-- Friends by link, and names instead of handles (DESIGN §1 "Friend edge",
-- §3.2, §3.3).
--
-- Before this, a friendship started with a handle: claim one, turn findable
-- on, and anyone who typed it could ask. After it, a friendship starts with a
-- link the owner hands to somebody off the platform, and nobody is found by
-- typing anything. So everything that existed to make a person findable goes:
-- `username`, `searchable`, `find_by_username`, `profile_by_id`,
-- `claim_username` and `is_searchable`. Taste search stays (DESIGN §5), and
-- its connect requests with it, now sendable only to someone the search named.
--
-- IRREVERSIBLE: the two dropped columns take every claimed handle with them.
-- Reviewed as that. At the time of writing the site had never been deployed
-- to anyone, so no handle anybody was promised was ever claimed.


-- Discoverable is now the one switch. It used to be ANDed with `searchable`
-- because a request could only be sent to a findable person; the request
-- policy below now takes a suggestion instead, so the second half has nothing
-- left to guard. A missing prefs row is the default, which is off.
--
-- `create or replace` keeps the OID, so the policies that call it in 0003 and
-- `is_suggested_to_me` keep working, and keeps the EXECUTE grant 0004 gave it.
create or replace function private.is_discoverable(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select u.discoverable_by_taste from public.user_prefs u where u.user_id = p_other),
    false);
$$;

-- The sender's half of a pending ask still expires; what it expires on moves
-- from "the target stayed findable" to "the target stayed discoverable",
-- because being suggested is now the only way to have been askable at all.
create or replace function private.has_open_outgoing_request_to(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.connect_requests c
    where c.from_id = (select auth.uid()) and c.to_id = p_other
  ) and private.is_discoverable(p_other);
$$;

-- A request may go only to someone taste search named to the sender and who is
-- still discoverable. A link is the other way to become friends and needs no
-- request at all. Knowing a uid is not a route: without this a client holding
-- one could ask anybody.
drop policy connect_requests_insert on public.connect_requests;
create policy connect_requests_insert on public.connect_requests
  for insert to authenticated
  with check (from_id = (select auth.uid()) and private.is_suggested_to_me(to_id));

drop function public.find_by_username(text);
drop function public.profile_by_id(uuid);
drop function public.claim_username(text);
drop function private.is_searchable(uuid);

alter table public.profiles drop constraint profiles_searchable_needs_handle;
alter table public.profiles drop column searchable;
alter table public.profiles drop column username;


-- A display name is now the only thing that says who somebody is, and anyone
-- may type anything into it. So it refuses what an id refuses for the same
-- reason (0001's `is_normalized_id`): a control character, and the
-- bidirectional marks and overrides, one of which in a name reverses the rest
-- of the line it is drawn in. NOT VALID so that a row written before this
-- cannot stop the migration; every insert and update from here on is checked.
alter table public.profiles add constraint profiles_display_name_plain check (
  display_name !~ ('[\U00000000-\U0000001F\U0000007F-\U0000009F'
                   '\U0000200E\U0000200F\U0000202A-\U0000202E'
                   '\U00002066-\U00002069\U0000FEFF]')
) not valid;

-- The default name is the first name, not the full one: it is what a friend
-- calls you, and it is editable on the people screen. Google's `given_name`
-- when the identity carries one, else the first word of the full name, else
-- '' — which the name gate asks about.
--
-- Stripped rather than refused: a character the CHECK above refuses must not
-- be able to stop an account being created, since this runs in the same
-- transaction as the auth user.
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
    v_name,
    -- `photos.ts`'s lh3.googleusercontent.com allowlist is what decides whether
    -- this is ever rendered; storing it verbatim keeps that one decision in one
    -- place.
    left(nullif(v_meta ->> 'avatar_url', ''), 2000)
  )
  on conflict (id) do nothing;

  insert into public.user_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;


-- A person's friending link: at most one, with no expiry and no limit on
-- uses. Whoever holds the token can see the owner's name and photo and become
-- their friend, so it is a bearer secret; what bounds it is that the owner can
-- turn it off, or replace it so the old one stops working, whenever they like.
--
-- The token is stored as itself, not hashed, because the owner has to be able
-- to copy their link again at any time. It is readable by its owner and nobody
-- else: the select policy admits the owner's own row only, so filtering on
-- `token` finds nothing that is not already the caller's. A recipient reaches
-- a row only through `invite_owner` and `redeem_invite`, each taking the exact
-- token and touching at most one row. What that gives up against a hash is a
-- copy of the database being a copy of everyone's links — and whoever holds
-- the database holds the friendships a link would make anyway.
--
-- Revoking keeps the friendships a link already made: a friendship is two
-- people's, and either of them can end it.
create table public.invite_links (
  owner_id    uuid primary key references public.profiles (id) on delete cascade,
  -- 32 random bytes as unpadded base64url. The CHECK is the shape
  -- `set_invite_link` makes, so a row can hold nothing guessable.
  token       text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at  timestamptz not null default now()
);

