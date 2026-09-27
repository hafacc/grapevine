-- The neighbourhood cache (0016, DESIGN §3.4a): nobody but the service role can
-- reach it, the delta returns exactly what changed since the cache was written
-- — clears and friend lists included — and the purges leave no copy of a
-- deleted account or a removed name behind.
--
-- Everything in one transaction reads one `now()`, so "before the cache" is
-- made by moving the stamps an hour back, and "after" is anything written
-- once the cache is saved.

begin;
select plan(41);

-- V is the viewer; A its friend; B A's friend; C and D strangers to all three.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'v@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'a@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'b@example.com', now()),
  ('44444444-4444-4444-4444-444444444444', 'c@example.com', now()),
  ('55555555-5555-5555-5555-555555555555', 'd@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');

insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'kept',  '',     1, now() - interval '2 hours'),
  ('22222222-2222-2222-2222-222222222222', 'kept',  '',    -1, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'gone',  '',     1, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'gone',  'loud', 1, now() - interval '3 hours'),
  ('22222222-2222-2222-2222-222222222222', 'flip',  '',     1, now() - interval '3 hours'),
  ('33333333-3333-3333-3333-333333333333', 'kept',  '',     1, now() - interval '3 hours'),
  ('44444444-4444-4444-4444-444444444444', 'kept',  '',     1, now() - interval '3 hours');

update private.ratings_changed
   set changed_at = now() - interval '1 hour', friends_changed_at = now() - interval '1 hour';

-- Privileges. 0016 grants the service role reads and nothing else, and the two
-- client roles nothing.
set local role postgres;
select ok(
  not has_table_privilege('anon', 'private.snapshot_cache', 'select')
  and not has_table_privilege('authenticated', 'private.snapshot_cache', 'select')
  and not has_table_privilege('authenticated', 'private.snapshot_cache', 'insert')
  and not has_table_privilege('authenticated', 'private.snapshot_cache', 'update')
  and not has_table_privilege('authenticated', 'private.snapshot_cache', 'delete'),
  'no client role holds any verb on the cache');
select ok(
  not has_table_privilege('authenticated', 'private.ratings_cleared', 'select')
  and not has_table_privilege('anon', 'private.ratings_cleared', 'select')
  and not has_table_privilege('authenticated', 'private.snapshot_epoch', 'select'),
  'nor on the tombstones or the epoch');
select ok(
  has_table_privilege('service_role', 'private.snapshot_cache', 'select')
  and not has_table_privilege('service_role', 'private.snapshot_cache', 'insert')
  and not has_table_privilege('service_role', 'private.snapshot_cache', 'update')
  and not has_table_privilege('service_role', 'private.snapshot_cache', 'delete')
  and not has_table_privilege('service_role', 'private.ratings_cleared', 'insert')
  and not has_table_privilege('service_role', 'private.snapshot_epoch', 'update'),
  'the service role reads them and writes only through the save');
select ok(
  not has_function_privilege('authenticated', 'private.snapshot_delta(uuid, int, int, int)', 'execute')
  and not has_function_privilege('anon', 'private.snapshot_delta(uuid, int, int, int)', 'execute')
  and not has_function_privilege('authenticated',
    'private.save_snapshot_cache(uuid, bigint, int, timestamptz, uuid[], int, text)', 'execute')
  and not has_function_privilege('authenticated', 'private.neighbourhood_cut(uuid, int, int)', 'execute')
  and not has_function_privilege('authenticated', 'private.neighbourhood(uuid, int, int)', 'execute'),
  'no client role may call the delta, the save or the cut');
select ok(
  has_function_privilege('service_role', 'private.snapshot_delta(uuid, int, int, int)', 'execute')
  and has_function_privilege('service_role',
    'private.save_snapshot_cache(uuid, bigint, int, timestamptz, uuid[], int, text)', 'execute')
  and not has_function_privilege('service_role', 'private.drop_snapshot_caches(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.neighbourhood_cut(uuid, int, int)', 'execute'),
  'the service role calls the delta and the save, and cannot purge or read a bare cut');
select is(
  (select pronargs::int from pg_proc
    where oid = 'private.snapshot_delta(uuid, int, int, int)'::regprocedure),
  4, 'the delta takes one person: the viewer, and three numbers');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$select * from private.snapshot_cache$$, '42501', null,
  'a signed-in viewer cannot read even their own cache');
select throws_ok(
  $$select * from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)$$,
  '42501', null, 'or ask for their own delta');
reset role;

