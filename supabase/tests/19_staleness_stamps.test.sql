-- What stamps the clock a recompute's window is keyed on, besides a thumb.
--
-- `private.ratings_changed` is "has anything this viewer's feed is made of
-- changed since the last walk": a friend gained or lost is that, so a new
-- friend's thumbs reach the feed on the next open rather than on the ten-minute
-- window.
--
-- Every clock is wound back to the epoch before each write below, because
-- `now()` is one value for the whole of this transaction and "it moved" has to
-- be told apart from "it was already now".

begin;
select plan(7);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com',   now()),
  ('22222222-2222-2222-2222-222222222222', 'two@example.com',   now()),
  ('33333333-3333-3333-3333-333333333333', 'three@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test


insert into private.ratings_changed (user_id, changed_at) values
  ('11111111-1111-1111-1111-111111111111', 'epoch'),
  ('22222222-2222-2222-2222-222222222222', 'epoch'),
  ('33333333-3333-3333-3333-333333333333', 'epoch');

-- Made the way the app makes one: 1 opens 2's link, as themselves, through
-- the one statement that writes both edges.
insert into public.invite_links (owner_id, token) values
  ('22222222-2222-2222-2222-222222222222', 'TwosTokenTwosTokenTwosTokenTwosTokenTwosTok');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.redeem_invite('TwosTokenTwosTokenTwosTokenTwosTokenTwosTok')$$,
  'a link is redeemed');
set local role postgres;

select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'which stamps the redeemer''s clock, so their feed is stale at once');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '22222222-2222-2222-2222-222222222222'),
  now(), 'and the owner''s, since the edge is theirs too');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '33333333-3333-3333-3333-333333333333'),
  'epoch'::timestamptz, 'and nobody else''s');

update private.ratings_changed set changed_at = 'epoch';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$delete from public.friendships
     where (user_id = '11111111-1111-1111-1111-111111111111'
            and friend_id = '22222222-2222-2222-2222-222222222222')
        or (user_id = '22222222-2222-2222-2222-222222222222'
            and friend_id = '11111111-1111-1111-1111-111111111111')$$,
  'either end unfriends');
set local role postgres;

select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'and both clocks move again, so an unfriended thumb leaves the feed on the next open');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '22222222-2222-2222-2222-222222222222'),
  now(), 'on both sides');

select * from finish();
rollback;
