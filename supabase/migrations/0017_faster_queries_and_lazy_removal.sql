-- Faster queries, and removing a reported name lazily. Measured on a local
-- cluster holding 5 000 people, 66 000 friendship rows and 614 000 thumbs.
--
-- Removing a name records the removal and nothing more (DESIGN §4 "Item
-- names"). 0013–0017 deleted every thumb naming it, rewrote every stored feed
-- that held it and dropped every neighbourhood cache in one statement: 3.8 s
-- for a thing in all 5 000 feeds of the local benchmark, 5.3 s for an
-- attribute, where a signed-in request is cut off at 8 s. Now every reader of
-- a name leaves the removed ones out, and the thumbs go later, in batches.
--
-- - `private.removed_names` gains `purged_at`: null while thumbs naming it may
--   still exist. `private.unpurged_names()` is that set, nearly always empty,
--   and is what the readers of `ratings` exclude.
-- - `load_nodes` and `snapshot_delta` exclude those thumbs, so a recompute
--   never sees the name; the delta also names every removal since the cache
--   was written, and `applyDelta` drops them from the cached blob.
-- - A signed-in read of `ratings` excludes them (a restrictive policy).
-- - A stored feed computed before a removal is read through `public.my_feed()`,
--   which strips names removed since it was computed.
-- - `private.purge_removed_names`, every minute, deletes up to 5 000 of the
--   thumbs, and marks a name purged once none are left. The rating delete
--   triggers skip those thumbs: nobody's clock moves and no tombstone is left.


-- 0010's, asking whether the profile still exists before whether the account
-- is locked. An account's deletion reaches here once per thumb, after its
-- profile and its friendships are gone, and the lock check then walks index
-- entries for friendships deleted in the same transaction. For an account
-- with 120 thumbs, the deletion less its cache purge goes from 16 ms to 10 ms.
-- The answer is the same in every case.
create or replace function private.refuse_if_locked() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
     and not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;


-- Deleting an account sets `created_by` null on every item it named, and
-- without an index that is a scan of the whole catalog. Partial, because a
-- null is never looked up.
create index items_created_by_idx on public.items (created_by)
  where created_by is not null;


alter table private.removed_names add column purged_at timestamptz;

-- 0013–0017 deleted the thumbs as they removed.
update private.removed_names set purged_at = removed_at;

-- `my_feed` and the delta ask for removals after a time.
create index removed_names_removed_at_idx on private.removed_names (removed_at);


-- The removed names whose thumbs may still exist. Granted to `authenticated`
-- only because the policy below calls it; the schema lock keeps a direct call
-- from resolving, as 0013's `is_removed`.
create function private.unpurged_names() returns text[]
  language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r.id order by r.id), '{}'::text[])
    from private.removed_names r
   where r.purged_at is null;
$$;

-- Each call in a scalar subquery, so it is an InitPlan evaluated once per
-- statement rather than once per row, and the whole test short-circuits on an
-- empty set: `<> all` with a runtime array unpacks it on every row.
create policy ratings_not_removed_read on public.ratings
  as restrictive for select to authenticated
  using ((select cardinality(private.unpurged_names()) = 0)
         or (item_id <> all ((select private.unpurged_names())::text[])
             and tag <> all ((select private.unpurged_names())::text[])));


-- 0015's, building each person's ratings as `json` and casting once. Two
-- nested `jsonb_object_agg`s cost two thirds of a full load (390 ms of a
-- 2 000-person neighbourhood), because each level re-encodes the level below;
-- `json_object_agg` only concatenates text, and the cast sorts the keys the
-- way the nested `jsonb` did, so the result is byte for byte the same.
--
-- The viewer's own thumbs are read once and hashed. Left to itself the
-- planner merge-joins them against each person's thumbs, which reads the
-- viewer's rows again for every person loaded; `enable_mergejoin` is off for
-- this function alone, and nothing else in it is a join. Together, 390 ms to
-- 225 ms for 2 000 people, and 41 ms to 24 ms for a 200-person boundary round.
--
-- It also leaves out every thumb on a name awaiting its purge.
--
-- In the aggregates' FILTER and HAVING rather than the WHERE, and skipped
-- outright while nothing is awaiting: a WHERE clause lowers the planner's row
-- estimate enough that it sorts each person's thumbs to group them instead of
-- hashing, 245 ms to 297 for a 2 000-person load. As written, 5 ms more, and
-- 50 ms more for the minutes a name is awaiting its purge.
create or replace function private.load_nodes(p_viewer uuid, p_ids uuid[])
  returns table (id uuid, friend_ids uuid[], ratings jsonb)
  language sql stable security definer
  set search_path = ''
  set enable_mergejoin = off
