-- Two kinds of function, and the difference is the whole of DESIGN §3.3's
-- privacy boundary.
--
-- `private.neighbourhood` and `private.load_nodes` return other people's raw
-- ratings. They live in a schema PostgREST does not serve, and `service_role`
-- is the only role that may name it. A `grant execute` on either to
-- `authenticated`, or a move into `public`, hands every viewer the ratings of
-- everyone within two hops and breaks DESIGN §4's "nothing about another user
-- is ever computed on a client".
--
-- The rest are the client's. Every one of them is one statement's worth of
-- work; none is application code and none adds a network hop, so there is
-- still no server in the request path.

-- DESIGN §3.4. A breadth-first walk carried in two arrays — the seen set and
-- the current frontier, one row per level — joined to `friendships` and
-- `ratings` and aggregated into exactly the `{ users, friendIds, loaded,
-- ratings }` shape the wasm boundary already takes.
--
-- A person's ratings come back NESTED — item to tag to thumb, with `''` for the
-- thing itself — because a rating is keyed by columns and there is nothing
-- here to join them with: the core's join is a NUL, and Postgres text cannot
-- hold one (DESIGN §3.2). `sanitizeRatings` in `shared/` is what turns the nest
-- into the core's one key per rated thing.
--
-- The set-at-a-time form is not a flourish. A node-per-row recursion cannot
-- express a global row cap: `limit` on the outer select relies on the
-- executor's demand-driven evaluation to stop expanding the recursion, which is
-- an implementation detail and not a contract, and taking the first N_max of a
-- `distinct`/`order by` over the whole set requires materializing whatever the
-- recursion produced first — the explosion the cap exists to prevent.
--
-- The node cap is the real bound and it is hard: the recursion stops the moment
-- the seen set reaches `p_max_nodes`, and the slice cuts the level that crosses
-- it. Each level's ids arrive `order by f.friend_id`, so the cut is
-- deterministic and reproducible — the same property `nextBoundaryNodes`' sort
-- gives. The depth bound is a backstop against a pathological component
-- of tiny degree, not the semantic bound; at degree 15 the node cap binds at
-- depth 3, and a depth cap that fired in practice would be the fixed horizon
-- DESIGN §2.4 is explicit about not wanting.
--
-- Everyone named by a returned node but not himself returned is a boundary
-- node, with no adjacency and no ratings of his own. That is the contract
-- `boundaryResidual` and the extra rounds take.
create function private.neighbourhood(
  p_viewer    uuid,
  p_max_nodes int default 2000,
  p_max_depth int default 6
) returns table (id uuid, friend_ids uuid[], ratings jsonb)
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
  ),
  final as (
    select b.seen from bfs b order by b.depth desc limit 1
  ),
  loaded (id) as (
    select unnest(f.seen) from final f
  )
  select l.id,
         coalesce(e.friend_ids, '{}'::uuid[]),
         coalesce(r.ratings, '{}'::jsonb)
  from loaded l
  left join lateral (
    select array_agg(f.friend_id order by f.friend_id) as friend_ids
    from public.friendships f where f.user_id = l.id
  ) e on true
  left join lateral (
    select jsonb_object_agg(per_item.item_id, per_item.tags) as ratings
    from (
      select rt.item_id, jsonb_object_agg(rt.tag, rt.value) as tags
      from public.ratings rt where rt.user_id = l.id
      group by rt.item_id
    ) per_item
  ) r on true;
$$;

-- The same tail against an explicit id list: `computeWithBoundaryRounds`' extra
-- rounds, one call per round. `MAX_LOADED_NODES` counts every node the
-- recompute loads, rounds included, so the caller never passes more ids than
-- that cap leaves room for.
create function private.load_nodes(p_ids uuid[])
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
      select rt.item_id, jsonb_object_agg(rt.tag, rt.value) as tags
      from public.ratings rt where rt.user_id = l.id
      group by rt.item_id
    ) per_item
  ) r on true;
$$;


-- Finding a searchable stranger by handle cannot be a policy: a clause that
-- authorizes reading a searchable stranger's row authorizes reading every
-- searchable row. So the `searchable` condition lives here, behind an exact
-- key.
--
-- A prefix, a pattern (`like`, `~`, `%`) or an unbounded limit in this body is
-- the enumeration it exists to prevent. `p_handle` is compared with `=` and
-- nothing else, and that is not a detail to relax later.
create function public.find_by_username(p_handle text)
  returns table (id uuid, username text, display_name text, photo_url text)
  language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.photo_url
  from public.profiles p
  where p.username = p_handle and p.searchable
  limit 1;
