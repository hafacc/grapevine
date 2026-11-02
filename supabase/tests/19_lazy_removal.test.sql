-- Removing a name is lazy: it records the removal and deletes the catalog row
-- and the reports, and nothing else. Every reader leaves the name out from
-- then on (a signed-in read of `ratings`, a followed account's thumbs, its
-- stamp) and the purge deletes the thumbs later, in batches.

begin;
select plan(21);

-- V the viewer, who follows A. B is nobody to either.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'v@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'a@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'b@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test

insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into public.items (id, search_id) values ('bad', 'bad'), ('cafe', 'cafe');
insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'bad',  '',     1, now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'cafe', '',     1, now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'cafe', 'bad',  1, now() - interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'bad',  '',    -1, now() - interval '3 hours'),
  -- The newest of A's, so A's stamp before the removal rests on it.
  ('22222222-2222-2222-2222-222222222222', 'cafe', 'bad',  1, now() - interval '5 minutes'),
  ('22222222-2222-2222-2222-222222222222', 'cafe', 'loud', 1, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'tea',  '',     1, now() - interval '4 hours'),
  ('33333333-3333-3333-3333-333333333333', 'bad',  '',     1, now() - interval '3 hours');
insert into public.reports (user_id, item_id) values
  ('33333333-3333-3333-3333-333333333333', 'bad');

create temporary table seen (label text primary key, stamp text);
grant all on seen to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into seen select 'before', stamp from public.followed_stamps();
reset role;


select lives_ok($$select private.remove_name('bad')$$, 'the owner removes a name');

select is((select count(*)::int from public.items where id = 'bad'), 0,
  'its catalog row goes at once');
select is((select count(*)::int from public.reports where item_id = 'bad'), 0,
  'and its reports');
select is(
  (select count(*)::int from public.ratings where item_id = 'bad' or tag = 'bad'), 5,
  'its thumbs stay, for the purge');


-- What a signed-in reader sees, before the purge has run.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$select item_id, tag from public.ratings
     where user_id = (select auth.uid()) order by item_id, tag$$,
  $$values ('cafe'::text, ''::text)$$,
  'the viewer''s own thumbs on it are hidden at once');
select results_eq(
  $$select item_id, tag from public.ratings
     where user_id = '22222222-2222-2222-2222-222222222222' order by item_id, tag$$,
  $$values ('cafe'::text, 'loud'::text), ('tea', '')$$,
  'and so are a followed account''s, as a thing and as an attribute');
select is(
  public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  '{"cafe":{"loud":1},"tea":{"":1}}'::jsonb,
  'the followed account''s thumbs load without it');
select isnt(
  (select stamp from public.followed_stamps()),
  (select stamp from seen where label = 'before'),
  'and its stamp has moved, though no thumb has been deleted yet');
insert into seen select 'removed', stamp from public.followed_stamps();
select throws_ok($$select private.unpurged_names()$$, '42501', null,
  'the list the policy reads cannot be called directly');
select throws_ok($$select * from private.removed_names$$, '42501', null,
  'nor the removals read');
reset role;


-- The purge: batches, and "purged" only once it is safe to stop excluding the
-- name.
select is(private.purge_removed_names(2), 2, 'the purge deletes a batch');
select is(private.purge_removed_names(2), 2, 'and the next');
select is(private.purge_removed_names(2), 1, 'and the rest');
select is(
  (select count(*)::int from public.ratings where item_id = 'bad' or tag = 'bad'), 0,
  'until no thumb names it');
select is((select count(*)::int from public.ratings), 3, 'and every other thumb is where it was');
set local role authenticated;
select isnt(
  (select stamp from public.followed_stamps()),
  (select stamp from seen where label = 'removed'),
  'the purge moves the stamp of an account it deleted from');
reset role;
select ok(
  (select purged_at is null from private.removed_names where id = 'bad'),
  'within ten minutes of the removal the name is still excluded');
update private.removed_names set removed_at = now() - interval '11 minutes';
select is(private.purge_removed_names(2), 0, 'later, a run finds nothing');
select ok(
  (select purged_at is not null from private.removed_names where id = 'bad'),
  'and marks the name purged');

select is(
  (select command from cron.job where jobname = 'removed-names-purge'),
  'select private.purge_removed_names()', 'the purge is scheduled');

select ok(
  not has_function_privilege('authenticated', 'private.purge_removed_names(int)', 'execute')
  and not has_function_privilege('authenticated', 'private.remove_name(text)', 'execute')
  and not has_function_privilege('anon', 'private.unpurged_names()', 'execute')
  and not has_table_privilege('authenticated', 'private.removed_names', 'select'),
  'no client purges, removes, or reads what was removed');

select * from finish();
rollback;
