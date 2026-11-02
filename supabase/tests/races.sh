#!/usr/bin/env bash
# What has to hold across connections, and so cannot be shown by a pgTAP
# suite, which is one session and interleaves nothing. Each case here runs on
# two connections, with one transaction held open while the other starts.
#
# 1. The lock: an account that follows no person has no link, however the
#    transactions that got it there overlapped.
# 2. Reading changes: a follower who applies each `account_thumbs_since`
#    answer on top of the last ends with the account's thumbs, even when it
#    read beside a writer that had not committed.
#
# NOT run by `run-local.sh`, and not in CI. Run it by hand after touching
# `private.revoke_link_if_locked`, `public.set_invite_link`,
# `public.redeem_invite` or `private.is_unlocked` (the first), or
# `private.next_revision`, the triggers on `ratings` or
# `public.account_thumbs_since` (the second):
#
#   bash supabase/tests/races.sh
#
# It builds its own throwaway cluster the way `run-local.sh` does
# (`local-cluster.sh`), on GRAPEVINE_RACES_PGPORT (default 55434) so the two
# can run at once, and needs `initdb`, `pg_ctl` and `psql` on PATH. Each case
# takes about two seconds, which is how long the first transaction is held.
#
# Without the row lock in `revoke_link_if_locked` the first two cases fail;
# without the one in `set_invite_link`, the third. With revisions drawn from a
# sequence instead of the account's locked counter row, the two-writer cases fail.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

CLUSTER="$(mktemp -d "${TMPDIR:-/tmp}/grapevine-races.XXXXXX")"
PGPORT="${GRAPEVINE_RACES_PGPORT:-55434}"
PGDATABASE=grapevine_races

# shellcheck source=supabase/tests/local-cluster.sh
source "$HERE/local-cluster.sh"

cleanup() {
  stop_cluster
  rm -rf "$CLUSTER"
}
trap cleanup EXIT

start_cluster
bootstrap_platform
apply_migrations

U=11111111-1111-1111-1111-111111111111
P1=22222222-2222-2222-2222-222222222222
P2=33333333-3333-3333-3333-333333333333
TOKEN=RaceTokenRaceTokenRaceTokenRaceTokenRaceTok

run() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$PGDATABASE" "$@"; }

# U follows whoever is named, and holds a link when asked to.
world() {
  local with_link="$1"; shift
  run -c "delete from auth.users" >/dev/null
  run -c "insert into auth.users (id, email, email_confirmed_at) values
            ('$U', 'u@example.com', now()), ('$P1', 'p1@example.com', now()),
            ('$P2', 'p2@example.com', now())" >/dev/null
  local followed
  for followed in "$@"; do
    run -c "insert into public.follows (follower_id, followed_id) values ('$U', '$followed')" >/dev/null
  done
  if [ "$with_link" = link ]; then
    run -c "insert into public.invite_links (owner_id, token) values ('$U', '$TOKEN')" >/dev/null
  fi
}

# A statement as U's own signed-in session.
as_u() {
  printf "set local role authenticated; set local request.jwt.claims = '{\"sub\":\"%s\",\"role\":\"authenticated\"}'; %s" "$U" "$1"
}

# Runs the first transaction, holds it open two seconds, and starts the second
# half a second in. Neither is allowed to fail the script: a refusal is one of
# the outcomes being checked.
overlap() {
  (run -c "begin; $1; select pg_sleep(2); commit;" >/dev/null 2>&1 || true) &
  sleep 0.5
  run -c "begin; $2; commit;" >/dev/null 2>&1 || true
  wait
}

failed=0
check() {
  local name="$1"
  local links locked
  links="$(run -c "select count(*) from public.invite_links where owner_id = '$U'")"
  locked="$(run -c "select not private.is_unlocked('$U')")"
  if [ "$locked" = t ] && [ "$links" != 0 ]; then
    echo "  FAILED $name: locked, with a live link"
    failed=$((failed + 1))
  else
    echo "  ok     $name"
  fi
}

world link "$P1" "$P2"
overlap "delete from public.follows where follower_id = '$U' and followed_id = '$P1'" \
        "delete from public.follows where follower_id = '$U' and followed_id = '$P2'"
check "the last two follows deleted in overlapping transactions"

world link "$P1" "$P2"
overlap "delete from auth.users where id = '$P1'" \
        "delete from public.follows where follower_id = '$U' and followed_id = '$P2'"
check "one of the last two deleting their account while the other is unfollowed"

world nolink "$P1"
overlap "delete from public.follows where follower_id = '$U' and followed_id = '$P1'" \
        "$(as_u "select public.set_invite_link()")"
check "a link made while the loss of the last follow is uncommitted"

world nolink "$P1"
overlap "$(as_u "select public.set_invite_link()")" \
        "delete from public.follows where follower_id = '$U' and followed_id = '$P1'"
check "the last follow lost while a link being made is uncommitted"

# U follows P1, who has one thumb, and has read it: U holds revision 1.
since() {
  run -c "begin; $(as_u "select public.account_thumbs_since('$P1', $1, 0)"); commit;" | tail -1
}
expect() {
  if [ "$2" = "$3" ]; then
    echo "  ok     $1"
  else
    echo "  FAILED $1"
    echo "         have: $2"
    echo "         want: $3"
    failed=$((failed + 1))
  fi
}
rate() {
  printf "insert into public.ratings (user_id, item_id, value) values ('%s', '%s', 1)" "$P1" "$1"
}

world nolink "$P1"
run -c "$(rate first)" >/dev/null
(run -c "begin; $(rate second); select pg_sleep(2); commit;" >/dev/null) &
sleep 0.5
beside="$(since 1)"
wait
expect "a reader beside an uncommitted writer is answered at the revision before it, and is not made to wait" \
  "$beside" '{"full": false, "thumbs": {}, "cleared": [], "removed": 0, "revision": 1}'
expect "and its next read, from that revision, carries what the writer wrote" \
  "$(since 1)" '{"full": false, "thumbs": {"second": {"": 1}}, "cleared": [], "removed": 0, "revision": 2}'

# Two writers to one account, overlapping: the second takes its revision only
# once the first has committed, so a reader in between is never answered at a
# revision above a change it was not given.
world nolink "$P1"
run -c "$(rate first)" >/dev/null
(run -c "begin; $(rate second); select pg_sleep(2); commit;" >/dev/null) &
sleep 0.5
(run -c "$(rate third)" >/dev/null) &
sleep 0.5
between="$(since 1)"
wait
expect "a reader between two overlapping writers sees neither" \
  "$between" '{"full": false, "thumbs": {}, "cleared": [], "removed": 0, "revision": 1}'
expect "and then both, each at its own revision" \
  "$(since 1)" '{"full": false, "thumbs": {"third": {"": 1}, "second": {"": 1}}, "cleared": [], "removed": 0, "revision": 3}'
expect "and the later writer took the later revision" \
  "$(run -c "select string_agg(item_id || '=' || revision, ',' order by revision) from public.ratings where user_id = '$P1'")" \
  'first=1,second=2,third=3'

echo
echo "$failed failed"
[ "$failed" -eq 0 ]
