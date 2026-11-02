-- A rename. Whoever follows you, and whoever you follow, reads your profile
-- directly, so no copy of your name lives on a follow: a rename is one update
-- of one row and reaches all of them at once. These assert that, and that a
-- follow has no name to rewrite and no verb to rewrite it with.

begin;
select plan(11);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'me@example.com',       now()),
  ('22222222-2222-2222-2222-222222222222', 'them@example.com',     now()),
  ('33333333-3333-3333-3333-333333333333', 'impostor@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test

update public.profiles set display_name = 'Old Name'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Them' where id = '22222222-2222-2222-2222-222222222222';

insert into public.follows (follower_id, followed_id) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set display_name = 'New Name' where id = (select auth.uid())$$,
  'a rename is one update of your own row');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'New Name', 'and the follower reads the new name at once, with nothing to heal');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'follows'
     and column_name in ('display_name', 'photo_url')),
  0, 'a follow carries no name or photo to heal');

select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'follows'
     and privilege_type = 'UPDATE' and grantee in ('authenticated', 'anon')),
  0, 'and no client holds an UPDATE privilege on one');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$update public.follows set since = now()
    where followed_id = '11111111-1111-1111-1111-111111111111'$$, '42501', null,
  'so an impostor has no verb to reach for');

select is(
  (select count(*)::int from public.follows),
  0, 'and cannot even see the follow');

-- A misleading name is a claim about your own row, which is the only place it
-- can be made and the one place a reader checks.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$update public.profiles set display_name = 'grapevine Support' where id = (select auth.uid())$$,
  'a misleading display name is still possible, since a name is whatever its owner types');
-- A policy filters a write rather than refusing it, so the assertion is that
-- the row did not move, not that anything raised.
select lives_ok(
  $$update public.profiles set display_name = 'grapevine Support'
    where id = '22222222-2222-2222-2222-222222222222'$$,
  'but only about yourself');
select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Them', 'and nobody else''s name moved');

-- The whole of what a client may do to a follow.
select is(
  (select string_agg(distinct privilege_type, ',' order by privilege_type)
   from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'follows' and grantee = 'authenticated'),
  'DELETE,SELECT', 'a follow may be read and dropped, and that is all');
select throws_ok(
  $$update public.profiles set id = '33333333-3333-3333-3333-333333333333'
    where id = (select auth.uid())$$, '42501', null,
  'and a profile cannot be re-keyed onto somebody else');

select * from finish();
rollback;
