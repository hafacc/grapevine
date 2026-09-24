-- A connect request cannot spoof an identity, because it carries no name.
--
-- A pending ask is itself a read clause on `profiles` — unconditionally for the
-- recipient, and for as long as the target is searchable for the sender — so
-- each party reads the other's real row and there is one copy of a name. The
-- spoof is not refused, it is unspellable. These assert that a request has no
-- name columns, that the read through the ask works, and that neither half of
-- it outlives what opened it.

begin;
select plan(14);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'target@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'sender@example.com', now());

update public.profiles set display_name = 'Target', username = 'u_one', searchable = true
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Real Sender', username = 'real_sender', searchable = true
  where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')$$,
  'you can ask, under the only name you have');

select throws_ok(
  $$update public.connect_requests set from_name = 'Chase Fraud Alert'
    where from_id = (select auth.uid())$$, '42703',
  'there is no display name on a request to invent');

select throws_ok(
  $$update public.connect_requests set from_username = 'chase_support'
    where from_id = (select auth.uid())$$, '42703',
  'nor a handle on it to wear');

-- The columns a request really has, so that adding one back is a failure here
-- rather than a quiet re-opening of the whole category.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'connect_requests'),
  'from_id,to_id,created_at',
  'a request carries two uuids and a server clock, and nothing else');

-- Each party reads the other's real row.
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Target', 'the sender reads the recipient''s real profile through the pending ask');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Real Sender', 'and the recipient reads the sender''s, which is the name the inbox shows');

-- `created_at` is absent from the insert grant.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id, created_at)
    values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'epoch')$$,
  '42501', 'a request cannot be backdated');

-- There is no UPDATE privilege; a re-ask is `on conflict do nothing` over the
-- same row.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$update public.connect_requests set to_id = '11111111-1111-1111-1111-111111111111'
    where from_id = (select auth.uid())$$, '42501',
  'there is no update verb on a request at all');

select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
    on conflict do nothing$$,
  'a re-ask is the same row, not a second one');


-- The two reads above are not one permission. A single bidirectional request
-- probe that tested nothing about `searchable` would turn an unanswered ask into
-- a standing subscription to a stranger's renames and photos for as long as the
-- row sat there, which is why `has_open_outgoing_request_to` carries the join
-- and `has_incoming_request_from` does not.

set local role postgres;
update public.profiles set searchable = false
  where id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  0, 'the ask stops being a read the moment the target goes private');
select is(
  (select count(*)::int from public.profile_by_id('11111111-1111-1111-1111-111111111111')),
  0, 'and the exact-key lookup refuses them too, so the switch leaves no route open');

-- What the sender keeps is the ask itself: `connect_requests_select` is either
-- party, so a request can still be withdrawn by the person who made it. That is
-- the row, not the profile — there is no name on it to read.
select is(
  (select count(*)::int from public.connect_requests
    where from_id = (select auth.uid()) and to_id = '11111111-1111-1111-1111-111111111111'),
  1, 'while the ask itself stays the sender''s, to withdraw');

-- The other direction does not depend on `searchable` at all, and must not: a
-- sender needs a handle to be found BY, not to find, so a recipient deciding on
-- an ask can be looking at someone who is not findable by anyone.
set local role postgres;
update public.profiles set searchable = false
  where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Real Sender', 'the recipient reads the sender''s row though the sender is findable by nobody');
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1, 'and going private never closed anyone''s read of their own row');

select * from finish();
rollback;
