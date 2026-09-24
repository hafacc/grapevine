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
# One thing stands in for the platform, named where it is created below: a
# minimal `auth` schema (GoTrue's, cut down to what the migrations and the
# tests actually touch). pgTAP is the real one wherever it can be had — see
# above the suite loop — and a stand-in only offline. Under `supabase test db`
# neither stand-in exists — the real `auth` schema and the real extension are
# already there — so a suite that passes here and fails there is a suite that
# depended on a stand-in, which is what keeping them this small is for.
#
# Another thing is not a stand-in but a reproduction: the platform's permissive
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

-- Where the platform keeps extensions, pgTAP among them under `supabase test
-- db`, and the search_path it gives every connection.
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;

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

# pgTAP, in the order of how faithful it is. Whichever is used lives in schema
# `extensions`, which is where `supabase test db` puts it and which the
# database's search_path names, as the platform's does.
#
# 1. The extension, if this PostgreSQL has it installed.
# 2. The real pgTAP source, pinned by tag and checksum, fetched once into a
#    cache and loaded as plain SQL. PostgreSQL before 18 reads extensions only
#    from its own share directory, which is not this script's to write, but
#    pgTAP is SQL throughout and needs no control file to run.
# 3. Offline with nothing cached: a stand-in for the functions the suites call.
#    It reproduces pgTAP's signatures and matching rules, and it is still a
#    copy — the suites once passed against a stand-in that read a three-argument
#    `throws_ok`'s third argument as a description where pgTAP reads the
#    expected error message, and every one of them failed in CI.
PGTAP_VERSION=1.3.3
PGTAP_SHA256=325ea79d0d2515bce96bce43f6823dcd3effbd6c54cb2a4d6c2384fffa3a14c7
PGTAP_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/grapevine/pgtap-$PGTAP_VERSION"

fetch_pgtap() {
  [ -f "$PGTAP_CACHE/sql/pgtap.sql.in" ] && return 0
  command -v curl >/dev/null || return 1
  local archive="$CLUSTER/pgtap.tar.gz"
  curl -fsSL -m 60 -o "$archive" \
    "https://github.com/theory/pgtap/archive/refs/tags/v$PGTAP_VERSION.tar.gz" 2>/dev/null || return 1
  local actual
  actual="$(shasum -a 256 "$archive" 2>/dev/null || sha256sum "$archive")"
  if [ "${actual%% *}" != "$PGTAP_SHA256" ]; then
    echo "pgtap: checksum mismatch on the v$PGTAP_VERSION archive; not using it" >&2
    return 1
  fi
  mkdir -p "$(dirname "$PGTAP_CACHE")"
  tar -xzf "$archive" -C "$CLUSTER"
  rm -rf "$PGTAP_CACHE"
  mv "$CLUSTER/pgtap-$PGTAP_VERSION" "$PGTAP_CACHE"
}

if psql -X -q -d "$PGDATABASE" -c 'create extension if not exists pgtap with schema extensions' >/dev/null 2>&1; then
  echo "pgtap: the installed extension"
elif fetch_pgtap; then
  echo "pgtap: v$PGTAP_VERSION from source ($PGTAP_CACHE)"
  # What pgTAP's own Makefile does to the file for PostgreSQL 10 and later.
  {
    echo "set search_path = extensions; set client_min_messages = warning;"
    sed -e "s/__OS__/$(uname -s | tr '[:upper:]' '[:lower:]')/g" \
        -e "s/__VERSION__/${PGTAP_VERSION%.*}/g" "$PGTAP_CACHE/sql/pgtap.sql.in"
  } | psql -X -v ON_ERROR_STOP=1 -q -o /dev/null -d "$PGDATABASE" -f -
else
  echo "pgtap: NOT INSTALLED and could not be fetched — using the stand-in below."
  echo "       \`supabase test db\` uses the real one; a pgTAP function the"
  echo "       stand-in does not define fails here as undefined."
  psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" <<'PGTAP_SHIM'
