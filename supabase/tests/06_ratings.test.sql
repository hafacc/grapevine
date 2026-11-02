-- Ratings: written by their owner only, one row per thumb, every value
-- validated. Who else may READ them is 24_followed_thumbs'. A thumb is
-- keyed by COLUMNS rather than by a composite key encoded into text (DESIGN
-- §3.2): `tag` is a column, not null, with the empty string meaning the thing
-- itself — and the two rows below, for one item, are what that buys.

begin;
select plan(29);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'pal@example.com',   now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test

-- 3 follows the owner, so 3 can read the owner's thumbs and nothing more.
insert into public.follows (follower_id, followed_id) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into public.ratings (user_id, item_id, tag, value) values
      ((select auth.uid()), 'café bleu', '', 1),
      ((select auth.uid()), 'café bleu', 'late night', -1)$$,
  'the thing itself and one of its attributes are two rows for one item');

-- The key is the whole of "one thumb per thing per person", on each of the two
-- separately.
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', '', -1)$$, '23505', null,
  'and the key refuses a second thumb on the thing');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', 'late night', 1)$$, '23505', null,
  'and on the attribute');

-- `tag` defaults to the empty string, so a thumb on the thing itself is written
-- by leaving the column out.
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), '日本', 1)$$,
  'a thumb with no tag named is a thumb on the thing');

-- Each half carries the id rule on its own — `private.is_normalized_id`, the
-- same predicate `isNormalizedId` is in `shared/`. `05_items` is the long
-- version of this list.
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'Café Bleu', 1)$$, '23514', null, 'item: a capital');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), repeat('i', 129), 1)$$, '23514', null, 'item: 129 characters');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', 'Late Night', 1)$$, '23514', null, 'tag: a capital');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', repeat('t', 129), 1)$$, '23514', null,
  'tag: 129 characters');
-- Empty is what the item's own thumb is keyed by, so it cannot be null as well.
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', null, 1)$$, '23502', null, 'tag: null');

select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'dune', 99)$$, '23514', null, 'a value that is not a thumb');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'dune', 0)$$, '23514', null, 'nor is nought');

select throws_ok(
  $$insert into public.ratings (user_id, item_id, value, weight)
    values ((select auth.uid()), 'dune', 1, 99)$$, '42703', null,
  'and there is no room for a fourth field');

-- `rated_at` is the server's clock: when the thumb was first given.
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value, rated_at)
    values ((select auth.uid()), 'dune', 1, 'epoch')$$, '42501', null,
  'a thumb cannot be backdated');
select throws_ok(
  $$select rated_at from public.ratings$$, '42501', null,
  'nor can anybody read when one was given, their own included');
select throws_ok(
  $$select * from public.ratings$$, '42501', null,
  'so a read names its columns');

-- Wound back to the epoch before each write below, because `now()` is one
-- value for the whole of this transaction and "it moved" has to be told apart
-- from "it was already now".
set local role postgres;
select is(
  (select count(*)::int from public.ratings where rated_at = now()),
  3, 'giving a thumb stamps it with the server''s clock');
update public.ratings set rated_at = 'epoch';

set local role authenticated;
select lives_ok(
  $$update public.ratings set value = 1 where item_id = 'café bleu' and tag = ''$$,
  'writing the value a thumb already has');
set local role postgres;
select is(
  (select rated_at from public.ratings where item_id = 'café bleu' and tag = ''),
  'epoch'::timestamptz, 'changes nothing, so rated_at stays put');

-- UPDATE is on `value` alone, so changing a thumb cannot silently re-point it
-- at another thing or another attribute.
set local role authenticated;
select lives_ok(
  $$update public.ratings set value = -1 where item_id = 'café bleu' and tag = ''$$,
  'a thumb can be turned over');
set local role postgres;
select is(
  (select rated_at from public.ratings where item_id = 'café bleu' and tag = ''),
  'epoch'::timestamptz, 'which leaves rated_at where it was: nothing reads it, so nothing re-dates it');

set local role authenticated;
select throws_ok(
  $$update public.ratings set item_id = 'dune' where item_id = 'café bleu'$$, '42501', null,
  'but not re-pointed at another thing');
select throws_ok(
  $$update public.ratings set tag = 'cheap' where item_id = 'café bleu'$$, '42501', null,
  'nor at another attribute');
select throws_ok(
  $$update public.ratings set rated_at = 'epoch' where item_id = 'café bleu'$$, '42501', null,
  'nor re-dated by hand');

-- Clearing a thumb really removes the row rather than storing a third value.
-- Ordered under "C": the database's own collation decides whether `日本` sorts
-- before `café bleu`, and a local cluster and the platform disagree.
select lives_ok(
  $$delete from public.ratings where item_id = 'café bleu' and tag = 'late night'$$,
  'and cleared');
select is(
  (select string_agg(item_id || '/' || tag || '=' || value, ','
                     order by item_id collate "C", tag collate "C")
     from public.ratings),
  'café bleu/=-1,日本/=1', 'leaving exactly what was left');

-- A follower reads and cannot write; a stranger does neither.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.ratings), 2,
  'a follower reads them');
update public.ratings set value = 1 where user_id = '11111111-1111-1111-1111-111111111111';
delete from public.ratings where user_id = '11111111-1111-1111-1111-111111111111';
select is(
  (select string_agg(value::text, ',' order by item_id collate "C") from public.ratings),
  '-1,1', 'and a follower''s update and delete match nothing');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.ratings), 0,
  'a stranger reads none of them');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ('11111111-1111-1111-1111-111111111111', 'dune', 1)$$, '42501', null,
  'nor can anybody write one in somebody else''s name');

select * from finish();
rollback;
