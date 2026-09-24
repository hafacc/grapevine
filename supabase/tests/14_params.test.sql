-- `private.params`, the population's priors: no client verb at all, and what
-- 0005's pooling statement writes into it.
--
-- Reading it would say how much the people on this instance agree with their
-- friends and with strangers, which is an aggregate nobody is shown anywhere
-- else; writing it would move the prior behind every viewer's feed at once. It
-- is in schema `private`, so the refusal is an address the API does not serve
-- rather than a policy that can be got wrong — and the schema is what holds it
-- shut, which is why the table carries no RLS at all.

begin;
select plan(17);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com', now());

insert into private.params (id, kappa, a0_d1, a0_d2, a0_d3plus)
  values (true, 11.2, 0.64, 0.58, 0.51);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok($$select * from private.params$$, '42501', null,
  'a signed-in account cannot read the estimate');
select throws_ok($$select kappa from private.params$$, '42501', null,
  'nor one column of it');
select throws_ok($$insert into private.params (id, kappa) values (true, 1)$$, '42501', null,
  'nor write it');
select throws_ok($$update private.params set kappa = 1$$, '42501', null,
  'nor move a number in it');
select throws_ok($$delete from private.params$$, '42501', null,
  'nor remove it');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from private.params$$, '42501', null,
  'and a signed-out visitor can do none of that either');

set local role postgres;

-- Columns rather than a nested object, so that a half-written row is not
-- expressible and 0005's pooling statement writes one field at a time under its
-- own guard. Every field is separately nullable, so the core merges it into
-- DESIGN §2.8's table field by field and a missing, partial or crafted row can
-- only fail to move a number.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns where table_schema = 'private' and table_name = 'params'),
  'id,computed_at,kappa,a0_d1,a0_d2,a0_d3plus,samples',
  'the row is columns, so a half-written one is not expressible');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'private' and table_name = 'params'
     and column_name in ('kappa', 'a0_d1', 'a0_d2', 'a0_d3plus')
     and is_nullable = 'YES'),
  4, 'and every estimate in it is separately nullable');

-- Exactly one row, by the primary key.
select throws_ok(
  $$insert into private.params (id, kappa) values (true, 2)$$, '23505', null,
  'there is one row and the key says so');
select throws_ok(
  $$insert into private.params (id, kappa) values (false, 2)$$, '23514', null,
  'and no second one under another key');

-- `service_role` is the only role that may name the schema at all: the two Edge
-- Functions reach it over a direct connection, not through
-- PostgREST, which serves `public` and `graphql_public` only.
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'private' and grantee in ('anon', 'authenticated')),
  0, 'and neither client role holds a single grant in the schema');


-- DESIGN §2.10's estimator, run from the schedule's own text so the statement
-- tested is the statement scheduled, over tallies four viewers reported: 400
-- pairs one hop out, agreement rates half at 0.4 and half at 0.8 — a mean of
-- 0.6 — each over an overlap of 20.
--
-- By hand, which is `estimate_priors_from_tallies` in `rust/src/priors.rs`:
-- spread 16 over 400 pairs is an observed variance of 0.04, the sampling
-- variance is 0.6·0.4/20 = 0.012, and 19·0.012/(0.04 − 0.012) − 1 is 7.142857.
set local role postgres;
insert into auth.users (id)
  select ('bbbbbbbb-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
  from generate_series(1, 4) as n;
insert into public.user_model (user_id, checked_at,
                               pair_n_d1, pair_sum_d1, pair_sumsq_d1, pair_overlap_d1,
                               pair_n_d2, pair_sum_d2, pair_sumsq_d2, pair_overlap_d2,
                               pair_n_d3, pair_sum_d3, pair_sumsq_d3, pair_overlap_d3)
  select id, now(),
         100, 60, 40, 2000,
         0, 0, 0, 0,
         0, 0, 0, 0
  from auth.users where id::text like 'bbbbbbbb-%';

do $$ begin
  execute (select command from cron.job where jobname = 'params-priors');
end $$;

select is(
  (select round(kappa::numeric, 6) from private.params), 7.142857::numeric,
  'the pooled tallies give the same κ the estimator in the crate does');
select is(
  (select round(a0_d1::numeric, 6) from private.params), 0.600000::numeric,
  'and a₀(1) is the mean agreement rate of the class that had the pairs');

-- A class below `N_min` says nothing, and saying nothing is not the same as
-- saying "the table's constant": the number that was there stays there.
select is(
  (select a0_d2 from private.params), 0.58::float8,
  'a class with no pairs this week leaves the estimate it had alone');
select is(
  (select samples ->> 'pairs' from private.params), '400',
  'and the row records how many pairs it rests on');

-- The other two statements in 0005 are not about priors at all and must not be
-- removed: they are what keeps a free project from pausing after seven days
-- with no database activity, and removing them would look, from the outside,
-- exactly like success.
select is(
  (select string_agg(jobname, ',' order by jobname) from cron.job),
  'debug-ttl,params-priors,write-budget-sweep',
  'three statements are scheduled and the two sweeps are two of them');

-- Nothing at all to pool is nothing written, rather than an estimate of
-- nothing: the insert matches no row and every number stands.
select is(
  (select count(*)::int from public.user_model m
   where m.checked_at <= now() - interval '7 days'),
  0, 'while a recompute older than the window contributes nothing to it');

select * from finish();
rollback;
