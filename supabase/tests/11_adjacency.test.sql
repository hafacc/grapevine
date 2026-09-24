-- The adjacency is `friendships` and nothing else (DESIGN §3.2). No profile
-- column lists a person's friends — a list the walk believed would be a claim
-- about who knows whom that anyone could make — an edge is only ever written by
-- one of its two ends, and reciprocity is a constraint.

begin;
select plan(11);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',    now()),
  ('22222222-2222-2222-2222-222222222222', 'f2@example.com',       now()),
  ('33333333-3333-3333-3333-333333333333', 'f3@example.com',       now()),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com', now());

update public.profiles set searchable = true, username = 'f2_h'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set searchable = true, username = 'f3_h'
  where id = '33333333-3333-3333-3333-333333333333';

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role postgres;
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'friend_ids'),
  0, 'there is no friend_ids column to verify, cap or repair');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set friend_ids = array['22222222-2222-2222-2222-222222222222']::uuid[]
    where id = (select auth.uid())$$, '42703', null,
  'so a session cannot graft a network onto a profile');

-- `private.neighbourhood` joins `friendships`, so this is the only way to
-- assert who knows whom.
select throws_ok(
  $$insert into public.friendships (user_id, friend_id)
    values ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')$$,
  '42501', null, 'an edge between two other people cannot be asserted');

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '33333333-3333-3333-3333-333333333333')$$,
  'asking is one statement');
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok(
  $$select public.accept_connect_request('11111111-1111-1111-1111-111111111111')$$,
  'and accepting is one more — no second write to keep in step');

-- Dropping an edge is a delete of two rows and adding one needs an accept, so
-- no single write can swap one friend for another.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set constraints all immediate;
select lives_ok(
  $$delete from public.friendships
    where (user_id, friend_id) in (
      ((select auth.uid()), '22222222-2222-2222-2222-222222222222'),
      ('22222222-2222-2222-2222-222222222222', (select auth.uid())))$$,
  'leaving is a delete of both rows');
select is(
  (select count(*)::int from public.friendships where user_id = (select auth.uid())),
  1, 'and takes exactly the one friendship with it');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(
  $$insert into public.friendships (user_id, friend_id)
    values ('11111111-1111-1111-1111-111111111111', (select auth.uid()))$$,
  '42501', null, 'a stranger cannot write themselves into somebody''s adjacency');
select lives_ok(
  $$delete from public.friendships where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'and a delete they are not party to raises nothing');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.friendships where user_id = (select auth.uid())),
  1, 'because the policy filtered every row away');

select is(
  (select count(*)::int from public.friendships
   where user_id = '44444444-4444-4444-4444-444444444444'),
  0, 'somebody with no edges at all has none, and needs no migration to say so');

select * from finish();
rollback;
