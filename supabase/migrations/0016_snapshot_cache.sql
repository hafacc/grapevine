-- DESIGN §3.4a: each viewer's loaded neighbourhood is kept between refreshes,
-- and a refresh reads what changed since instead of the whole of it.
--
-- What this adds, all of it in `private` and none of it reachable by a client:
--
-- 1. `private.snapshot_cache`, one row per viewer: the neighbourhood
--    `private.neighbourhood` last returned, as one compressed blob the function
--    writes and reads back (the codec is `shared/src/snapshot-cache.ts`), and
--    the ids it loaded, so the delta below and the purges can find it without
--    decoding it.
-- 2. `private.ratings_cleared`, a tombstone per cleared thumb. A deleted row
--    cannot say when it went, and "thumbs written since" misses exactly those.
-- 3. `private.ratings_changed.friends_changed_at`, stamped only when a
--    friendship is made or removed, so a delta re-reads a friend list only when
--    it moved.
-- 4. `private.snapshot_delta`, the one read a patched refresh makes. It runs
--    0015's `private.neighbourhood_cut`, so the full load and the delta share
--    one implementation of who is loaded.
-- 5. `private.save_snapshot_cache` and `private.drop_snapshot_caches`, and the
--    epoch they agree through, so a cache read before an account deletion or a
--    removed name can never be written back after it.
-- 6. Purges: an account deletion drops every cache that loaded the account or
--    any of its friends (so neither its thumbs nor its id survive in one);
--    `remove_name` drops them all; a cache unused for seven days is swept, and
--    tombstones a day later.
--
-- The cache holds nothing `ratings` and `friendships` do not already hold, but
-- it is a second copy that outlives the call (DESIGN §4). A migration that
-- writes either table with the triggers off (a restore, a bulk rewrite) must
-- end with `delete from private.snapshot_cache`: the delta sees only what the
-- triggers stamp, and a cache that missed a change stays wrong until the next
-- full check.

create table private.snapshot_cache (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  -- `CACHE_VERSION` in shared/src/snapshot-cache.ts: the codec and the patch
  -- rules. A row of another version is never patched, only replaced.
  version     int not null,
  -- The database's clock read before the data this blob holds, and when it was
  -- last used: every refresh rewrites it, so the seven-day sweep keys on it.
  since       timestamptz not null,
  -- Who the blob loaded, for the delta and the purges. Read by no client and
  -- not returned by the delta.
  members     uuid[] not null,
  -- Refreshes left before the next full load and comparison.
  reloads_in  int not null,
  -- The gzipped encoding as text, seven bits a character (`bytesToText` in
  -- shared/): postgres.js reads every result as text, and a bytea would come
  -- back as hex, twice its size, where this is an eighth over.
  blob        text not null
);

-- A tombstone per cleared thumb, the key only. Its foreign key and the guard in
-- the trigger below are what keep a deleted account's keys out of it.
create table private.ratings_cleared (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_id     text not null,
  tag         text not null,
  cleared_at  timestamptz not null,
  primary key (user_id, item_id, tag)
);

-- For the sweep.
create index ratings_cleared_at_idx on private.ratings_cleared (cleared_at);

-- One row. Bumped by every purge, and compared by every save, so a refresh that
-- read before a purge cannot write what it read after it.
create table private.snapshot_epoch (
  id     boolean primary key default true check (id),
  epoch  bigint not null default 0
);
insert into private.snapshot_epoch default values;

alter table private.ratings_changed add column friends_changed_at timestamptz;

-- Every write goes through the functions below, which run as their owner, so
-- the service role is given reads and nothing else; `anon` and `authenticated`
-- get nothing, as nowhere in `private`.
revoke all on private.snapshot_cache, private.ratings_cleared, private.snapshot_epoch
  from public, anon, authenticated, service_role;
grant select on private.snapshot_cache, private.ratings_cleared, private.snapshot_epoch
  to service_role;


-- The tombstone, beside the stamp 0001 already writes on a clear. Guarded on
-- the profile still existing, as that stamp is: an account's thumbs go by
-- cascade after its profile, and nobody's cache wants its keys.
create function private.record_rating_cleared() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.ratings_cleared (user_id, item_id, tag, cleared_at)
  select p.id, old.item_id, old.tag, now() from public.profiles p
  where p.id = old.user_id
  on conflict (user_id, item_id, tag) do update set cleared_at = excluded.cleared_at;
  return null;
end $$;

create trigger ratings_cleared_on_delete
  after delete on public.ratings
  for each row execute function private.record_rating_cleared();

-- Both clocks: `changed_at` because a friend gained or lost changes the feed
-- (0001), `friends_changed_at` so the delta knows the list itself moved.
create function private.stamp_friends_changed() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.ratings_changed (user_id, changed_at, friends_changed_at)
  select p.id, now(), now() from public.profiles p
  where p.id = coalesce(new.user_id, old.user_id)
  on conflict (user_id) do update
    set changed_at = excluded.changed_at,
        friends_changed_at = excluded.friends_changed_at;
  return null;
