-- Who can read a profile, and what a display name may be.
--
-- There are no handles: nobody is found by typing anything, so there is no
-- lookup by key for a stranger at all, and a stranger's row is unreadable.
-- The only profiles a caller reads are their own and their friends'. A name is the default from Google — the
-- first name — and anything its owner types after that, short of a control
-- character or a bidirectional mark.

begin;
select plan(30);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',     now(), '{}'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com',  now(), '{}'),
  ('33333333-3333-3333-3333-333333333333', 'friend@example.com',    now(), '{}'),
  ('44444444-4444-4444-4444-444444444444', 'another@example.com',   now(), '{}');
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

-- The default name, from each shape Google's metadata comes in.
insert into auth.users (id, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001',
   '{"given_name":"Ada","full_name":"Augusta Ada King","name":"Augusta Ada King"}'),
  ('a0000000-0000-0000-0000-000000000002', '{"full_name":"Grace Brewster Hopper"}'),
  ('a0000000-0000-0000-0000-000000000003', '{"name":"Alan Turing"}'),
  ('a0000000-0000-0000-0000-000000000004', '{}'),
  ('a0000000-0000-0000-0000-000000000005', '{"given_name":"  "}'),
  ('a0000000-0000-0000-0000-000000000006', '{"given_name":"Ev‮il"}'),
  ('a0000000-0000-0000-0000-000000000007', json_build_object('given_name', repeat('x', 80))::jsonb);

select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
          'Ada', 'the default name is given_name when Google sends one');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000002'),
          'Grace', 'else the first word of full_name');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
          'Alan', 'else the first word of name');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000004'),
          'unknown', 'else "unknown", which its owner can change (0010)');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000005'),
          'unknown', 'a blank given_name counts as none');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000006'),
          'Evil', 'a bidi override is stripped rather than refused, so the account is still made');
select is((select char_length(display_name) from public.profiles where id = 'a0000000-0000-0000-0000-000000000007'),
          50, 'and the default is cut to the column''s fifty');

update public.profiles set display_name = 'Owner'    where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Stranger' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Friend'   where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'Another' where id = '44444444-4444-4444-4444-444444444444';

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');


set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1, 'can read your own profile');
select is(
  (select count(*)::int from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  1, 'a friend''s profile is readable directly');
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  0, 'a stranger''s is not');
select is(
  (select count(*)::int from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  0, 'nor any other stranger''s');

-- No clause matches a stranger, so the whole-table read returns the caller and
-- their friends.
select is(
  (select count(*)::int from public.profiles),
  2, 'the profile table cannot be enumerated');

select throws_ok(
  $$select 1 from public.user_prefs$$, '42P01', null,
  'there are no prefs: the suggestions switch went with taste search');
select is((select count(*)::int from public.friendships
           where user_id = '44444444-4444-4444-4444-444444444444'),
          0, 'and so do their friend edges');

-- The handle functions and columns are gone, not merely unreachable.
select throws_ok(
  $$select public.find_by_username('owner_h')$$, '42883', null,
  'there is no lookup by handle');
select throws_ok(
  $$select public.profile_by_id('44444444-4444-4444-4444-444444444444')$$, '42883', null,
  'nor by id');
select throws_ok(
  $$select public.claim_username('owner_h')$$, '42883', null,
  'nor a handle to claim');
select throws_ok(
  $$select username from public.profiles$$, '42703', null,
  'there is no username column');
select throws_ok(
  $$select searchable from public.profiles$$, '42703', null,
  'nor a searchable one');

-- A name is anything plain.
select lives_ok(
  $$update public.profiles set display_name = 'Renamed', photo_url = 'https://example.com/p.png'
    where id = (select auth.uid())$$,
  'a rename and a new photo are one update of your own row');
select lives_ok(
  $$update public.profiles set display_name = 'جان‌محمد' where id = (select auth.uid())$$,
  'a ZWNJ, which Persian needs, is allowed');
select throws_ok(
  $$update public.profiles set display_name = E'Tab\there' where id = (select auth.uid())$$, '23514', null,
  'a control character is refused');
select throws_ok(
  $$update public.profiles set display_name = U&'Mom\202E' where id = (select auth.uid())$$, '23514', null,
  'a bidi override is refused');
select throws_ok(
  $$update public.profiles set display_name = U&'a\2066b' where id = (select auth.uid())$$, '23514', null,
  'and a bidi isolate');
select throws_ok(
  $$update public.profiles set display_name = repeat('x', 51) where id = (select auth.uid())$$, '23514', null,
  'as is a name over fifty characters');

select throws_ok(
  $$update public.profiles set email = 'owner@example.com' where id = (select auth.uid())$$, '42703', null,
  'there is no column to park an address in');
select throws_ok(
  $$update public.profiles set created_at = now() where id = (select auth.uid())$$, '42501', null,
  'created_at is not the client''s to move');
select throws_ok(
  $$insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Nobody')$$, '42501', null,
  'a profile cannot be conjured');
select throws_ok(
  $$delete from public.profiles where id = (select auth.uid())$$, '42501', null,
  'nor deleted');

-- Renaming somebody else touches nothing.
update public.profiles set display_name = 'Hijacked' where id = '33333333-3333-3333-3333-333333333333';
set local role postgres;
select is((select display_name from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
          'Friend', 'and nobody renames anybody else, friend or not');

select * from finish();
rollback;
