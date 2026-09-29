-- A thing's link to a public index (DESIGN §3.2 `item_refs`).
--
-- When somebody adds a thing, the browser asks Wikipedia and OpenStreetMap
-- for matches, directly; picking one stores the index's id beside the name.
-- No URL is stored: the link is built from `(source, ref)` by the client
-- (`shared/src/references.ts`), and the format check below is what makes
-- that safe, since a ref can hold no `/`, `?`, `#` or `:`. No description and
-- no coordinates either: names and ids alone keep OpenStreetMap's share-alike
-- out of reach (OSMF's Geocoding Guideline), and a stored description would be
-- Wikipedia's text to keep in step.
--
-- A side table rather than columns, because `items` has no UPDATE for anyone
-- and a plain name may gain a link after it exists.


-- The indices, and the pattern each one's ids must match. The patterns are
-- the ones `SOURCES` in `shared/src/references.ts` compiles, and its tests
-- check this list against that one. A new index is a row here, not a schema
-- change.
create table private.ref_sources (
  source   text primary key,
  pattern  text not null
);

insert into private.ref_sources (source, pattern) values
  ('wikidata', '^Q[1-9][0-9]{0,11}$'),
  ('osm',      '^[nwr][1-9][0-9]{0,14}$');

revoke all on private.ref_sources from public, anon, authenticated;


-- One link per thing, and one thing per link: the same Wikipedia page or
-- the same shop always resolves to the thing that already holds it.
create table public.item_refs (
  item_id     text primary key references public.items (id) on delete cascade,
  source      text not null references private.ref_sources (source),
  ref         text not null,
  created_at  timestamptz not null default now(),
  -- As on `items`: not in the insert grant, not in the select grant, and it
  -- must outlive its author.
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (source, ref)
);

create index item_refs_created_by_idx on public.item_refs (created_by)
  where created_by is not null;

-- A CHECK cannot read another table, so the pattern is checked here, for
-- every writer.
create function private.check_ref() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from private.ref_sources s
                  where s.source = new.source and new.ref ~ s.pattern) then
    raise exception 'not a % id: %', new.source, new.ref using errcode = '23514';
  end if;
  return new;
end $$;

create trigger item_refs_check_ref
  before insert or update on public.item_refs
  for each row execute function private.check_ref();

create trigger item_refs_count_write
  before insert on public.item_refs
  for each row execute function private.count_write();

alter table public.item_refs enable row level security;

revoke all on public.item_refs from anon, authenticated;
grant select (item_id, source, ref) on public.item_refs to authenticated;
grant insert (item_id, source, ref) on public.item_refs to authenticated;
grant all on public.item_refs to service_role;

-- As shared as the catalog it annotates.
create policy item_refs_select on public.item_refs
  for select to authenticated
  using (true);

create policy item_refs_insert on public.item_refs
  for insert to authenticated
  with check (created_by = (select auth.uid()));


-- Links an admin took off. Blocked from coming back, on any thing, or the
-- same account could put it back a second later.
create table private.removed_refs (
  source      text not null,
  ref         text not null,
  removed_at  timestamptz not null default now(),
  primary key (source, ref)
);

revoke all on private.removed_refs from public, anon, authenticated;

create function private.is_ref_removed(p_source text, p_ref text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.removed_refs r
                  where r.source = p_source and r.ref = p_ref);
$$;

create policy item_refs_not_removed on public.item_refs
  as restrictive for insert to authenticated
  with check (not private.is_ref_removed(source, ref)
              and not private.is_removed(item_id));


-- Takes a thing's link off and blocks it, and leaves the name and its thumbs
-- alone, so a wrong link on a well-rated name is fixed without removing the
-- name. Removing the name (`remove_reported_name`) takes its link with it
-- through the cascade. No caller check: no client can call it, and the owner
-- runs it by hand (`supabase db query --linked`, where `auth.uid()` is null
-- and `public.remove_reference` would refuse), as `private.remove_name`.
create function private.remove_reference(p_item_id text) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_source text;
  v_ref    text;
begin
  delete from public.item_refs r where r.item_id = p_item_id
    returning r.source, r.ref into v_source, v_ref;
  if v_source is not null then
    insert into private.removed_refs (source, ref) values (v_source, v_ref)
      on conflict do nothing;
  end if;
end $$;

-- An admin's, from a client. Nothing in the app calls it today.
create function public.remove_reference(p_item_id text) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform private.remove_reference(p_item_id);
end $$;

revoke all on function private.check_ref()                  from public, anon, authenticated;
revoke all on function private.is_ref_removed(text, text)   from public, anon, authenticated;
revoke all on function private.remove_reference(text)       from public, anon, authenticated;
revoke all on function public.remove_reference(text)        from public, anon, authenticated;
-- A policy expression checks EXECUTE against the querying role (0013 says why).
grant execute on function private.is_ref_removed(text, text) to authenticated;
grant execute on function public.remove_reference(text) to authenticated;
