-- Who can read a profile, and how a handle is claimed.
--
-- A stranger reads a searchable profile only through `public.profile_by_id` and
-- `public.find_by_username`, each taking an exact key, never through the table:
-- a policy clause authorizing one searchable row authorizes every searchable row
-- (DESIGN §3.3).

begin;
select plan(43);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',     now()),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com',  now()),
  ('33333333-3333-3333-3333-333333333333', 'friend@example.com',    now()),
  ('44444444-4444-4444-4444-444444444444', 'findable@example.com',  now()),
  ('55555555-5555-5555-5555-555555555555', 'private@example.com',   now());

-- `private.handle_new_user()` already made the profile and prefs rows.
update public.profiles set display_name = 'Owner'    where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Stranger' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Friend'   where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'Findable', username = 'findable_one', searchable = true
  where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set display_name = 'Private', username = 'private_one'
  where id = '55555555-5555-5555-5555-555555555555';

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
  (select count(*)::int from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  0, 'a searchable stranger is NOT readable through the table');
select is(
  (select count(*)::int from public.profile_by_id('44444444-4444-4444-4444-444444444444')),
  1, 'a searchable stranger is readable by exact id, through profile_by_id');

select is(
  (select count(*)::int from public.profile_by_id('55555555-5555-5555-5555-555555555555')),
  0, 'a private profile is not readable even knowing the uid');

-- No clause matches a stranger, so the whole-table read returns the caller,
-- their friends, their counterparties and their at-most-five suggestions —
-- here, two rows.
select is(
  (select count(*)::int from public.profiles),
  2, 'the profile table cannot be enumerated');

-- Searchable exposes the profile and nothing else: neither of these policies has
-- a `searchable` clause to widen.
select is((select count(*)::int from public.user_prefs
           where user_id = '44444444-4444-4444-4444-444444444444'),
          0, 'a searchable stranger''s prefs stay unreadable');
select is((select count(*)::int from public.friendships
           where user_id = '44444444-4444-4444-4444-444444444444'),
          0, 'a searchable stranger''s friend edges stay unreadable');

select is(
  (select id from public.find_by_username('findable_one')),
  '44444444-4444-4444-4444-444444444444'::uuid,
  'a handle resolves to a uid by exact spelling');
select is(
  (select count(*)::int from public.find_by_username('private_one')),
  0, 'the same lookup refuses a handle whose owner is not searchable');

-- The lookup takes an exact key: a `like`, a `~`, a `%` or an unbounded limit in
-- its body is the enumeration it exists to prevent, so the body itself is the
-- assertion.
select is(
  (select count(*)::int from pg_proc
   where proname = 'find_by_username'
     and prosrc ~* '(like|similar to|~|%)'),
  0, 'find_by_username''s body carries no pattern operator');


select lives_ok(
  $$select public.claim_username('owner_h')$$,
  'an unclaimed handle can be claimed');
select is(
  (select username from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'owner_h', 'and it lands on the caller''s own row');
-- `searchable` rides along: a handle exists to be found by.
select is(
  (select searchable from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  true, 'claiming a handle makes you findable');

-- The update is guarded on `username is null`, so a second claim matches no row
-- and raises. A retry after a claim that in fact landed therefore reports
-- "taken" rather than succeeding quietly: a worse message for the same outcome.
select throws_ok(
  $$select public.claim_username('owner_h')$$, '23505', null,
  'a second claim by the same account raises rather than passing');

select throws_ok(
  $$select public.claim_username('findable_one')$$, '23505', null,
  'a handle somebody else holds cannot be stolen');

-- Nobody can claim a handle for someone else's uid or smuggle extra fields: the
-- function takes one argument and writes `id = auth.uid()`.
select is(
  (select pg_get_function_arguments(oid) from pg_proc
   where proname = 'claim_username' and pronamespace = 'public'::regnamespace),
  'p_handle text', 'claim_username takes the handle and nothing else');

-- Permanent, which is what makes going private reversible — and what the
-- credential check exists for.
select throws_ok(
  $$update public.profiles set username = null where id = (select auth.uid())$$, '42501', null,
  'a handle cannot be released');
select throws_ok(
  $$update public.profiles set username = 'something_else' where id = (select auth.uid())$$, '42501', null,
  'nor changed, not even to a free one');
select throws_ok(
  $$update public.profiles set username = 'findable_one' where id = (select auth.uid())$$, '42501', null,
  'nor can a handle you never claimed be displayed');


set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Eight calls rather than a loop, so that dropping one name from the CHECK
-- fails on the name rather than on a count.
select throws_ok($$select public.claim_username('admin')$$,     '23514', null, 'reserved: admin');
select throws_ok($$select public.claim_username('grapevine')$$, '23514', null, 'reserved: grapevine');
select throws_ok($$select public.claim_username('support')$$,   '23514', null, 'reserved: support');
select throws_ok($$select public.claim_username('help')$$,      '23514', null, 'reserved: help');
select throws_ok($$select public.claim_username('root')$$,      '23514', null, 'reserved: root');
select throws_ok($$select public.claim_username('system')$$,    '23514', null, 'reserved: system');
select throws_ok($$select public.claim_username('about')$$,     '23514', null, 'reserved: about');
select throws_ok($$select public.claim_username('settings')$$,  '23514', null, 'reserved: settings');

select throws_ok($$select public.claim_username('ab')$$,       '23514', null, 'malformed: too short');
select throws_ok($$select public.claim_username('1abc')$$,     '23514', null, 'malformed: leading digit');
select throws_ok($$select public.claim_username('Bad_Caps')$$, '23514', null, 'malformed: capitals');
select throws_ok($$select public.claim_username('has-dash')$$, '23514', null, 'malformed: a dash, which the folding never emits');
select lives_ok($$select public.claim_username('stranger_h')$$, 'a well-formed handle is accepted');


set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- A CHECK: you cannot be findable with nothing to be found by.
select throws_ok(
  $$update public.profiles set searchable = true where id = (select auth.uid())$$, '23514', null,
  'cannot mark yourself searchable without a handle');
select lives_ok(
  $$select public.claim_username('friend_h')$$,
  'claiming one is what makes the switch reachable');
select lives_ok(
  $$update public.profiles set searchable = false where id = (select auth.uid())$$,
  'and it can be turned back off');
select lives_ok(
  $$update public.profiles set searchable = true where id = (select auth.uid())$$,
  'and on again, with a handle you own');

-- Every field the app really writes still passes, so tightening the grant cannot
-- quietly break a rename.
select lives_ok(
  $$update public.profiles set display_name = 'Renamed', photo_url = 'https://example.com/p.png'
    where id = (select auth.uid())$$,
  'a rename and a new photo are one update of your own row');

-- The promise this schema makes loudest: an address lives on the auth account
-- and nowhere else.
select throws_ok(
  $$update public.profiles set email = 'owner@example.com' where id = (select auth.uid())$$, '42703', null,
  'there is no column to park an address in');
select throws_ok(
  $$update public.profiles set phone_number = '+15551234567' where id = (select auth.uid())$$, '42703', null,
  'nor a number');

-- A missing column privilege.
select throws_ok(
  $$update public.profiles set created_at = now() where id = (select auth.uid())$$, '42501', null,
  'created_at is not the client''s to move');

-- No INSERT and no DELETE verb at all: the row is the trigger's.
select throws_ok(
  $$insert into public.profiles (id, display_name) values (gen_random_uuid(), 'Nobody')$$, '42501', null,
  'a profile cannot be conjured');
select throws_ok(
  $$delete from public.profiles where id = (select auth.uid())$$, '42501', null,
  'nor deleted');

select * from finish();
rollback;
