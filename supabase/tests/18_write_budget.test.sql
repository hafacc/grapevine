-- The daily write budget (0001, "daily write budget"): one allowance per account
-- per UTC day, spent by giving or turning over a thumb, naming an item, sending
-- a connect request and recording a diagnostics event, and enforced where a
-- crafted client cannot skip it.
--
-- Every count below is derived from `private.daily_write_limit()`, so the
-- number lives in the migration and nowhere else. It is read once, as the
-- owner, into a transaction-local setting a client session can read back.

begin;
select plan(17);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'busy@example.com',  now()),
  ('22222222-2222-2222-2222-222222222222', 'quiet@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'other@example.com', now());

-- Findable, so a request to either is allowed by policy and only the budget
-- can refuse it.
update public.profiles set username = 'quiet', searchable = true
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set username = 'other', searchable = true
  where id = '33333333-3333-3333-3333-333333333333';

set local role postgres;
select set_config('budget.limit', private.daily_write_limit()::text, true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- All but a few of the day's writes, as thumbs. One statement, and the budget
-- is a row trigger, so each row draws on it.
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    select (select auth.uid()), 'item ' || n, 1
    from generate_series(1, current_setting('budget.limit')::int - 4) as n$$,
  'thumbs up to four short of the budget land');

-- Deletes shrink what is stored and draw nothing.
select lives_ok(
  $$delete from public.ratings where item_id in ('item 1', 'item 2', 'item 3')$$,
  'clearing thumbs');
set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  current_setting('budget.limit')::int - 4,
  'spends nothing');

-- The four kinds of write share one allowance.
set local role authenticated;
select lives_ok(
  $$update public.ratings set value = -1 where item_id = 'item 4'$$,
  'turning a thumb over spends one');
select lives_ok(
  $$select public.record_debug_event('probe', 'x')$$,
  'so does a diagnostics event');
select lives_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '22222222-2222-2222-2222-222222222222')$$,
  'and a connect request');
select lives_ok(
  $$insert into public.items (id, search_id) values ('last one', 'last one')$$,
  'and naming an item is the last write the budget allows');

select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'one too many', 1)$$,
  'PT429', null, 'the next thumb is refused with a stable code');
select throws_ok(
  $$insert into public.items (id, search_id) values ('one more', 'one more')$$,
  'PT429', null, 'and so is the next item');
-- Every insert is a Realtime event at the target, so without this a loop of
-- ask-and-withdraw pings somebody without limit.
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '33333333-3333-3333-3333-333333333333')$$,
  'PT429', null, 'and so is the next connect request');
select lives_ok(
  $$delete from public.connect_requests
    where from_id = (select auth.uid()) and to_id = '22222222-2222-2222-2222-222222222222'$$,
  'while withdrawing one still works, because a delete spends nothing');
select throws_ok(
  $$insert into public.connect_requests (from_id, to_id)
    values ((select auth.uid()), '22222222-2222-2222-2222-222222222222')$$,
  'PT429', null, 'and sending it again does not');

set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  current_setting('budget.limit')::int,
  'a refused write rolls its own increment back, so the account stays at the budget');

-- One account's budget is its own.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'item 1', 1)$$,
  'somebody else still writes');

select throws_ok(
  $$select writes from private.write_budget$$, '42501', null,
  'and no client can read a counter, their own included');

-- A connection with no request identity is not a client spending an allowance:
-- either Edge Function as `service_role`.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ('11111111-1111-1111-1111-111111111111', 'written by the server', 1)$$,
  'the service role is not held to the budget');

-- 0005's sweep, run from the schedule's own text so the statement tested is the
-- statement scheduled.
set local role postgres;
update private.write_budget set day = day - 1
 where user_id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  execute (select command from cron.job where jobname = 'write-budget-sweep');
end $$;
select is(
  (select string_agg(user_id::text, ',') from private.write_budget),
  '11111111-1111-1111-1111-111111111111',
  'the nightly sweep removes a past day''s counter and leaves today''s');

select * from finish();
rollback;
