-- Debug events: write-only diagnostics, nobody reads one back, and the shape
-- pinned so one crafted write cannot be an arbitrary blob.
--
-- The table is in schema `private`, which PostgREST does not serve, so a client
-- has no address for it in any verb. The one way in is
-- `public.record_debug_event(p_kind, p_detail)`, which takes the two fields a
-- client may supply.

begin;
select plan(15);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'stranger@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'owner@example.com',    now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select public.record_debug_event('listeners-lost', '{"reason":"stalled"}')$$,
  'a signed-in caller records their own event');

-- The uid, the timestamp and the expiry are the wrapper's, so a client cannot
-- write in another user's name or choose a clock.
select is(
  (select pg_get_function_arguments(oid) from pg_proc
   where proname = 'record_debug_event' and pronamespace = 'public'::regnamespace),
  'p_kind text, p_detail text',
  'the write verb takes a kind and a detail, and nothing else');

select throws_ok(
  $$select public.record_debug_event('k', 'd', (select auth.uid()))$$, '42883', null,
  'there is no third argument to lodge somebody else''s uid in');

set local role postgres;
select is(
  (select user_id from private.debug_events),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the stored uid is the caller''s, from auth.uid() and not from an argument');
select ok(
  (select at from private.debug_events) between now() - interval '1 second' and now(),
  'and `at` is the server''s clock');
select ok(
  (select expires - at from private.debug_events) = interval '7 days',
  'and `expires` is seven days out, which a client cannot widen or shorten');

-- The wrapper supplies the other four columns itself. Read as `postgres`,
-- because `information_schema.columns` shows only what the current role holds a
-- privilege on — and `authenticated` holds none here, which is itself the
-- point.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'private' and table_name = 'debug_events'),
  'id,user_id,kind,detail,at,expires',
  'the row has six columns and no room for a smuggled one');
set local role authenticated;

-- The cap is what bounds one write, so it is the whole abuse story. A CHECK, so
-- it fires the same way from the wrapper.
select throws_ok(
  $$select public.record_debug_event('listeners-lost', repeat('x', 2001))$$, '23514', null,
  'an oversized detail is refused');
select throws_ok(
  $$select public.record_debug_event(repeat('k', 41), 'd')$$, '23514', null,
  'and an oversized kind');

-- Nothing reads these back, which is what keeps them from being a channel to a
-- person: the schema is not served and neither role may even name it.
select throws_ok($$select * from private.debug_events$$, '42501', null,
  'nobody reads one back, including its author');
select throws_ok($$update private.debug_events set kind = 'x'$$, '42501', null,
  'nobody edits one');
select throws_ok($$delete from private.debug_events$$, '42501', null,
  'nobody removes one');
select throws_ok($$insert into private.debug_events (kind, detail) values ('k', 'd')$$, '42501', null,
  'and nobody reaches the table directly to write one either');

-- With no anonymous sessions a first visit is signed OUT, and `anon` holds
-- nothing at all.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.record_debug_event('listeners-lost', 'd')$$, '42501', null,
  'signed out records nothing');
select is(
  (select count(*)::int from information_schema.role_routine_grants
   where specific_schema = 'public' and routine_name = 'record_debug_event' and grantee = 'anon'),
  0, 'because `anon` holds no EXECUTE on the one verb there is');

select * from finish();
rollback;
