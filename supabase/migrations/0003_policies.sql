-- DESIGN §3.3: which rows a caller may see and write. What a column, a
-- constraint, a missing privilege or a unique index already enforces is in
-- 0001 and 0002, not here.
--
-- Two conventions, both from DESIGN §3.3:
--
-- * `(select auth.uid())`, never bare `auth.uid()`. The planner hoists the
--   subquery to an InitPlan and evaluates it once per statement instead of once
--   per row.
-- * No policy reads another table directly. Every cross-table predicate goes
--   through a `security definer stable` helper in `private`, so RLS never nests
--   and never recurses. Those helpers need no grant: a policy expression is not
--   a call the querying role has to be allowed to make, which is why
--   `authenticated` can be filtered by `private.is_friend` and still be refused
--   `select private.is_friend(...)` at the schema.


-- Friendship is symmetric by construction (the deferred trigger in 0001), so
-- one probe answers it.
create function private.is_friend(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_id = p_other and f.friend_id = (select auth.uid())
  );
$$;

-- The SENDER's half of a pending ask, and it expires. Either party to an ask
-- has to read the other's row — the recipient's inbox needs the sender's name
-- and the sender's outbox needs the recipient's — but the two directions are
-- not the same permission and must not share a helper.
--
-- One bidirectional probe would make a stale ask a standing read: A asks B
-- while B is findable, B turns the switch off, and A goes on reading B's whole
-- row, every later rename and every later photo with it.
--
-- So the sender reads the target's profile only while the target is still
-- searchable. The `searchable` join is the whole of what this adds over
-- `has_incoming_request_from`, which is the recipient's half and needs no such
-- condition — they have to read the sender to decide, and a sender was never
-- required to be findable in the first place (a handle is what you are found
-- BY, not what lets you find).
create function private.has_open_outgoing_request_to(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.connect_requests c
    join public.profiles p on p.id = c.to_id
    where c.from_id = (select auth.uid())
      and c.to_id = p_other
      and p.searchable
  );
$$;

-- The recipient's half, and it is also what authorizes the accept: the edge's
-- owner is the sender and the writer is the recipient, so a request you SENT
-- never authorizes you to write the recipient's edge. An either-direction
-- probe here would let anyone befriend themselves to a stranger by asking and
-- then accepting their own ask.
create function private.has_incoming_request_from(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.connect_requests c
    where c.from_id = p_other and c.to_id = (select auth.uid())
  );
$$;

-- Whether a person may be named by taste search right now: findable by handle
-- AND discoverable by taste (DESIGN §5.1). A missing prefs row is the default,
-- which is off.
--
-- A suggestion row outlives both switches — only the VIEWER's own
-- `refresh-suggestions` rewrites it — so every read a suggestion grants is
-- ANDed with this, and the read ends the moment the suggested person turns
-- either switch off rather than at the viewer's next search. Deleting the rows
-- instead would need a trigger on two tables and would still leave a race with
-- a search already running; a condition on the read has neither.
create function private.is_discoverable(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_prefs u on u.user_id = p.id
    where p.id = p_other and p.searchable and u.discoverable_by_taste
  );
$$;

-- At most five rows per viewer, and it is how a suggestion's name and handle
-- reach the screen: reading the row reveals strictly less than the suggestion
-- already does. It holds only while the suggested person is still
-- discoverable (see `is_discoverable`).
create function private.is_suggested_to_me(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.suggestions s
    where s.user_id = (select auth.uid()) and s.suggested_id = p_other
  ) and private.is_discoverable(p_other);
$$;

-- A request may only be sent along a route that is open, and being searchable
-- is the only route grapevine opens.
create function private.is_searchable(p_other uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.searchable from public.profiles p where p.id = p_other), false);
$$;

-- Whether the caller has a way back into the account. It reads committed state
-- rather than a token claim, which would be a snapshot of the account as of
-- the last token refresh.
--
-- With Google the only provider this is vacuous — minting an account costs a
-- Google account, and every signed-in session passes by construction. It stays
-- because the thing it guards against is a dashboard toggle rather than a code
-- path (DESIGN §3.3), and the body stays general — confirmed email OR confirmed
-- phone OR a Google identity, and never anonymous — so that an additive door is
-- correct on the day it is enabled rather than one forgotten edit later.
create function private.has_credential() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and u.is_anonymous = false
      and (u.email_confirmed_at is not null
           or u.phone_confirmed_at is not null
           or exists (select 1 from auth.identities i
                      where i.user_id = u.id and i.provider = 'google'))
  );
