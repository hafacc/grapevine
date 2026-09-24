#!/usr/bin/env bash
# The pgTAP suites, on a machine with no Docker.
#
# `supabase test db` is the real runner and what CI uses. It needs the local
# stack, which needs Docker. This brings up a throwaway cluster with whatever
# `initdb` is on PATH, applies every migration to it, and runs the same files.
# The platform runs `major_version = 17` (supabase/config.toml) and this cluster
# is whatever is installed, so a version difference is one more thing that can
# pass here and fail under `supabase test db`.
#
#   bash supabase/tests/run-local.sh              # all of them
#   bash supabase/tests/run-local.sh 09_items     # one, by prefix
#
# Two things stand in for the platform, and both are named where they are
# created below: a minimal `auth` schema (GoTrue's, cut down to what the
# migrations and the tests actually touch) and, if the pgTAP extension is not
# installed, the six pgTAP functions the suites use. Under `supabase test db`
# neither stand-in exists — the real `auth` schema and the real extension are
# already there — so a suite that passes here and fails there is a suite that
# depended on a stand-in, which is what keeping them this small is for.
#
# A third thing is not a stand-in but a reproduction: the platform's permissive
# grant baseline, applied below before any migration. Without it the cluster
# starts at nothing, every `revoke` in the migrations is a no-op, and the suites
# pass by testing an empty room — easier than the database being shipped to,
# which is the wrong direction for a test to be wrong in.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"
FILTER="${1:-}"

CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/grapevine-pgtap.XXXXXX")"
PGPORT="${GRAPEVINE_PGPORT:-55432}"
export PGHOST="$CLUSTER/socket"
export PGPORT
export PGDATABASE=grapevine_test
export PGUSER
PGUSER="$(id -un)"

cleanup() {
  pg_ctl -D "$CLUSTER/data" -s -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$CLUSTER"
}
trap cleanup EXIT

mkdir -p "$CLUSTER/socket"
initdb -D "$CLUSTER/data" -U "$PGUSER" --auth=trust --no-sync -E UTF8 >/dev/null
pg_ctl -D "$CLUSTER/data" -s -o "-p $PGPORT -k '$CLUSTER/socket' -c listen_addresses='' -c wal_level=logical" -w start >/dev/null
createdb "$PGDATABASE"

psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" <<'BOOTSTRAP'
-- The three roles PostgREST hands a request to. `nologin` because nothing
-- connects as one; a test reaches them with `set local role`, which needs the
-- bootstrap superuser to be a member.
-- `0002_grants.sql` names `postgres` explicitly, because on the platform that
-- is the role migrations run as and default privileges belong to whoever set
-- them. Here the bootstrap superuser is whoever ran this script.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres superuser login;
  end if;
end $$;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
do $$ begin execute format('grant anon, authenticated, service_role to %I', current_user); end $$;

-- The platform's own grant baseline, installed BEFORE the migrations, because
-- that is the database they actually run against. Supabase hands `anon` and
-- `authenticated` everything in `public` and then goes on handing it to them
-- through default privileges, so a migration that revokes only what exists is
-- one `create table` away from shipping a readable one. A bare cluster starts
-- with both roles holding nothing, which is the one state in which a missing
-- revoke cannot fail.
grant all on all tables    in schema public to anon, authenticated;
grant all on all routines  in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on routines  to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated;
alter default privileges for role postgres in schema public grant all on routines  to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;

-- GoTrue's schema, cut to what the migrations and the suites touch. The real one
-- has forty more columns, all nullable or defaulted, so an insert that works
-- here works there — which is the only property this stand-in has to have.
create schema auth;