-- pgTAP's own definitions of what the suites call, reduced: same signatures and
-- overloads, same matching, same TAP lines and diagnostics, and a result table
-- in place of pgTAP's temp tables. Only `plan`, `_tap_record` and `finish`
-- touch it, as SECURITY DEFINER, because a suite calls `ok()` while it is
-- `set local role authenticated` and a table that role could write is exactly
-- what `15_structure` is there to catch.
set search_path = extensions;

create table extensions._tap_counter (ran int not null, failed int not null, planned int not null);

create function extensions.plan(integer) returns text
  language plpgsql security definer set search_path = ''
as $$
begin
  delete from extensions._tap_counter;
  insert into extensions._tap_counter values (0, 0, $1);
  return '1..' || $1;
end $$;

create function extensions._tap_record(p_passed boolean) returns integer
  language plpgsql security definer set search_path = ''
as $$
declare
  v_at int;
begin
  update extensions._tap_counter
     set ran = ran + 1, failed = failed + (case when p_passed then 0 else 1 end)
  returning ran into v_at;
  if v_at is null then
    raise exception 'You tried to run a test without a plan! Gotta have a plan';
  end if;
  return v_at;
end $$;

create function extensions.diag(msg text) returns text
  language sql strict
as $$
  select '# ' || replace(replace(replace($1, E'\r\n', E'\n# '), E'\n', E'\n# '), E'\r', E'\n# ');
$$;

create function extensions.ok(boolean, text) returns text
  language plpgsql
as $$
declare
  v_at int := extensions._tap_record(coalesce($1, false));
begin
  return (case $1 when true then '' else 'not ' end)
         || 'ok ' || v_at
         || case $2 when '' then '' else coalesce(' - ' || substr(extensions.diag($2), 3), '') end
         || case $1 when true then '' else E'\n' ||
              extensions.diag('Failed test ' || v_at
                              || case $2 when '' then '' else coalesce(': "' || $2 || '"', '') end)
              || case when $1 is null then E'\n' || extensions.diag('    (test result was NULL)') else '' end
            end;
end $$;

create function extensions.ok(boolean) returns text
  language sql
as $$ select extensions.ok($1, null); $$;

create function extensions.is(anyelement, anyelement, text) returns text
  language plpgsql
as $$
declare
  v_result boolean := not $1 is distinct from $2;
begin
  return extensions.ok(v_result, $3) || case v_result when true then '' else E'\n' || extensions.diag(
           '        have: ' || case when $1 is null then 'NULL' else $1::text end ||
        E'\n        want: ' || case when $2 is null then 'NULL' else $2::text end) end;
end $$;

create function extensions.is(anyelement, anyelement) returns text
  language sql
as $$ select extensions.is($1, $2, null); $$;

-- A statement with no whitespace in it is the name of a prepared statement.
create function extensions._query(text) returns text
  language sql
as $$
  select case when $1 like '"%' or $1 !~ '[[:space:]]' then 'EXECUTE ' || $1 else $1 end;
$$;

-- The description is the fourth argument. A third is the expected error
-- message, compared whole against SQLERRM.
create function extensions.throws_ok(text, char(5), text, text) returns text
  language plpgsql
as $$
declare
  v_descr text := coalesce($4, 'threw ' || $2 || ': ' || $3, 'threw ' || $2, 'threw ' || $3,
                           'threw an exception');
begin
  execute extensions._query($1);
  return extensions.ok(false, v_descr) || E'\n' || extensions.diag(
         '      caught: no exception' || E'\n      wanted: ' || coalesce($2, 'an exception'));
exception when others or assert_failure then
  if ($2 is null or sqlstate = $2) and ($3 is null or sqlerrm = $3) then
    return extensions.ok(true, v_descr);
  else
    return extensions.ok(false, v_descr) || E'\n' || extensions.diag(
             '      caught: ' || sqlstate || ': ' || sqlerrm ||
          E'\n      wanted: ' || coalesce($2, 'an exception') || coalesce(': ' || $3, ''));
  end if;