as $$
  with mine as materialized (
    select m.item_id, m.tag, m.rated_at
    from public.ratings m
    where m.user_id = p_viewer
  ),
  gone as materialized (
    select private.unpurged_names() as ids
  )
  select l.id,
         coalesce(e.friend_ids, '{}'::uuid[]),
         coalesce(r.ratings::jsonb, '{}'::jsonb)
  from unnest(p_ids) as l(id)
  left join lateral (
    select array_agg(f.friend_id order by f.friend_id) as friend_ids
    from public.friendships f where f.user_id = l.id
  ) e on true
  left join lateral (
    select json_object_agg(per_item.item_id, per_item.tags) as ratings
    from (
      select rt.item_id,
             json_object_agg(
               rt.tag,
               rt.value * case when rt.rated_at > mine.rated_at then 2 else 1 end
             ) filter (where k.keep) as tags
      from public.ratings rt
      left join mine
        on mine.item_id = rt.item_id
       and mine.tag = rt.tag
      cross join lateral (
        select (select cardinality(g.ids) = 0 from gone g)
               or (rt.item_id <> all ((select g.ids from gone g)::text[])
                   and rt.tag <> all ((select g.ids from gone g)::text[])) as keep
      ) k
      where rt.user_id = l.id
      group by rt.item_id
      having bool_or(k.keep)
    ) per_item
  ) r on true;
$$;


-- 0016's, with the same exclusion on a changed person's thumbs, and one more
-- row, last:
--
--   'names'  every name removed since the cache was written, as a jsonb array
--            in `cleared`, under the viewer's id. The cache may hold thumbs on them, which a full load
--            would not return; `applyDelta` drops every key naming one, as a
--            thing or an attribute.
--
-- By `removed_at`, not by `purged_at`: a week-old cache can hold a thumb whose
-- row the purge has since deleted. The same minute of overlap as the thumbs, so
-- a removal committed while the cache was being read is still named.
create or replace function private.snapshot_delta(
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
  v_gone   text[];
begin
  select * into v_cache from private.snapshot_cache c
   where c.user_id = p_viewer
     and c.version = p_version
     and c.since > now() - interval '7 days';
  if not found then
    return;
  end if;
  v_since := v_cache.since - interval '1 minute';
  v_gone := private.unpurged_names();

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
                 and (cardinality(v_gone) = 0
                      or (rt.item_id <> all (v_gone) and rt.tag <> all (v_gone)))
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

  return query
    select 'names'::text, p_viewer, null::uuid[], null::jsonb,
           jsonb_agg(r.id order by r.id), null::text, null::int
    from private.removed_names r
    where r.removed_at > v_since
    having count(*) > 0;
end $$;


-- A feed without the names in `p_names`: an entry for one goes, an attribute
-- named by one goes, and an entry that had only such attributes and no belief
-- about the thing itself (`conf` 0) goes with them. 0013's rewrite, for a set.
create function private.strip_names(p_entries jsonb, p_names text[]) returns jsonb
  language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(coalesce(t.stripped, x.e) order by x.n), '[]'::jsonb)
    from jsonb_array_elements(p_entries) with ordinality as x(e, n)
    cross join lateral (
      select case when (x.e -> 'tags') ?| p_names
                  then jsonb_set(x.e, '{tags}', (x.e -> 'tags') - p_names) end as stripped
    ) t
   where not coalesce((x.e ->> 'itemId') = any (p_names), false)
     and not coalesce(t.stripped -> 'tags' = '{}'::jsonb
                      and coalesce((t.stripped ->> 'conf')::double precision, 1) = 0, false);
$$;

-- The caller's stored feed, less every name removed since it was computed. The
-- row as `user_recs` holds it when nothing was (one index probe); stripped
-- otherwise, which the viewer's next recompute makes permanent. The minute is
-- the delta's: `computed_at` is read before the neighbourhood, so a removal
-- committed during the read can carry an earlier stamp.
--
-- The caller's own row and nothing else, so it can say no more about a removal
-- than that a name the caller's feed held is gone.
create function public.my_feed()
  returns table (computed_at timestamptz, entries jsonb)
  language sql stable security definer set search_path = ''
as $$
  select u.computed_at,
         case when gone.names is null then u.entries
              else private.strip_names(u.entries, gone.names) end
    from public.user_recs u
    cross join lateral (
      select array_agg(r.id) as names
        from private.removed_names r
       where r.removed_at > u.computed_at - interval '1 minute'
    ) gone
   where u.user_id = (select auth.uid());
