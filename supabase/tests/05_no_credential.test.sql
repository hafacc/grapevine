-- A participant with no credential, pinned from both sides. Everything such an
-- account may do, it may do because no policy MENTIONS how it signed in —
-- correctness by omission, which vanishes when somebody adds a provider check
-- for a good local reason. Under Google-only every session passes
-- `private.has_credential()` by construction, so this suite is what keeps the
-- check from being decorative: it guards against a dashboard toggle rather than
-- a client (DESIGN §3.3), and a toggle ships no diff.

begin;
select plan(15);

insert into auth.users (id, email, email_confirmed_at, phone, phone_confirmed_at, is_anonymous) values
  -- The credentialed account: a confirmed address.
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com', now(), null, null, false),
  -- Signed in, and nothing about the account proves anyone owns it. This is
  -- what an anonymous session or an unverified email signup would produce, and
  -- both of those are a config change away.
  ('22222222-2222-2222-2222-222222222222', 'nobody@example.com', null, null, null, false),
  -- Anonymous outright.
  ('33333333-3333-3333-3333-333333333333', null, null, null, null, true),
  -- The other two doors, each of which proves itself.
  ('44444444-4444-4444-4444-444444444444', null, null, '+15555550123', now(), false),
  ('55555555-5555-5555-5555-555555555555', 'google@example.com', null, null, null, false),
  -- Somebody findable for the uncredentialed account to ask.
  ('66666666-6666-6666-6666-666666666666', 'findable@example.com', now(), null, null, false);

-- Every column GoTrue's `auth.identities` does not default, plus the two
-- clocks, which some versions of that table do not default either. Nothing else
-- in it is required, so this insert is one a real stack accepts as well.
insert into auth.identities (provider, provider_id, user_id, identity_data, created_at, updated_at)
values ('google', 'google-55555', '55555555-5555-5555-5555-555555555555',
        '{"sub":"google-55555"}', now(), now());

update public.profiles set display_name = 'Owner', username = 'owner_h', searchable = true
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Nobody'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Findable', username = 'findable_h', searchable = true
  where id = '66666666-6666-6666-6666-666666666666';

insert into public.connect_requests (from_id, to_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- The permissive half, and the half that actually rots.
select lives_ok(
  $$update public.profiles set display_name = 'Stranger' where id = (select auth.uid())$$,
  'writes its own profile with a display name');

select lives_ok(
  $$select public.accept_connect_request('11111111-1111-1111-1111-111111111111')$$,
  'accepts a request — no policy mentions how anybody signed in');

select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Owner', 'reads a friend''s profile once the edge exists');

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '66666666-6666-6666-6666-666666666666')$$,
  'sends a connect request to a searchable user');

select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'blue bottle', 1)$$,
  'rates a thing');

select lives_ok(
  $$select public.record_debug_event('listeners-lost', '{"reason":"stalled"}')$$,
  'records a diagnostic event');

-- The one thing refused, because a handle is permanent and never released, and
-- an account nobody can sign back into would park one for good.
select throws_ok(
  $$select public.claim_username('nobody_h')$$, '42501',
  'cannot claim a handle');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$select public.claim_username('anon_h')$$, '42501',
  'nor can an anonymous session — the toggle this check exists for');

-- A refusal test alone passes just as happily against a check that refuses
-- everyone, so each door that does prove itself gets its own case.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok(
  $$select public.claim_username('phoned_h')$$,
  'a confirmed phone can');

set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select lives_ok(
  $$select public.claim_username('google_h')$$,
  'and a Google identity can — which is the only door there actually is');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select username from public.profiles where id = (select auth.uid())),
  'owner_h', 'a confirmed address counts too, and is what the seeds use');

-- Searchability is gated transitively: there is no UPDATE privilege on the column at all, so
-- the claim is the only way a handle is ever written and the credential is
-- demanded there.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set username = 'owner_h' where id = (select auth.uid())$$, '42501',
  'cannot show a handle it does not own, credential or not');
select throws_ok(
  $$update public.profiles set searchable = true where id = (select auth.uid())$$, '23514',
  'and cannot be findable with nothing to be found by');

-- `has_credential()` reads committed state rather than a token claim, so it
-- sees the account as it is, not as of the last token refresh.
select is(
  (select count(*)::int from pg_proc
   where proname = 'has_credential' and pronamespace = 'private'::regnamespace),
  1, 'the check exists');
select is(
  (select count(*)::int from pg_proc
   where proname = 'claim_username' and pronamespace = 'public'::regnamespace
     and prosrc like '%has_credential%'),
  1, 'and claim_username is what calls it');

select * from finish();
rollback;
