# shellcheck shell=bash
# The throwaway PostgreSQL cluster `run-local.sh` runs the suites in and
# `serve-local.sh` serves the app from. Sourced, never run: one copy, so the
# database a suite passes against and the one a browser check drives are built
# by the same statements.
#
# Two things stand in for the platform, named where they are created below: a
# minimal `auth` schema (GoTrue's, cut down to what the migrations and the
# tests actually touch), and Supabase Vault, reduced to one view and one call.
# Under `supabase start` neither stand-in exists (the real `auth` schema and
# the real extension are already there), so something that passes here and
# fails there depended on a stand-in, which is what keeping them this small is
# for.
#
# Another thing is not a stand-in but a reproduction: the platform's permissive
# grant baseline, applied before any migration. Without it the cluster starts
# at nothing, every `revoke` in the migrations is a no-op, and the suites pass
# by testing an empty room — easier than the database being shipped to, which
# is the wrong direction for a test to be wrong in.
#
# The caller sets CLUSTER (a directory this may fill), PGPORT, PGDATABASE and
# MIGRATIONS, and CLUSTER_LISTEN when anything is to reach the cluster over
# TCP. It owns stopping the cluster and removing the directory.

# Starts an empty cluster under $CLUSTER and points every later `psql` at it.
#
# The superuser is whoever ran the script, over the socket and with no
# password. A TCP connection has to present one, so a cluster that listens is
# not open to every process on the machine as a superuser.
start_cluster() {
  export PGHOST="$CLUSTER/socket"
  export PGPORT PGDATABASE
  export PGUSER
  PGUSER="$(id -un)"

  mkdir -p "$CLUSTER/socket"
  initdb -D "$CLUSTER/data" -U "$PGUSER" --auth-local=trust --auth-host=scram-sha-256 \
    --no-sync -E UTF8 >/dev/null
  pg_ctl -D "$CLUSTER/data" -s -l "$CLUSTER/postgres.log" \
    -o "-p $PGPORT -k '$CLUSTER/socket' -c listen_addresses='${CLUSTER_LISTEN:-}' -c wal_level=logical" \
    -w start >/dev/null
  # `initdb` already made one called `postgres`.
  [ "$PGDATABASE" = postgres ] || createdb "$PGDATABASE"
}

stop_cluster() {
  pg_ctl -D "$CLUSTER/data" -s -m immediate stop >/dev/null 2>&1 || true
}

# What the platform has in a database before the first migration runs.
bootstrap_platform() {
  psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" <<'BOOTSTRAP'
-- The three roles PostgREST hands a request to. `nologin` because nothing
-- connects as one; a test reaches them with `set local role`, which needs the
-- bootstrap superuser to be a member.
-- The first migration names `postgres` explicitly, because on the platform
-- that is the role migrations run as and default privileges belong to whoever
-- set them. Here the bootstrap superuser is whoever ran this script.
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
  -- No default, as on the platform: a suite that leaves it out fails here too.
  identity_data  jsonb not null,
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

-- Supabase Vault, cut to the view and the call the migrations use. The real one keeps
-- the secret encrypted under a key outside the database; this keeps it plain,
-- which changes nothing a suite can observe.
create schema vault;
create table vault.secrets (
  id           uuid primary key default gen_random_uuid(),
  name         text unique,
  description  text not null default '',
  secret       text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(
  new_secret text, new_name text default null, new_description text default '',
  new_key_id uuid default null) returns uuid
  language sql
as $$
  insert into vault.secrets (secret, name, description)
  values (new_secret, new_name, new_description)
  returning id;
$$;

-- The migrations schedule six statements. pg_cron is a compiled extension and
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
}

apply_migrations() {
  local migration
  for migration in "$MIGRATIONS"/*.sql; do
    # The one line the stand-in cannot satisfy: pg_cron has no control file
    # here, so `create extension` would fail before the schedule calls it guards.
    sed 's/^create extension if not exists pg_cron;/-- pg_cron: stubbed by local-cluster.sh/' "$migration" \
      | psql -X -v ON_ERROR_STOP=1 -q -o /dev/null -d "$PGDATABASE" -f - \
      || { echo "migration failed: $(basename "$migration")" >&2; return 1; }
  done
}
