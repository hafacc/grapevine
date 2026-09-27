-- Removing a name is lazy (0017): it records the removal and deletes the
-- catalog row and the reports, and nothing else. Every reader leaves the name
-- out from then on — a recompute's loads, a patched cache, the viewer's own
-- thumbs and the stored feed — and the purge deletes the thumbs later, in
-- batches, stamping nobody.
--
-- Everything in one transaction reads one `now()`, so "before the removal" is
-- made by moving stamps an hour back.

begin;
select plan(35);

-- V the viewer; A its friend; B A's friend.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'v@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'a@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'b@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');

insert into public.items (id, search_id) values ('bad', 'bad'), ('cafe', 'cafe');
insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'bad',  '',     1, now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'cafe', '',     1, now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'cafe', 'bad',  1, now() - interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'bad',  '',    -1, now() - interval '3 hours'),
  -- Recent, so a delta from before the removal would carry it.
  ('22222222-2222-2222-2222-222222222222', 'cafe', 'bad',  1, now() - interval '5 minutes'),
  ('22222222-2222-2222-2222-222222222222', 'cafe', 'loud', 1, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'tea',  '',     1, now() - interval '3 hours'),
  ('33333333-3333-3333-3333-333333333333', 'bad',  '',     1, now() - interval '3 hours');
insert into public.reports (user_id, item_id) values
  ('33333333-3333-3333-3333-333333333333', 'bad');

-- `zed` is an entry with no belief and no attributes that the name never
-- touched: stripping must leave it.
insert into public.user_recs (user_id, computed_at, entries, feed_hash) values
  ('11111111-1111-1111-1111-111111111111', now() - interval '1 hour',
   '[{"itemId":"bad","score":0.4,"conf":1,"tags":{}},
     {"itemId":"cafe","score":0.2,"conf":1,"tags":{"bad":0.5,"loud":0.3}},
     {"itemId":"tea","score":0,"conf":0,"tags":{"bad":0.4}},
     {"itemId":"zed","score":0,"conf":0,"tags":{}}]'::jsonb,
   'h');

update private.ratings_changed
   set changed_at = now() - interval '2 hours', friends_changed_at = now() - interval '2 hours';

set local role service_role;
select ok(private.save_snapshot_cache(
    '11111111-1111-1111-1111-111111111111', (select epoch from private.snapshot_epoch), 1,
    now() - interval '1 hour',
    array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[], 19, 'ab'::text),
  'a cache written an hour before the removal');
reset role;
create temp table epoch_before as select epoch from private.snapshot_epoch;


select lives_ok($$select private.remove_name('bad')$$, 'the owner removes a name');

select is((select count(*)::int from public.items where id = 'bad'), 0,
  'its catalog row goes at once');
select is((select count(*)::int from public.reports where item_id = 'bad'), 0,
  'and its reports');
select is(
  (select count(*)::int from public.ratings where item_id = 'bad' or tag = 'bad'), 5,
  'its thumbs stay, for the purge');
select is(
  (select entries -> 0 ->> 'itemId' from public.user_recs
    where user_id = '11111111-1111-1111-1111-111111111111'),
  'bad', 'and no stored feed is rewritten');
select is((select count(*)::int from private.snapshot_cache), 1, 'no cache is dropped');
select is((select epoch from private.snapshot_epoch), (select epoch from epoch_before),
  'and no epoch bumped');
select is(
  (select count(*)::int from private.ratings_changed where changed_at = now()), 0,
  'and nobody''s clock moved');


-- A recompute's loads never see it.
set local role service_role;
select is(
  (select ratings from private.load_nodes('11111111-1111-1111-1111-111111111111',
     array['22222222-2222-2222-2222-222222222222']::uuid[])),
  '{"cafe":{"loud":1},"tea":{"":1}}'::jsonb,
  'load_nodes leaves out every thumb naming it, as a thing or an attribute');
select is(
  (select ratings from private.neighbourhood('11111111-1111-1111-1111-111111111111', 2000, 6)
    where id = '11111111-1111-1111-1111-111111111111'),
  '{"cafe":{"":1}}'::jsonb,
  'and so does the full load, the viewer''s own thumbs included');
select is(
  (select ratings from private.neighbourhood('11111111-1111-1111-1111-111111111111', 2000, 6)
    where id = '33333333-3333-3333-3333-333333333333'),
  '{}'::jsonb,
  'someone whose only thumb named it loads with none');
reset role;

-- A patched cache: A changes after it, and the delta names the removal.
insert into public.ratings (user_id, item_id, tag, value) values
  ('22222222-2222-2222-2222-222222222222', 'new', '', 1);
