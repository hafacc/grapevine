-- A rename. A friend reads your profile directly, so no copy of your name lives
-- on a friend edge: a rename is one update of one row and reaches every friend
-- at once. These assert that, and that an edge has no name to rewrite and no
-- verb to rewrite it with.

begin;
select plan(9);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'me@example.com',       now()),
  ('22222222-2222-2222-2222-222222222222', 'them@example.com',     now()),
  ('33333333-3333-3333-3333-333333333333', 'impostor@example.com', now());

update public.profiles set display_name = 'Old Name', username = 'me_h', searchable = true
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Them' where id = '22222222-2222-2222-2222-222222222222';

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set display_name = 'New Name' where id = (select auth.uid())$$,
  'a rename is one update of your own row');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'New Name', 'and the friend reads the new name at once, with nothing to heal');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'friendships'
     and column_name in ('display_name', 'username', 'photo_url')),
  0, 'an edge carries no name, handle or photo to heal');

select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'friendships'
     and privilege_type = 'UPDATE' and grantee in ('authenticated', 'anon')),
  0, 'and no client holds an UPDATE privilege on one');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$update public.friendships set since = now()
    where user_id = '11111111-1111-1111-1111-111111111111'$$, '42501',
  'so an impostor has no verb to reach for');

select is(
  (select count(*)::int from public.friendships),
  0, 'and cannot even see the edge');

-- A misleading name is a claim about your own row, which is the only place it
-- can be made and the one place a reader checks.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$update public.profiles set display_name = 'grapevine Support' where id = (select auth.uid())$$,
  'a misleading display name is still possible, as DESIGN §4 says it is');
-- A policy filters a write rather than refusing it, so the assertion is that
-- the row did not move, not that anything raised.
select lives_ok(
  $$update public.profiles set display_name = 'grapevine Support'
    where id = '22222222-2222-2222-2222-222222222222'$$,
  'but only about yourself');
select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Them', 'and nobody else''s name moved');

select * from finish();
rollback;
