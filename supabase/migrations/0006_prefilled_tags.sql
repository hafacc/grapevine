-- A prefilled account carries the attributes its own thumbs use, so that it
-- can be found the way a thing is: the people screen's search for `pizza`
-- finds the account that rates pizza. Its thumbs cannot say so to anybody who does not follow it
-- (`ratings_select`), and the point is to be found before following, so the
-- list is stored on the profile, where every signed-in caller already reads a
-- prefilled account.
--
-- A person has none: the column is null for every one of them, by a CHECK, so
-- nothing here can become a way to find a person.
--
-- Written only by `load_prefilled`, from the thumbs it has just made equal to
-- the file, so the file stays the one source; and by `remove_name`, which takes
-- a removed name out of it at once, because unlike a thumb it is shown to
-- people who follow nobody.
alter table public.profiles
  add column tags text[],
  add constraint profiles_tags_only_prefilled check (prefilled or tags is null);

-- The attributes an account's thumbs put on things, those on the most things
-- first, and never a removed name.
create function private.prefilled_tags(p_user uuid) returns text[]
  language sql stable set search_path = ''
as $$
  select coalesce(array_agg(t.tag order by t.things desc, t.tag collate "C"), '{}'::text[])
    from (select r.tag, count(*) as things
            from public.ratings r
           where r.user_id = p_user and r.tag <> '' and not private.is_removed(r.tag)
           group by r.tag) t;
$$;

update public.profiles p set tags = private.prefilled_tags(p.id) where p.prefilled;

grant select (tags) on public.profiles to authenticated;


-- As in 0001, and then the account's tags from what it now holds. Only when
-- they changed, so a load that moved nothing writes nothing.
create or replace function private.load_prefilled(p_handle text, p_display_name text, p_thumbs jsonb)
  returns jsonb
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id       uuid;
  v_bad      jsonb;
  v_wanted   jsonb;
  v_skipped  integer;
  v_items    integer;
  v_refs     integer;
  v_deleted  integer;
  v_changed  integer;
  v_saved    integer;
begin
  if p_thumbs is null or jsonb_typeof(p_thumbs) <> 'array' then
    raise exception 'thumbs must be an array' using errcode = '22023';
  end if;

  select e.thumb into v_bad
    from jsonb_array_elements(p_thumbs) with ordinality as e(thumb, ord)
   where jsonb_typeof(e.thumb) <> 'object'
      or not coalesce(private.is_normalized_id(e.thumb ->> 'item'), false)
      or not (coalesce(e.thumb ->> 'tag', '') = ''
              or private.is_normalized_id(e.thumb ->> 'tag'))
      or coalesce(e.thumb ->> 'value', '') not in ('1', '-1')
      or char_length(e.thumb ->> 'search_id') > 128
   order by e.ord limit 1;
  if v_bad is not null then
    raise exception 'not a thumb: %', v_bad using errcode = '22023';
  end if;

  select jsonb_build_object('item', t.item, 'tag', t.tag) into v_bad
    from (select e.thumb ->> 'item' as item, coalesce(e.thumb ->> 'tag', '') as tag
            from jsonb_array_elements(p_thumbs) as e(thumb)) t
   group by t.item, t.tag
  having count(*) > 1
   limit 1;
  if v_bad is not null then
    raise exception 'given twice: %', v_bad using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) into v_wanted
    from (
      select e.ord,
             e.thumb ->> 'item'                as item,
             e.thumb ->> 'search_id'           as search_id,
             coalesce(e.thumb ->> 'tag', '')   as tag,
             (e.thumb ->> 'value')::smallint   as value,
             e.thumb ->> 'source'              as source,
             e.thumb ->> 'ref'                 as ref
        from jsonb_array_elements(p_thumbs) with ordinality as e(thumb, ord)
    ) t
   where not private.is_removed(t.item)
     and not (t.tag <> '' and private.is_removed(t.tag));
  v_skipped := jsonb_array_length(p_thumbs) - jsonb_array_length(v_wanted);

  select jsonb_build_object('item', w.item) into v_bad
    from jsonb_to_recordset(v_wanted) as w(item text, search_id text)
   where not exists (select 1 from public.items i where i.id = w.item)
   group by w.item
  having count(w.search_id) = 0
   limit 1;
  if v_bad is not null then
    raise exception 'a new thing needs its search_id: %', v_bad using errcode = '22023';
  end if;

  perform set_config('grapevine.importing', 'on', true);

  insert into public.profiles as p (display_name, prefilled, handle)
  values (p_display_name, true, p_handle)
  on conflict (handle) do update set display_name = excluded.display_name
  returning p.id into v_id;

  insert into public.items (id, search_id, created_by)
  select distinct on (w.item) w.item, w.search_id, null
    from jsonb_to_recordset(v_wanted) as w(ord integer, item text, search_id text)
   where w.search_id is not null
   order by w.item, w.ord
  on conflict do nothing;
  get diagnostics v_items = row_count;

  insert into public.item_refs (item_id, source, ref, created_by)
  select distinct on (w.item) w.item, w.source, w.ref, null
    from jsonb_to_recordset(v_wanted)
           as w(ord integer, item text, source text, ref text)
    join private.ref_sources s on s.source = w.source and w.ref ~ s.pattern
   where not private.is_ref_removed(w.source, w.ref)
   order by w.item, w.ord
  on conflict do nothing;
  get diagnostics v_refs = row_count;

  delete from public.ratings r
   where r.user_id = v_id
     and not exists (select 1 from jsonb_to_recordset(v_wanted) as w(item text, tag text)
                      where w.item = r.item_id and w.tag = r.tag);
  get diagnostics v_deleted = row_count;

  update public.ratings r
     set value = w.value
    from jsonb_to_recordset(v_wanted) as w(item text, tag text, value smallint)
   where r.user_id = v_id and r.item_id = w.item and r.tag = w.tag
     and r.value <> w.value;
  get diagnostics v_changed = row_count;

  -- Only the missing ones are offered: a thumb that is already there would
  -- take a revision on its way to being turned away, and send every follower
  -- to read an account that did not change.
  insert into public.ratings (user_id, item_id, tag, value)
  select v_id, w.item, w.tag, w.value
    from jsonb_to_recordset(v_wanted) as w(item text, tag text, value smallint)
   where not exists (select 1 from public.ratings r
                      where r.user_id = v_id and r.item_id = w.item and r.tag = w.tag)
  on conflict do nothing;
  get diagnostics v_saved = row_count;

  update public.profiles p
     set tags = private.prefilled_tags(v_id)
   where p.id = v_id and p.tags is distinct from private.prefilled_tags(v_id);

  perform set_config('grapevine.importing', 'off', true);

  return jsonb_build_object(
    'id',      v_id,
    'saved',   v_saved,
    'changed', v_changed,
    'deleted', v_deleted,
    'skipped', v_skipped,
    'items',   v_items,
    'refs',    v_refs);
end $$;


-- As in 0001, and the name out of every prefilled account's tags, in the same
-- statement as the removal: a tag is shown to callers who follow nobody, and
-- the readers that hide a removed name's thumbs do not read it.
create or replace function private.remove_name(p_id text) returns void
  language plpgsql volatile set search_path = ''
as $$
begin
  if not private.is_normalized_id(p_id) then
    raise exception 'not an id: %', p_id using errcode = '22023';
  end if;
  insert into private.removed_names (id) values (p_id) on conflict (id) do nothing;
  delete from public.items i where i.id = p_id;
  delete from public.reports p where p.item_id = p_id;
  update public.profiles p set tags = array_remove(p.tags, p_id) where p_id = any (p.tags);
end $$;