end $$;

drop trigger ratings_changed_on_friendship on public.friendships;
create trigger ratings_changed_on_friendship
  after insert or delete on public.friendships
  for each row execute function private.stamp_friends_changed();


-- What changed in the viewer's neighbourhood since their cache was written,
-- against the cache of version `p_version`. No rows at all when there is no
-- such cache, or it is older than the tombstones reach back: the caller then
-- loads in full. Otherwise, one row per state:
--
--   'cache'    first, once: the blob and `reloads_in`
--   'added'    someone the cut now loads and the cache did not: the whole row,
--              as `load_nodes` returns it
--   'removed'  someone the cache loaded and the cut no longer does
--   'changed'  a kept person whose clock moved: `ratings` holds only the thumbs
--              written since (with the order bit), `cleared` the keys taken
--              back since (item to a list of tags), and `friend_ids` the whole
--              list when it moved, else null
--
-- "Since" is the cache's `since` less a minute: `now()` is a transaction's
-- start, so a thumb committed after the cache was read can carry an earlier
-- stamp. A change read twice is applied as its current value, so the overlap
-- costs a few rows and nothing else.
--
-- STABLE, so every statement below reads the one snapshot the call was made
-- in, and the blob and the delta against it can never come from two moments.
create function private.snapshot_delta(
  p_viewer    uuid,
  p_version   int,
  p_max_nodes int,
  p_max_depth int
) returns table (
  state       text,
  id          uuid,
  friend_ids  uuid[],
  ratings     jsonb,
  cleared     jsonb,
  blob        text,
  reloads_in  int
)
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cache  private.snapshot_cache;
  v_since  timestamptz;
  v_cut    uuid[];
begin
  select * into v_cache from private.snapshot_cache c
   where c.user_id = p_viewer
     and c.version = p_version
     and c.since > now() - interval '7 days';
  if not found then
    return;
  end if;
  v_since := v_cache.since - interval '1 minute';

  return query select 'cache'::text, p_viewer, null::uuid[], null::jsonb, null::jsonb,
                      v_cache.blob, v_cache.reloads_in;

  v_cut := private.neighbourhood_cut(p_viewer, p_max_nodes, p_max_depth);

  return query
    select 'added'::text, n.id, n.friend_ids, n.ratings, null::jsonb, null::text, null::int
    from private.load_nodes(
      p_viewer,
      array(select unnest(v_cut) except select unnest(v_cache.members))) n;

  return query
    select 'removed'::text, gone.id, null::uuid[], null::jsonb, null::jsonb, null::text, null::int
    from (select unnest(v_cache.members) except select unnest(v_cut)) as gone (id);

  return query
    select 'changed'::text, k.id,
           case when rc.friends_changed_at > v_since then coalesce(
             (select array_agg(f.friend_id order by f.friend_id)
                from public.friendships f where f.user_id = k.id),
             '{}'::uuid[]) end,
           coalesce((
             select jsonb_object_agg(per_item.item_id, per_item.tags)
             from (
               select rt.item_id,
                      jsonb_object_agg(
                        rt.tag,
                        rt.value * case when rt.rated_at > mine.rated_at then 2 else 1 end
                      ) as tags
               from public.ratings rt
               left join public.ratings mine
                 on mine.user_id = p_viewer
                and mine.item_id = rt.item_id
                and mine.tag = rt.tag
               where rt.user_id = k.id
                 and (rt.rated_at > v_since
                      -- Cleared and given again: the row is the answer, however
                      -- old its stamp.
                      or exists (select 1 from private.ratings_cleared t
                                 where t.user_id = rt.user_id and t.item_id = rt.item_id
                                   and t.tag = rt.tag and t.cleared_at > v_since))
               group by rt.item_id
             ) per_item), '{}'::jsonb),
           coalesce((
             select jsonb_object_agg(per_item.item_id, per_item.tags)
             from (
               select t.item_id, jsonb_agg(t.tag order by t.tag) as tags
               from private.ratings_cleared t
               where t.user_id = k.id
                 and t.cleared_at > v_since
                 and not exists (select 1 from public.ratings r
                                 where r.user_id = t.user_id and r.item_id = t.item_id
                                   and r.tag = t.tag)
               group by t.item_id
             ) per_item), '{}'::jsonb),
           null::text, null::int
    from (select unnest(v_cut) intersect select unnest(v_cache.members)) as k (id)
    join private.ratings_changed rc on rc.user_id = k.id
    where rc.changed_at > v_since;
end $$;


-- The lock the purge and the save agree through. Arbitrary, and named once.
create function private.snapshot_lock_key() returns bigint
  language sql immutable set search_path = ''
as $$ select 3414001::bigint $$;

