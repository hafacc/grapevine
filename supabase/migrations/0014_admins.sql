-- Admins, and their review queue for reported names (DESIGN §4 "Item names").
--
-- Supabase has no application-level admin role for end users, so an admin is
-- a row here, written by hand by the owner (CLAUDE.md, "Admins"). No client
-- reads or writes it. An admin is never locked (0010), which is how the first
-- account gets in: it needs no connection to make the first link.
--
-- The queue is three `security definer` functions in `public`, because a
-- client must call them. Each checks `private.is_admin()` before anything
-- else: listing answers nothing for anybody else, and the two that write
-- refuse. That check, the revoke from PUBLIC and the exact key are the whole
-- of the defence, since `public` is served.

create table private.admins (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now()
);

revoke all on private.admins from public, anon, authenticated;

-- Exact key, the caller's own.
create function private.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function private.is_admin() from public, anon, authenticated;


-- 0010's, and an admin is never locked.
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.admins a where a.user_id = p_user)
      or exists (select 1 from public.friendships f where f.user_id = p_user);
$$;

-- An admin removed with no connection left is locked, and loses its link the
-- way losing the last connection does. `revoke_link_if_locked` reads
-- `old.user_id`, which both tables have.
create trigger admins_revoke_link_if_locked
  after delete on private.admins
  for each row execute function private.revoke_link_if_locked();


-- Whether to show the caller the queue at all. About the caller only.
create function public.account_is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select private.is_admin();
$$;

-- Every reported name, most reported first. Counts and times, never who.
create function public.reported_names()
  returns table (item_id text, reports integer, latest timestamptz)
  language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    return;
  end if;
  return query
    select r.item_id, count(*)::integer, max(r.created_at)
      from public.reports r
     group by r.item_id
     order by count(*) desc, max(r.created_at) desc, r.item_id;
end $$;

-- `private.remove_name`, for an admin. Returns the thumbs it deleted.
create function public.remove_reported_name(p_id text) returns integer
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return private.remove_name(p_id);
end $$;

-- The name stays. Its reports go, and anyone may report it again.
create function public.dismiss_reports(p_id text) returns integer
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_dismissed integer;
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from public.reports r where r.item_id = p_id;
  get diagnostics v_dismissed = row_count;
  return v_dismissed;
end $$;

revoke all on function public.account_is_admin()          from public, anon, authenticated;
revoke all on function public.reported_names()            from public, anon, authenticated;
revoke all on function public.remove_reported_name(text)  from public, anon, authenticated;
revoke all on function public.dismiss_reports(text)       from public, anon, authenticated;
grant execute on function public.account_is_admin()         to authenticated;
grant execute on function public.reported_names()           to authenticated;
grant execute on function public.remove_reported_name(text) to authenticated;
grant execute on function public.dismiss_reports(text)      to authenticated;
