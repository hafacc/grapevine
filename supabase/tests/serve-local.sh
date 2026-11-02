#!/usr/bin/env bash
# A local stack for the app and the browser tests, on a machine with no Docker.
#
# `supabase start` is the real one and needs Docker. This serves the same
# database `run-local.sh` tests (`local-cluster.sh`: every migration over a
# throwaway cluster, with the same stand-ins) at the addresses the real stack
# uses, so `web`'s `dev:local`, `seed:local` and the `e2e` tests run
# against either without knowing which:
#
#   127.0.0.1:54322   PostgreSQL, `postgres:postgres`, database `postgres`
#   127.0.0.1:54321   the API: `/rest/v1` is PostgREST, and `/auth/v1` answers
#                     the two calls supabase-js makes with a session it was
#                     handed (`web/scripts/local-gateway.mjs`)
#
#   bash supabase/tests/serve-local.sh        # shell 1: up, until Ctrl-C
#   cd web && bun dev:local               # shell 2: the app on :3001, by hand
#   cd web && bun e2e:stack               # or the browser tests, which serve
#                                         # the app themselves
#   bash supabase/tests/serve-local.sh stop   # from anywhere, instead of Ctrl-C
#
# The database lives only while this runs: stopping it deletes it, and starting
# it again is every migration from zero, which is this stack's `supabase db
# reset`.
#
# What it is not:
#
#   - GoTrue. Nothing issues, refreshes or revokes a session. A test signs
#     its own against the stack's well-known JWT secret
#     (`web/e2e/local-session.ts`), which PostgREST verifies as the real
#     one does.
#   - Realtime. The app's channels never join, so a change made elsewhere shows
#     on the next load, and after a while the app says it has stopped receiving
#     updates. That banner is this stack, not a defect.
#   - The platform's PostgreSQL. It is whatever `initdb` is on PATH, with the
#     `auth` and Vault stand-ins and no `pg_cron`, so nothing scheduled runs.
#
# Needs `initdb`, `pg_ctl`, `psql` (a PostgreSQL install), `postgrest` and
# `node` on PATH.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

DB_PORT=54322
API_PORT=54321
# PostgREST itself, behind the gateway. Nothing outside this script names it.
REST_PORT="${GRAPEVINE_REST_PORT:-54399}"
# What `supabase start` signs with on every machine. It authorizes nothing
# anywhere else; `web/tests/local-stack.test.ts` pins it to the tests' copy.
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"

# A fixed place, so `stop` finds what another shell started, and a short one:
# a socket's path may not pass about a hundred bytes, which macOS's own TMPDIR
# nearly spends.
STACK="${GRAPEVINE_STACK_DIR:-/tmp/grapevine-local-stack-$(id -u)}"
CLUSTER="$STACK"
PGPORT="$DB_PORT"
PGDATABASE=postgres
CLUSTER_LISTEN=127.0.0.1

# shellcheck source=supabase/tests/local-cluster.sh
source "$HERE/local-cluster.sh"

alive() {
  [ -f "$STACK/$1.pid" ] && kill -0 "$(cat "$STACK/$1.pid")" 2>/dev/null
}

listening() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

teardown() {
  local name
  for name in gateway postgrest; do
    if alive "$name"; then kill "$(cat "$STACK/$name.pid")" 2>/dev/null || true; fi
  done
  if [ -d "$STACK/data" ]; then stop_cluster; fi
  rm -rf "$STACK"
}

if [ "${1:-}" = stop ]; then
  if alive serve; then
    serving="$(cat "$STACK/serve.pid")"
    kill "$serving"
    for _ in $(seq 1 50); do
      kill -0 "$serving" 2>/dev/null || break
      sleep 0.2
    done
    echo "stopped"
  elif [ -d "$STACK" ]; then
    # Whatever a killed run left behind: its trap never ran.
    teardown
    echo "stopped (cleared what an earlier run left)"
  else
    echo "nothing is up"
  fi
  exit 0
