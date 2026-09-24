-- Accepting a request. It is the write that lands a row owned by somebody ELSE,
-- and the direction of the request probe is what stops an attacker befriending
-- themselves to a stranger by asking and then accepting their own ask.

begin;
select plan(13);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',    now()),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'third@example.com',    now());

update public.profiles set display_name = 'Owner', username = 'owner_h', searchable = true
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Stranger', username = 'stranger_h', searchable = true
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Third', username = 'third_h', searchable = true
  where id = '33333333-3333-3333-3333-333333333333';

-- The stranger asked the owner.
insert into public.connect_requests (from_id, to_id) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The accept clause: the accepter writes the SENDER's edge, authorized by the
-- pending request the sender addressed to them.
select lives_ok(
  $$select public.accept_connect_request('22222222-2222-2222-2222-222222222222')$$,
  'a pending ask authorizes the accepter to write both edges');
select is(
  (select count(*)::int from public.friendships),
  2, 'and both directions exist');
select is(
  (select count(*)::int from public.connect_requests),
  0, 'and the ask is consumed');

-- An edge carries no copy of the accepter's name, so there is nothing on it to
-- lie in.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'friendships'),
  'user_id,friend_id,since',
  'an edge carries two uuids and a server clock, and no name to forge');

select throws_ok(
  $$insert into public.friendships (user_id, friend_id, since)
    values ((select auth.uid()), '33333333-3333-3333-3333-333333333333', 'epoch')$$,
  '42501', 'and `since` is the server''s, not the writer''s');

select throws_ok(
  $$insert into public.friendships (user_id, friend_id)
    values ('33333333-3333-3333-3333-333333333333', (select auth.uid()))$$,
  '42501', 'nobody writes into somebody''s friend list without a request');

select throws_ok(
  $$select public.accept_connect_request('33333333-3333-3333-3333-333333333333')$$,
  '42501', 'and accepting an ask nobody made is refused');

-- The difference between `has_incoming_request_from` and a both-directions
-- probe, which is the whole of it: a request you SENT must not authorize you to
-- write the recipient's edge.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '22222222-2222-2222-2222-222222222222')$$,
  'the third party asks the stranger');
select throws_ok(
  $$insert into public.friendships (user_id, friend_id)
    values ('22222222-2222-2222-2222-222222222222', (select auth.uid()))$$,
  '42501', 'and cannot then accept their own ask on the stranger''s behalf');


-- Reciprocity at commit time. Deferred because an
-- accept inserts the two rows as two statements and either order is momentarily
-- one-sided; forced immediate here because a test transaction never commits.
set constraints all immediate;

select throws_ok(
  $$insert into public.friendships (user_id, friend_id)
    values ((select auth.uid()), '11111111-1111-1111-1111-111111111111')$$,
  '23514', 'one half of an edge alone cannot stand');

-- Which is why the pair is only ever written by the accepter, in the one
-- statement `accept_connect_request` makes of it.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$select public.accept_connect_request('33333333-3333-3333-3333-333333333333')$$,
  'both halves together can, through the accept');

-- Unfriending removes both rows, which the same trigger then requires.
select throws_ok(
  $$delete from public.friendships
    where user_id = (select auth.uid())
      and friend_id = '33333333-3333-3333-3333-333333333333'$$,
  '23514', 'and leaving removes both or neither');
select lives_ok(
  $$delete from public.friendships
    where (user_id, friend_id) in (
      ((select auth.uid()), '33333333-3333-3333-3333-333333333333'),
      ('33333333-3333-3333-3333-333333333333', (select auth.uid())))$$,
  'both at once is the unfriend');

select * from finish();
rollback;
