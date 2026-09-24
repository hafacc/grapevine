-- The two stamps a recompute's window is keyed on, and the two things that are
-- not thumbs but change the answer all the same.
--
-- `private.ratings_changed` is "has anything this viewer's feed is made of
-- changed since the last walk": a friend gained or lost is that, so a new
-- friend's thumbs reach the feed on the next open rather than on the ten-minute
-- window. `user_model.suggestions_at` is taste search's window: moving the
-- switch forgets it, so the next search runs rather than answering with the list
-- the old setting wrote.
--
-- Every clock is wound back to the epoch before each write below, because
-- `now()` is one value for the whole of this transaction and "it moved" has to
-- be told apart from "it was already now".

begin;
select plan(12);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com',   now()),
  ('22222222-2222-2222-2222-222222222222', 'two@example.com',   now()),
  ('33333333-3333-3333-3333-333333333333', 'three@example.com', now());

update public.profiles set searchable = true, username = 'two_h'
  where id = '22222222-2222-2222-2222-222222222222';

insert into private.ratings_changed (user_id, changed_at) values
  ('11111111-1111-1111-1111-111111111111', 'epoch'),
  ('22222222-2222-2222-2222-222222222222', 'epoch'),
  ('33333333-3333-3333-3333-333333333333', 'epoch');

-- Accepted the way the app accepts one: the recipient, as themselves, through
-- the one statement that writes both edges.
insert into public.connect_requests (from_id, to_id) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$select public.accept_connect_request('22222222-2222-2222-2222-222222222222')$$,
  'an ask is accepted');
set local role postgres;

select is(
  (select changed_at from private.ratings_changed
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'which stamps the accepter''s clock, so their feed is stale at once');
select is(
  (select changed_at from private.ratings_changed
    where user_id = '22222222-2222-2222-2222-222222222222'),
  now(), 'and the sender''s, since the edge is theirs too');
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

insert into public.user_model (user_id, suggestions_at) values
  ('11111111-1111-1111-1111-111111111111', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$update public.user_prefs set dismissed_suggestions = '{}'
     where user_id = (select auth.uid())$$,
  'a write to the prefs row that leaves the switch alone');
set local role postgres;
select is(
  (select suggestions_at from public.user_model
    where user_id = '11111111-1111-1111-1111-111111111111'),
  now(), 'keeps the window, so it buys no search');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- The client's own write: an upsert on the row the signup trigger made.
select lives_ok(
  $$insert into public.user_prefs (user_id, discoverable_by_taste)
    values ((select auth.uid()), true)
    on conflict (user_id) do update set discoverable_by_taste = excluded.discoverable_by_taste$$,
  'turning suggestions on');
set local role postgres;
select ok(
  (select suggestions_at from public.user_model
    where user_id = '11111111-1111-1111-1111-111111111111') is null,
  'forgets when the last search ran, so the next one runs');

update public.user_model set suggestions_at = now()
  where user_id = '11111111-1111-1111-1111-111111111111';
update public.user_prefs set discoverable_by_taste = false
  where user_id = '11111111-1111-1111-1111-111111111111';
select ok(
  (select suggestions_at from public.user_model
    where user_id = '11111111-1111-1111-1111-111111111111') is null,
  'and so does turning them off, which is what writes the list empty');

select * from finish();
rollback;