-- The cut is 0015's: V, A and B, and C nobody reaches.
select is(
  (select array_agg(x order by x) from unnest(
     private.neighbourhood_cut('11111111-1111-1111-1111-111111111111', 2000, 6)) x),
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333']::uuid[],
  'the cut is who the breadth-first walk reaches');
select is(
  (select count(*)::int from private.neighbourhood('11111111-1111-1111-1111-111111111111', 2, 6)),
  2, 'and the full load still stops at its node cap');

-- No cache: no rows, so the caller loads in full.
set local role service_role;
select is(
  (select count(*)::int from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)),
  0, 'with no cache the delta is empty');

select ok(private.save_snapshot_cache(
    '11111111-1111-1111-1111-111111111111', (select epoch from private.snapshot_epoch), 1, now(),
    array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333']::uuid[], 19, 'ab'::text),
  'the save writes when no purge ran');
select throws_ok(
  $$insert into private.snapshot_cache (user_id, version, since, members, reloads_in, blob)
    values ('22222222-2222-2222-2222-222222222222', 1, now(), '{}', 0, 'a')$$,
  '42501', null, 'and the service role cannot write the table directly');

select is(
  (select array_agg(state order by state)
     from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)),
  array['cache'], 'nothing changed: the cache row alone');
select is(
  (select blob from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'cache'),
  'ab'::text, 'carrying the blob');
select is(
  (select count(*)::int from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 2, 2000, 6)),
  0, 'a cache of another version is not patched');
reset role;

-- The changes, all after the cache: V rates `flip`; A
-- clears `gone` and its attribute, flips `flip` and `kept` and rates `new`; B
-- and C become friends, so C joins the cut; nothing about B's own thumbs
-- changes.
insert into public.ratings (user_id, item_id, tag, value) values
  ('11111111-1111-1111-1111-111111111111', 'flip', '', -1),
  ('22222222-2222-2222-2222-222222222222', 'new',  '', 1);
delete from public.ratings
 where user_id = '22222222-2222-2222-2222-222222222222' and item_id = 'gone';
update public.ratings set value = -1
 where user_id = '22222222-2222-2222-2222-222222222222' and item_id = 'flip';
update public.ratings set value = 1
 where user_id = '22222222-2222-2222-2222-222222222222' and item_id = 'kept';
insert into public.friendships (user_id, friend_id) values
  ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'),
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333');

select is(
  (select array_agg(item_id || '/' || tag order by item_id, tag) from private.ratings_cleared
    where user_id = '22222222-2222-2222-2222-222222222222'),
  array['gone/', 'gone/loud'], 'a clear leaves a tombstone per key');

set local role service_role;
create temporary table delta on commit drop as
  select * from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6);
reset role;

select is(
  (select array_agg(state || ':' || id::text order by state, id) from delta),
  array['added:44444444-4444-4444-4444-444444444444',
        'cache:11111111-1111-1111-1111-111111111111',
        'changed:11111111-1111-1111-1111-111111111111',
        'changed:22222222-2222-2222-2222-222222222222',
        'changed:33333333-3333-3333-3333-333333333333'],
  'C is added, and exactly the three whose clocks moved are changed');
select is(
  (select ratings from delta where state = 'added'),
  '{"kept": {"": 1}}'::jsonb, 'an added person comes whole');
select is(
  (select friend_ids from delta where state = 'added'),
  array['33333333-3333-3333-3333-333333333333']::uuid[], 'friend list and all');
