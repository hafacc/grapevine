-- DESIGN §3.2: the tables.
--
-- Grants are 0002, policies are 0003, the functions clients call are 0004.
-- This file creates structure only, so that what a client may *do* with any of
-- it is readable in one place instead of interleaved with the columns.

create schema if not exists private;

comment on schema private is
  'Anything no client may touch. Not in the API''s exposed-schema list '
  '(supabase/config.toml), so this is an address PostgREST does not serve '
  'rather than a policy that can be got wrong (DESIGN §3.3).';


-- DESIGN §3.2. An id is the text somebody typed, folded by `normalizeId` in
-- `shared/` — lower case, NFKC, one space between words, trimmed — and this is
-- the database's copy of what that folding may emit. `items.id`,
-- `ratings.item_id` and `ratings.tag` all wear it, which is why it is a
-- function rather than three constraints: an id and an attribute are the same
-- kind of thing, and a tag is this or the empty string.
--
-- An id is arbitrary Unicode and no pattern could enumerate what it may
-- contain, so the refusals are stated directly, and the database is the
-- AUTHORITY for all of them: `lower` here and `toLowerCase` on the client are
-- two implementations of one Unicode table and can disagree on a handful of
-- characters, and it is this that decides whether the row exists.
--
-- `is nfkc normalized` is what makes an id canonical — one byte sequence per
-- name — and is a predicate Postgres has, so nothing here approximates it.
--
-- The character class is five general categories: control, format, surrogate,
-- private-use and unassigned, plus the whitespace NFKC does not reduce to a
-- plain space. Two exceptions are deliberate: U+200C and U+200D (ZWNJ, ZWJ),
-- which Persian and several Indic scripts need to spell ordinary words and
-- which emoji sequences are built from. The bidirectional overrides are in it
-- by being format characters, and they are the reason the class is not
-- `[[:cntrl:]]`: one of those in a name reverses the rest of the row it is
-- drawn in, and `[[:cntrl:]]` does not carry them.
--
-- Two of the five are approximations. Surrogates cannot be listed because
-- Postgres cannot hold one: a lone surrogate is not valid UTF-8, so the server
-- refuses the byte sequence before any constraint sees it. And `Cn` is
-- unassigned code points, which is a table per Unicode version rather than a
-- list of ranges — so what is refused here is the noncharacters and the planes
-- with nothing assigned in them at all. A code point assigned in a later
-- Unicode version than the one that classified an existing block is not caught,
-- which is a name no font draws rather than anything a walk can be hurt by.
create function private.is_normalized_id(candidate text) returns boolean
  language sql immutable set search_path = ''
as $$
  select candidate is not null
     and char_length(candidate) between 1 and 128
     and candidate is nfkc normalized
     and candidate = lower(candidate)
     and candidate = btrim(candidate)
     and candidate !~ '\s\s'
     and candidate !~
       -- Cc, and the whitespace NFKC leaves as something other than one space.
       ('[\U00000000-\U0000001F\U0000007F-\U0000009F'
        '\U000000A0\U00001680\U00002000-\U0000200A\U00002028\U00002029'
        '\U0000202F\U0000205F\U00003000'
       -- Cf, minus ZWNJ and ZWJ.
        '\U000000AD\U00000600-\U00000605\U0000061C\U000006DD\U0000070F'
        '\U00000890-\U00000891\U000008E2\U0000180E'
        '\U0000200B\U0000200E-\U0000200F\U0000202A-\U0000202E'
        '\U00002060-\U00002064\U00002066-\U0000206F\U0000FEFF'
        '\U0000FFF9-\U0000FFFB\U000110BD\U000110CD\U00013430-\U0001343F'
        '\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A'
        '\U000E0001\U000E0020-\U000E007F'
       -- Co.
        '\U0000E000-\U0000F8FF\U000F0000-\U000FFFFD\U00100000-\U0010FFFD'
       -- Noncharacters, and the planes with nothing assigned in them.
        '\U0000FDD0-\U0000FDEF\U0000FFFE-\U0000FFFF\U0001FFFE-\U0001FFFF'
        '\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U00040000-\U000DFFFF'
        '\U000EFFFE-\U000EFFFF\U0010FFFE-\U0010FFFF]')
$$;


