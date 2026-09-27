-- Invite-only: an account that trusts nobody is locked (DESIGN §3.6).
--
-- Google cannot be told about the link. The OAuth round trip carries nothing
-- of ours to GoTrue, so a "before user created" auth hook, which sees the
-- user record GoTrue is about to write and the request's metadata, has
-- nothing to check the token against. So every Google sign-in makes an
-- account, and the gate is on what it can do: an account with no connection
-- is locked, and every write it could make is refused. Nothing stores the
-- lock. It is read from `friendships` on every write, so an account that never
-- joined and one that removed its last connection are locked by the same rule,
-- and redeeming a live link unlocks one by writing the friendship that it is.
--
-- A locked account is not deleted. It keeps its ratings and can still read,
-- sign out, delete itself and answer a link.
--
-- Every account with no connection when this applies is locked like any
-- other, and its link is revoked below.


-- Exact key, a boolean, and no client grant: the trigger below and
-- `refresh-recs` (as `service_role`) ask it about somebody other than the
-- caller.
create function private.is_unlocked(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.friendships f where f.user_id = p_user);
$$;

-- The caller's, for policies and for the client.
create function private.is_unlocked() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select private.is_unlocked((select auth.uid()));
$$;

revoke all on function private.is_unlocked(uuid) from public, anon, authenticated;
revoke all on function private.is_unlocked()     from public, anon, authenticated;
grant execute on function private.is_unlocked(uuid) to service_role;
-- A policy expression checks EXECUTE against the querying role (0004).
grant execute on function private.is_unlocked() to authenticated;

-- What the client shows instead of the list. About the caller only.
create function public.account_locked() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select not private.is_unlocked();
$$;

revoke all on function public.account_locked() from public, anon, authenticated;
grant execute on function public.account_locked() to authenticated;


-- Every write a client makes that adds or changes a row spends the write
-- budget through this trigger — a rating, an item, a report, a link, a
-- diagnostic — so this is where a locked account is stopped. 0001's, with the
-- check in front of the spend. Service-role writes have no `auth.uid()` and
-- are not counted or stopped.
create or replace function private.count_write() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  writer uuid := auth.uid();
  used integer;
begin
  if writer is null then
    return new;
  end if;
  if not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;
  insert into private.write_budget as budget (user_id, day, writes)
  values (writer, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set writes = budget.writes + 1
  returning budget.writes into used;
  if used > private.daily_write_limit() then
    raise exception 'daily write limit reached'
      using errcode = 'PT429',
            hint = 'The budget resets at midnight UTC.';
  end if;
  return new;
end $$;

-- The two client writes the trigger above does not see: a name, and clearing
-- a thumb. A trigger raising `42501` rather than a restrictive policy, because
-- a policy would make the write match no row and report success. Deleting the
-- account and removing a connection stay open: the first cascades here after
-- its profile row is gone, which is what the profile guard lets through, and a
-- locked account has no connection.
create function private.refuse_if_locked() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_unlocked()
     and exists (select 1 from public.profiles p where p.id = (select auth.uid())) then
    raise exception 'accept a link first' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

revoke all on function private.refuse_if_locked() from public, anon, authenticated;

create trigger profiles_refuse_if_locked
  before update on public.profiles
  for each row execute function private.refuse_if_locked();

create trigger ratings_delete_refuse_if_locked
  before delete on public.ratings
  for each row execute function private.refuse_if_locked();


-- Losing the last connection revokes the account's link, so a link's owner is
-- never locked and `redeem_invite` needs no check of its own. Per row, on each
-- end's own half: unfriending deletes both halves in one statement, and
-- deleting an account cascades to every half that names it.
create function private.revoke_link_if_locked() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_unlocked(old.user_id) then
    delete from public.invite_links l where l.owner_id = old.user_id;
  end if;
  return null;
end $$;

revoke all on function private.revoke_link_if_locked() from public, anon, authenticated;

create trigger friendships_revoke_link_if_locked
  after delete on public.friendships
  for each row execute function private.revoke_link_if_locked();

delete from public.invite_links l where not private.is_unlocked(l.owner_id);


-- 0009's, and a Google account that carries no name is called "unknown"
-- rather than asked for one: it can rename itself once it is unlocked.
create or replace function private.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full text := coalesce(nullif(btrim(v_meta ->> 'full_name'), ''),
                          nullif(btrim(v_meta ->> 'name'), ''),
                          '');
  v_name text;
begin
  v_name := coalesce(nullif(btrim(v_meta ->> 'given_name'), ''),
                     nullif(split_part(v_full, ' ', 1), ''),
                     '');
  v_name := left(btrim(regexp_replace(
    v_name,
    '[\U00000000-\U0000001F\U0000007F-\U0000009F\U0000200E\U0000200F'
    '\U0000202A-\U0000202E\U00002066-\U00002069\U0000FEFF]',
    '', 'g')), 50);

  insert into public.profiles (id, display_name, photo_url)
  values (
    new.id,
    coalesce(nullif(v_name, ''), 'unknown'),
    left(nullif(v_meta ->> 'avatar_url', ''), 2000)
  )
  on conflict (id) do nothing;

  insert into public.user_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

update public.profiles set display_name = 'unknown' where display_name = '';
