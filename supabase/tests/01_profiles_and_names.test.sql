-- Who can read a profile, and what a display name may be.
--
-- Nobody is found by typing anything, so there is no lookup by key for a
-- stranger at all, and a stranger's row is unreadable. The profiles a caller
-- reads are their own, those of the accounts they follow, and their
-- followers'. (A prefilled account is readable by everyone signed in; that is
-- 23_prefilled's.) A name is the default from Google, the first name, and
-- anything its owner types after that, short of a control character or a
-- bidirectional mark.

begin;
select plan(44);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',     now(), '{}'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com',  now(), '{}'),
  ('33333333-3333-3333-3333-333333333333', 'followed@example.com',  now(), '{}'),
  ('44444444-4444-4444-4444-444444444444', 'follower@example.com',  now(), '{}'),
  ('55555555-5555-5555-5555-555555555555', 'another@example.com',   now(), '{}');
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test

-- The default name, from each shape Google's metadata comes in.
insert into auth.users (id, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001',
   '{"given_name":"Ada","full_name":"Augusta Ada King","name":"Augusta Ada King"}'),
  ('a0000000-0000-0000-0000-000000000002', '{"full_name":"Grace Brewster Hopper"}'),
  ('a0000000-0000-0000-0000-000000000003', '{"name":"Alan Turing"}'),
  ('a0000000-0000-0000-0000-000000000004', '{}'),
  ('a0000000-0000-0000-0000-000000000005', '{"given_name":"  "}'),
  ('a0000000-0000-0000-0000-000000000006', '{"given_name":"Ev‮il"}'),
  ('a0000000-0000-0000-0000-000000000007', json_build_object('given_name', repeat('x', 80))::jsonb),
  -- A zero-width space and a soft hyphen inside a name, and a name of nothing else.
  ('a0000000-0000-0000-0000-000000000008', jsonb_build_object('given_name', U&'A\200Bd\00ADa')),
  ('a0000000-0000-0000-0000-000000000009',
   jsonb_build_object('given_name', U&'\200B\2060', 'avatar_url', 'javascript:alert(1)')),
  ('a0000000-0000-0000-0000-00000000000a',
   '{"given_name":"Plain","avatar_url":"http://example.com/p.png"}'),
  ('a0000000-0000-0000-0000-00000000000b',
   '{"given_name":"Secure","avatar_url":"https://example.com/p.png"}');

select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
          'Ada', 'the default name is given_name when Google sends one');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000002'),
          'Grace', 'else the first word of full_name');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
          'Alan', 'else the first word of name');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000004'),
          'unknown', 'else "unknown", which its owner can change');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000005'),
          'unknown', 'a blank given_name counts as none');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000006'),
          'Evil', 'a bidi override is stripped rather than refused, so the account is still made');
select is((select char_length(display_name) from public.profiles where id = 'a0000000-0000-0000-0000-000000000007'),
          50, 'and the default is cut to the column''s fifty');

select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000008'),
          'Ada', 'characters that draw as nothing are stripped too');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000009'),
          'unknown', 'and a name of nothing else counts as none');
select is(
  (select count(*)::int from public.profiles
    where id in ('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-00000000000a')
      and photo_url is null),
  2, 'a picture that is not https is dropped, and the account is still made');
select is((select photo_url from public.profiles where id = 'a0000000-0000-0000-0000-00000000000b'),
          'https://example.com/p.png', 'while an https one is kept');

update public.profiles set display_name = 'Owner'    where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Stranger' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Followed' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'Follower' where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set display_name = 'Another'  where id = '55555555-5555-5555-5555-555555555555';

-- The owner follows 3 and is followed by 4. 2 and 5 follow each other, which
-- is nothing to the owner.
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222');


set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1, 'can read your own profile');
select is(
  (select display_name from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'Followed', 'somebody you follow is readable directly');
select is(
  (select display_name from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  'Follower', 'and so is somebody who follows you, or you could not tell who reads your thumbs');
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  0, 'a stranger''s is not');
select is(
  (select count(*)::int from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
  0, 'nor any other stranger''s');

-- No clause matches a stranger, so the whole-table read returns the caller and
-- the two accounts at the other end of a follow.
select is(
  (select count(*)::int from public.profiles),
  3, 'the profile table cannot be enumerated');

-- A person has no handle, so there is nothing to look one up by.
select is(
  (select count(*)::int from public.profiles where handle is not null or prefilled),
  0, 'no person carries a handle');
select throws_ok(
  $$update public.profiles set handle = 'owner' where id = (select auth.uid())$$, '42501', null,
  'and none can claim one');
select throws_ok(
  $$update public.profiles set prefilled = true where id = (select auth.uid())$$, '42501', null,
  'or declare itself prefilled');

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
-- What draws as nothing, or breaks the line: with any of these two names that
-- look the same are different strings.
select is(
  (select count(*)::int
     from unnest(array[U&'a\061Cb', U&'a\200Bb', U&'a\2060b', U&'a\00ADb',
                       U&'a\2028b', U&'a\2029b', U&'a\FEFFb']) as name
    where name !~ ('[\U00000000-\U0000001F\U0000007F-\U0000009F'
                   '\U000000AD\U0000061C\U0000200B\U0000200E\U0000200F'
                   '\U00002028-\U0000202E\U00002060'
                   '\U00002066-\U00002069\U0000FEFF]')),
  0, 'the pattern below refuses each invisible character on its own');
select throws_ok(
  $$update public.profiles set display_name = U&'a\061Cb' where id = (select auth.uid())$$, '23514', null,
  'an Arabic letter mark is refused');
select throws_ok(
  $$update public.profiles set display_name = U&'a\200Bb' where id = (select auth.uid())$$, '23514', null,
  'and a zero-width space');
select throws_ok(
  $$update public.profiles set display_name = U&'a\2060b' where id = (select auth.uid())$$, '23514', null,
  'and a word joiner');
select throws_ok(
  $$update public.profiles set display_name = U&'a\00ADb' where id = (select auth.uid())$$, '23514', null,
  'and a soft hyphen');
select throws_ok(
  $$update public.profiles set display_name = U&'a\2028b' where id = (select auth.uid())$$, '23514', null,
  'and a line separator');
select throws_ok(
  $$update public.profiles set display_name = U&'a\2029b' where id = (select auth.uid())$$, '23514', null,
  'and a paragraph separator');
select throws_ok(
  $$update public.profiles set display_name = '' where id = (select auth.uid())$$, '23514', null,
  'a name cannot be empty');
select throws_ok(
  $$update public.profiles set display_name = '   ' where id = (select auth.uid())$$, '23514', null,
  'or blank');

-- A link's holder is handed the photo's URL before signing in.
select throws_ok(
  $$update public.profiles set photo_url = 'javascript:alert(1)' where id = (select auth.uid())$$,
  '23514', null, 'a photo is not a script');
select throws_ok(
  $$update public.profiles set photo_url = 'http://example.com/p.png' where id = (select auth.uid())$$,
  '23514', null, 'nor fetched in the clear');
select throws_ok(
  $$update public.profiles set photo_url = ' https://example.com/p.png' where id = (select auth.uid())$$,
  '23514', null, 'and https is how it starts, not something it contains');
select lives_ok(
  $$update public.profiles set photo_url = null where id = (select auth.uid())$$,
  'having no photo is allowed');

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
          'Followed', 'and nobody renames anybody else, followed or not');

select * from finish();
rollback;