$$;


-- 0017's, lazily. It records the removal, which every reader above honours at
-- once, and deletes the catalog row (so the name cannot be found) and the
-- name's reports (so it leaves the queue). The thumbs are the purge's.
--
-- `void` now: it deletes no thumbs, so it has none to count.
drop function public.remove_reported_name(text);
drop function private.remove_name(text);

create function private.remove_name(p_id text) returns void
  language plpgsql volatile set search_path = ''
as $$
begin
  if not private.is_normalized_id(p_id) then
    raise exception 'not an id: %', p_id using errcode = '22023';
  end if;
  insert into private.removed_names (id) values (p_id) on conflict (id) do nothing;
  delete from public.items i where i.id = p_id;
  delete from public.reports p where p.item_id = p_id;
end $$;

-- 0014's, for an admin.
create function public.remove_reported_name(p_id text) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform private.remove_name(p_id);
end $$;


-- A thumb on a removed name is invisible to every reader from the moment of
-- removal, so deleting it changes nothing anybody's feed or cache was built
-- from: it neither stamps the rater's clock nor leaves a tombstone. With both,
-- a purge of a name 17 000 people rated stamped nearly everyone in reach, and
-- the next patched refresh cost 480 ms, twice a full load. `WHEN` on OLD
-- cannot share a trigger with INSERT, so 0001's trigger is split in two.
drop trigger ratings_changed_on_write on public.ratings;
create trigger ratings_changed_on_insert
  after insert on public.ratings
  for each row execute function private.stamp_ratings_changed();
create trigger ratings_changed_on_delete
  after delete on public.ratings
  for each row
  when (not (private.is_removed(old.item_id) or private.is_removed(old.tag)))
  execute function private.stamp_ratings_changed();

drop trigger ratings_cleared_on_delete on public.ratings;
create trigger ratings_cleared_on_delete
  after delete on public.ratings
  for each row
  when (not (private.is_removed(old.item_id) or private.is_removed(old.tag)))
  execute function private.record_rating_cleared();


-- Deletes up to `p_batch` thumbs naming any unpurged name, as a thing or an
-- attribute, and returns how many.
--
-- A name is marked purged only once a run finds fewer than a batch left AND it
-- was removed over ten minutes ago: a thumb whose insert passed the policy
-- before the removal committed can land after the first empty run, and the
-- readers above stop excluding a name the moment it is marked.
--
-- Each run is one scan of `ratings` (there is no index on `item_id` or `tag`,
-- and one would cost every thumb written, for a job that runs only after a
-- removal) and at most `p_batch` deletes.
create function private.purge_removed_names(p_batch int default 5000) returns integer
  language plpgsql volatile set search_path = ''
as $$
declare
  v_gone     text[];
  v_deleted  integer;
begin
  v_gone := private.unpurged_names();
  if cardinality(v_gone) = 0 then
    return 0;
  end if;

  delete from public.ratings r
   where r.ctid = any (array(
     select t.ctid from public.ratings t
      where t.item_id = any (v_gone) or t.tag = any (v_gone)
      limit p_batch));
  get diagnostics v_deleted = row_count;

  if v_deleted < p_batch then
    update private.removed_names r
       set purged_at = now()
     where r.purged_at is null
       and r.id = any (v_gone)
       and r.removed_at < now() - interval '10 minutes';
  end if;
  return v_deleted;
end $$;

revoke all on function private.unpurged_names()          from public, anon, authenticated;
revoke all on function private.strip_names(jsonb, text[]) from public, anon, authenticated;
revoke all on function private.remove_name(text)          from public, anon, authenticated;
revoke all on function private.purge_removed_names(int)   from public, anon, authenticated;
revoke all on function public.my_feed()                   from public, anon, authenticated;
revoke all on function public.remove_reported_name(text)  from public, anon, authenticated;
-- The policy's call is checked against the querying role (0013 says why).
grant execute on function private.unpurged_names() to authenticated;
grant execute on function public.my_feed() to authenticated;
grant execute on function public.remove_reported_name(text) to authenticated;
-- `create or replace` keeps these; said again, as 0017 does.
revoke all on function private.load_nodes(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.load_nodes(uuid, uuid[]) to service_role;
revoke all on function private.snapshot_delta(uuid, int, int, int) from public, anon, authenticated;
grant execute on function private.snapshot_delta(uuid, int, int, int) to service_role;

-- Every minute: with nothing to purge, a run reads a table of a few rows.
select cron.schedule(
  'removed-names-purge',
  '* * * * *',
  $$select private.purge_removed_names()$$
);