-- There is no column for an email address or a phone number, deliberately: a
-- contact detail exists in exactly one place, the auth account, in a schema
-- the API does not serve, and a column here is somewhere one could be written.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  -- Permanent: 0002 grants no UPDATE on this column, so there is no verb to
  -- change or release a handle. `public.claim_username` sets it exactly once.
  username      text unique
                  check (username ~ '^[a-z][a-z0-9_]{2,19}$'
                         and username <> all (array['admin', 'grapevine', 'support',
                                                    'help', 'root', 'system',
                                                    'about', 'settings'])),
  display_name  text not null default '' check (char_length(display_name) <= 50),
  photo_url     text check (char_length(photo_url) <= 2000),
  searchable    boolean not null default false,
  created_at    timestamptz not null default now(),
  -- You cannot be findable with nothing to be found by.
  constraint profiles_searchable_needs_handle check (not searchable or username is not null)
);


-- No name copied onto an edge: a friend can read your profile (0003), so
-- there is one copy of your name and nothing to keep in step on a rename.
--
-- Both directions are stored, because `friends(u)` must be one index probe and
-- `private.is_friend` is on the hot path of every profile read.
create table public.friendships (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  since      timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_not_self check (user_id <> friend_id)
);

-- The reverse probe, and what makes the cascade delete of a profile cheap.
create index friendships_friend_id_idx on public.friendships (friend_id);


-- The composite key is "exactly one pending ask per pair", and re-asking is
-- `on conflict do nothing` over the same row. No name fields: a pending
-- request in either direction is itself a read clause on `profiles` (0003), so
-- each party reads the other's real row.
create table public.connect_requests (
  from_id     uuid not null references public.profiles (id) on delete cascade,
  to_id       uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (from_id, to_id),
  constraint connect_requests_not_self check (from_id <> to_id)
);

-- The inbox.
create index connect_requests_to_idx on public.connect_requests (to_id);


-- The id IS the name (DESIGN §3.2): `normalizeId` in `shared/` folds what
-- somebody typed and this row stores the answer, so `Café Bleu` and
-- `café  bleu` are one row, there is no second key to keep in step, and there
-- is no display name — the id is what every screen draws.
create table public.items (
  id          text primary key check (private.is_normalized_id(id)),
  -- The id with its accents and its punctuation stripped off — `cafe bleu` for
  -- `café bleu` — which is what the catalog's search matches against, so that
  -- typing the unaccented name finds the thing instead of offering to add it a
  -- second time and splitting the catalog.
  --
  -- **The CLIENT writes it, from `searchFold` in `shared/`, and no SQL strips
  -- anything.** A trigger computing it would put the stripping rule in SQL as
  -- well as in TypeScript, and two implementations that disagree make a row
  -- nobody can find by its own name; it could not be a generated column either,
  -- because accent-stripping is not IMMUTABLE. There is therefore no CHECK
  -- tying the two columns together and there cannot be one — what holds them in
  -- step is `web/scripts/search-id-check.ts`, which reads every row and
  -- asserts `search_id = searchFold(id)` using that one implementation. What a
  -- lying client gains is a thing that surfaces under a name it does not have,
  -- which naming it misleadingly already allows, and the result renders the
  -- real id anyway (DESIGN §3.2).
  search_id   text not null check (char_length(search_id) <= 128),
  created_at  timestamptz not null default now(),
  -- Not in the insert grant, so a client cannot name anyone but itself; not in
  -- the select grant, so creation stays unattributed everywhere a reader can
  -- look.
  --
  -- Nullable, and `on delete set null`, because the row has to outlive its
  -- creator. Every other reference to a person cascades from `auth.users` — the
  -- profile goes, and with it the friendships, the requests, the ratings, the
  -- feed, the model row and the suggestions — and this is the one that must
  -- not. The catalog is shared and permanent: there is no UPDATE and no DELETE
  -- grant on `items` for anyone, `/privacy/` says a name can never be changed
  -- or removed, and every rating in every network points at the id. A cascade
  -- would take the thing away with the account that first named it, and `no
  -- action` (what no `on delete` clause means) would make deleting anyone who
  -- had ever added a thing raise a foreign-key violation and leave the account
  -- in place, breaking `/privacy/`'s promise of deletion.
  --
  -- Null therefore means "added by a deleted account". It is also what a
  -- bulk load outside a request writes if it forgets to say, because
  -- `auth.uid()` is null there, which is why `web/scripts/seed-local.ts`
  -- supplies the creator explicitly.
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null
);

