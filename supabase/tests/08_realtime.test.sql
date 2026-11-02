-- What Realtime may broadcast (`0004_realtime.sql`). The live channel and the
-- read policies are two mechanisms, and a table absent from the publication
-- subscribes successfully and delivers nothing, which presents as a screen
-- that is a little stale and survives a release.
--
-- `web/tests/realtime.test.ts` is the other half: it fails if the client
-- subscribes to a table this file does not publish.

begin;
select plan(8);

select is(
  (select count(*)::int from pg_publication where pubname = 'supabase_realtime'),
  1, 'the publication exists');

select is(
  (select string_agg(tablename, ',' order by tablename)
   from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'),
  'follows',
  'and carries the one table the client listens to');

-- A policy is evaluated against a row, and a deleted row is gone, so row-level
-- security cannot be applied to a DELETE: every subscriber whose filter matches
-- receives it, carrying the replica identity, which for `follows` is both
-- uuids. A client subscribing with no filter would get a pair for every
-- unfollow in the instance, which is who follows whom, globally.
select ok(
  (select not pubdelete from pg_publication where pubname = 'supabase_realtime'),
  'and publishes no delete events, which row-level security cannot bound');
select ok(
  (select pubinsert and pubupdate from pg_publication where pubname = 'supabase_realtime'),
  'while inserts and updates, which it can, are published');
select ok(
  (select not pubtruncate from pg_publication where pubname = 'supabase_realtime'),
  'and a truncate reaches nobody either');

-- Membership is not itself a decision to publish anything: what a subscriber
-- receives is what their own SELECT policy admits, evaluated as them. So a
-- published table must be under row-level security with a policy that names
-- the viewer, or it would broadcast every row to everybody.
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and tablename = 'follows' and not rowsecurity),
  0, 'the published table is under row-level security');
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'follows' and cmd = 'SELECT'
     and qual like '%follower_id = ( SELECT auth.uid()%'
     and qual like '%followed_id = ( SELECT auth.uid()%'),
  1, 'and a new follow reaches its two ends, which is how somebody learns they are followed');
-- Thumbs are fetched when `followed_stamps` says they moved; a row event for
-- each would be thousands for one import.
select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename in ('ratings', 'profiles', 'items')),
  0, 'and no thumb, profile or name is broadcast');

select * from finish();
rollback;