end $$;

-- Three arguments are (sql, errcode, errmsg) when the second is five bytes
-- long and (sql, errmsg, description) otherwise; neither is a description
-- after an errcode.
create function extensions.throws_ok(text, text, text) returns text
  language plpgsql
as $$
begin
  if octet_length($2) = 5 then
    return extensions.throws_ok($1, $2::char(5), $3, null);
  else
    return extensions.throws_ok($1, null, $2, $3);
  end if;
end $$;

create function extensions.throws_ok(text, text) returns text
  language plpgsql
as $$
begin
  if octet_length($2) = 5 then
    return extensions.throws_ok($1, $2::char(5), null, null);
  else
    return extensions.throws_ok($1, null, $2, null);
  end if;
end $$;

create function extensions.throws_ok(text) returns text
  language sql
as $$ select extensions.throws_ok($1, null::char(5), null, null); $$;

create function extensions.throws_ok(text, int4, text, text) returns text
  language sql
as $$ select extensions.throws_ok($1, $2::char(5), $3, $4); $$;

create function extensions.throws_ok(text, int4, text) returns text
  language sql
as $$ select extensions.throws_ok($1, $2::char(5), $3, null); $$;

create function extensions.throws_ok(text, int4) returns text
  language sql
as $$ select extensions.throws_ok($1, $2::char(5), null, null); $$;

create function extensions.lives_ok(text, text) returns text
  language plpgsql
as $$
begin
  execute extensions._query($1);
  return extensions.ok(true, $2);
exception when others or assert_failure then
  return extensions.ok(false, $2) || E'\n' || extensions.diag('    died: ' || sqlstate || ': ' || sqlerrm);
end $$;

create function extensions.lives_ok(text) returns text
  language sql
as $$ select extensions.lives_ok($1, null); $$;

create function extensions.finish(exception_on_failure boolean default null) returns setof text
  language plpgsql security definer set search_path = ''
as $$
declare
  v_row extensions._tap_counter%rowtype;
begin
  select * into v_row from extensions._tap_counter;
  if v_row.ran is null or v_row.ran = 0 then
    raise exception '# No tests run!';
  end if;
  if v_row.ran <> v_row.planned then
    return next extensions.diag('Looks like you planned ' || v_row.planned || ' test'
      || case v_row.planned when 1 then '' else 's' end || ' but ran ' || v_row.ran);
  elsif v_row.failed > 0 then
    if exception_on_failure then
      raise exception '% test% failed of %', v_row.failed,
        case v_row.failed when 1 then '' else 's' end, v_row.planned;
    end if;
    return next extensions.diag('Looks like you failed ' || v_row.failed || ' test'
      || case v_row.failed when 1 then '' else 's' end || ' of ' || v_row.planned);
  end if;
end $$;
PGTAP_SHIM
fi

# `0002_grants.sql` revokes EXECUTE from PUBLIC on every routine created after
# it, and pgTAP is created after it here. On the platform the extension is owned
# by a role that revoke does not reach, and the three client roles can call
# what is in `extensions`, which is what a suite needs once it has `set local
# role authenticated`.
psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" \
  -c 'grant execute on all routines in schema extensions to anon, authenticated, service_role'

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
  bad="$(grep -c '^not ok\|^# Looks like you planned' <<<"$output" || true)"
  total=$((total + ran))
  failed=$((failed + bad))
  printf '  %-34s %3d assertions%s\n' "$name" "$ran" "$([ "$bad" -gt 0 ] && echo "  $bad FAILED" || echo "")"
  [ "$bad" -gt 0 ] && grep -A3 '^not ok\|^# Looks like you planned' <<<"$output" | sed 's/^/        /'
done

echo
echo "$total assertions, $failed failed"
[ "$failed" -eq 0 ]