-- The catalog's search is `where id like $1 || '%'`. The database collation is
-- not `C`, so without `text_pattern_ops` that range is a sequential scan which
-- looks fine at a hundred items and stops looking fine at a hundred thousand.
-- The primary key's index carries the literal prefix, what somebody typed; the
-- second carries the stripped one.
create index items_id_prefix_idx on public.items (id text_pattern_ops);
create index items_search_id_prefix_idx on public.items (search_id text_pattern_ops);


-- One row per thumb. The row constraints reject both a bad value and a key the
-- folding could not have produced. The sanitizers on both sides of the wasm
-- boundary still check the same things, because they are what protects a walk
-- from a schema that changes.
create table public.ratings (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- The thumb is keyed by COLUMNS (DESIGN §3.2), not by one text key that
  -- joins the two, and each half carries the id rule on its own.
  --
  -- `tag` is NOT NULL, with the empty string meaning the thing itself and a
  -- real tag meaning one of its attributes — so `''` and `'coffee'` are two
  -- rows for one item and the key refuses a second thumb on either. Null would
  -- have made the key useless: a primary key over a nullable column cannot be,
  -- and `null <> null` would have admitted a second thumb on the thing itself.
  --
  -- Inside the core the two halves want one map key, and they join there
  -- with a NUL — which Postgres text cannot hold at all, so no name anybody can
  -- type can forge that join. It is never stored, never queried and never
  -- shown.
  item_id     text not null check (private.is_normalized_id(item_id)),
  tag         text not null default ''
                check (tag = '' or private.is_normalized_id(tag)),
  value       smallint not null check (value in (1, -1)),
  -- Written from the first day because history cannot be backfilled, and read
  -- by nothing. DESIGN §3.2: nothing in the UI surfaces it, and surfacing it is
  -- a later change with its own decision. It is the time the thumb was GIVEN,
  -- so turning one over moves it (`private.stamp_rating_flip` below).
  rated_at    timestamptz not null default now(),
  primary key (user_id, item_id, tag)
);

-- Per viewer, when anything their feed is made of last changed: what the
-- staleness check compares against `user_model.checked_at`.
--
-- Deliberately not `max(rated_at)`: a flip is an UPDATE and a clear is a
-- DELETE, and neither moves the maximum of the rows that are left, so a viewer
-- who turned a thumb over or took one back would keep the feed that counted it
-- until the ten-minute window ran out. A deleted row cannot carry the time it
-- was deleted, so the stamp lives beside the rows rather than on them, written
-- by a trigger on every insert, flip and clear.
--
-- In `private` and granted to nobody but `service_role`: it is a per-person
-- activity clock, and no client has a reason to read one.
create table private.ratings_changed (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  changed_at  timestamptz not null
);

-- SECURITY DEFINER because the writer is a client deleting its own thumb, and
-- no client role has any privilege in `private`. The write is guarded on the
-- profile still existing: when an account is deleted its ratings go by cascade
-- after the profile row, and an unguarded upsert would then fail this table's
-- own foreign key and refuse the deletion.
create function private.stamp_ratings_changed() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into private.ratings_changed (user_id, changed_at)
  select p.id, now() from public.profiles p
  where p.id = coalesce(new.user_id, old.user_id)
  on conflict (user_id) do update set changed_at = excluded.changed_at;
  return null;
end $$;

create trigger ratings_changed_on_write
  after insert or delete on public.ratings
  for each row execute function private.stamp_ratings_changed();

-- Only a real flip. Writing the value a thumb already has changes nothing a
-- walk would read, and stamping it would buy a walk for nothing.
create trigger ratings_changed_on_flip
  after update of value on public.ratings
  for each row when (old.value is distinct from new.value)
  execute function private.stamp_ratings_changed();

-- A friend gained or lost changes the walk as surely as a thumb does. Without
-- this a new friend's thumbs would reach the feed only on the ten-minute
-- window, and an unfriended one's would stay in it that long. Both directions
-- are rows, so each end stamps its own clock; the guard on the profile is what
-- lets an account's deletion take its edges.
create trigger ratings_changed_on_friendship
  after insert or delete on public.friendships
  for each row execute function private.stamp_ratings_changed();

-- Not SECURITY DEFINER: it touches nothing but the row being written. A client
-- holds no UPDATE on `rated_at`, and does not need one — the column privilege
-- is checked against the statement's own SET list, before this runs.
create function private.stamp_rating_flip() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.rated_at := now();
  return new;
end $$;

create trigger ratings_flip_moves_rated_at
  before update of value on public.ratings
  for each row when (old.value is distinct from new.value)
  execute function private.stamp_rating_flip();