set local role service_role;
select is(
  (select ratings from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  '{"new":{"":1}}'::jsonb,
  'a changed person''s recent thumb on the name is not in the delta');
select is(
  (select cleared from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'names'),
  '["bad"]'::jsonb,
  'and the delta names the removal, so the patch drops what the cache holds');
select is(
  (select array_agg(state order by state)
     from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)),
  array['cache', 'changed', 'names'],
  'once, last');
reset role;

-- A cache written after the removal is not told about it again.
update private.snapshot_cache set since = now() + interval '2 minutes';
set local role service_role;
select is(
  (select count(*)::int from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'names'),
  0, 'a cache written after the removal gets no names row');
reset role;


-- The viewer's own reads.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select results_eq(
  $$select item_id, tag from public.ratings order by item_id, tag$$,
  $$values ('cafe'::text, ''::text)$$,
  'the viewer''s own thumbs on it are hidden at once');
select is(
  (select entries from public.my_feed()),
  '[{"itemId":"cafe","score":0.2,"conf":1,"tags":{"loud":0.3}},
    {"itemId":"zed","score":0,"conf":0,"tags":{}}]'::jsonb,
  'my_feed strips it from a feed computed before the removal, with the entry it was the only reason for');
select is(
  (select computed_at from public.my_feed()), now() - interval '1 hour',
  'and keeps the feed''s stamp');
select throws_ok($$select private.unpurged_names()$$, '42501', null,
  'the list the policy reads cannot be called directly');
select throws_ok($$select * from private.removed_names$$, '42501', null,
  'nor the removals read');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.my_feed()), 0,
  'my_feed answers with the caller''s own feed and nobody else''s');
reset role;

update public.user_recs set computed_at = now() + interval '2 minutes';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  jsonb_array_length((select entries from public.my_feed())), 4,
  'a feed computed after the removal is returned as stored');
reset role;


-- The purge: batches, no stamp, no tombstone, and "purged" only once it is
-- safe to stop excluding the name.
select is(private.purge_removed_names(2), 2, 'the purge deletes a batch');
select is(private.purge_removed_names(2), 2, 'and the next');
select is(private.purge_removed_names(2), 1, 'and the rest');
select is(
  (select count(*)::int from public.ratings where item_id = 'bad' or tag = 'bad'), 0,
  'until no thumb names it');
select is(
  (select count(*)::int from private.ratings_cleared where item_id = 'bad' or tag = 'bad'), 0,
  'leaving no tombstone');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '33333333-3333-3333-3333-333333333333'),
  now() - interval '2 hours', 'and moving no clock');
select ok(
  (select purged_at is null from private.removed_names where id = 'bad'),
  'within ten minutes of the removal the name is still excluded');
update private.removed_names set removed_at = now() - interval '11 minutes';
select is(private.purge_removed_names(2), 0, 'later, a run finds nothing');
select ok(
  (select purged_at is not null from private.removed_names where id = 'bad'),
  'and marks the name purged');

-- Any other clear still stamps and leaves its tombstone.
delete from public.ratings
 where user_id = '11111111-1111-1111-1111-111111111111' and item_id = 'cafe';
select ok(
  exists (select 1 from private.ratings_cleared
           where user_id = '11111111-1111-1111-1111-111111111111' and item_id = 'cafe')
  and (select changed_at = now() from private.ratings_changed
        where user_id = '11111111-1111-1111-1111-111111111111'),
  'an ordinary clear stamps and leaves a tombstone');

select is(
  (select command from cron.job where jobname = 'removed-names-purge'),
  'select private.purge_removed_names()', 'the purge is scheduled');

select ok(
  has_function_privilege('authenticated', 'public.my_feed()', 'execute')
  and not has_function_privilege('anon', 'public.my_feed()', 'execute')
  and not has_function_privilege('authenticated', 'private.purge_removed_names(int)', 'execute')
  and not has_function_privilege('service_role', 'private.purge_removed_names(int)', 'execute')
  and not has_function_privilege('authenticated', 'private.strip_names(jsonb, text[])', 'execute')
  and not has_function_privilege('authenticated', 'private.remove_name(text)', 'execute')
  and not has_function_privilege('service_role', 'private.remove_name(text)', 'execute')
  and not has_function_privilege('anon', 'private.unpurged_names()', 'execute')
  and not has_table_privilege('authenticated', 'private.removed_names', 'select'),
  'a client calls my_feed and nothing else new');

select * from finish();
rollback;
