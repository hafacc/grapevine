-- Reporting a thing's name, and removing one (DESIGN §4 "Item names").
--
-- A name is public, permanent text that anyone signed in can create, so a
-- signed-in person can report one from the thing's own screen. A report is a
-- row the client may INSERT and nobody may read back through the API: the
-- owner reviews them with `supabase db query --linked` (CLAUDE.md, "Reports").
--
-- Removal is `private.remove_name(text)`, run by the owner and callable by no
-- client. There is still no UPDATE or DELETE on `items` for anybody else.


-- One report per person per name, and nothing but the name: no reason, no free
-- text (which would be a second channel of user-written text to moderate), and
-- no reference to `items`, because a name on screen can come from a rating
-- with no catalog row behind it. `user_id` is not in the insert grant and
-- defaults to the caller, so a report cannot be filed in somebody else's name.
create table public.reports (
  user_id     uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  item_id     text not null check (private.is_normalized_id(item_id)),
  created_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.reports enable row level security;

-- INSERT of the name alone. No SELECT: who reported what is nobody's to read
-- through the API, including the reporter's own rows, so the table cannot be
-- used to learn anything. No UPDATE and no DELETE.
revoke all on public.reports from anon, authenticated;
grant insert (item_id) on public.reports to authenticated;
grant all on public.reports to service_role;

create policy reports_insert on public.reports
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- A report spends a write, so a loop of them costs its author like any other.
create trigger reports_count_write
  before insert on public.reports
  for each row execute function private.count_write();


-- Names the owner removed. A removed name cannot be created again, as a thing
-- or as an attribute: removing the rows alone would let the same account type
-- it back a second later.
create table private.removed_names (
  id          text primary key check (private.is_normalized_id(id)),
  removed_at  timestamptz not null default now()
);

create function private.is_removed(p_id text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.removed_names r where r.id = p_id);
$$;

-- RESTRICTIVE, so they AND with the permissive policies instead of widening
-- them. `ratings_own` stays the rule for whose row it is; these add what name
-- it may carry.
create policy items_not_removed on public.items
  as restrictive for insert to authenticated
  with check (not private.is_removed(id));

create policy ratings_not_removed on public.ratings
  as restrictive for insert to authenticated
  with check (not private.is_removed(item_id) and not private.is_removed(tag));

-- Nor reported: the name is already gone, and a report of it would put it
-- back in the admins' queue.
create policy reports_not_removed on public.reports
  as restrictive for insert to authenticated
  with check (not private.is_removed(item_id));

-- Removing a name, for the owner (`select private.remove_name('…')` through
-- `supabase db query --linked`). It takes the exact id and:
--
-- - blocks it (above),
-- - deletes every thumb that names it, as a thing or as an attribute — the
--   ratings trigger stamps each rater's clock, so their next recompute runs —
-- - deletes its catalog row and its reports,
-- - and strips it from every stored feed, so it is gone from the next paint
--   rather than from each viewer's next recompute. The stale `feed_hash` only
--   makes that recompute write, which it would have anyway.
--
-- Returns how many thumbs it deleted, so the operator sees what it reached.
create function private.remove_name(p_id text) returns integer
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

  return v_thumbs;
end $$;

revoke all on function private.is_removed(text)  from public, anon, authenticated;
revoke all on function private.remove_name(text) from public, anon, authenticated;
-- A policy expression checks EXECUTE against the querying role (0004 says why);
-- the schema lock still keeps a direct call from resolving.
grant execute on function private.is_removed(text) to authenticated;