-- A missing row reads as the defaults everywhere.
create table public.user_prefs (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  -- DESIGN §5.1: default OFF, and on is one tap. Taste search is the one
  -- channel that names you to somebody you have no edge to.
  discoverable_by_taste  boolean not null default false,
  dismissed_suggestions  uuid[] not null default '{}'
                           check (cardinality(dismissed_suggestions) <= 500)
);


-- One row per viewer, written in one statement, so a reader never sees a moved
-- stamp beside a stale feed. The jsonb is TOASTed out of line, so a scan of
-- this table for any other purpose does not read the feed.
create table public.user_recs (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  computed_at  timestamptz not null,
  -- [{ itemId, score, conf, tags }], sorted by itemId. No name: the id is what
  -- a screen draws (DESIGN §3.2).
  entries      jsonb not null,
  -- `feedSignature` over the whole feed, rounded. What stops a recompute that
  -- landed on the same answer from moving `computed_at` and making every open
  -- tab re-read a feed that says the same thing (DESIGN §3.4).
  feed_hash    text not null,
  -- The step the bar's fill moves in (DESIGN §1 "The bar", §3.2): the feed on
  -- this row was computed to within this much, so a difference smaller than it
  -- is a difference the walk cannot support and must not be drawn.
  --
  -- It is on the row the VIEWER may read, and `user_model` — which carries both
  -- halves of it — has no client verb of any kind, so a bar quantizing itself
  -- to a bound it cannot see is the alternative. It is deliberately not named
  -- `truncation`: it is `max(truncation·L, settle_movement)`, either half can
  -- be the larger, and a column named for one while holding the maximum of both
  -- is a trap.
  error        real not null check (error >= 0)
);


-- The two Edge Functions' own bookkeeping, with no client verb (0002).
create table public.user_model (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  -- Two stamps, not one: `checked_at` moving is what buys the next ten-minute
  -- window and is written by a walk that found nothing new; `computed_at`
  -- moving is the client's signal that the feed changed.
  computed_at    timestamptz,
  checked_at     timestamptz,
  -- When taste search last ran for this person (DESIGN §5.1): the stamp
  -- `refresh-suggestions` keys its ten-minute window on. It lives beside the
  -- rows rather than being read off them, because a viewer with nobody to
  -- suggest writes no row, and "written empty" and "never run" are not the same
  -- answer.
  suggestions_at timestamptz,
  nodes_touched  int,
  rating_count   int,
  -- Unrounded. A rescore over the
  -- cached masses is handed this number back and carries it through, so a
  -- rounding here would be the cache reporting an accuracy no walk paid for.
  truncation     real,
  -- Mass the walk sent to people nobody loaded, after the boundary rounds.
  -- Reporting only: accuracy is promised relative to the nearest `N_max`
  -- people, so this is never counted against `ε_total` (DESIGN §2.4). A rescore
  -- carries it through with `truncation`.
  boundary_residual real,
  -- The largest movement of any score in the settling loop's last pass, the
  -- pass count, and whether the loop stopped on the tolerance rather than the
  -- cap (DESIGN §2.2). Reaching the cap is not an error: it makes the bar
  -- coarser and nothing else, which is why `settled` is recorded rather than
  -- acted on.
  settle_movement real,
  passes          int,
  settled         boolean,
  recomputed     boolean,
  -- The `private.params` stamp this feed was computed under, or null for DESIGN
  -- §2.8's table: a feed and the numbers behind it are one answer.
  priors_at      timestamptz,
  -- `π̃` per reached person from the last FULL walk, at most `N_max` entries,
  -- beside a hash of the adjacency that walk ran on: the sorted friend list of
  -- every loaded node. A recompute hashes what it just loaded and reuses these
  -- masses when the two agree, which needs no trigger and no change feed
  -- because the recompute reads the neighbourhood anyway (DESIGN §3.4). A walk
  -- that took a boundary round hashes the larger set it ended on, so the next
  -- call's hash of the plain neighbourhood differs and it walks in full — which
  -- is what keeps a reuse over exactly the graph that was walked.
  --
  -- `reach_reuses` counts consecutive reuses. It is a belt and not a bound:
  -- `REACH_REUSE_MAX` forces a full walk so a long-lived cache cannot drift
  -- unexamined.
  reach          jsonb,
  reach_hash     text,
  reach_reuses   int not null default 0,
  -- DESIGN §2.10's per-viewer tallies, over the pairs this recompute already
  -- worked an alignment out for, by distance class: count, sum and sum of
  -- squares of the agreement rate `A/(A+D)`, and `Σ(A+D)` — which `κ`'s moment
  -- equation needs for the mean overlap `n̄` and which a count, a sum and a sum
  -- of squares cannot supply. A statement in 0005 pools them into
  -- `private.params`, so no job has to read the whole graph to recompute what
  -- every recompute already holds.
  --
  -- Counts and sums, because those are what a mean and a variance need and
  -- because they ADD — which is the only reason a per-viewer report can stand
  -- in for a sweep of the population.
  pair_n_d1       bigint,
  pair_sum_d1     double precision,
  pair_sumsq_d1   double precision,
  pair_overlap_d1 double precision,
  pair_n_d2       bigint,
  pair_sum_d2     double precision,
  pair_sumsq_d2   double precision,
  pair_overlap_d2 double precision,
  pair_n_d3       bigint,
  pair_sum_d3     double precision,
  pair_sumsq_d3   double precision,
  pair_overlap_d3 double precision
);