create table auth.users (
  id                  uuid primary key,
  email               text,
  phone               text,
  email_confirmed_at  timestamptz,
  phone_confirmed_at  timestamptz,
  is_anonymous        boolean not null default false,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create table auth.identities (
  provider       text not null,
  provider_id    text not null,
  user_id        uuid not null references auth.users (id) on delete cascade,
  identity_data  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (provider, provider_id)
);

-- Verbatim from the platform: a session is a GUC, so `set local
-- request.jwt.claims` is how a test becomes somebody. `request.jwt.claim.sub`
-- is the older spelling and is still read first, exactly as upstream does.
create function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

create function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant select on auth.users, auth.identities to service_role;

-- `0005_cron.sql` schedules three statements. pg_cron is a compiled extension and
-- is not installed here; a suite that needs a statement runs its text by hand,
-- so the stand-in records the schedule and runs nothing.
create schema cron;
create table cron.job (
  jobid    bigint generated always as identity primary key,
  jobname  text,
  schedule text,
  command  text
);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
  language sql
as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
  returning jobid;
$$;
BOOTSTRAP

for migration in "$MIGRATIONS"/*.sql; do
  # The one line the stand-in cannot satisfy: pg_cron has no control file here,
  # so `create extension` would fail before the schedule calls it guards.
  sed 's/^create extension if not exists pg_cron;/-- pg_cron: stubbed by run-local.sh/' "$migration" \
    | psql -X -v ON_ERROR_STOP=1 -q -o /dev/null -d "$PGDATABASE" -f - \
    || { echo "migration failed: $(basename "$migration")" >&2; exit 1; }
done

if psql -X -q -d "$PGDATABASE" -c 'create extension if not exists pgtap' >/dev/null 2>&1; then
  echo "pgtap: the real extension"
else
  echo "pgtap: NOT INSTALLED — using the stand-in below (six functions, plain SQL)."
  echo "       \`supabase test db\` uses the real one; anything relying on pgTAP"
  echo "       beyond plan/ok/is/throws_ok/lives_ok/finish will not run here."
  psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" <<'PGTAP_SHIM'
-- The six pgTAP functions the suites use, and nothing else. Each returns the
-- TAP line the real one returns, so the same files produce the same output
-- under `pg_prove` and under the loop at the foot of this script.
--
-- SECURITY DEFINER throughout, and the counter carries no grant, because a
-- suite calls `ok()` while it is `set local role authenticated` — and a table
-- that role could write is exactly what `15_structure` is there to catch.
create table public._tap_counter (ran int not null, failed int not null, planned int not null);

create function public.plan(p_count int) returns setof text
  language plpgsql security definer
as $$
begin
  delete from public._tap_counter;
  insert into public._tap_counter values (0, 0, p_count);
  return next '1..' || p_count;
end $$;

create function public.ok(p_result boolean, p_description text default '') returns text
  language plpgsql security definer
as $$
declare
  v_at int;
begin
  update public._tap_counter
     set ran = ran + 1, failed = failed + (case when coalesce(p_result, false) then 0 else 1 end)
  returning ran into v_at;
  return (case when coalesce(p_result, false) then 'ok ' else 'not ok ' end)
         || v_at || ' - ' || p_description;
end $$;

create function public.is(p_have anyelement, p_want anyelement, p_description text default '')
  returns text language sql
as $$
  select public.ok(p_have is not distinct from p_want,
                   p_description || coalesce(' (have ' || p_have::text || ', want ' || p_want::text || ')', ''));
$$;

create function public.throws_ok(p_sql text, p_errcode text, p_description text default '')
  returns text language plpgsql security invoker
as $$
begin
  execute p_sql;
  return public.ok(false, p_description || ' [no error raised]');
exception
  when others then
    if p_errcode is null or sqlstate = p_errcode then
      return public.ok(true, p_description);
    else
      return public.ok(false, p_description || ' [' || sqlstate || ', wanted ' || p_errcode || ']');
    end if;
end $$;

create function public.lives_ok(p_sql text, p_description text default '')
  returns text language plpgsql security invoker
as $$
begin
  execute p_sql;
  return public.ok(true, p_description);
exception
  when others then
    return public.ok(false, p_description || ' [' || sqlstate || ': ' || sqlerrm || ']');
end $$;

create function public.finish() returns setof text
  language plpgsql security definer
as $$
declare
  v_row public._tap_counter%rowtype;
begin
  select * into v_row from public._tap_counter;
  if v_row.ran <> v_row.planned then
    return next 'not ok - planned ' || v_row.planned || ' but ran ' || v_row.ran;
  end if;
end $$;

grant execute on function public.plan(int), public.ok(boolean, text), public.finish() to public;
grant execute on function public.is(anyelement, anyelement, text) to public;
grant execute on function public.throws_ok(text, text, text), public.lives_ok(text, text) to public;
PGTAP_SHIM
fi

total=0
failed=0
for suite in "$TESTS"/*.test.sql; do
  name="$(basename "$suite" .test.sql)"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then continue; fi
  output="$(psql -X -t -A -v ON_ERROR_STOP=1 -d "$PGDATABASE" -f "$suite" 2>&1)" || {
    echo "  ERROR $name"
    echo "$output" | sed 's/^/        /'
    failed=$((failed + 1))
    continue
  }
  ran="$(grep -c '^ok \|^not ok ' <<<"$output" || true)"
  bad="$(grep -c '^not ok' <<<"$output" || true)"
  total=$((total + ran))
  failed=$((failed + bad))
  printf '  %-34s %3d assertions%s\n' "$name" "$ran" "$([ "$bad" -gt 0 ] && echo "  $bad FAILED" || echo "")"
  [ "$bad" -gt 0 ] && grep '^not ok' <<<"$output" | sed 's/^/        /'
done

echo
echo "$total assertions, $failed failed"
[ "$failed" -eq 0 ]