$$;

-- The same lookup keyed on id, for a viewer who holds a uid but no edge. A
-- friend or a counterparty reads the table directly under `profiles_select`;
-- this is for everybody else, and it refuses anyone who is not searchable.
create function public.profile_by_id(p_id uuid)
  returns table (id uuid, username text, display_name text, photo_url text)
  language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.photo_url
  from public.profiles p
  where p.id = p_id and p.searchable
  limit 1;
$$;

-- One statement over a unique index, which is the whole uniqueness guarantee.
--
-- The pattern and the reserved list are CHECKs on `profiles.username` (0001),
-- so a bad handle raises there. A handle somebody else holds raises the unique
-- violation. A second claim by the same person matches no row, because the
-- update is guarded on `username is null` — which is also the only reason this
-- needs to be `security definer` rather than a plain UPDATE: 0002 grants no
-- UPDATE on the column at all, so that there is no verb to change or release a
-- handle.
--
-- `searchable` rides along: a handle exists to be found by.
create function public.claim_username(p_handle text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_credential() then
    raise exception 'a handle needs a way back in' using errcode = '42501';
  end if;

  update public.profiles
     set username = p_handle, searchable = true
   where id = (select auth.uid()) and username is null;

  if not found then
    raise exception 'handle already set' using errcode = '23505';
  end if;
end $$;

-- SECURITY INVOKER on purpose: it runs with the caller's own rights and every
-- policy in 0003 still applies. All it supplies is the transaction — so this
-- is not a server in the request path, it is the same client writes with a
-- commit boundary around them.
--
-- The order is load-bearing. `friendships_insert`'s accept clause is true only
-- while the sender's request is still there, so the request is deleted last;
-- and the two rows go in together because the deferred symmetry trigger will
-- not let one commit alone. An accept with no pending request is refused by the
-- policy rather than by the explicit check below — the check is there to say
-- which of the two it was.
create function public.accept_connect_request(p_from uuid) returns void
  language plpgsql security invoker set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.connect_requests c
                 where c.from_id = p_from and c.to_id = v_me) then
    raise exception 'no pending request from %', p_from using errcode = '42501';
  end if;

  insert into public.friendships (user_id, friend_id)
  values (v_me, p_from), (p_from, v_me)
  on conflict do nothing;

  delete from public.connect_requests c
   where (c.from_id = p_from and c.to_id = v_me)
      or (c.from_id = v_me and c.to_id = p_from);
end $$;

-- An append-if-absent to an array, which PostgREST has no verb for. SECURITY
-- INVOKER, so `user_prefs_own` and the 500-element cap both still apply. A
-- dismissal is a claim about nobody but its owner's own screen, so there is no
-- per-write cap on how many accumulate.
create function public.dismiss_suggestion(p_suggested uuid) returns void
  language sql security invoker set search_path = ''
as $$
  insert into public.user_prefs (user_id, dismissed_suggestions)
  values ((select auth.uid()), array[p_suggested])
  on conflict (user_id) do update
    set dismissed_suggestions =
      case when user_prefs.dismissed_suggestions @> array[p_suggested]
           then user_prefs.dismissed_suggestions
           else user_prefs.dismissed_suggestions || p_suggested
      end;
$$;

-- The only write verb on `private.debug_events`. The table is in `private`
-- because nothing may read one back; the client reaches it through this,
-- because PostgREST serves `public` and `graphql_public` only and adding
-- `private` to that list would put `neighbourhood` on an RPC endpoint.
--
-- `user_id`, `at` and `expires` are not arguments, so a client cannot forge
-- them. The length caps are CHECKs. A signed-out caller has no EXECUTE grant.
create function public.record_debug_event(p_kind text, p_detail text) returns void
  language sql security definer set search_path = ''
as $$
  insert into private.debug_events (kind, detail) values (p_kind, p_detail);
$$;