-- Moving the suggestions switch is a new question, so the ten-minute window
-- `suggestions_at` keys must not answer it with the list the old setting
-- wrote: switched on, that list is the empty one an off switch writes, and it
-- said "nobody with similar taste yet" before anybody had looked. Forgetting
-- the stamp in the same statement as the switch makes the next search run.
--
-- SECURITY DEFINER because the writer is the owner flipping their own switch
-- and `user_model` has no client verb of any kind.
create function private.forget_suggestions_search() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  update public.user_model set suggestions_at = null
   where user_id = new.user_id;
  return null;
end $$;

create trigger forget_suggestions_search_on_insert
  after insert on public.user_prefs
  for each row execute function private.forget_suggestions_search();

create trigger forget_suggestions_search_on_switch
  after update of discoverable_by_taste on public.user_prefs
  for each row
  when (old.discoverable_by_taste is distinct from new.discoverable_by_taste)
  execute function private.forget_suggestions_search();


-- A suggestion is a name and an order, and nothing else. No name or handle is
-- copied here: anyone in your own suggestions list is readable by you (0003),
-- which is scoped to at most five rows and reveals strictly less than the
-- suggestion already does.
--
-- Deliberately no level of alignment on the row: "lots in common" is not a
-- reason to accept a stranger. The words a row shows are the attributes the
-- two of you agree on against the grain, computed on request by
-- `public.shared_attributes` and stored nowhere (DESIGN §5.1), so no number
-- about alignment leaves the server.
create table public.suggestions (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  rank          smallint not null check (rank between 1 and 5),
  suggested_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (user_id, rank),
  -- Also the probe `private.is_suggested_to_me` uses.
  unique (user_id, suggested_id)
);


-- The population's priors (DESIGN §2.10). No client may read or write it:
-- reading it would say how much the people on this instance agree with their
-- friends and with strangers, which is an aggregate nobody is shown anywhere
-- else; writing it would move the prior behind every viewer's feed at once.
--
-- Columns rather than one nested object, because the pooling statement (0005)
-- writes them one at a time under a per-class guard. Every field is
-- separately nullable, so the core merges it into DESIGN §2.8's table field by
-- field and a missing or partial row can only fail to move a number.
--
-- Deliberately no prior for a learned per-edge trust: there is no learned edge
-- trust, and so nothing for one to be a prior on.
create table private.params (
  id           boolean primary key default true check (id),  -- exactly one row
  computed_at  timestamptz not null default now(),
  kappa        double precision,
  a0_d1        double precision,
  a0_d2        double precision,
  a0_d3plus    double precision,
  samples      jsonb not null default '{}'::jsonb
);


-- Write-only diagnostics; nothing reads one back. A client writes only `kind`
-- and `detail`, through `public.record_debug_event` (0004), so `user_id`, `at`
-- and `expires` cannot be forged. A CHECK could not bound them: `now()` is
-- STABLE, not IMMUTABLE, and Postgres refuses it in a check constraint.
create table private.debug_events (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid(),
  kind     text not null check (char_length(kind) <= 40),
  detail   text not null check (char_length(detail) <= 2000),
  at       timestamptz not null default now(),
  expires  timestamptz not null default now() + interval '7 days'
);

-- For the TTL sweep in 0005.
create index debug_events_expires_idx on private.debug_events (expires);


