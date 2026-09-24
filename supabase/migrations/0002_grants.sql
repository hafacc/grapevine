-- DESIGN §3.3's column privileges and table privileges.
--
-- Read this file as the answer to "what may a client do at all?", before any
-- policy narrows it to "and to which rows?". A column absent from an insert
-- grant takes its DEFAULT and is therefore unforgeable: `created_at`,
-- `created_by`, `since`, `rated_at`. A column absent from a select grant is in
-- no response: `items.created_by`. A verb absent from a table grant is "no
-- update and no delete, for anyone".
--
-- The order is deliberate: revoke everything first, then name what comes back.
-- A grant that is not in this file does not exist.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- DESIGN §3.3: schema isolation. `private.neighbourhood` returns the raw
-- ratings of up to N_max people, and `private.params` is the one number in the
-- system not bounded by anybody's reach. Neither role may even name the schema,
-- so there is nothing here for a later `grant execute` to slip through: the
-- policy helpers in `private` are still reachable from inside a policy, because
-- a policy expression is not a call the querying role has to be allowed to
-- make.
revoke all on schema private from anon, authenticated, public;

-- Postgres grants EXECUTE on a NEW function to PUBLIC by default, which is the
-- hazard DESIGN §3.3 names: a client may call anything nobody revoked. These
-- two lines flip that for everything this project creates after them, so that
-- 0004's explicit grants are the whole list of what a client may call.
--
-- They are deliberately NOT schema-qualified, and that is the whole of why they
-- work. A schema-qualified default privilege is a DELTA, stored per (role,
-- schema) and added on top of the built-in default — and PUBLIC's EXECUTE lives
-- in that built-in default, not in the delta, so revoking it there removes
-- nothing and Postgres stores no row at all. The unqualified form edits the
-- base itself (`pg_default_acl` with `defaclnamespace = 0`), which is where
-- PUBLIC can be taken out of. Measured with `has_function_privilege` rather
-- than read off `proacl`, which is NULL exactly when a function is at the
-- built-in default and so makes the strictest-looking reading pass most
-- readily: with the qualified form, a function created in `public` after every
-- migration was executable by `anon`. The two forms compose rather than shadow,
-- so the unqualified pair covers `private` as well and stays correct if a later
-- migration sets a schema row.
alter default privileges                   revoke execute on routines from public;
alter default privileges for role postgres revoke execute on routines from public;

-- And the same hazard for tables. `revoke all on all tables` above is a
-- statement about the tables that existed when it ran; the platform installs
-- `alter default privileges in schema public grant all on tables to anon,
-- authenticated` (and the same for sequences and routines), so the NEXT table
-- anybody adds to `public` arrives with ALL granted to `authenticated` and this
-- file is not there to catch it. These six make "a client privilege exists only
-- because a migration wrote it down" a property of the database rather than of
-- the order the files happened to be written in. Both role spellings, because a
-- default privilege belongs to the role that set it, and that is `postgres` on
-- the platform and whoever ran the script locally.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines  from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on routines  from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

-- The two Edge Functions write as `service_role`, which bypasses RLS and is
-- the only role that may reach `private`. It is safe to give it the schema
-- because `private` is not in the API's exposed-schema list
-- (supabase/config.toml): there is no PostgREST route to any of this, only a
-- direct connection holding the service key.
grant usage on schema private to service_role;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant all on all sequences in schema public to service_role;
grant all on all sequences in schema private to service_role;

-- `anon` is a signed-out visitor, and there are no anonymous sessions, so a
-- first visit is signed out too. `anon` holds nothing at all, and that is the
-- whole of its configuration.

-- `searchable` is readable so that the owner's own Settings switch can show its
-- state; the policy in 0003 is what stops it being readable for a stranger, and
-- deliberately does NOT carry an `or searchable` disjunct (DESIGN §3.3).
grant select (id, username, display_name, photo_url, searchable, created_at)
  on public.profiles to authenticated;

-- No `username`: a handle is permanent and there is no verb to change or
-- release one. `public.claim_username` sets it, once. No INSERT either — the
-- row is created by the trigger on `auth.users` — and no DELETE for anyone.
grant update (display_name, photo_url, searchable) on public.profiles to authenticated;

-- `since` is the server's clock, so it is absent from the insert grant. No
-- UPDATE: an edge carries nothing that could change.
grant select, delete on public.friendships to authenticated;
grant insert (user_id, friend_id) on public.friendships to authenticated;

-- No UPDATE: a re-ask is `on conflict (from_id, to_id) do nothing`, so the
-- insert policy is the only check a request ever has to pass.
grant select, delete on public.connect_requests to authenticated;
grant insert (from_id, to_id) on public.connect_requests to authenticated;

-- `created_at` is unforgeable and `created_by` is unreadable, each by being
-- absent from one of these two lines. No UPDATE and no DELETE for anybody: a
-- name everyone in every network shares must not become something else after
-- the fact, and a delete would strand every rating pointing at the id.
-- Both columns are the client's to write, and that is deliberate: `search_id`
-- is `searchFold(id)`, and computing it here would put the stripping rule in
-- SQL as well as in `shared/` where the two can disagree (DESIGN §3.2). There
-- is no `name`, because the id is the name.
grant select (id, search_id) on public.items to authenticated;
grant insert (id, search_id) on public.items to authenticated;

-- `rated_at` is the server's clock, moved by a trigger when a thumb is turned
-- over. UPDATE is on `value` alone, so changing a thumb cannot silently
-- re-point it at another thing or another attribute. `private.ratings_changed`,
-- which every one of these three verbs writes through a trigger, gets no grant
-- here at all.
grant select, delete on public.ratings to authenticated;
grant insert (user_id, item_id, tag, value) on public.ratings to authenticated;
grant update (value) on public.ratings to authenticated;

-- No DELETE: nothing needs one, and a missing row reads as the defaults anyway.
grant select, insert, update on public.user_prefs to authenticated;

-- Read-only for the client, because only the server writes these. A planted
-- suggestion
-- would be a stranger presented as vouched for by the algorithm; a planted feed
-- entry would be the same thing without the name.
grant select on public.user_recs to authenticated;
grant select on public.suggestions to authenticated;

-- `public.user_model` is NOT here, and that is a decision rather than an
-- omission. It carries the per-node reach masses of the last walk, which say
-- how far each named person's corner of the graph agrees with this viewer —
-- exactly what DESIGN §4 keeps on the server, and no client has a use for it:
-- the stamp the feed screen watches is `user_recs.computed_at`, over Realtime
-- (0006), and the rest of this row is the Edge Functions' own bookkeeping. So
-- the row is the server's, like `private.params`, and the only readers are the
-- two Edge Functions and the pooling statement in 0005 — `service_role` or the
-- database's owner.
--
-- It is also why the bar's quantum is copied onto `user_recs.error` rather than
-- read from here: the viewer has to be able to see it, and this row is a row
-- they may not read a column of.

-- `private.debug_events` has no grant, to either role. The one write verb is
-- `public.record_debug_event` in 0004, and it takes the two fields a client may
-- supply and nothing else. Deliberately not a column INSERT grant: PostgREST
-- serves `public` and `graphql_public` only, so the client has no route to a
-- table in `private`, and opening one by adding `private` to the exposed-schema
-- list would put `neighbourhood` on an RPC endpoint guarded by nothing but an
-- EXECUTE grant.