alter table public.invite_links enable row level security;

-- No INSERT and no UPDATE: the token is made on the server, by
-- `set_invite_link`, so a client can neither choose one nor plant one.
-- DELETE is turning the link off.
grant select (token, created_at) on public.invite_links to authenticated;
grant delete on public.invite_links to authenticated;
grant all on public.invite_links to service_role;

create policy invite_links_select on public.invite_links
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy invite_links_delete on public.invite_links
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Turning a link on or replacing it spends a write, like everything else that
-- adds a row. INSERT only: `set_invite_link` replaces by `on conflict do
-- update`, which fires a BEFORE UPDATE trigger as well as the BEFORE INSERT
-- one, so a trigger on both would charge a replacement twice.
create trigger invite_links_count_write
  before insert on public.invite_links
  for each row execute function private.count_write();


-- `private.count_write` for a write that is not an insert into a table with the
-- trigger on it: redeeming a link, which spends one whether or not the token
-- matched, so that guessing costs the guesser. Same row, same limit, same
-- `PT429`.
create function private.spend_write() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  writer uuid := auth.uid();
  used integer;
begin
  if writer is null then
    return;
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
end $$;


-- Turns the caller's link on, or replaces it, and returns the token. Replacing
-- is the same call: the new token overwrites the old one, which stops working
-- in the same statement.
--
-- 32 bytes from two v4 UUIDs, which Postgres draws from its strong random
-- source (244 random bits), as unpadded base64url: 43 characters. Core
-- functions only, so it needs no extension and no search path.
--
-- `has_credential()` is what it has in common with the handle it replaces: a
-- link makes friendships in its owner's name, so an account nobody can prove
-- they own may not have one (DESIGN §3.3).
create function public.set_invite_link() returns text
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_token text;
begin
  if v_me is null or not private.has_credential() then
    raise exception 'a link needs a way back in' using errcode = '42501';
  end if;

  v_token := translate(
    rtrim(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text,
                                '-', ''), 'hex'), 'base64'), '='),
    '+/', '-_');

  insert into public.invite_links as l (owner_id, token)
  values (v_me, v_token)
  on conflict (owner_id) do update
    set token = excluded.token, created_at = now();

  return v_token;
end $$;

-- Whose link this is: the owner's name and photo, so the person holding it can
-- see who they would befriend before signing in and before saying yes. Exact
-- key, one row, and nothing for a token that does not match.
--
-- Callable by `anon`, and it is the only thing `anon` may call. The link is
-- the authority: its owner handed it over so that the holder would know who it
-- is from, and it discloses exactly the two fields a friend would see and no
-- id. It spends nothing — `anon` has no budget to spend — and what bounds
-- guessing is the token's 244 bits.
create function public.invite_owner(p_token text)
  returns table (display_name text, photo_url text)
  language sql stable security definer set search_path = ''
as $$
  select p.display_name, p.photo_url
    from public.invite_links l
    join public.profiles p on p.id = l.owner_id
   where l.token = p_token
   limit 1;
$$;

-- Makes the caller and the link's owner friends, and returns the owner's id:
-- null when no live link has this token; the caller's own id when it is their
-- own link, which writes nothing. Already friends is a no-op that still answers
-- with the owner.
--
-- SECURITY DEFINER because it writes the OWNER's half of the edge, which no
-- policy lets the caller write: the owner authorized it by handing the link
-- over, and the caller by confirming. The symmetry trigger still checks both
-- rows at commit. A pending ask between the two, either way, is answered by
-- this and deleted.
create function public.redeem_invite(p_token text) returns uuid
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_me is null or not private.has_credential() then
    raise exception 'a friendship needs a way back in' using errcode = '42501';
  end if;

  perform private.spend_write();

  select l.owner_id into v_owner
    from public.invite_links l
   where l.token = p_token;

  if v_owner is null or v_owner = v_me then
    return v_owner;
  end if;

  -- Lower id first, so two people redeeming each other's links at once wait
  -- on the same row instead of each holding the half the other wants.
  insert into public.friendships (user_id, friend_id)
  select pair.user_id, pair.friend_id
    from (values (v_me, v_owner), (v_owner, v_me)) as pair (user_id, friend_id)
   order by pair.user_id
  on conflict do nothing;

  delete from public.connect_requests c
   where (c.from_id = v_me and c.to_id = v_owner)
      or (c.from_id = v_owner and c.to_id = v_me);

  return v_owner;
end $$;


revoke all on function private.spend_write()        from public, anon, authenticated;
revoke all on function public.set_invite_link()     from public, anon, authenticated;
revoke all on function public.invite_owner(text)    from public, anon, authenticated;
revoke all on function public.redeem_invite(text)   from public, anon, authenticated;

grant execute on function public.set_invite_link()  to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
-- Signed out too: the welcome screen names whose link it is (see above).
grant execute on function public.invite_owner(text) to anon, authenticated;