-- Every write a client can make that adds to what the server stores — a thumb
-- given or turned over, an item named, a connect request sent, a diagnostics
-- event — draws on one budget per account per UTC day. The client cannot be
-- the thing holding it to that: a crafted client is exactly the case a budget
-- exists for, and every one of these tables is written straight through
-- PostgREST. Deletes draw nothing, because they shrink what is stored.
--
-- A connect request is on the list for what it sends rather than what it
-- stores: every insert is a Realtime event at its target, so sending and
-- withdrawing one in a loop would otherwise ping somebody without limit.
--
-- The one place the number lives. The pgTAP suite reads it from here rather
-- than repeating it.
create function private.daily_write_limit() returns integer
  language sql immutable set search_path = ''
as $$ select 1024 $$;

-- One row per account per day, incremented by the trigger below and deleted
-- the next night by 0005's sweep. In `private` with no client grant, so how
-- much somebody wrote today is readable by nobody but the service role.
create table private.write_budget (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  writes   integer not null,
  primary key (user_id, day)
);

-- SECURITY DEFINER because the writer is a client and the counter is in a
-- schema no client role can reach. Keyed on `auth.uid()`, the caller, not on
-- the row: that is who is spending. A connection with no request identity —
-- either Edge Function as `service_role`, a migration, the local seed
-- — has no `auth.uid()` and is not counted; none of those write these tables
-- on anyone's behalf.
--
-- BEFORE, so a refused write never reaches the table, and the increment is
-- part of the same statement, so the refusal rolls it back: an account at its
-- budget stays at it rather than climbing with every refused attempt. An
-- insert that goes on to collide (the client's insert-then-update for a thumb
-- it already gave, an item somebody else named first) is rolled back the same
-- way, or counted once when `on conflict do nothing` swallows it.
--
-- `PT429` because PostgREST turns a `PTxxx` state into that HTTP status and
-- passes the code through, which is what `isDailyLimit` in
-- `web/utils/supabase.ts` keys on.
create function private.count_write() returns trigger
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

create trigger ratings_count_write
  before insert or update on public.ratings
  for each row execute function private.count_write();

create trigger items_count_write
  before insert on public.items
  for each row execute function private.count_write();

create trigger debug_events_count_write
  before insert on private.debug_events
  for each row execute function private.count_write();

create trigger connect_requests_count_write
  before insert on public.connect_requests
  for each row execute function private.count_write();


-- A friendship exists on both sides or on neither, checked at commit. Deferred
-- because an accept inserts the two rows as two statements, and either order
-- is momentarily one-sided. The core still checks reciprocity itself, as
-- defence in depth.
--
-- SECURITY DEFINER because the check must see both rows: a constraint trigger
-- otherwise runs as the caller, whose RLS policy on `friendships` filters the
-- select to edges they are party to, and the trigger would then report a
-- perfectly good pair as one-sided.
create function private.assert_symmetric() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user   uuid := coalesce(new.user_id, old.user_id);
  v_friend uuid := coalesce(new.friend_id, old.friend_id);
  v_forward boolean;
  v_back    boolean;
begin
  select exists (select 1 from public.friendships f
                 where f.user_id = v_user and f.friend_id = v_friend),
         exists (select 1 from public.friendships f
                 where f.user_id = v_friend and f.friend_id = v_user)
    into v_forward, v_back;

  if v_forward <> v_back then
    raise exception 'a friendship must exist on both sides or on neither (% / %)',
      v_user, v_friend
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger friendships_symmetric
  after insert or delete on public.friendships
  deferrable initially deferred
  for each row execute function private.assert_symmetric();


-- Google returns `full_name`, `name` and `avatar_url` in the identity's
-- metadata, so a profile exists, named and with a photo, in the same
-- transaction that creates the auth user: a signed-in user never has a missing
-- profile.
--
-- A Google account can carry no name at all — `display_name` is then '' and
-- the client's name gate asks — which is why the coalesce ends in '' rather
-- than refusing the insert.
create function private.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, photo_url)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''),
                  nullif(new.raw_user_meta_data ->> 'name', ''),
                  ''), 50),
    -- `photos.ts`'s lh3.googleusercontent.com allowlist is what decides whether
    -- this is ever rendered; storing it verbatim keeps that one decision in one
    -- place.
    left(nullif(new.raw_user_meta_data ->> 'avatar_url', ''), 2000)
  )
  on conflict (id) do nothing;

  -- So that "missing prefs" stops happening for a new account. A missing row
  -- still reads as the defaults everywhere, which is what a row written before
  -- this trigger existed needs.
  insert into public.user_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