select is(
  (select ratings from delta where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  '{"new": {"": 1}, "flip": {"": -1}, "kept": {"": 2}}'::jsonb,
  'a changed person brings only the thumbs written since, flips included, with the order bit');
select is(
  (select cleared from delta where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  '{"gone": ["", "loud"]}'::jsonb, 'and the keys cleared since');
select ok(
  (select friend_ids is null from delta
    where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  'and no friend list, since theirs did not move');
select is(
  (select friend_ids from delta where state = 'changed' and id = '33333333-3333-3333-3333-333333333333'),
  array['22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444']::uuid[],
  'a friend list that moved comes whole');
select is(
  (select ratings from delta where state = 'changed' and id = '33333333-3333-3333-3333-333333333333'),
  '{}'::jsonb, 'with none of that person''s old thumbs');
select is(
  (select ratings from delta where state = 'changed' and id = '11111111-1111-1111-1111-111111111111'),
  '{"flip": {"": -1}}'::jsonb, 'the viewer''s own new thumb is in the delta');

-- Given again after a clear: the row is the answer, and no tombstone for it.
insert into public.ratings (user_id, item_id, tag, value) values
  ('22222222-2222-2222-2222-222222222222', 'gone', '', -1);
set local role service_role;
select is(
  (select ratings -> 'gone' from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  '{"": -1}'::jsonb, 'a thumb cleared and given again comes back as given');
select is(
  (select cleared from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'changed' and id = '22222222-2222-2222-2222-222222222222'),
  '{"gone": ["loud"]}'::jsonb, 'and only the key still cleared is a tombstone');
reset role;

-- A removed friendship takes B out of the cut, and C with it.
delete from public.friendships
 where (user_id, friend_id) in (('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'),
                                ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222'));
set local role service_role;
select is(
  (select array_agg(id order by id) from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)
    where state = 'removed'),
  array['33333333-3333-3333-3333-333333333333']::uuid[], 'someone the cut drops is removed');
reset role;

-- A cache older than the tombstones reach is never patched.
update private.snapshot_cache set since = now() - interval '8 days';
set local role service_role;
select is(
  (select count(*)::int from private.snapshot_delta('11111111-1111-1111-1111-111111111111', 1, 2000, 6)),
  0, 'a week-old cache is not patched');
reset role;

-- The sweeps.
do $$ begin execute (select command from cron.job where jobname = 'snapshot-cache-sweep'); end $$;
select is((select count(*)::int from private.snapshot_cache), 0,
  'the sweep deletes a cache unused for a week');
update private.ratings_cleared set cleared_at = now() - interval '9 days' where tag = 'loud';
do $$ begin execute (select command from cron.job where jobname = 'ratings-cleared-sweep'); end $$;
select is((select count(*)::int from private.ratings_cleared where tag = 'loud'), 0,
  'and a tombstone past eight days');

-- Purges. Three caches: V's (loads V, A), C's (loads C, B) and D's (loads D).
insert into public.friendships (user_id, friend_id) values
  ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555'),
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333');
set local role service_role;
select private.save_snapshot_cache(u, (select epoch from private.snapshot_epoch), 1, now(), m, 19, 'a')
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,
   array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[]),
  ('44444444-4444-4444-4444-444444444444'::uuid,
   array['44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333']::uuid[]),
  ('55555555-5555-5555-5555-555555555555'::uuid,
   array['55555555-5555-5555-5555-555555555555']::uuid[])) as s (u, m);
reset role;
create temporary table epoch_before on commit drop as select epoch from private.snapshot_epoch;
grant select on epoch_before to service_role;

-- A deletes their account: V's cache loaded A, and goes. C's and D's loaded
-- neither A nor anyone who named A.
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select array_agg(user_id order by user_id) from private.snapshot_cache),
  array['44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555']::uuid[],
  'deleting an account drops every cache that loaded it');
select ok((select epoch from private.snapshot_epoch) > (select epoch from epoch_before),
  'and moves the epoch');
select is((select count(*)::int from private.ratings_cleared
            where user_id = '22222222-2222-2222-2222-222222222222'), 0,
  'and leaves no tombstone of theirs');
select ok((select friends_changed_at = now() from private.ratings_changed
            where user_id = '11111111-1111-1111-1111-111111111111'),
  'while the friend they left has their friend list stamped');

-- B deletes theirs. D's cache loaded only D, but D's friend list names B.
delete from auth.users where id = '33333333-3333-3333-3333-333333333333';
select is((select count(*)::int from private.snapshot_cache), 0,
  'and every cache that loaded a friend of theirs, whose list named them');

-- A refresh that read its epoch before a purge cannot write what it read.
set local role service_role;
select ok(not private.save_snapshot_cache(
    '11111111-1111-1111-1111-111111111111', (select epoch from epoch_before), 1, now(),
    array['11111111-1111-1111-1111-111111111111']::uuid[], 19, 'a'),
  'a save with an epoch from before a purge refuses');
select ok(private.save_snapshot_cache(
    '11111111-1111-1111-1111-111111111111', (select epoch from private.snapshot_epoch), 1, now(),
    array['11111111-1111-1111-1111-111111111111']::uuid[], 19, 'a'),
  'and one with the current epoch writes');
reset role;

-- Removing a name drops every cache, and every tombstone naming it.
insert into public.ratings (user_id, item_id, tag, value) values
  ('44444444-4444-4444-4444-444444444444', 'banned', '', 1);
delete from public.ratings where user_id = '44444444-4444-4444-4444-444444444444' and item_id = 'banned';
select private.remove_name('banned');
select is((select count(*)::int from private.snapshot_cache), 0,
  'removing a name drops every cache');
select is((select count(*)::int from private.ratings_cleared where item_id = 'banned'), 0,
  'and every tombstone that names it');

select * from finish();
rollback;