$$;


alter table public.profiles         enable row level security;
alter table public.friendships      enable row level security;
alter table public.connect_requests enable row level security;
alter table public.items            enable row level security;
alter table public.ratings          enable row level security;
alter table public.user_prefs       enable row level security;
alter table public.user_recs        enable row level security;
alter table public.user_model       enable row level security;
alter table public.suggestions      enable row level security;

-- `private.params` and `private.debug_events` carry no policies because they
-- carry no grants and live in a schema the API does not serve. RLS there would
-- suggest the policy was the thing holding them shut, when the address is.

-- Deliberately no `or searchable` disjunct. A policy that admits a row admits
-- every row it matches, so `or searchable` would also authorize
-- `select * from profiles where searchable` — every findable account and its
-- handle, a global aggregate DESIGN §4 says this app will not have. Reading a
-- searchable stranger by NAME lives instead inside `public.find_by_username`
-- and `public.profile_by_id` (0004), each taking an exact key and returning at
-- most one row.
--
-- No clause matches a stranger, so `select * from profiles` returns the
-- caller, their friends, their counterparties and their at-most-five
-- suggestions. Every disjunct is a live relationship, and none of them
-- survives the thing that created it — which is why the outgoing-ask clause is
-- the expiring one (see `has_open_outgoing_request_to`).
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_friend(id)
    or private.has_incoming_request_from(id)
    or private.has_open_outgoing_request_to(id)
    or private.is_suggested_to_me(id)
  );

-- Your own row only. Which columns, and what values, are 0001 and 0002's
-- business: the column grant, the unique handle and the CHECKs.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));


create policy friendships_select on public.friendships
  for select to authenticated
  using (user_id = (select auth.uid()) or friend_id = (select auth.uid()));

-- Two clauses. The first is your own edge. The second is the accept step: the
-- accepter writes the SENDER's edge, authorized by the pending request the
-- sender addressed to them — which is why the probe is directional (see
-- `has_incoming_request_from`).
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (friend_id = (select auth.uid()) and private.has_incoming_request_from(user_id))
  );

-- Either end may unfriend. Unfriending removes both rows, which the deferred
-- symmetry trigger then requires: one half alone cannot commit.
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (user_id = (select auth.uid()) or friend_id = (select auth.uid()));

create policy connect_requests_select on public.connect_requests
  for select to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- No UPDATE policy, because there is no UPDATE privilege: a re-ask is
-- `on conflict do nothing` over the same row.
create policy connect_requests_insert on public.connect_requests
  for insert to authenticated
  with check (from_id = (select auth.uid()) and private.is_searchable(to_id));

-- Decline and withdraw are the same delete either way.
create policy connect_requests_delete on public.connect_requests
  for delete to authenticated
  using (from_id = (select auth.uid()) or to_id = (select auth.uid()));

-- A shared catalog: everyone signed in sees that a thing exists.
create policy items_select on public.items
  for select to authenticated
  using (true);

-- Any signed-in user may add a name. Everything else about the row is a
-- column or a constraint: what an id may be is `private.is_normalized_id`, and
-- `created_at` and `created_by` are absent from the insert grant.
create policy items_insert on public.items
  for insert to authenticated
  with check (true);

-- Owner only. The values are CHECKs in 0001, one row at a time.
create policy ratings_own on public.ratings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy user_prefs_own on public.user_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Owner read only. There is no write policy because 0002 grants SELECT and
-- nothing else; the two Edge Functions write as `service_role`, which
-- bypasses RLS.
create policy user_recs_select on public.user_recs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A row naming somebody who has since switched off is invisible rather than
-- deleted: the viewer's next search rewrites the list, and until then the row
-- must not go on naming them (see `is_discoverable`).
create policy suggestions_select on public.suggestions
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_discoverable(suggested_id));

-- `public.user_model` has no policy, because 0002 gives `authenticated` no
-- verb on it at all — it is the server's row, for the reason stated there. RLS
-- stays enabled on it above: a table with row-level security on and no policy
-- admits nothing, which is the belt to that missing grant's braces and the
-- state a table added to this schema by mistake should be in.
