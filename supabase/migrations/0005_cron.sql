-- The scheduled statements, in the repo and applied by `supabase db push`, so
-- that none of them is a console setting somebody has to remember.
--
-- They do a second job nobody would guess from their contents: **a free
-- Supabase project pauses after seven days with no database activity**, and
-- these run nightly whether or not a single person opens the app. They are
-- what keeps the project awake. Removing the last entry here would let it
-- pause, which looks from the outside exactly like an outage.

create extension if not exists pg_cron;

-- Nothing reads a debug event back, so this sweep is the only thing bounding
-- the pile. `expires` defaults to seven days out and no client can supply it.
select cron.schedule(
  'debug-ttl',
  '7 3 * * *',
  $$delete from private.debug_events where expires < now()$$
);

-- A counter row only ever answers for its own UTC day, so anything older is
-- dead weight. Not merged into the TTL statement above, so that either one
-- failing shows as its own failed run in `cron.job_run_details`.
select cron.schedule(
  'write-budget-sweep',
  '8 3 * * *',
  $$delete from private.write_budget where day < (now() at time zone 'utc')::date$$
);

-- DESIGN §2.10's `κ` and `a₀(d)`, pooled from tallies every recompute already
-- reported. It is `estimate_priors_from_tallies` in `rust/src/priors.rs` said
-- in SQL: the same method of moments over the same four sums per distance
-- class, so the simulator's estimate and this one are one estimator with two
-- callers and neither is the other's approximation.
--
--   a₀(d)  the mean of `A/(A+D)` over that class's pairs
--   κ      `(n̄ − 1)·sampling / (observed − sampling) − 1`, pooled over
--          the three classes, where `observed` is the spread of the rates
--          around each class's OWN mean and `sampling` is the spread a
--          Beta-binomial over `n̄` trials would show on its own
--
-- Each class is centred on its own mean before pooling: the difference BETWEEN
-- the classes is `a₀(d)`, and counting it here would read the prior's whole
-- point as noise.
--
-- What it does not write is most of what it does:
--
--  * A class with fewer than `N_min = 200` pairs is left EXACTLY as it was,
--    per field — the `coalesce` in the conflict clause. No excess spread at all
--    is the same answer for `κ`: a population as uniform as chance would make
--    it look is evidence for an arbitrarily strong prior rather than for any
--    particular one, so nothing is claimed and §2.8's table stands underneath.
--  * A row whose tallies are not finite is excluded, matching the
--    `finiteOrNull` every consumer reads the stored value back through.
--  * The window is seven days on `checked_at`, the stamp every recompute writes
--    beside its tallies, so the estimate follows the people using the app
--    rather than accumulating over a population that has moved on.
--
-- Pooling rather than a pass over the whole graph, because a recompute already
-- holds an alignment for every pair in reach, at a distance it already knows,
-- and counts, sums and sums of squares add.
select cron.schedule(
  'params-priors',
  '45 3 * * *',
  $$
  with reported as (
    select m.pair_n_d1, m.pair_sum_d1, m.pair_sumsq_d1, m.pair_overlap_d1,
           m.pair_n_d2, m.pair_sum_d2, m.pair_sumsq_d2, m.pair_overlap_d2,
           m.pair_n_d3, m.pair_sum_d3, m.pair_sumsq_d3, m.pair_overlap_d3
    from public.user_model m
    where m.checked_at > now() - interval '7 days'
      and num_nonnulls(m.pair_n_d1, m.pair_n_d2, m.pair_n_d3) = 3
      -- One question for nine columns: a NaN or an infinity anywhere makes the
      -- sum non-finite, and the bounds are strict because Postgres sorts NaN
      -- above every other value, so the upper one drops it as well as +Infinity.
      -- A null anywhere makes the sum null and the row is dropped with it.
      and (m.pair_sum_d1 + m.pair_sumsq_d1 + m.pair_overlap_d1
         + m.pair_sum_d2 + m.pair_sumsq_d2 + m.pair_overlap_d2
         + m.pair_sum_d3 + m.pair_sumsq_d3 + m.pair_overlap_d3)
          > '-Infinity'::double precision
      and (m.pair_sum_d1 + m.pair_sumsq_d1 + m.pair_overlap_d1
         + m.pair_sum_d2 + m.pair_sumsq_d2 + m.pair_overlap_d2
         + m.pair_sum_d3 + m.pair_sumsq_d3 + m.pair_overlap_d3)
          < 'Infinity'::double precision
  ),
  pooled as (
    select coalesce(sum(pair_n_d1), 0)       as n1,
           coalesce(sum(pair_sum_d1), 0)     as s1,
           coalesce(sum(pair_sumsq_d1), 0)   as q1,
           coalesce(sum(pair_overlap_d1), 0) as o1,
           coalesce(sum(pair_n_d2), 0)       as n2,
           coalesce(sum(pair_sum_d2), 0)     as s2,
           coalesce(sum(pair_sumsq_d2), 0)   as q2,
           coalesce(sum(pair_overlap_d2), 0) as o2,
           coalesce(sum(pair_n_d3), 0)       as n3,
           coalesce(sum(pair_sum_d3), 0)     as s3,
           coalesce(sum(pair_sumsq_d3), 0)   as q3,
           coalesce(sum(pair_overlap_d3), 0) as o3
    from reported
  ),
  means as (
    select p.*,
           case when p.n1 > 0 then p.s1 / p.n1 end as m1,
           case when p.n2 > 0 then p.s2 / p.n2 end as m2,
           case when p.n3 > 0 then p.s3 / p.n3 end as m3,
           p.n1 + p.n2 + p.n3 as pairs,
           p.o1 + p.o2 + p.o3 as overlap
    from pooled p
  ),
  moments as (
    select d.*,
           case when d.pairs > 0 then d.overlap / d.pairs end as mean_overlap,
           coalesce(greatest(d.q1 - d.n1 * d.m1 * d.m1, 0), 0)
             + coalesce(greatest(d.q2 - d.n2 * d.m2 * d.m2, 0), 0)
             + coalesce(greatest(d.q3 - d.n3 * d.m3 * d.m3, 0), 0) as spread,
           coalesce(d.n1 * d.m1 * (1 - d.m1), 0)
             + coalesce(d.n2 * d.m2 * (1 - d.m2), 0)
             + coalesce(d.n3 * d.m3 * (1 - d.m3), 0) as binomial
    from means d
  ),
  rates as (
    select t.*,
           t.spread / nullif(t.pairs, 0)                        as observed,
           t.binomial / nullif(t.pairs, 0) / t.mean_overlap     as sampling
    from moments t
  ),
  estimate as (
    select r.*,
           case when r.n1 >= 200 then r.m1 end as a0_d1,
           case when r.n2 >= 200 then r.m2 end as a0_d2,
           case when r.n3 >= 200 then r.m3 end as a0_d3plus,
           case when r.pairs >= 200
                 and r.mean_overlap > 1
                 and r.sampling > 0
                 and r.observed > r.sampling
                 and (r.mean_overlap - 1) * r.sampling / (r.observed - r.sampling) - 1 > 0
                 and (r.mean_overlap - 1) * r.sampling / (r.observed - r.sampling) - 1
                       < 'Infinity'::double precision
                then (r.mean_overlap - 1) * r.sampling / (r.observed - r.sampling) - 1
           end as kappa
    from rates r
  )
  insert into private.params (id, computed_at, kappa, a0_d1, a0_d2, a0_d3plus, samples)
  select true, now(), e.kappa, e.a0_d1, e.a0_d2, e.a0_d3plus,
         jsonb_build_object('d1', e.n1, 'd2', e.n2, 'd3plus', e.n3,
                            'pairs', e.pairs,
                            'meanOverlap', coalesce(e.mean_overlap, 0))
  from estimate e
  where e.pairs > 0
  on conflict (id) do update
    set computed_at = excluded.computed_at,
        kappa       = coalesce(excluded.kappa, params.kappa),
        a0_d1       = coalesce(excluded.a0_d1, params.a0_d1),
        a0_d2       = coalesce(excluded.a0_d2, params.a0_d2),
        a0_d3plus   = coalesce(excluded.a0_d3plus, params.a0_d3plus),
        samples     = excluded.samples
  $$
);