-- 0002 turned off Postgres' default of granting EXECUTE on a new function to
-- PUBLIC, but that default belongs to the role that ran the ALTER. These
-- revokes make the guarantee independent of which role applies the migration,
-- so that neither loader is ever one mis-ordered file away from being callable.
--
-- The list is every function in `private` (`public`'s are below), and the last
-- six are the ones easiest to miss: they are created in 0001, BEFORE 0002 flips
-- the default, so without a line here they keep `proacl = NULL` — the built-in
-- default, which is EXECUTE to PUBLIC. Unreachable as it stands, since
-- `private` carries no USAGE for either client role and five of the six return
-- `trigger`, which no caller may pass or receive; but DESIGN §3.3 claims both
-- locks rather than one, and an exception a reader has to discover is not a
-- lock. A trigger fires with no EXECUTE check at all — that is checked once,
-- when the trigger is created — so this costs the triggers nothing.
revoke all on function private.neighbourhood(uuid, int, int)      from public, anon, authenticated;
revoke all on function private.load_nodes(uuid[])                 from public, anon, authenticated;
revoke all on function private.is_friend(uuid)                    from public, anon, authenticated;
revoke all on function private.has_incoming_request_from(uuid)    from public, anon, authenticated;
revoke all on function private.has_open_outgoing_request_to(uuid) from public, anon, authenticated;
revoke all on function private.is_suggested_to_me(uuid)           from public, anon, authenticated;
revoke all on function private.is_discoverable(uuid)              from public, anon, authenticated;
revoke all on function private.is_searchable(uuid)                from public, anon, authenticated;
revoke all on function private.has_credential()                   from public, anon, authenticated;
revoke all on function private.assert_symmetric()                 from public, anon, authenticated;
revoke all on function private.handle_new_user()                  from public, anon, authenticated;
revoke all on function private.stamp_ratings_changed()            from public, anon, authenticated;
revoke all on function private.stamp_rating_flip()                from public, anon, authenticated;
revoke all on function private.forget_suggestions_search()        from public, anon, authenticated;
revoke all on function private.count_write()                      from public, anon, authenticated;
revoke all on function private.daily_write_limit()                from public, anon, authenticated;
revoke all on function private.is_normalized_id(text)              from public, anon, authenticated;

-- The six helpers the policies in 0003 call need EXECUTE back, and the shape
-- of that requirement is worth stating because it is not what it looks like.
--
-- A policy expression names its functions by OID — they were resolved when the
-- policy was created — so evaluating one performs **no name lookup and no
-- schema USAGE check**, but it does check EXECUTE against the querying role.
-- Measured, not assumed: without these grants `select * from public.profiles`
-- as `authenticated` fails with "permission denied for function is_friend".
--
-- `authenticated` therefore holds EXECUTE on these six and still cannot call
-- any of them: `revoke all on schema private` (0002) means the name
-- `private.is_friend` does not resolve for that role, so a direct call is
-- refused before the privilege is ever consulted. Both locks are load-bearing,
-- and `neighbourhood` and `load_nodes` — the two that return other people's
-- ratings — are behind both.
grant execute on function private.is_friend(uuid)                    to authenticated;
grant execute on function private.has_incoming_request_from(uuid)    to authenticated;
grant execute on function private.has_open_outgoing_request_to(uuid) to authenticated;
grant execute on function private.is_suggested_to_me(uuid)           to authenticated;
grant execute on function private.is_discoverable(uuid)              to authenticated;
grant execute on function private.is_searchable(uuid)                to authenticated;

-- And the same requirement from the other direction: a CHECK constraint that
-- calls a function checks EXECUTE against the role doing the INSERT, exactly as
-- a policy expression does — measured, not assumed, and without this line every
-- write of an item or a thumb fails with "permission denied for function
-- is_normalized_id". `service_role` needs it for the same reason: it bypasses
-- row-level security, not privileges. Neither role can CALL it, because
-- `revoke all on schema private` (0002) means the name does not resolve for
-- them — the same pair of locks the six helpers above sit behind. It discloses
-- nothing either way: it is a predicate over a string the caller supplied.
grant execute on function private.is_normalized_id(text) to authenticated, service_role;

revoke all on function public.find_by_username(text)        from public, anon, authenticated;
revoke all on function public.profile_by_id(uuid)           from public, anon, authenticated;
revoke all on function public.claim_username(text)          from public, anon, authenticated;
revoke all on function public.accept_connect_request(uuid)  from public, anon, authenticated;
revoke all on function public.dismiss_suggestion(uuid)      from public, anon, authenticated;
revoke all on function public.record_debug_event(text, text) from public, anon, authenticated;

grant execute on function private.neighbourhood(uuid, int, int) to service_role;
grant execute on function private.load_nodes(uuid[])            to service_role;

-- Signed-in callers only: `anon` gets none of them.
grant execute on function public.find_by_username(text)         to authenticated;
grant execute on function public.profile_by_id(uuid)            to authenticated;
grant execute on function public.claim_username(text)           to authenticated;
grant execute on function public.accept_connect_request(uuid)   to authenticated;
grant execute on function public.dismiss_suggestion(uuid)       to authenticated;
grant execute on function public.record_debug_event(text, text) to authenticated;
