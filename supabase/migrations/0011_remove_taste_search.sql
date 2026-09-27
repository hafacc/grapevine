-- Taste search is gone, for now (DESIGN §1 item 5, §4): no suggestions, no
-- discoverability switch, and no connect requests, because after 0009 a
-- request could be sent only to somebody taste search named. A friend is made
-- by a link and by nothing else.
--
-- IRREVERSIBLE: this drops `suggestions`, `connect_requests` and `user_prefs`
-- with every row in them, and `user_model.suggestions_at`. Reviewed as that.
-- When this was written the live project had no real users — one test account
-- — so nothing anybody chose or was promised is lost. Bringing taste search
-- back is new tables in a new migration, not an undo of this one.

-- The client verbs that only existed for it.
drop function public.shared_attributes(uuid);
drop function public.accept_connect_request(uuid);
drop function public.dismiss_suggestion(uuid);

-- A profile is readable by its owner and by a friend, and nobody else: the
-- three other clauses were a pending ask either way and a suggestion. A link's
-- holder reads the owner's name and photo through `invite_owner`, not here.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_friend(id));

-- No client inserts a friendship any more. The own-edge clause alone could
-- never commit (the deferred symmetry trigger wants the other half, which only
-- the accept clause could write), and every friendship is now written by
-- `redeem_invite`, which runs as its owner. Unfriending keeps its DELETE.
drop policy friendships_insert on public.friendships;
revoke insert on public.friendships from authenticated;

-- Their policies, grants, the request's write-budget trigger and its place in
-- the Realtime publication go with them.
drop table public.suggestions;
drop table public.connect_requests;

drop function private.is_suggested_to_me(uuid);
drop function private.has_incoming_request_from(uuid);
drop function private.has_open_outgoing_request_to(uuid);
drop function private.is_discoverable(uuid);

-- `user_prefs` held the switch and the dismissals and nothing else. Its two
-- triggers go with it.
drop table public.user_prefs;
drop function private.forget_suggestions_search();

alter table public.user_model drop column suggestions_at;


-- 0010's, without the prefs row.
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

  return new;
end $$;

-- 0009's, without deleting a pending ask between the two.
create or replace function public.redeem_invite(p_token text) returns uuid
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

  return v_owner;
end $$;
