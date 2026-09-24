-- Who may send a connect request. Going private stops inbound requests
-- outright, not just in the UI: the insert policy requires
-- `private.is_searchable(to_id)`, and being searchable is the only route
-- grapevine opens.

begin;
select plan(13);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'findable@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'sender@example.com',   now()),
  ('33333333-3333-3333-3333-333333333333', 'private@example.com',  now()),
  ('44444444-4444-4444-4444-444444444444', 'impostor@example.com', now());

update public.profiles set display_name = 'U', username = 'u_one', searchable = true
  where id = '11111111-1111-1111-1111-111111111111';
-- Searchable, so that the self-request below is refused by the CHECK rather
-- than by `is_searchable` — the two would otherwise be indistinguishable.
update public.profiles set display_name = 'Sender', username = 'sender_h', searchable = true
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Private', username = 'private_one'
  where id = '33333333-3333-3333-3333-333333333333';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  'a searchable user can be asked');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333')$$,
  '42501', 'a private user cannot be, even knowing their uid');

-- The foreign key refuses this, and `is_searchable` returns false for a row
-- that is not there, so either lock alone would do.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '99999999-9999-9999-9999-999999999999')$$,
  '42501', 'nor can somebody with no profile at all');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111')$$,
  '42501', 'and nobody asks on somebody else''s behalf');

select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222')$$,
  '23514', 'nor of themselves');

-- Exactly one pending ask per pair is the composite primary key.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  '23505', 'one pending ask per pair, by the primary key');

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