-- Drops every cache that loaded `p_member` or any of their friends — the second
-- because a friend's list names them — or every cache when `p_member` is null.
-- It takes the lock exclusively and bumps the epoch first: a save in flight
-- holds the lock shared until it commits, so this waits for it and then sees
-- its row; a save that starts after sees the new epoch and refuses.
create function private.drop_snapshot_caches(p_member uuid) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(private.snapshot_lock_key());
  update private.snapshot_epoch set epoch = epoch + 1;
  if p_member is null then
    delete from private.snapshot_cache;
  else
    delete from private.snapshot_cache c
     where c.members && (array[p_member] || array(
       select f.friend_id from public.friendships f where f.user_id = p_member));
  end if;
end $$;

-- Writes the viewer's cache unless a purge ran since the refresh read its epoch
-- (`p_epoch`), in which case what it read may hold what the purge removed, and
-- nothing is written. Returns whether it wrote.
create function private.save_snapshot_cache(
  p_viewer     uuid,
  p_epoch      bigint,
  p_version    int,
  p_since      timestamptz,
  p_members    uuid[],
  p_reloads_in int,
  p_blob       text
) returns boolean
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock_shared(private.snapshot_lock_key());
  if (select e.epoch from private.snapshot_epoch e) is distinct from p_epoch then
    return false;
  end if;
  insert into private.snapshot_cache (user_id, version, since, members, reloads_in, blob)
  values (p_viewer, p_version, p_since, p_members, p_reloads_in, p_blob)
  on conflict (user_id) do update
    set version = excluded.version,
        since = excluded.since,
        members = excluded.members,
        reloads_in = excluded.reloads_in,
        blob = excluded.blob;
  return true;
end $$;

-- BEFORE, so the account's friendships are still there to be read: they go by
-- cascade after the profile row does.
create function private.drop_caches_of_deleted() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  perform private.drop_snapshot_caches(old.id);
  return old;
end $$;

create trigger profiles_drop_snapshot_caches
  before delete on public.profiles
  for each row execute function private.drop_caches_of_deleted();

-- 0013's, and then every cache: each may hold a thumb that names it.
create or replace function private.remove_name(p_id text) returns integer
  language plpgsql volatile set search_path = ''
as $$
declare
  v_thumbs integer;
begin
  if not private.is_normalized_id(p_id) then
    raise exception 'not an id: %', p_id using errcode = '22023';
  end if;

  insert into private.removed_names (id) values (p_id) on conflict (id) do nothing;

  delete from public.ratings r where r.item_id = p_id or r.tag = p_id;
  get diagnostics v_thumbs = row_count;

  delete from public.items i where i.id = p_id;
  delete from public.reports p where p.item_id = p_id;

  -- An entry the name was the only reason for (no belief about the thing
  -- itself, and no attribute left) goes with it.
  update public.user_recs u
     set entries = coalesce((
       select jsonb_agg(stripped.e order by stripped.n)
         from (
           select case when x.e ? 'tags' then jsonb_set(x.e, '{tags}', (x.e -> 'tags') - p_id)
                       else x.e end as e,
                  x.n
             from jsonb_array_elements(u.entries) with ordinality as x(e, n)
            where x.e ->> 'itemId' is distinct from p_id) stripped
        where not (coalesce(stripped.e -> 'tags', '{}'::jsonb) = '{}'::jsonb
                   and coalesce((stripped.e ->> 'conf')::double precision, 1) = 0)), '[]'::jsonb)
   where exists (select 1 from jsonb_array_elements(u.entries) e
                  where e ->> 'itemId' = p_id or (e -> 'tags') ? p_id);

  perform private.drop_snapshot_caches(null);
  delete from private.ratings_cleared t where t.item_id = p_id or t.tag = p_id;

  return v_thumbs;
end $$;

revoke all on function private.record_rating_cleared()  from public, anon, authenticated;
revoke all on function private.stamp_friends_changed()  from public, anon, authenticated;
revoke all on function private.drop_caches_of_deleted() from public, anon, authenticated;
revoke all on function private.remove_name(text)        from public, anon, authenticated;
revoke all on function private.snapshot_lock_key()      from public, anon, authenticated;
revoke all on function private.drop_snapshot_caches(uuid) from public, anon, authenticated;
revoke all on function private.snapshot_delta(uuid, int, int, int) from public, anon, authenticated;
revoke all on function private.save_snapshot_cache(uuid, bigint, int, timestamptz, uuid[], int, text)
  from public, anon, authenticated;
grant execute on function private.snapshot_delta(uuid, int, int, int) to service_role;
grant execute on function private.save_snapshot_cache(uuid, bigint, int, timestamptz, uuid[], int, text)
  to service_role;

-- 0005's style: each its own job, so either failing shows as its own run. The
-- tombstones outlive the caches by a day, so a cache the sweep has not reached
-- yet never asks for a tombstone that is gone (the delta also refuses a cache
-- older than seven days).
select cron.schedule(
  'snapshot-cache-sweep',
  '9 3 * * *',
  $$delete from private.snapshot_cache where since < now() - interval '7 days'$$
);
select cron.schedule(
  'ratings-cleared-sweep',
  '10 3 * * *',
  $$delete from private.ratings_cleared where cleared_at < now() - interval '8 days'$$
);
