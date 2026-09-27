-- Who may send a connect request. There is no searching for people, so the
-- only route a request travels is a suggestion: the insert policy requires
-- `private.is_suggested_to_me(to_id)`, which also requires the target to be
-- discoverable NOW. Knowing a uid is not a route. (A link is the other way to
-- become friends, and it needs no request at all.)

begin;
select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'suggested@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'sender@example.com',    now()),
  ('33333333-3333-3333-3333-333333333333', 'unnamed@example.com',   now()),
  ('44444444-4444-4444-4444-444444444444', 'impostor@example.com',  now()),
  ('55555555-5555-5555-5555-555555555555', 'switched@example.com',  now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

update public.profiles set display_name = 'U'        where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Sender'   where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Unnamed'  where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'Switched' where id = '55555555-5555-5555-5555-555555555555';

-- Everyone discoverable but the one who switched off after being named.
update public.user_prefs set discoverable_by_taste = true
  where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
                    '33333333-3333-3333-3333-333333333333');
-- The sender is named 1 and 5, and — so that the self-request below is refused
-- by the CHECK rather than by the policy — themselves. 3 is discoverable and
-- named to nobody.
insert into public.suggestions (user_id, rank, suggested_id) values
  ('22222222-2222-2222-2222-222222222222', 1, '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', 2, '55555555-5555-5555-5555-555555555555'),
  ('22222222-2222-2222-2222-222222222222', 3, '22222222-2222-2222-2222-222222222222');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  'someone suggested to you can be asked');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')$$,
  '42501', null, 'someone discoverable but not suggested to you cannot be, even knowing their uid');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '55555555-5555-5555-5555-555555555555')$$,
  '42501', null, 'nor someone suggested who has since switched off');

-- The foreign key refuses this, and `is_suggested_to_me` returns false for a
-- row that is not there, so either lock alone would do.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999999')$$,
  '42501', null, 'nor can somebody with no profile at all');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'and nobody asks on somebody else''s behalf');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222')$$,
  '23514', null, 'nor of themselves');

-- Exactly one pending ask per pair is the composite primary key.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  '23505', null, 'one pending ask per pair, by the primary key');

select is(
  (select count(*)::int from public.connect_requests),
  1, 'the sender sees their own outbox');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.connect_requests),
  1, 'and the recipient their inbox');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.connect_requests),
  0, 'and nobody else sees either');

-- A policy filters a delete rather than refusing it, so the outsider's attempt
-- is silent and the assertion has to be that the row survived it.
select lives_ok(
  $$delete from public.connect_requests$$,
  'a third party''s delete raises nothing');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.connect_requests),
  1, 'and removes nothing — the ask is still in the inbox');

-- Decline and withdraw are the same delete either way.
select lives_ok(
  $$delete from public.connect_requests where to_id = (select auth.uid())$$,
  'the recipient declines');
select is(
  (select count(*)::int from public.connect_requests),
  0, 'and the ask is gone');

select * from finish();
rollback;
