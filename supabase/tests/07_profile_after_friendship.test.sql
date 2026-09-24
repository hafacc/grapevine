-- A profile that changes after a friendship exists: befriend someone, then
-- claim a handle or change your photo. Nothing about you is copied onto the
-- edge, so none of it needs a repair pass, and nothing can be smuggled onto an
-- edge either.

begin;
select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'healer@example.com',     now()),
  ('22222222-2222-2222-2222-222222222222', 'healfriend@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'someone@example.com',    now());

update public.profiles set display_name = 'Old Name'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Friend'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Someone', username = 'someone_else', searchable = true
  where id = '33333333-3333-3333-3333-333333333333';

-- The edge, written before the handle and the photo exist.
insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Claiming a handle writes one row and every reader joins to it.
select lives_ok(
  $$select public.claim_username('claimed_later')$$,
  'a handle claimed after the friendship needs no repair pass');
select lives_ok(
  $$update public.profiles set display_name = 'New Name', photo_url = 'https://example.com/new.png'
    where id = (select auth.uid())$$,
  'and neither does a new name or a new photo');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select username || '/' || display_name || '/' || photo_url from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  'claimed_later/New Name/https://example.com/new.png',
  'the friend sees all three, from the one row they were written to');

-- There is no second place to write a handle or a photo, and the handle column
-- carries no UPDATE privilege at all.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set username = 'someone_else' where id = (select auth.uid())$$, '42501', null,
  'a handle registered to someone else cannot be worn');

select throws_ok(
  $$update public.friendships set friend_id = '33333333-3333-3333-3333-333333333333'
    where user_id = (select auth.uid())$$, '42501', null,
  'an edge cannot be re-pointed at somebody else');
select throws_ok(
  $$update public.profiles set id = '33333333-3333-3333-3333-333333333333'
    where id = (select auth.uid())$$, '42501', null,
  'nor a profile re-keyed');

-- The two verbs that survive on an edge, and the two that do not.
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
  'friend_id,user_id', 'and written with two uuids — `since` is the server''s');

select * from finish();
rollback;
