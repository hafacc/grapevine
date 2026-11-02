-- What Realtime may broadcast, and to whom.
--
-- A row change reaches a subscribed browser only if the table is in the
-- `supabase_realtime` publication. A channel on a table missing from it
-- subscribes successfully and delivers nothing: the app works, it just stops
-- being live, and that survives a release.
--
-- `follows` is the one table in it: a new follower, and being followed back,
-- are the two things that happen to a person while they are looking at the
-- screen and that somebody else did. Thumbs are not here. A followed
-- account's thumbs are fetched when `followed_stamps` says they moved, and a
-- row event for each one would be thousands of them for one import.
--
-- Realtime applies the table's SELECT policy to each changed row, as the
-- subscriber with their own JWT, so membership is not itself a decision to
-- publish anything: a follow reaches its two ends and nobody else. A filter in
-- the client's `.on("postgres_changes", …)` narrows further, but it is the
-- client's own string and a crafted one may say anything; the policy is what
-- bounds this.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- No DELETE events, because the argument above fails for them. A policy is
-- evaluated against a row, and a deleted row is gone, so row-level security
-- cannot be applied to a DELETE at all: every subscriber whose filter matches
-- receives it. The payload is the replica identity, which for `follows` is
-- exactly `(follower_id, followed_id)`, so a client subscribing with no filter
-- would receive a uuid pair for every unfollow in the whole instance. That is
-- who follows whom, globally. There is no per-table publish setting and no
-- filter that can reference the subscriber, so the switch is the
-- publication's.
--
-- What it costs: somebody unfollowed, or removed as a follower, learns on
-- their next load rather than at once. The one who did it refreshes for
-- itself.
--
-- This is a property of the publication, not of a table in it: anything added
-- below inherits it, and a table that needs delete events needs a second
-- publication rather than a change here.
alter publication supabase_realtime set (publish = 'insert, update');

-- `add table` raises if the table is already a member, which a hosted project
-- that pre-populated the publication can produce.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'follows'
  ) then
    alter publication supabase_realtime add table public.follows;
  end if;
end $$;
