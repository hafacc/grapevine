-- What Realtime may broadcast (`0006_realtime.sql`). The live channel and the
-- read policies are two mechanisms, and a table absent from the publication
-- subscribes successfully and delivers nothing — which presents as a feed that
-- is a little stale and survives a release.
--
-- `web/tests/realtime.test.ts` is the other half: it fails if the client
-- subscribes to a table this file does not publish.

begin;
select plan(9);

select is(
  (select count(*)::int from pg_publication where pubname = 'supabase_realtime'),
  1, 'the publication exists');

select is(
  (select string_agg(tablename, ',' order by tablename)
   from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'),
  'connect_requests,friendships,user_recs',
  'and carries the three tables the client listens to');

-- A policy is evaluated against a row, and a deleted row is gone, so RLS cannot
-- be applied to a DELETE: every subscriber whose filter matches receives it,
-- carrying the replica identity — for `connect_requests`, both uuids. A client
-- subscribing with no filter would get a pair for every accept, decline and
-- withdrawal in the instance, which is who-knows-whom globally, and DESIGN §4
-- says friend lists are private.
select ok(
  (select not pubdelete from pg_publication where pubname = 'supabase_realtime'),
  'and publishes no delete events, which RLS cannot bound');
select ok(
  (select pubinsert and pubupdate from pg_publication where pubname = 'supabase_realtime'),
  'while inserts and updates, which it can, are published');
select ok(
  (select not pubtruncate from pg_publication where pubname = 'supabase_realtime'),
  'and a truncate reaches nobody either');

-- Membership is not itself a decision to publish anything: what a subscriber
-- receives is what their own SELECT policy admits, evaluated as them. So the
-- three published tables must each be under RLS with a policy that names the
-- viewer — a published table with RLS off would broadcast every row to
-- everybody.
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public'
     and tablename in ('user_recs', 'connect_requests', 'friendships')
     and not rowsecurity),
  0, 'each published table is under row-level security');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'user_recs' and cmd = 'SELECT'
     and qual like '%auth.uid()%'),
  1, 'a feed reaches its owner and nobody else');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'connect_requests' and cmd = 'SELECT'
     and qual like '%auth.uid()%'),
  1, 'a request reaches its two parties');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'friendships' and cmd = 'SELECT'
     and qual like '%auth.uid()%'),
  1, 'and a new edge — the accept signal that replaces the delete — its two ends');

select * from finish();
rollback;
