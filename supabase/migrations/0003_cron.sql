-- The scheduled statements, in the repo and applied by `supabase db push`, so
-- that none of them is a console setting somebody has to remember. Everything
-- that runs on a schedule runs here, inside the database.
--
-- They do a second job nobody would guess from their contents: a free Supabase
-- project pauses after seven days with no database activity, and these run
-- whether or not a single person opens the app. Removing the last of them
-- would let the project pause, which looks from the outside like an outage.
--
-- One statement per job rather than one job, so that any one failing shows as
-- its own failed run in `cron.job_run_details`.

create extension if not exists pg_cron;

-- Nothing reads a debug event back, so this sweep is the only thing bounding
-- the pile. `expires` defaults to seven days out and no client can supply it.
select cron.schedule(
  'debug-ttl',
  '7 3 * * *',
  $$delete from private.debug_events where expires < now()$$
);

-- A counter row only ever answers for its own UTC day.
select cron.schedule(
  'write-budget-sweep',
  '8 3 * * *',
  $$delete from private.write_budget where day < (now() at time zone 'utc')::date$$
);

-- A few minutes after midnight UTC: the budget a fingerprint carries resets
-- then, so one older than its day has nothing left to stop.
select cron.schedule(
  'deleted-identities-sweep',
  '9 0 * * *',
  $$delete from private.deleted_identities where day < (now() at time zone 'utc')::date$$
);

select cron.schedule(
  'imports-sweep',
  '19 0 * * *',
  $$select private.sweep_imports()$$
);

-- A tombstone tells a follower that a thumb was cleared, and is kept 30 days.
-- A reader who has not been back in that long is answered in full instead.
select cron.schedule(
  'cleared-thumbs-sweep',
  '29 0 * * *',
  $$select private.sweep_cleared()$$
);

-- Every minute: with nothing to purge, a run reads a table of a few rows, and
-- a removed name's thumbs should not outlive the removal by an hour.
select cron.schedule(
  'removed-names-purge',
  '* * * * *',
  $$select private.purge_removed_names()$$
);
