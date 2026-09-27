-- DESIGN §2's witness model replaces the walk, and four things change in the
-- database.
--
-- 1. The neighbourhood says, per rating, whether it was given AFTER the
--    viewer's own thumb on the same thing — one bit, carried in the value
--    (`±1` before or unordered, `±2` after), and never a clock. That is the
--    whole of what the model reads about time (DESIGN §2.3), and all a
--    recompute can learn about anybody's timing from its own feed.
-- 2. `load_nodes` needs the viewer for the same bit, so it takes one, and
--    `neighbourhood` becomes `load_nodes` over the breadth-first cut, so the
--    bit is computed in one place.
-- 3. The columns the settling loop and the quantized bar needed go:
--    `user_recs.error` and `user_model.settle_movement`, `passes`, `settled`.
-- 4. So do the walk's: `truncation` and `boundary_residual` (there is no
--    residual to report) and the reach cache `reach`, `reach_hash`,
--    `reach_reuses` (every reliability is recomputed from the snapshot,
--    DESIGN §3.4).
--
-- Dropped rather than left null, because a column nothing writes is a column
-- somebody later reads. `private.params` keeps `a0_d2` and `a0_d3plus`, which
-- the witness core no longer reads: dropping them means rewriting 0005's
-- pooling job, which is a later migration's.

drop function private.load_nodes(uuid[]);

create function private.load_nodes(p_viewer uuid, p_ids uuid[])
  returns table (id uuid, friend_ids uuid[], ratings jsonb)
  language sql stable security definer set search_path = ''
as $$
  select l.id,
         coalesce(e.friend_ids, '{}'::uuid[]),
         coalesce(r.ratings, '{}'::jsonb)
  from unnest(p_ids) as l(id)
  left join lateral (
    select array_agg(f.friend_id order by f.friend_id) as friend_ids
    from public.friendships f where f.user_id = l.id
  ) e on true
  left join lateral (
    select jsonb_object_agg(per_item.item_id, per_item.tags) as ratings
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
      where rt.user_id = l.id
      group by rt.item_id
    ) per_item
  ) r on true;
$$;

-- The breadth-first cut on its own, returning the ids: `private.neighbourhood`
-- below and 0016's `private.snapshot_delta` both call it, so the cut a patch is
-- checked against is the cut a full load makes.
create function private.neighbourhood_cut(
  p_viewer    uuid,
  p_max_nodes int,
  p_max_depth int
) returns uuid[]
  language sql stable security definer set search_path = ''
as $$
  with recursive bfs (seen, frontier, depth) as (
      select array[p_viewer]::uuid[], array[p_viewer]::uuid[], 0
    union all
      select (b.seen || nxt.ids)[1 : p_max_nodes], nxt.ids, b.depth + 1
      from bfs b
      cross join lateral (
        select coalesce(array_agg(distinct f.friend_id order by f.friend_id), '{}'::uuid[])
        from public.friendships f
        where f.user_id = any (b.frontier)
          and not (f.friend_id = any (b.seen))
      ) as nxt (ids)
      where b.depth < p_max_depth
        and cardinality(b.seen) < p_max_nodes
        and cardinality(nxt.ids) > 0
  )
  select b.seen from bfs b order by b.depth desc limit 1;
$$;

create or replace function private.neighbourhood(
  p_viewer    uuid,
  p_max_nodes int default 2000,
  p_max_depth int default 6
) returns table (id uuid, friend_ids uuid[], ratings jsonb)
  language sql stable security definer set search_path = ''
as $$
  select n.id, n.friend_ids, n.ratings
  from private.load_nodes(
    p_viewer, private.neighbourhood_cut(p_viewer, p_max_nodes, p_max_depth)) n;
$$;

-- Both locks, as 0004 gives the old loader: nobody but the service role. The
-- cut is called only from inside the two functions above and 0016's delta.
revoke all on function private.load_nodes(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.load_nodes(uuid, uuid[]) to service_role;
revoke all on function private.neighbourhood_cut(uuid, int, int) from public, anon, authenticated;

alter table public.user_recs drop column error;
alter table public.user_model
  drop column settle_movement,
  drop column passes,
  drop column settled,
  drop column truncation,
  drop column boundary_residual,
  drop column reach,
  drop column reach_hash,
  drop column reach_reuses;
