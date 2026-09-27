-- `delete_account()`, the one verb that removes an account (0012). What the
-- cascade takes is 17_account_deletion's; this is who may call it, which
-- account it reaches, 0009's link going with it, and the diagnostics the
-- cascade cannot reach.

begin;
select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'leaver@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'friend@example.com', now()),
  ('44444444-4444-4444-4444-444444444444', 'other@example.com',  now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test
insert into auth.identities (provider, provider_id, user_id) values
  ('google', 'google-sub-leaver', '11111111-1111-1111-1111-111111111111');

insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
insert into public.items (id, search_id, created_by)
  values ('café bleu', 'cafe bleu', '11111111-1111-1111-1111-111111111111');
insert into public.ratings (user_id, item_id, value) values
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 1);
insert into private.debug_events (user_id, kind, detail) values
  ('11111111-1111-1111-1111-111111111111', 'stall', 'the leaver''s'),
  ('22222222-2222-2222-2222-222222222222', 'stall', 'the friend''s');

set local role postgres;
select ok(
  not has_function_privilege('anon', 'public.delete_account()', 'execute'),
  'a signed-out visitor cannot call it');
select ok(
  has_function_privilege('authenticated', 'public.delete_account()', 'execute'),
  'a signed-in one can');
-- It takes no argument, so there is no key to point at somebody else.
select is(
  (select pronargs::int from pg_proc
   where oid = 'public.delete_account()'::regprocedure),
  0, 'and it takes no argument: the only account it can reach is the caller''s');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.delete_account()$$, '42501', null,
  'with no identity it refuses rather than matching nothing');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$select public.set_invite_link()$$, 'the leaver has a friending link');
select lives_ok($$select public.delete_account()$$, 'the owner deletes their account');
select lives_ok($$select public.delete_account()$$,
  'and a second call, from a retry or another tab, is harmless');

set local role postgres;
select is((select count(*)::int from auth.users
           where id = '11111111-1111-1111-1111-111111111111'), 0,
  'the auth account is gone');
select is((select count(*)::int from auth.identities
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and the Google identity with it, so signing in again makes a new account');
select is((select count(*)::int from auth.users), 2,
  'and nobody else''s account');
select is((select count(*)::int from public.invite_links), 0,
  'their link goes, so nobody can befriend the account through it');
select is((select count(*)::int from public.friendships), 0,
  'the friend loses the friendship from their side too');
select ok((select created_by from public.items where id = 'café bleu') is null,
  'the thing they added stays, attributed to nobody');

select is(
  (select array_agg(detail order by detail) from private.debug_events),
  array['the friend''s'],
  'their diagnostics go now rather than at the TTL, and nobody else''s');

select * from finish();
rollback;
