-- A profile that changes after a friendship exists: befriend someone, then
-- change your name or your photo. Nothing about you is copied onto the
-- edge, so none of it needs a repair pass, and nothing can be smuggled onto an
-- edge either.

begin;
select plan(6);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'healer@example.com',     now()),
  ('22222222-2222-2222-2222-222222222222', 'healfriend@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'someone@example.com',    now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

update public.profiles set display_name = 'Old Name'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Friend'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Someone'
  where id = '33333333-3333-3333-3333-333333333333';

-- The edge, written before the new name and the photo exist.
insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A rename writes one row and every reader joins to it.
select lives_ok(
  $$update public.profiles set display_name = 'New Name', photo_url = 'https://example.com/new.png'
    where id = (select auth.uid())$$,
  'a new name or a new photo after the friendship needs no repair pass');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select display_name || '/' || photo_url from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  'New Name/https://example.com/new.png',
  'the friend sees both, from the one row they were written to');

-- There is no second place to write a name or a photo.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$update public.friendships set friend_id = '33333333-3333-3333-3333-333333333333'
    where user_id = (select auth.uid())$$, '42501', null,
  'an edge cannot be re-pointed at somebody else');
select throws_ok(
  $$update public.profiles set id = '33333333-3333-3333-3333-333333333333'
    where id = (select auth.uid())$$, '42501', null,
  'nor a profile re-keyed');

-- The two verbs a client has on an edge. There is no insert: `redeem_invite`
-- writes both halves as its owner (0011).
select is(
  (select string_agg(distinct privilege_type, ',' order by privilege_type)
   from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'friendships' and grantee = 'authenticated'),
  'DELETE,SELECT', 'an edge may be read and dropped, and that is all');
select is(
  (select string_agg(distinct column_name, ',' order by column_name)
   from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'friendships'
     and grantee = 'authenticated' and privilege_type = 'INSERT'),
  null, 'and written by no client at all');

select * from finish();
rollback;
