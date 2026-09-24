-- Ratings: owner only, one row per thumb, every value validated. A thumb is
-- keyed by COLUMNS rather than by a composite key encoded into text (DESIGN
-- §3.2): `tag` is a column, not null, with the empty string meaning the thing
-- itself — and the two rows below, for one item, are what that buys.

begin;
select plan(30);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'pal@example.com',   now());

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333'),
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
-- same predicate `isNormalizedId` is in `shared/` and `is_normalized_id` at the
-- wasm boundary. `09_items` is the long version of this list.
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

-- `rated_at` is the server's clock. DESIGN §3.2: it is written from the first
-- day because history cannot be backfilled, and read by nothing.
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value, rated_at)
    values ((select auth.uid()), 'dune', 1, 'epoch')$$, '42501', null,
  'a thumb cannot be backdated');

-- The staleness probe reads `private.ratings_changed`, not `max(rated_at)`: a
-- flip and a clear move no maximum, and a clear leaves no row to carry a time.
-- Every clock is wound back to the epoch before each write below, because
-- `now()` is one value for the whole of this transaction and "it moved" has to
-- be told apart from "it was already now".
set local role postgres;
select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'giving a thumb stamps the owner''s ratings clock');
update private.ratings_changed set changed_at = 'epoch';
update public.ratings set rated_at = 'epoch';

set local role authenticated;
select lives_ok(
  $$update public.ratings set value = 1 where item_id = 'café bleu' and tag = ''$$,
  'writing the value a thumb already has');
set local role postgres;
select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  'epoch'::timestamptz, 'changes nothing a walk reads, so the clock stays put');
select is(
  (select rated_at from public.ratings where item_id = 'café bleu' and tag = ''),
  'epoch'::timestamptz, 'and neither does rated_at');

-- UPDATE is on `value` alone, so changing a thumb cannot silently re-point it
-- at another thing or another attribute.
set local role authenticated;
select lives_ok(
  $$update public.ratings set value = -1 where item_id = 'café bleu' and tag = ''$$,
  'a thumb can be turned over');
set local role postgres;
select is(
  (select rated_at from public.ratings where item_id = 'café bleu' and tag = ''),
  now(), 'which moves rated_at, the time the thumb was given');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'and the ratings clock, so the feed that counted the old thumb is stale');
update private.ratings_changed set changed_at = 'epoch';

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
select lives_ok(
  $$delete from public.ratings where item_id = 'café bleu' and tag = 'late night'$$,
  'and cleared');
select is(
  (select string_agg(item_id || '/' || tag || '=' || value, ',' order by item_id, tag)
     from public.ratings),
  'café bleu/=-1,日本/=1', 'leaving exactly what was left');
set local role postgres;
select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'and a clear moves the clock too, though no row is left to carry it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$select changed_at from private.ratings_changed$$, '42501', null,
  'the owner cannot read their own ratings clock');

-- These are the one thing in the schema nobody but their author ever sees: the
-- recompute reads them as `service_role`, and a friend is no more entitled than
-- a stranger.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.ratings), 0,
  'a friend reads none of them');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.ratings), 0,
  'and neither does a stranger');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ('11111111-1111-1111-1111-111111111111', 'dune', 1)$$, '42501', null,
  'nor can either write one in somebody else''s name');

select * from finish();
rollback;