elif [ $# -gt 0 ]; then
  echo "usage: serve-local.sh [stop]" >&2
  exit 2
fi

for tool in initdb pg_ctl psql postgrest node; do
  command -v "$tool" >/dev/null || {
    echo "serve-local.sh needs \`$tool\` on PATH, and it is not there." >&2
    echo "  initdb, pg_ctl, psql: a PostgreSQL install (brew install postgresql@17)" >&2
    echo "  postgrest:            brew install postgrest" >&2
    echo "  node:                 any current Node.js" >&2
    exit 1
  }
done

if alive serve; then
  echo "already up (pid $(cat "$STACK/serve.pid")). \`bash supabase/tests/serve-local.sh stop\` stops it." >&2
  exit 1
fi

for port in "$DB_PORT" "$API_PORT" "$REST_PORT"; do
  if listening "$port"; then
    echo "port $port is taken, so this would be serving beside something else." >&2
    echo "  a real stack:        supabase stop" >&2
    echo "  an earlier run here: bash supabase/tests/serve-local.sh stop" >&2
    exit 1
  fi
done

teardown
mkdir -p "$STACK"
echo $$ >"$STACK/serve.pid"
trap teardown EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "building the database"
start_cluster
bootstrap_platform

psql -X -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" <<'SERVED'
-- The password the real stack's `postgres` has, which every test's
-- connection string carries.
alter role postgres password 'postgres';

-- Who PostgREST connects as, before it becomes the role a token names.
create role authenticator noinherit login password 'postgres';
grant anon, authenticated, service_role to authenticator;

-- GoTrue's own columns that a test's account row names (`authUserRow` in
-- `web/e2e/local-session.ts`): the real server will not read a row back
-- without them, so the tests write them, and the stand-in has to take them.
alter table auth.users
  add column instance_id                 uuid,
  add column aud                         text,
  add column role                        text,
  add column encrypted_password          text,
  add column raw_app_meta_data           jsonb,
  add column updated_at                  timestamptz,
  add column confirmation_token          text,
  add column recovery_token              text,
  add column email_change_token_new      text,
  add column email_change                text,
  add column email_change_token_current  text,
  add column phone_change                text,
  add column phone_change_token          text,
  add column reauthentication_token      text;
SERVED

apply_migrations

# Every setting `supabase/config.toml` gives the real API, as PostgREST's own
# environment: no file to keep beside this one.
PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:$DB_PORT/$PGDATABASE" \
PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon \
PGRST_DB_EXTRA_SEARCH_PATH="public, extensions" \
PGRST_DB_MAX_ROWS=1000 \
PGRST_JWT_SECRET="$JWT_SECRET" \
PGRST_SERVER_HOST=127.0.0.1 \
PGRST_SERVER_PORT="$REST_PORT" \
  postgrest >"$STACK/postgrest.log" 2>&1 &
echo $! >"$STACK/postgrest.pid"

GATEWAY_PORT="$API_PORT" REST_PORT="$REST_PORT" JWT_SECRET="$JWT_SECRET" \
  node "$ROOT/web/scripts/local-gateway.mjs" >"$STACK/gateway.log" 2>&1 &
echo $! >"$STACK/gateway.pid"

for name in postgrest gateway; do
  port="$REST_PORT"
  if [ "$name" = gateway ]; then port="$API_PORT"; fi
  for _ in $(seq 1 100); do
    if listening "$port"; then break; fi
    alive "$name" || break
    sleep 0.1
  done
  if ! alive "$name" || ! listening "$port"; then
    echo "$name did not come up:" >&2
    sed 's/^/  /' "$STACK/$name.log" >&2
    exit 1
  fi
done

cat <<UP

the local stack is up (no Docker: no GoTrue, no Realtime)

  API       http://127.0.0.1:$API_PORT      /rest/v1, and /auth/v1 for a minted session
  database  postgresql://postgres:postgres@127.0.0.1:$DB_PORT/$PGDATABASE
  logs      $STACK/{postgres,postgrest,gateway}.log

  cd web && bun dev:local     the app on http://localhost:3001
  cd web && bun seed:local    a simulated world into it
  cd web && bun e2e:stack     the browser tests against it

Ctrl-C, or \`bash supabase/tests/serve-local.sh stop\`, stops it and deletes the database.
UP

while alive postgrest && alive gateway; do
  sleep 1
done
echo "a server exited; stopping. its log:" >&2
for name in postgrest gateway; do
  alive "$name" || sed 's/^/  /' "$STACK/$name.log" >&2
done
exit 1
