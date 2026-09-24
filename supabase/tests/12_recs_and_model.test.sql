-- `user_recs` and `user_model`: written by the recompute as `service_role`,
-- which bypasses RLS. There is no client write verb at all, so nobody can plant
-- entries in a feed — their own or, once these ids are known, anyone else's.
--
-- The two tables part company on the read. A viewer reads their own feed,
-- `error` included, because the bar cannot quantize itself to a bound it cannot
-- see; nobody reads `user_model` at all, because its reach masses say how far
-- each named person's corner of the graph agrees with the viewer, which DESIGN
-- §4 keeps on the server (0002 says the rest).

begin;
select plan(17);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com',   now()),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com', now());

insert into public.user_recs (user_id, computed_at, entries, feed_hash, error) values
  ('11111111-1111-1111-1111-111111111111', now(),
   '[{"itemId":"café bleu","score":0.4,"conf":1.2,"tags":{}}]'::jsonb, 'abc', 0.04);
insert into public.user_model (user_id, computed_at, checked_at, nodes_touched,
                               rating_count, truncation, boundary_residual, settle_movement, passes, settled,
                               recomputed, reach, reach_hash, reach_reuses) values
  ('11111111-1111-1111-1111-111111111111', now(), now(), 12, 30, 0.01, 0.3, 0.04, 5, true, true,
   '{"22222222-2222-2222-2222-222222222222":0.31}'::jsonb, 'abcd1234', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.user_recs), 1, 'the owner reads their own feed');
select is(
  (select error::text from public.user_recs), '0.04',
  'and the step its bar may move in, which is why the column is on this row');
select throws_ok(
  $$select count(*) from public.user_model$$, '42501', null,
  'and cannot read the model row behind it, not even their own');

-- One row, so no reader can see a moved stamp beside part of an old feed.
select is(
  (select jsonb_array_length(entries) from public.user_recs),
  1, 'and it is one row, not a collection of chunks');

select throws_ok(
  $$insert into public.user_recs (user_id, computed_at, entries, feed_hash)
    values ('22222222-2222-2222-2222-222222222222', now(), '[]'::jsonb, 'x')$$,
  '42501', null, 'the owner cannot insert a feed');
select throws_ok(
  $$update public.user_recs set entries = '[]'::jsonb$$, '42501', null,
  'nor rewrite one');
select throws_ok(
  $$delete from public.user_recs$$, '42501', null,
  'nor delete one');

-- The reach masses are the one place the walk's opinion of each named person is
-- written down, so a forged row would be a way to move somebody's feed.
select throws_ok(
  $$insert into public.user_model (user_id, reach) values ((select auth.uid()), '{"f1":1}'::jsonb)$$,
  '42501', null, 'the owner cannot insert a model row');
select throws_ok(
  $$update public.user_model set reach = '{"f1":1}'::jsonb$$, '42501', null,
  'nor rewrite one');
select throws_ok(
  $$delete from public.user_model$$, '42501', null,
  'nor delete one');

select is(
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '
                              order by table_name || ':' || privilege_type), 'none')
   from information_schema.table_privileges
   where table_schema = 'public' and table_name in ('user_recs', 'user_model')
     and grantee in ('authenticated', 'anon')),
  'user_recs:SELECT',
  'because the feed''s grant carries one verb and the model has no grant at all');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.user_recs), 0, 'another user reads none of my feed');
select throws_ok(
  $$insert into public.user_recs (user_id, computed_at, entries, feed_hash)
    values ('11111111-1111-1111-1111-111111111111', now(), '[]'::jsonb, 'x')$$,
  '42501', null, 'nor can they plant one in it');

-- The other half of "no client reads it": somebody still does. `service_role`
-- bypasses RLS and holds every verb, which is how `refresh-recs` writes the row
-- and how 0005's pooling statement aggregates it.
set local role service_role;
select is((select count(*)::int from public.user_model), 1,
          'while the server reads the model row, which is whose it is');

-- There is no learned edge trust, deliberately (DESIGN §2.1). A column here that
-- only such a fit would have a use for is a mechanism somebody is about to
-- rebuild.
select is(
  (select coalesce(string_agg(column_name, ',' order by column_name), 'none')
   from information_schema.columns
   where table_schema = 'public' and table_name = 'user_model'
     and column_name in ('trust', 'prior_energy', 'effective_dimension', 'fit_at')),
  'none', 'no column that only a learned edge-trust fit would need');
-- `suggestions_at` is the stamp taste search's ten-minute window keys on, which
-- cannot be read off the `suggestions` rows: a viewer with nobody to suggest
-- writes none.
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'user_model'
     and column_name = 'suggestions_at'),
  1, 'and the stamp the on-demand taste search keys on is still here');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'user_model'
     and column_name like 'pair\_%'),
  12, 'and DESIGN §2.10 reports twelve tallies per viewer');

select * from finish();
rollback;
