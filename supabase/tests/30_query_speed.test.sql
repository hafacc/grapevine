-- What 0017 changed about how three queries run, where a later
-- `create or replace` could undo it without any other suite noticing.
-- 28_rating_order pins what `load_nodes` returns, 26_reports what
-- `remove_name` leaves in a feed, and 17 and 24 that an account deletion goes
-- through.

begin;
select plan(3);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com', now());

select is(
  (select row(friend_ids, ratings)::text from private.load_nodes(
     '11111111-1111-1111-1111-111111111111',
     array['33333333-3333-3333-3333-333333333333']::uuid[])),
  row('{}'::uuid[], '{}'::jsonb)::text,
  'someone with no friends and no thumbs loads as two empty values, not nulls');

-- A merge join rereads the viewer's own thumbs once per person loaded.
select ok(
  (select 'enable_mergejoin=off' = any (p.proconfig)
     from pg_proc p where p.oid = 'private.load_nodes(uuid, uuid[])'::regprocedure),
  'load_nodes hashes the viewer''s own thumbs once');

select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'items'
             and indexname = 'items_created_by_idx'),
  'deleting an account finds the items it named by index');

select * from finish();
rollback;
