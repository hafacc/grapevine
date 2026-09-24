-- What Realtime may broadcast, and to whom.
--
-- A Postgres row change reaches a subscribed browser only if the table is in
-- the `supabase_realtime` publication. A channel on a table missing from it
-- subscribes successfully and delivers nothing: the app works, it just stops
-- being live, which presents as "the feed is a little stale" and survives a
-- release. `web/tests/realtime.test.ts` fails if a table the client subscribes
-- to is missing from this file.
--
-- Realtime applies the SELECT policy of 0003 to each changed row, evaluated as
-- the subscriber with their own JWT, and drops columns they hold no SELECT
-- grant on. So membership here is not itself a decision to publish anything:
-- `user_recs` reaches its owner only, `connect_requests` only its two parties,
-- `friendships` only the two ends of the edge. A filter in the client's
-- `.on("postgres_changes", …)` narrows further, but it is the client's own
-- string and a crafted one may say anything — the policy is what bounds this,
-- and the client's filters are an optimization on top of it.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- No DELETE events, because the argument above fails for them. A policy is
-- evaluated against a row, and a deleted row is gone, so RLS cannot be applied
-- to a DELETE at all: every subscriber whose filter matches receives it. The
-- payload is the replica identity — here the primary key — which for
-- `connect_requests` is exactly `(from_id, to_id)`, so a client subscribing
-- with no filter would receive a uuid pair for every accept, decline and
-- withdrawal in the whole instance. That is who-knows-whom, globally, and
-- DESIGN §4 says friend lists are private. There is no per-table publish
-- setting and no filter that can reference the subscriber, so the switch is the
-- publication's.
--
-- What it costs: the counterparty to a decline or a withdrawal learns on their
-- next load rather than at once. The actor refreshes for itself either way
-- (`store.tsx`'s accept and decline both re-read), and being *accepted*
-- — the one event that matters to somebody who is not the actor — arrives as
-- the INSERT of that person's own `friendships` row instead, which is a row a
-- policy can and does bound.
--
-- This is a property of the publication, not of a table in it: anything added
-- below inherits it, and a table that needs delete events needs a second
-- publication rather than a change here.
alter publication supabase_realtime set (publish = 'insert, update');

-- `add table` raises if the table is already a member, which a re-applied
-- migration or a hosted project that pre-populated the publication can both
-- produce.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['user_recs', 'connect_requests', 'friendships']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
