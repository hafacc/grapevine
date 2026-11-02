-- The whole schema: tables, privileges, policies and the functions a client
-- calls. The allow-list for names is the next file, because it is generated;
-- the scheduled statements and the Realtime publication follow it.
--
-- A viewer's list is computed in the browser, from the viewer's own thumbs and
-- the thumbs of the accounts they follow. So the database's whole job is to
-- store thumbs and to decide who may read whose: nothing here computes
-- anything about a person, and nothing a server computed is stored.
--
-- Access is three mechanisms, reached for in this order. A column privilege:
-- the client cannot write this field, so it takes its default and cannot be
-- forged. A table privilege: nobody has this verb at all. A policy: which rows
-- this caller may see. A privilege cannot be got wrong by a later policy, and a
-- table in schema `private` cannot be reached at all.
--
-- Two conventions in every policy:
--
-- * `(select auth.uid())`, never bare `auth.uid()`. The planner hoists the
--   subquery to an InitPlan and evaluates it once per statement instead of once
--   per row.
-- * No policy reads another table directly. A cross-table predicate goes
--   through a `security definer stable` helper in `private`, so row-level
--   security never nests and never recurses.

create schema if not exists private;

comment on schema private is
  'Anything no client may touch. Not in the API''s exposed-schema list '
  '(supabase/config.toml), so this is an address PostgREST does not serve '
  'rather than a policy that can be got wrong.';

revoke all on schema private from anon, authenticated, public;
grant usage on schema private to service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Postgres grants EXECUTE on a NEW function to PUBLIC by default, so a client
-- may call anything nobody revoked. These two lines flip that for everything
-- created after them, which is why they come before the first function.
--
-- They are deliberately NOT schema-qualified. A schema-qualified default
-- privilege is a delta added on top of the built-in default, and PUBLIC's
-- EXECUTE lives in the built-in default, so revoking it there removes nothing
-- and Postgres stores no row at all. The unqualified form edits the base
-- itself, which is where PUBLIC can be taken out of. Measured with
-- `has_function_privilege` rather than read off `proacl`, which is NULL exactly
-- when a function is at the built-in default: with the qualified form, a
-- function created in `public` after every migration was executable by `anon`.
alter default privileges                   revoke execute on routines from public;
alter default privileges for role postgres revoke execute on routines from public;

-- The same hazard for tables. The platform installs `alter default privileges
-- in schema public grant all on tables to anon, authenticated` (and the same
-- for sequences and routines), so a table added to `public` arrives with ALL
-- granted to `authenticated`. These make "a client privilege exists only
-- because a migration wrote it down" a property of the database. Both role
-- spellings, because a default privilege belongs to the role that set it:
-- `postgres` on the platform, whoever ran the script locally.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines  from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on routines  from anon, authenticated;


-- An id is the text somebody typed, folded by `normalizeId` in `shared/`:
-- lower case, NFKC, one space between words, trimmed. `items.id`,
-- `ratings.item_id`, `ratings.tag` and the report and removal tables all wear
-- it, which is why it is a function rather than a constraint on each: a thing
-- and an attribute are the same kind of name.
--
-- This is the shape alone. Which characters a name may hold is an allow-list
-- generated from Unicode's data, and the next migration replaces this function
-- with the one that carries it; the tables are created against this one
-- because a CHECK needs its function to exist.
--
-- The database is the authority: `lower` here and `toLowerCase` on the client
-- are two implementations of one Unicode table and can disagree on a handful
-- of characters, and it is this that decides whether the row exists.
create function private.is_normalized_id(candidate text) returns boolean
  language sql immutable set search_path = ''
as $$
  select candidate is not null
     and char_length(candidate) between 1 and 128
     and candidate is nfkc normalized
     and candidate = lower(candidate)
     and candidate = btrim(candidate)
     and candidate !~ '\s\s'
$$;


-- A person, or a prefilled account: one the owner made to hold a notable
-- critic's or source's taste, which anyone signed in may follow.
--
-- `id` is not a foreign key to `auth.users`, because a prefilled account has
-- no sign-in at all. A person's row is created by the trigger on `auth.users`
-- below with that account's id, and removed by the one beside it; everything
-- else about a person hangs off this row by `on delete cascade`.
--
-- There is no column for an email address or a phone number, deliberately: a
-- contact detail exists in exactly one place, the auth account, in a schema
-- the API does not serve, and a column here is somewhere one could be written.
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  -- The only thing that says who a person is, and anyone may type anything
  -- into it. It refuses what would make one name pass for another or break
  -- the line it is drawn in: control characters, the line and paragraph
  -- separators, the bidirectional marks and overrides (one of which reverses
  -- the rest of the line), and the characters that draw as nothing (soft
  -- hyphen, zero-width space, word joiner, byte-order mark), with which two
  -- names that look the same are different strings. ZWNJ and ZWJ stay: Persian
  -- and the Indic scripts spell ordinary names with them.
  --
  -- No default, and never blank: every screen that names a person draws this,
  -- and an empty row in a list of followers is somebody nobody can tell apart.
  display_name  text not null
                  check (char_length(display_name) <= 50)
                  constraint profiles_display_name_plain check (
                    display_name !~ ('[\U00000000-\U0000001F\U0000007F-\U0000009F'
                                     '\U000000AD\U0000061C\U0000200B\U0000200E\U0000200F'
                                     '\U00002028-\U0000202E\U00002060'
                                     '\U00002066-\U00002069\U0000FEFF]'))
                  constraint profiles_display_name_not_blank check (
                    btrim(display_name) <> ''),
  -- A link's holder is shown this before signing in (`invite_owner`), so it is
  -- a URL a stranger's browser is handed. `https` only: anything else is a
  -- script or a request in the clear, and the client's allowlist of photo
  -- hosts should not be the only thing between `javascript:` and an `<img>`.
  photo_url     text check (char_length(photo_url) <= 2000)
                  constraint profiles_photo_url_https check (
                    photo_url is null or photo_url ~ '^https://'),
  created_at    timestamptz not null default now(),
  prefilled     boolean not null default false,
  -- What a prefilled account is loaded by, so loading one twice is the same
  -- account. A person has none: nobody is found by typing anything.
  handle        text unique check (handle ~ '^[a-z0-9][a-z0-9_.]{1,30}$'),
  constraint profiles_handle_iff_prefilled check (prefilled = (handle is not null))
);

-- Following is one-way: the follower reads the followed account's thumbs, and
-- the followed account learns only that it has a follower. No name is copied
-- onto the row, since either end can read the other's profile, so a rename is
-- one update of one row.
create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  followed_id  uuid not null references public.profiles (id) on delete cascade,
  since        timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follows_not_self check (follower_id <> followed_id)
);

-- "Who follows me", and what makes the cascade from a deleted profile cheap.
create index follows_followed_id_idx on public.follows (followed_id);

-- The id IS the name: `normalizeId` folds what somebody typed and this row
-- stores the answer, so `Café Bleu` and `café  bleu` are one row, there is no
-- second key to keep in step, and the id is what every screen draws.
create table public.items (
  id          text primary key check (private.is_normalized_id(id)),
  -- The id with its accents and punctuation stripped, which is what search
  -- matches, so that typing the unaccented name finds the thing instead of
  -- offering to add it a second time.
  --
  -- The CLIENT writes it, from `searchFold` in `shared/`, and no SQL strips
  -- anything. A trigger computing it would be a second implementation of the
  -- stripping, and two that disagree make a row nobody can find by its own
  -- name; it could not be a generated column either, because accent-stripping
  -- is not IMMUTABLE. What a lying client gains is a thing that surfaces under
  -- a name it does not have, which naming it misleadingly already allows.
  search_id   text not null check (char_length(search_id) <= 128),
  created_at  timestamptz not null default now(),
  -- Not in the insert grant, so a client cannot name anyone but itself; not in
  -- the select grant, so creation stays unattributed.
  --
  -- `on delete set null`, and the one person reference that does not cascade:
  -- the catalog is shared, and a cascade would take a thing away with the
  -- account that first named it, while `no action` would make deleting anyone
  -- who had ever added a thing fail.
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null
);

-- Search is `where id like $1 || '%'`. The database collation is not `C`, so
-- without `text_pattern_ops` that is a sequential scan. The first carries what
-- somebody typed, the second the stripped copy.
create index items_id_prefix_idx on public.items (id text_pattern_ops);
create index items_search_id_prefix_idx on public.items (search_id text_pattern_ops);

-- Deleting an account sets `created_by` null on every item it named, and
-- without an index that is a scan of the whole catalog. Partial, because a
-- null is never looked up.
create index items_created_by_idx on public.items (created_by)
  where created_by is not null;

-- One row per thumb, keyed by COLUMNS rather than one text key joining the
-- two. `tag` is NOT NULL, with the empty string meaning the thing itself: a
-- primary key over a nullable column cannot be, and `null <> null` would have
-- admitted a second thumb on the thing.
--
-- `item_id` is not a foreign key: a thumb can name a thing nobody created a
-- catalog row for, and it has been through the same rules either way.
create table public.ratings (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  item_id   text not null check (private.is_normalized_id(item_id)),
  tag       text not null default ''
              check (tag = '' or private.is_normalized_id(tag)),
  value     smallint not null check (value in (1, -1)),
  -- When the thumb was first given, on the server's clock. No client can
  -- write it, and none can read it: a follower reading when somebody rated
  -- each thing would have a record of that person's days. Nothing in the
  -- database reads it either. It is kept because history cannot be
  -- backfilled, and `/privacy/` says a rating is stored with when.
  rated_at  timestamptz not null default now(),
  -- The account's revision when this thumb was last written: what lets a
  -- follower who holds the account as of one revision ask for only what
  -- changed since (`account_thumbs_since`). Set by a trigger, for every
  -- writer, and readable by no client: it counts an account's changes, which
  -- is nobody's to watch.
  revision  bigint not null,
  primary key (user_id, item_id, tag)
);

-- A person's link: at most one, with no expiry and no limit on
-- uses. Whoever holds the token can see the owner's name and photo and follow
-- them, so it is a bearer secret; what bounds it is that the owner can turn it
-- off, or replace it so the old one stops working, whenever they like.
--
-- The token is stored as itself, not hashed, because the owner has to be able
-- to copy their link again. What that gives up against a hash is a copy of the
-- database being a copy of everyone's links, and whoever holds the database
-- holds the thumbs a link would open anyway.
create table public.invite_links (
  owner_id    uuid primary key references public.profiles (id) on delete cascade,
  -- 32 random bytes as unpadded base64url: the shape `set_invite_link` makes,
  -- so a row can hold nothing guessable.
  token       text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at  timestamptz not null default now()
);

-- One report per person per name, and nothing but the name: no reason and no
-- free text, which would be a second channel of user-written text to moderate,
-- and no reference to `items`, because a name on screen can come from a thumb
-- with no catalog row behind it.
create table public.reports (
  user_id     uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  item_id     text not null check (private.is_normalized_id(item_id)),
  created_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Names an admin removed. A removed name cannot be created again, as a thing
-- or as an attribute: deleting the rows alone would let the same account type
-- it back a second later. `purged_at` is null while thumbs naming it may still
-- exist (see `purge_removed_names`).
create table private.removed_names (
  id          text primary key check (private.is_normalized_id(id)),
  removed_at  timestamptz not null default now(),
  purged_at   timestamptz
);

-- The public indices a thing can link to, and the pattern each one's ids must
-- match: the ones `SOURCES` in `shared/src/references.ts` compiles, whose
-- tests check this list against that one. A new index is a row here.
create table private.ref_sources (
  source   text primary key,
  pattern  text not null
);

insert into private.ref_sources (source, pattern) values
  ('wikidata', '^Q[1-9][0-9]{0,11}$'),
  ('osm',      '^[nwr][1-9][0-9]{0,14}$');

-- A thing's link to a public index. No URL is stored: the client builds it
-- from `(source, ref)`, and the pattern is what makes that safe, since a ref
-- can hold no `/`, `?`, `#` or `:`. No description and no coordinates either:
-- names and ids alone keep OpenStreetMap's share-alike out of reach.
--
-- A side table rather than columns, because `items` has no UPDATE for anyone
-- and a plain name may gain a link after it exists. One link per thing and one
-- thing per link, so the same page always resolves to the thing that holds it.
create table public.item_refs (
  item_id     text primary key references public.items (id) on delete cascade,
  source      text not null references private.ref_sources (source),
  ref         text not null,
  created_at  timestamptz not null default now(),
  -- As on `items`: unforgeable, unreadable, and it must outlive its author.
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (source, ref)
);

create index item_refs_created_by_idx on public.item_refs (created_by)
  where created_by is not null;

-- Links an admin took off, blocked from coming back on any thing.
create table private.removed_refs (
  source      text not null,
  ref         text not null,
  removed_at  timestamptz not null default now(),
  primary key (source, ref)
);

-- Supabase has no application-level admin role for end users, so an admin is
-- a row here, written by hand by the owner. An admin is never locked, which is
-- how the first account gets in: it needs to follow nobody to make a link.
create table private.admins (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  added_at  timestamptz not null default now()
);

-- Write-only diagnostics; nothing reads one back. `user_id` has no foreign
-- key, because a diagnostic must be writable before anything else about the
-- account is, so the trigger on a deleted auth account clears it by hand.
create table private.debug_events (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid(),
  kind     text not null check (char_length(kind) <= 40),
  detail   text not null check (char_length(detail) <= 2000),
  at       timestamptz not null default now(),
  expires  timestamptz not null default now() + interval '7 days'
);

create index debug_events_expires_idx on private.debug_events (expires);

-- One row per account per UTC day: how much of the day's write budget it has
-- spent. Readable by no client, so how much somebody wrote today is nobody's
-- to see.
create table private.write_budget (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null,
  writes   integer not null,
  primary key (user_id, day)
);

-- What a deleted account leaves so that deleting and signing in again resets
-- nothing: a one-way fingerprint of each identity it signed in with, beside
-- that UTC day's spent budget. No email, no name and no uuid is kept.
create table private.deleted_identities (
  fingerprint  bytea primary key,
  day          date not null,
  writes       integer not null check (writes > 0)
);

-- What can be imported from: the keys `shared/src/import/formats.ts` gives a
-- recognized file.
create table private.import_sources (
  source  text primary key
);

insert into private.import_sources (source) values
  ('imdb'), ('letterboxd'), ('goodreads'), ('google-maps');

-- An account's latest import from each source: when its first thumb was
-- written and how many it has written since.
create table private.imports (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  source      text not null references private.import_sources (source),
  started_at  timestamptz not null default now(),
  thumbs      integer not null default 0 check (thumbs >= 0),
  primary key (user_id, source)
);

-- An import's 30 days outlive the account, under the same fingerprint the
-- day's budget does. The thumbs themselves are gone with the account.
create table private.deleted_imports (
  fingerprint  bytea not null,
  source       text not null references private.import_sources (source),
  started_at   timestamptz not null,
  thumbs       integer not null,
  primary key (fingerprint, source)
);


-- A table with row-level security on and no policy admits nothing, which is
-- the state a table added to `public` by mistake should be in. Nothing in
-- `private` has it: those tables carry no grant and live at an address the API
-- does not serve, and a policy there would suggest it was the thing holding
-- them shut.
alter table public.profiles     enable row level security;
alter table public.follows      enable row level security;
alter table public.items        enable row level security;
alter table public.ratings      enable row level security;
alter table public.invite_links enable row level security;
alter table public.reports      enable row level security;
alter table public.item_refs    enable row level security;


-- Whether the caller has a way back into the account. It reads committed
-- state rather than a token claim, which would be a snapshot of the account as
-- of the last token refresh.
--
-- With Google the only provider this is vacuous: every signed-in session
-- passes by construction. It stays because what it guards against is a
-- dashboard toggle turning on anonymous sessions or a second provider, which
-- ships no diff, and the body stays general so that a second door is correct
-- on the day it is enabled.
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

-- Exact key, the caller's own.
create function private.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.admins a where a.user_id = (select auth.uid()));
$$;

-- Invite-only, enforced after the fact. Google cannot be told about a link:
-- the OAuth round trip carries nothing of ours, so every Google sign-in makes
-- an account and the gate is on what it can do. An account is unlocked while
-- it follows at least one PERSON, or is an admin. Nothing stores the lock: an
-- account that never joined and one that lost its last follow are locked by
-- the same rule, and redeeming a live link unlocks one by writing the follow.
--
-- A prefilled account does not count, or following a critic would be a way in
-- with no invitation. Being followed does not count either: it is somebody
-- else's act, and a lock the account's own followers could lift is no gate.
create function private.is_unlocked(p_user uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.admins a where a.user_id = p_user)
      or exists (select 1
                   from public.follows f
                   join public.profiles p on p.id = f.followed_id
                  where f.follower_id = p_user and not p.prefilled);
$$;

create function private.is_unlocked() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select private.is_unlocked((select auth.uid()));
$$;

-- The accounts the caller follows, as one array, so a policy can compare a
-- column against it as an InitPlan and an index: a helper called per row
-- would probe `follows` once for every thumb read.
create function private.following() returns uuid[]
  language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(f.followed_id), '{}'::uuid[])
    from public.follows f
   where f.follower_id = (select auth.uid());
$$;

create function private.followers() returns uuid[]
  language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(f.follower_id), '{}'::uuid[])
    from public.follows f
   where f.followed_id = (select auth.uid());
$$;

create function private.is_removed(p_id text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.removed_names r where r.id = p_id);
$$;

-- The removed names whose thumbs may still exist: nearly always empty.
create function private.unpurged_names() returns text[]
  language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r.id order by r.id), '{}'::text[])
    from private.removed_names r
   where r.purged_at is null;
$$;

create function private.is_ref_removed(p_source text, p_ref text) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.removed_refs r
                  where r.source = p_source and r.ref = p_ref);
$$;


-- Every write a client can make that adds to what the server stores draws on
-- one budget per account per UTC day. The client cannot be the thing holding
-- it to that: a crafted client is exactly the case a budget exists for, and
-- every one of these tables is written straight through PostgREST. Deletes
-- draw nothing, because they shrink what is stored.
--
-- The one place the number lives.
create function private.daily_write_limit() returns integer
  language sql immutable set search_path = ''
as $$ select 1024 $$;

-- SECURITY DEFINER because the writer is a client and the counter is in a
-- schema no client role can reach. Keyed on `auth.uid()`, the caller, not on
-- the row: that is who is spending. A connection with no request identity (a
-- migration, the owner, a scheduled statement) is not counted.
--
-- This is also where a locked account is stopped, in front of the spend,
-- since every counted write comes through here.
--
-- A row written by `import_thumbs` or `load_prefilled` is let through: the
-- first counts against the import's own allowance and has checked the lock
-- itself, the second is the owner's. The setting is transaction-local and set
-- only there; a client has no way to set one, since PostgREST runs no
-- statement of the caller's and `set_config` is in no schema it serves.
--
-- BEFORE, so a refused write never reaches the table, and the increment is
-- part of the same statement, so the refusal rolls it back: an account at its
-- budget stays at it rather than climbing with every refused attempt.
--
-- `PT429` because PostgREST turns a `PTxxx` state into that HTTP status and
-- passes the code through, which is what the client keys on.
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
  if current_setting('grapevine.importing', true) = 'on' then
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

-- The same spend for a write that is not an insert into a table with the
-- trigger on it: a follow. It does not look at the lock, because redeeming a
-- link is how a locked account gets out; the two other follow functions check
-- it themselves.
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

-- The two client writes `count_write` does not see: a name, and clearing a
-- thumb. A trigger raising `42501` rather than a restrictive policy, because a
-- policy would make the write match no row and report success.
--
-- The profile is asked for before the lock. An account's deletion reaches
-- here once per thumb, after its profile is gone, and that is what lets the
-- cascade through.
create function private.refuse_if_locked() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and coalesce(current_setting('grapevine.importing', true), '') <> 'on'
     and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
     and not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger profiles_refuse_if_locked
  before update on public.profiles
  for each row execute function private.refuse_if_locked();

create trigger ratings_delete_refuse_if_locked
  before delete on public.ratings
  for each row execute function private.refuse_if_locked();

create trigger ratings_count_write
  before insert or update on public.ratings
  for each row execute function private.count_write();

create trigger items_count_write
  before insert on public.items
  for each row execute function private.count_write();

create trigger item_refs_count_write
  before insert on public.item_refs
  for each row execute function private.count_write();

create trigger reports_count_write
  before insert on public.reports
  for each row execute function private.count_write();

create trigger debug_events_count_write
  before insert on private.debug_events
  for each row execute function private.count_write();

-- INSERT only: `set_invite_link` replaces by `on conflict do update`, which
-- fires a BEFORE UPDATE trigger as well as the BEFORE INSERT one, so a trigger
-- on both would charge a replacement twice.
create trigger invite_links_count_write
  before insert on public.invite_links
  for each row execute function private.count_write();


-- How many times each account's thumbs have changed. It is the only clock a
-- follower is given: whether to read an account again (`followed_stamps`), and
-- from where (`account_thumbs_since`).
--
-- A counter rather than anything read off the rows. A digest of the count and
-- the newest `rated_at` gave that time away to anybody who followed the
-- account, since the count is theirs to see and a timestamp has few enough
-- values to try them all; and two of an account's transactions that overlap
-- could leave it unchanged across a real change, because `now()` is when a
-- transaction started.
--
-- The salt is what makes a stamp say nothing: random, fixed when the row is
-- made and never readable, so the same revision is a different stamp for
-- every account and a stamp cannot be reversed into its revision.
--
-- `floor` is the highest revision among the tombstones already swept. A
-- reader below it may have missed a clear nothing remembers, and is answered
-- in full.
create table private.ratings_revision (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  revision  bigint not null default 1,
  salt      uuid not null default gen_random_uuid(),
  floor     bigint not null default 0
);

-- A cleared thumb leaves this, so a follower reading changes learns of the
-- clear: a deleted row cannot say it was deleted. One per key, replaced by a
-- later clear of the same thumb and deleted when the thumb is given again, so
-- a key is never both a thumb and a tombstone and an answer never has to say
-- which of the two is newer.
--
-- `cleared_at` is for the sweep alone, and reaches no client.
create table private.ratings_cleared (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_id     text not null,
  tag         text not null,
  revision    bigint not null,
  cleared_at  timestamptz not null default now(),
  primary key (user_id, item_id, tag)
);

create index ratings_cleared_cleared_at_idx on private.ratings_cleared (cleared_at);

-- The account's next revision. The row it updates stays locked until the
-- writer commits, and that lock is what makes revisions a clock a reader can
-- trust: two writers to one account cannot both be in flight, so they commit
-- in the order of the revisions they took. A sequence would hand out numbers
-- without that, and a reader answered at 8 while the writer of 7 had not
-- committed would skip 7 for good.
create function private.next_revision(p_user uuid) returns bigint
  language sql volatile security definer set search_path = ''
as $$
  insert into private.ratings_revision as v (user_id) values (p_user)
  on conflict (user_id) do update set revision = v.revision + 1
  returning v.revision;
$$;

-- Per row, for every writer whatever its role: a reload of a prefilled
-- account changes what a follower reads as surely as a client does.
--
-- Writing the value a thumb already has changes nothing a reader holds, so it
-- takes no revision and a follower is not sent to read it.
create function private.stamp_rating_revision() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.value is not distinct from old.value then
      new.revision := old.revision;
      return new;
    end if;
  else
    delete from private.ratings_cleared c
     where c.user_id = new.user_id and c.item_id = new.item_id and c.tag = new.tag;
  end if;
  new.revision := private.next_revision(new.user_id);
  return new;
end $$;

-- Named to sort after `ratings_count_write`, so a write the budget or the lock
-- refuses is refused before it takes a revision.
create trigger ratings_revision_on_write
  before insert or update on public.ratings
  for each row execute function private.stamp_rating_revision();

-- The profile is asked for because an account's deletion deletes its thumbs
-- after its profile, and a tombstone or a counter written then would fail its
-- own foreign key and refuse the deletion.
--
-- A thumb on a removed name takes a revision and leaves no tombstone. Every
-- reader was sent back for a full read when the name was removed, so none
-- holds the thumb, and a tombstone would hand the removed name to followers
-- for another 30 days.
create function private.record_rating_cleared() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_revision bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return null;
  end if;
  v_revision := private.next_revision(old.user_id);
  if private.is_removed(old.item_id) or private.is_removed(old.tag) then
    return null;
  end if;
  insert into private.ratings_cleared as c (user_id, item_id, tag, revision)
  values (old.user_id, old.item_id, old.tag, v_revision)
  on conflict (user_id, item_id, tag) do update
    set revision = excluded.revision, cleared_at = now();
  return null;
end $$;

create trigger ratings_cleared_on_delete
  after delete on public.ratings
  for each row execute function private.record_rating_cleared();

-- Nothing can be asked of a tombstone a month old that a full read does not
-- answer, and it names what somebody once rated. Raising `floor` in the same
-- statement is what sends a reader who might have needed one back for
-- everything.
create function private.sweep_cleared() returns void
  language sql volatile security definer set search_path = ''
as $$
  with swept as (
    delete from private.ratings_cleared c
     where c.cleared_at < now() - interval '30 days'
    returning c.user_id, c.revision
  )
  update private.ratings_revision v
     set floor = greatest(v.floor, s.top)
    from (select w.user_id, max(w.revision) as top from swept w group by w.user_id) s
   where v.user_id = s.user_id;
$$;

-- A CHECK cannot read another table, so a link's pattern is checked here, for
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

-- Losing the last follow of a person revokes the account's link, so a link's
-- owner is never locked and `redeem_invite` needs no check of the owner. Per
-- row, on the follower: it fires when they unfollow, when the followed account
-- removes them, and when the followed account is deleted. An admin removed
-- while following nobody loses theirs the same way.
--
-- The account's profile row is locked first, and the question asked after.
-- Without it, two transactions that each delete one of an account's last two
-- follows each still see the other's row, and neither revokes the link: a
-- locked account with a live one. With it the second waits for the first, and
-- then reads what the first committed. `set_invite_link` takes the same lock,
-- so a link cannot be made while the removal of the caller's last follow is
-- still uncommitted. `no key update` rather than `update`, so the account's
-- own inserts, which take a key-share lock on this row through their foreign
-- keys, are not held up by it.
--
-- Two trigger functions over one body, because the two tables name the
-- account by different columns and a trigger function is checked against the
-- table it is on.
create function private.revoke_link_if_locked(p_user uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.profiles p where p.id = p_user for no key update;
  if not private.is_unlocked(p_user) then
    delete from public.invite_links l where l.owner_id = p_user;
  end if;
end $$;

-- 32 bytes from two v4 UUIDs, which Postgres draws from its strong random
-- source (244 random bits), as unpadded base64url: 43 characters. Core
-- functions only, so it needs no extension and no search path.
create function private.new_invite_token() returns text
  language sql volatile set search_path = ''
as $$
  select translate(
    rtrim(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text,
                                '-', ''), 'hex'), 'base64'), '='),
    '+/', '-_');
$$;

-- The second half is for the FOLLOWED account, when it is the one deleting:
-- removing a follower replaces its link, or the person removed walks back in
-- with the link they were given. Only when the caller is that account. A
-- follower who unfollows chose to go, a connection with no request identity is
-- the owner's, and an account being deleted (whose profile is gone by the time
-- its follows are) has a link the same cascade is taking.
--
-- It spends no write: the caller asked to remove somebody, not for a link.
create function private.follow_lost() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  perform private.revoke_link_if_locked(old.follower_id);
  if old.followed_id = (select auth.uid())
     and exists (select 1 from public.profiles p where p.id = old.followed_id) then
    update public.invite_links l
       set token = private.new_invite_token(), created_at = now()
     where l.owner_id = old.followed_id;
  end if;
  return null;
end $$;

create function private.admin_lost() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  perform private.revoke_link_if_locked(old.user_id);
  return null;
end $$;

create trigger follows_revoke_link_if_locked
  after delete on public.follows
  for each row execute function private.follow_lost();

create trigger admins_revoke_link_if_locked
  after delete on private.admins
  for each row execute function private.admin_lost();


-- A profile exists, named and with a photo, in the same transaction that
-- creates the auth user, so a signed-in person never has a missing one and
-- nothing asks for a name. The default is the first name: Google's
-- `given_name` when the identity carries one, else the first word of the full
-- name, else "unknown", which its owner can change.
--
-- Stripped rather than refused: a character the column's CHECK refuses must
-- not be able to stop an account being created. The same list as the CHECK,
-- and the two have to be changed together.
--
-- No `on conflict`: an id that already names a profile would hand that
-- profile to whoever signed in, so the sign-in fails instead.
create function private.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full text := coalesce(nullif(btrim(v_meta ->> 'full_name'), ''),
                          nullif(btrim(v_meta ->> 'name'), ''),
                          '');
  v_photo text := v_meta ->> 'avatar_url';
  v_name text;
begin
  v_name := coalesce(nullif(btrim(v_meta ->> 'given_name'), ''),
                     nullif(split_part(v_full, ' ', 1), ''),
                     '');
  v_name := btrim(left(btrim(regexp_replace(
    v_name,
    '[\U00000000-\U0000001F\U0000007F-\U0000009F\U000000AD\U0000061C'
    '\U0000200B\U0000200E\U0000200F\U00002028-\U0000202E\U00002060'
    '\U00002066-\U00002069\U0000FEFF]',
    '', 'g')), 50));

  insert into public.profiles (id, display_name, photo_url)
  values (
    new.id,
    coalesce(nullif(v_name, ''), 'unknown'),
    -- Dropped rather than refused when the column would not take it: a
    -- picture is not worth a sign-up.
    case when v_photo ~ '^https://' and char_length(v_photo) <= 2000 then v_photo end
  );

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- The other half of what a foreign key to `auth.users` would have done: the
-- account going takes the profile, and the profile's cascade takes the rest. A
-- trigger rather than a line in `delete_account`, so an account deleted from
-- the dashboard leaves nothing behind either. Never a prefilled profile, which
-- no auth account owns.
--
-- The diagnostics go here too. They carry the account's id with no foreign
-- key, so no cascade reaches them, and they would otherwise keep it until
-- their seven days ran out.
create function private.handle_deleted_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from public.profiles p where p.id = old.id and not p.prefilled;
  delete from private.debug_events d where d.user_id = old.id;
  return old;
end $$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function private.handle_deleted_user();


-- The fingerprint is HMAC-SHA256 of `provider:provider_id` (for Google, the
-- account's stable subject id) under a random key held in Supabase Vault.
-- Keyed, because a plain hash of a subject id can be confirmed by anybody who
-- knows the id; in Vault rather than a table, because Vault keeps it encrypted
-- under a key held outside the database, so a dump carries fingerprints nobody
-- can test a subject id against. The key is made here, on the server that
-- applies this, and is in no file.
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
                  where name = 'identity_fingerprint_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'identity_fingerprint_key',
      'HMAC key for private.deleted_identities. Never leaves the database.');
  end if;
end $$;

-- The key is read per call rather than cached anywhere a session could see it.
-- A missing key is an error, not a fallback to an unkeyed hash.
create function private.identity_fingerprint(p_provider text, p_provider_id text)
  returns bytea
  language plpgsql stable security definer set search_path = ''
as $$
declare
  v_key text;
begin
  select s.decrypted_secret into v_key
    from vault.decrypted_secrets s
   where s.name = 'identity_fingerprint_key';
  if v_key is null then
    raise exception 'identity_fingerprint_key is missing from vault';
  end if;
  return extensions.hmac(p_provider || ':' || p_provider_id, v_key, 'sha256');
end $$;

-- A new identity that matches one deleted today starts its account at that
-- day's count. After insert on `auth.identities` rather than on `auth.users`,
-- because GoTrue writes the identity after the user: the profile the budget
-- row hangs off exists by then, and the identity is the provider's own record,
-- where `raw_user_meta_data` is the user's to edit.
create function private.carry_deleted_budget() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_writes integer;
begin
  select d.writes into v_writes
    from private.deleted_identities d
   where d.fingerprint = private.identity_fingerprint(new.provider, new.provider_id)
     and d.day = v_today;
  if v_writes is null
     or not exists (select 1 from public.profiles p where p.id = new.user_id) then
    return null;
  end if;
  insert into private.write_budget as budget (user_id, day, writes)
  values (new.user_id, v_today, v_writes)
  on conflict (user_id, day) do update
    set writes = greatest(budget.writes, excluded.writes);
  return null;
end $$;

create trigger on_auth_identity_created
  after insert on auth.identities
  for each row execute function private.carry_deleted_budget();


-- The only place each of an import's numbers is written.
create function private.import_thumb_limit() returns integer
  language sql immutable set search_path = ''
as $$ select 10000 $$;

create function private.import_chunk_limit() returns integer
  language sql immutable set search_path = ''
as $$ select 500 $$;

-- In hours: a `day` added to a timestamp follows the session's time zone
-- across a clock change, and these are lengths of time.
create function private.import_open_for() returns interval
  language sql immutable set search_path = ''
as $$ select interval '24 hours' $$;

create function private.import_every() returns interval
  language sql immutable set search_path = ''
as $$ select interval '720 hours' $$;

create function private.carry_deleted_imports() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.imports as i (user_id, source, started_at, thumbs)
  select new.user_id, d.source, d.started_at, d.thumbs
    from private.deleted_imports d
   where d.fingerprint = private.identity_fingerprint(new.provider, new.provider_id)
     and d.started_at + private.import_every() > now()
     and exists (select 1 from public.profiles p where p.id = new.user_id)
  on conflict (user_id, source) do update
    set started_at = greatest(i.started_at, excluded.started_at);
  return null;
end $$;

create trigger on_auth_identity_created_imports
  after insert on auth.identities
  for each row execute function private.carry_deleted_imports();

-- Both tables hold when somebody imported, and nothing reads a row past its
-- 30 days.
create function private.sweep_imports() returns void
  language sql volatile security definer set search_path = ''
as $$
  delete from private.imports i
   where i.started_at + private.import_every() <= now();
  delete from private.deleted_imports d
   where d.started_at + private.import_every() <= now();
$$;


-- The only write verb on `private.debug_events`. `user_id`, `at` and `expires`
-- are not arguments, so a client cannot forge them.
create function public.record_debug_event(p_kind text, p_detail text) returns void
  language sql security definer set search_path = ''
as $$
  insert into private.debug_events (kind, detail) values (p_kind, p_detail);
$$;

-- What the client shows instead of the list. About the caller only.
create function public.account_locked() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select not private.is_unlocked();
$$;

-- Whether to show the caller the review queue at all. About the caller only.
create function public.account_is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select private.is_admin();
$$;


-- Turns the caller's link on, or replaces it, and returns the token. Replacing
-- is the same call: the new token overwrites the old one, which stops working
-- in the same statement. Whoever followed through the old one still does.
--
-- The insert's trigger spends the write and refuses a locked caller.
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

  -- See `revoke_link_if_locked`: the insert's lock check must not run beside
  -- an uncommitted loss of the caller's last follow.
  perform 1 from public.profiles p where p.id = v_me for no key update;

  v_token := private.new_invite_token();

  insert into public.invite_links as l (owner_id, token)
  values (v_me, v_token)
  on conflict (owner_id) do update
    set token = excluded.token, created_at = now();

  return v_token;
end $$;

-- Whose link this is: the owner's name and photo, so the person holding it can
-- see who they would follow before signing in and before saying yes. Exact
-- key, one row, no id, and nothing for a token that does not match.
--
-- Callable by `anon`, and it is the only thing `anon` may call. The link is
-- the authority: its owner handed it over so that the holder would know who it
-- is from. It spends nothing, since `anon` has no budget to spend, and what
-- bounds guessing is the token's 244 bits.
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

-- Makes the caller follow the link's owner, and returns the owner's id: null
-- when no live link has this token; the caller's own id when it is their own
-- link, which writes nothing. Already following is a no-op that still answers
-- with the owner.
--
-- One row, the caller's. The owner handed out a link to be followed by, not to
-- follow; following back is theirs to choose (`follow_back`).
--
-- It spends a write whether or not the token matched, so that guessing costs
-- the guesser, and does not ask whether the caller is locked: this is the way
-- out of the lock.
--
-- It does ask whether the OWNER is. A locked account's link is deleted when
-- it becomes locked, so there should be none to find; a link that outlived
-- that somehow is treated as dead rather than trusted, since following a
-- locked account is exactly the way in that the lock closes. Nothing is
-- deleted here: this is a read of somebody else's row.
create function public.redeem_invite(p_token text) returns uuid
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_me is null or not private.has_credential() then
    raise exception 'following needs a way back in' using errcode = '42501';
  end if;

  perform private.spend_write();

  select l.owner_id into v_owner
    from public.invite_links l
   where l.token = p_token;

  if v_owner is null or not private.is_unlocked(v_owner) then
    return null;
  end if;
  if v_owner = v_me then
    return v_owner;
  end if;

  insert into public.follows (follower_id, followed_id)
  values (v_me, v_owner)
  on conflict do nothing;

  return v_owner;
end $$;

-- Follows somebody who already follows the caller. That they do is the whole
-- of the authority: they chose to be read by nobody, and a follower they can
-- see and remove is the least a follow can cost them.
--
-- One refusal for every other uuid (a stranger, nobody at all, the caller's
-- own), so the answer says nothing about whether an account exists.
create function public.follow_back(p_user uuid) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not private.has_credential() then
    raise exception 'following needs a way back in' using errcode = '42501';
  end if;
  if not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;

  perform private.spend_write();

  if not exists (select 1 from public.follows f
                  where f.follower_id = p_user and f.followed_id = v_me) then
    raise exception 'not somebody you can follow' using errcode = '42501';
  end if;

  insert into public.follows (follower_id, followed_id)
  values (v_me, p_user)
  on conflict do nothing;
end $$;

-- Follows a prefilled account, which is public by design. The same refusal as
-- `follow_back` for anything else, a person's uuid included: knowing a uuid is
-- not a way to follow anybody.
create function public.follow_prefilled(p_user uuid) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null or not private.has_credential() then
    raise exception 'following needs a way back in' using errcode = '42501';
  end if;
  if not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;

  perform private.spend_write();

  if not exists (select 1 from public.profiles p
                  where p.id = p_user and p.prefilled) then
    raise exception 'not somebody you can follow' using errcode = '42501';
  end if;

  insert into public.follows (follower_id, followed_id)
  values (v_me, p_user)
  on conflict do nothing;
end $$;


-- PostgREST caps a read at 1 000 rows and a followed account can hold
-- thousands of thumbs, so the browser loads them an account at a time through
-- the two functions below, and asks this first which accounts changed.
--
-- One row per account the caller follows that has a thumb the caller may read.
-- The stamp is opaque and moves whenever what the caller would load does: the
-- account's revision, under its salt.
--
-- The number of names ever removed is digested with it. Removing a name hides
-- its thumbs from every reader at once and deletes them later, so between the
-- two no revision has moved and a browser would keep showing what it loaded
-- before. A removal therefore moves every stamp, once; it is rare, and the
-- alternative is finding every account that rated the name, which is the scan
-- a removal exists to put off.
--
-- SECURITY DEFINER because it reads a table no client may. So the body
-- restates what the policies on `ratings` would have decided: only accounts
-- the caller follows, and no thumb on a removed name awaiting its purge.
create function public.followed_stamps()
  returns table (user_id uuid, stamp text)
  language sql stable security definer set search_path = ''
as $$
  with gone as materialized (
    select private.unpurged_names() as ids,
           (select count(*) from private.removed_names) as removals
  )
  select v.user_id,
         md5(v.salt::text || ':' || v.revision::text || ':'
             || (select g.removals from gone g)::text)
    from private.ratings_revision v
   where v.user_id in (select f.followed_id from public.follows f
                        where f.follower_id = (select auth.uid()))
     and exists (
       select 1 from public.ratings r
        where r.user_id = v.user_id
          and ((select cardinality(g.ids) = 0 from gone g)
               or (r.item_id <> all ((select g.ids from gone g)::text[])
                   and r.tag <> all ((select g.ids from gone g)::text[]))));
$$;

-- One account's thumbs, nested thing to attribute to value, with `''` for the
-- thing itself. Not SECURITY DEFINER: the policies on `ratings` decide what is
-- visible, so an account the caller does not follow, a uuid that names nobody
-- and an account with no thumbs all answer `{}`.
--
-- Nested rather than keyed by a joined string: any separator a name could
-- hold could be forged by one. Aggregated as `json` and cast once, because
-- nested `jsonb_object_agg` re-encodes the level below at every level.
create function public.account_thumbs(p_user uuid) returns jsonb
  language sql stable set search_path = ''
as $$
  select coalesce(json_object_agg(per_item.item_id, per_item.tags)::jsonb, '{}'::jsonb)
    from (
      select r.item_id, json_object_agg(r.tag, r.value) as tags
        from public.ratings r
       where r.user_id = p_user
       group by r.item_id
    ) per_item;
$$;

-- What changed in one account's thumbs since the caller last read them, so a
-- browser keeps what it read and fetches the difference. `p_revision` and
-- `p_removed` are the `revision` and `removed` of the answer it last applied.
--
--   { "revision": the account's revision now,
--     "removed":  how many names have ever been removed,
--     "full":     whether `thumbs` is everything,
--     "thumbs":   { item: { attribute or "": 1 | -1 } },
--     "cleared":  [ [item, attribute or ""], ... ] }
--
-- When `full`, the caller replaces what it holds with `thumbs`. Otherwise it
-- writes `thumbs` over what it holds and drops each key in `cleared`. It is
-- full whenever a difference could not be trusted: nothing held yet, a
-- revision this account has not reached, a revision older than a tombstone
-- already swept, or a name removed since (which hides thumbs without any
-- revision moving).
--
-- For the caller's own id and for an account the caller follows. Anything
-- else, a uuid that names nobody and a null included, is answered as a
-- followed account that never rated would be.
--
-- Why applying an answer is exact, under READ COMMITTED. Every query in a
-- STABLE function runs on the calling statement's snapshot, so the revision
-- and the rows are read at one instant: the counter says N exactly when the
-- transaction that took N is visible, because that transaction wrote both.
-- And writers to one account are serialized by the counter row's lock
-- (`next_revision`), so they commit in revision order: any change this
-- snapshot does not see has a revision above the one answered, and the next
-- read asks for it. Reading the counter and the rows in two statements, or
-- making this function VOLATILE, would lose the first half of that.
--
-- SECURITY DEFINER because it reads columns and tables no client may, so the
-- body restates what the policies on `ratings` would have decided: whose
-- thumbs, and none on a removed name awaiting its purge.
create function public.account_thumbs_since(p_user uuid, p_revision bigint, p_removed bigint)
  returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with gone as materialized (
    select private.unpurged_names() as ids,
           (select count(*) from private.removed_names) as removals
  ),
  readable as materialized (
    select p_user is not null
           and (p_user = (select auth.uid())
                or exists (select 1 from public.follows f
                            where f.follower_id = (select auth.uid())
                              and f.followed_id = p_user)) as yes
  ),
  account as materialized (
    select coalesce(max(v.revision), 0) as revision, coalesce(max(v.floor), 0) as floor
      from private.ratings_revision v
     where v.user_id = p_user and (select r.yes from readable r)
  ),
  mode as materialized (
    select a.revision,
           g.removals,
           (p_revision is null or p_revision <= 0
            or p_revision > a.revision or p_revision < a.floor
            or p_removed is null or p_removed <> g.removals) as full
      from account a cross join gone g
  )
  select jsonb_build_object(
    'revision', m.revision,
    'removed',  m.removals,
    'full',     m.full,
    'thumbs',   coalesce((
      select json_object_agg(per_item.item_id, per_item.tags)::jsonb
        from (
          select r.item_id, json_object_agg(r.tag, r.value) as tags
            from public.ratings r
           where r.user_id = p_user
             and (select x.yes from readable x)
             and (m.full or r.revision > p_revision)
             and ((select cardinality(g.ids) = 0 from gone g)
                  or (r.item_id <> all ((select g.ids from gone g)::text[])
                      and r.tag <> all ((select g.ids from gone g)::text[])))
           group by r.item_id
        ) per_item), '{}'::jsonb),
    'cleared',  coalesce((
      select jsonb_agg(jsonb_build_array(c.item_id, c.tag) order by c.item_id, c.tag)
        from private.ratings_cleared c
       where c.user_id = p_user
         and (select x.yes from readable x)
         and not m.full
         and c.revision > p_revision), '[]'::jsonb))
    from mode m;
$$;


-- Removing a name records the removal and deletes the catalog row and the
-- name's reports, and nothing more, so it takes a millisecond however many
-- people rated it. Every reader of a thumb leaves a removed name out from that
-- moment, and the thumbs go later, in batches (`purge_removed_names`).
--
-- No caller check: no client can call it, and the owner runs it by hand, where
-- `auth.uid()` is null and an admin check would refuse.
create function private.remove_name(p_id text) returns void
  language plpgsql volatile set search_path = ''
as $$
begin
  if not private.is_normalized_id(p_id) then
    raise exception 'not an id: %', p_id using errcode = '22023';
  end if;
  insert into private.removed_names (id) values (p_id) on conflict (id) do nothing;
  delete from public.items i where i.id = p_id;
  delete from public.reports p where p.item_id = p_id;
end $$;

-- Deletes up to `p_batch` thumbs naming any unpurged name, as a thing or an
-- attribute, and returns how many.
--
-- A name is marked purged only once a run finds fewer than a batch left AND it
-- was removed over ten minutes ago: a thumb whose insert passed the policy
-- before the removal committed can land after the first empty run, and the
-- readers stop excluding a name the moment it is marked.
--
-- Each run is one scan of `ratings`. There is no index on `item_id` or `tag`:
-- one would cost every thumb written, for a job that runs only after a
-- removal.
create function private.purge_removed_names(p_batch int default 5000) returns integer
  language plpgsql volatile set search_path = ''
as $$
declare
  v_gone     text[];
  v_deleted  integer;
begin
  v_gone := private.unpurged_names();
  if cardinality(v_gone) = 0 then
    return 0;
  end if;

  delete from public.ratings r
   where r.ctid = any (array(
     select t.ctid from public.ratings t
      where t.item_id = any (v_gone) or t.tag = any (v_gone)
      limit p_batch));
  get diagnostics v_deleted = row_count;

  if v_deleted < p_batch then
    update private.removed_names r
       set purged_at = now()
     where r.purged_at is null
       and r.id = any (v_gone)
       and r.removed_at < now() - interval '10 minutes';
  end if;
  return v_deleted;
end $$;

-- The review queue is three functions in `public`, because a client must call
-- them. Each checks `private.is_admin()` before anything else: listing answers
-- nothing for anybody else, and the two that write refuse. That check, the
-- revoke from PUBLIC and the exact key are the whole of the defense, since
-- `public` is served.
--
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

create function public.remove_reported_name(p_id text) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform private.remove_name(p_id);
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

-- Takes a thing's link off and blocks it, and leaves the name and its thumbs
-- alone, so a wrong link on a well-rated name is fixed without removing the
-- name. No caller check, as `remove_name`.
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

-- An admin's, from a client.
create function public.remove_reference(p_item_id text) returns void
  language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform private.remove_reference(p_item_id);
end $$;


-- One chunk of an import, the one bulk write a client has. The browser reads
-- a file the person exported from another service, matches each rated thing
-- to a Wikipedia page or an OpenStreetMap place, and sends what it found here.
-- An import has an allowance of its own instead of the daily write limit:
--
-- - one import per source per account every 30 days,
-- - of up to 10 000 thumbs,
-- - sent in chunks of at most 500 things, each chunk one call and one write
--   from the daily budget,
-- - and open for a day after its first thumb, so one that stopped part-way
--   (a lost connection, a closed tab) can be finished.
--
-- Chunks rather than one call of 10 000: a thumb is three inserts and their
-- row triggers, a role's statement timeout is seconds, and a chunk that fails
-- loses 500 things and not the import.
--
-- It writes as its owner, with `count_write` let through, so this is where
-- everything a client's own insert is checked for has to be checked again:
-- the lock, the name rules, removed names, the link's pattern, removed links.
-- Anything added to what a thumb or a name is checked for must be added here.
--
-- `p_things` is an array of `{"id", "search_id", "source", "ref", "value"}`:
-- the name the browser would give the thing, its stripped copy, its link, and
-- the thumb. No date: `rated_at` is the server's clock, because a file's dates
-- would let anybody claim to have rated everything long ago.
--
-- Per thing: the thumb goes on whatever already holds the link, whatever it
-- is called. Otherwise the name is created if it is new and given the link if
-- it has none. A name that holds a different link is refused, and a refused
-- thing costs the chunk nothing else. A thumb the caller already has is kept
-- as it is.
--
-- Answers what happened as counts, the caller's own: `saved` thumbs written,
-- `kept` already there, `refused`, `over` the allowance, and what is `left`
-- of it.
--
-- `GV429` when this source's import has closed and its 30 days are not up.
-- An import that has written nothing has not started: a first chunk whose
-- every thing is refused leaves no row.
create function public.import_thumbs(p_source text, p_things jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_me      uuid := (select auth.uid());
  v_now     timestamptz := now();
  v_import  private.imports;
  v_asked   integer;
  v_valid   jsonb;
  v_taken   integer;
  v_over    integer;
  v_found   integer;
  v_saved   integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not private.is_unlocked() then
    raise exception 'accept a link first' using errcode = '42501';
  end if;
  if not exists (select 1 from private.import_sources s where s.source = p_source) then
    raise exception 'not an import source: %', p_source using errcode = '22023';
  end if;
  if p_things is null or jsonb_typeof(p_things) <> 'array' then
    raise exception 'things must be an array' using errcode = '22023';
  end if;
  v_asked := jsonb_array_length(p_things);
  if v_asked > private.import_chunk_limit() then
    raise exception 'at most % things a call', private.import_chunk_limit()
      using errcode = '22023';
  end if;

  perform private.spend_write();

  -- Taken here, so two chunks of one import run one after the other. A row
  -- past its 30 days is the next import's, from zero.
  insert into private.imports as i (user_id, source, started_at, thumbs)
  values (v_me, p_source, v_now, 0)
  on conflict (user_id, source) do update
    set started_at = case when i.started_at + private.import_every() <= v_now
                          then v_now else i.started_at end,
        thumbs     = case when i.started_at + private.import_every() <= v_now
                          then 0 else i.thumbs end
  returning i.* into v_import;

  if v_import.started_at + private.import_open_for() <= v_now then
    raise exception 'already imported from %', p_source
      using errcode = 'GV429',
            hint = 'One import per source every 30 days.';
  end if;

  -- What a client's own insert would be allowed, one thing per link, in the
  -- order sent.
  select coalesce(jsonb_agg(to_jsonb(v) order by v.ord), '[]'::jsonb) into v_valid
    from (
      select distinct on (t.source, t.ref)
             t.ord, t.id, t.search_id, t.source, t.ref,
             (case t.value when '1' then 1 else -1 end)::smallint as value
        from (
          select e.ord,
                 e.thing ->> 'id'        as id,
                 e.thing ->> 'search_id' as search_id,
                 e.thing ->> 'source'    as source,
                 e.thing ->> 'ref'       as ref,
                 e.thing ->> 'value'     as value
            from jsonb_array_elements(p_things) with ordinality as e(thing, ord)
           where jsonb_typeof(e.thing) = 'object'
        ) t
        join private.ref_sources s on s.source = t.source and t.ref ~ s.pattern
       where t.value in ('1', '-1')
         and private.is_normalized_id(t.id)
         and char_length(t.search_id) <= 128
         and not private.is_removed(t.id)
         and not private.is_ref_removed(t.source, t.ref)
       order by t.source, t.ref, t.ord
    ) v;

  -- No more than the allowance has left; the rest are `over`.
  v_taken := least(jsonb_array_length(v_valid),
                   private.import_thumb_limit() - v_import.thumbs);
  v_over := jsonb_array_length(v_valid) - v_taken;
  select coalesce(jsonb_agg(v.thing order by v.ord), '[]'::jsonb) into v_valid
    from (select e.thing, e.ord
            from jsonb_array_elements(v_valid) with ordinality as e(thing, ord)
           order by e.ord limit v_taken) v;

  perform set_config('grapevine.importing', 'on', true);

  -- A name for each link nothing holds yet, then the link. Both lose a race
  -- quietly: whatever holds the link afterwards is what the thumb goes on.
  insert into public.items (id, search_id, created_by)
  select distinct on (v.id) v.id, v.search_id, v_me
    from jsonb_to_recordset(v_valid)
           as v(ord integer, id text, search_id text, source text, ref text)
   where not exists (select 1 from public.item_refs r
                      where r.source = v.source and r.ref = v.ref)
   order by v.id, v.ord
  on conflict do nothing;

  insert into public.item_refs (item_id, source, ref, created_by)
  select v.id, v.source, v.ref, v_me
    from jsonb_to_recordset(v_valid)
           as v(ord integer, id text, search_id text, source text, ref text)
   where not exists (select 1 from public.item_refs r
                      where r.source = v.source and r.ref = v.ref)
   order by v.ord
  on conflict do nothing;

  -- A thing whose link is held by nothing now had a name that holds another.
  select count(*) into v_found
    from jsonb_to_recordset(v_valid) as v(source text, ref text)
    join public.item_refs r on r.source = v.source and r.ref = v.ref;

  insert into public.ratings (user_id, item_id, tag, value)
  select v_me, r.item_id, '', v.value
    from jsonb_to_recordset(v_valid) as v(source text, ref text, value smallint)
    join public.item_refs r on r.source = v.source and r.ref = v.ref
  on conflict do nothing;
  get diagnostics v_saved = row_count;

  perform set_config('grapevine.importing', 'off', true);

  if v_import.thumbs + v_saved = 0 then
    delete from private.imports i where i.user_id = v_me and i.source = p_source;
  else
    update private.imports i set thumbs = i.thumbs + v_saved
     where i.user_id = v_me and i.source = p_source;
  end if;

  return jsonb_build_object(
    'saved',   v_saved,
    'kept',    v_found - v_saved,
    'refused', v_asked - v_found - v_over,
    'over',    v_over,
    'left',    private.import_thumb_limit() - v_import.thumbs - v_saved);
end $$;

-- The caller's own imports that still count: whether each can take more, how
-- many thumbs it has left, and how long until that source can be imported
-- again. No timestamp: the answer is in the server's time, so a device's
-- clock cannot disagree with it. A source with no row can be imported.
create function public.import_state()
  returns table (source text, open boolean, thumbs_left integer, again_in_seconds integer)
  language sql stable security definer set search_path = ''
as $$
  select i.source,
         i.started_at + private.import_open_for() > now(),
         private.import_thumb_limit() - i.thumbs,
         ceil(extract(epoch from i.started_at + private.import_every() - now()))::integer
    from private.imports i
   where i.user_id = (select auth.uid())
     and i.started_at + private.import_every() > now();
$$;


-- Loads a prefilled account, for the owner: no client can call it. `p_thumbs`
-- is an array of
--
--   { "item": id, "search_id": its stripped copy, "tag": attribute or "",
--     "value": 1 | -1, "source"?: index, "ref"?: that index's id }
--
-- with `tag` and `search_id` optional (a missing tag is the thing itself; a
-- missing `search_id` is only an error when the thing has to be created).
--
-- The account is found by its handle, so loading it again is the same account
-- with the same id, renamed if the name changed. Its thumbs are made to equal
-- the array exactly: new ones written, changed ones turned over, and any the
-- array no longer holds deleted, so a source that withdrew an opinion stops
-- holding it here.
--
-- A thumb on a removed name is left out, as it would be refused for anyone.
-- Anything else wrong with an entry fails the whole load and names the entry:
-- the caller is the owner, and a load that quietly dropped a typo would be
-- that account holding less than it was given.
--
-- A link is added only where it is well formed, not removed, and neither the
-- thing nor the link already has one; a link is a convenience here, and the
-- thumb goes on the name given either way.
--
-- It writes as its owner and marks its rows the way an import does, so that
-- neither the budget nor the lock is asked about a caller who has no account.
create function private.load_prefilled(p_handle text, p_display_name text, p_thumbs jsonb)
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


-- Deletes the caller's own account. The whole of it is one `delete from
-- auth.users`: the trigger on that table takes the profile and the
-- diagnostics, and every other row about a person hangs off the profile by
-- `on delete cascade`. Anything new that names
-- a person needs the same, or deletion either fails or leaves it behind.
--
-- A function rather than a client DELETE, because no client role may be given
-- a verb on `auth.users`. What keeps SECURITY DEFINER from being a hazard is
-- that it takes no argument: the only account it can reach is the caller's.
--
-- It leaves two things behind, both under a keyed fingerprint of the identity
-- and neither naming anybody: today's spent budget and each import still
-- inside its 30 days, which an account made from the same Google identity is
-- handed back. Otherwise deleting and signing in again would be a way to
-- reset both.
--
-- A signed-in caller whose account is already gone (a second tab, a retry
-- after a lost response) matches no row and succeeds.
create function public.delete_account() returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into private.deleted_identities as d (fingerprint, day, writes)
  select private.identity_fingerprint(i.provider, i.provider_id), b.day, b.writes
    from auth.identities i
    join private.write_budget b
      on b.user_id = v_me and b.day = (now() at time zone 'utc')::date
   where i.user_id = v_me and b.writes > 0
  on conflict (fingerprint) do update
    set day = excluded.day,
        writes = case when d.day = excluded.day
                      then greatest(d.writes, excluded.writes)
                      else excluded.writes end;

  insert into private.deleted_imports as d (fingerprint, source, started_at, thumbs)
  select private.identity_fingerprint(i.provider, i.provider_id),
         m.source, m.started_at, m.thumbs
    from auth.identities i
    join private.imports m on m.user_id = v_me
   where i.user_id = v_me
     and m.started_at + private.import_every() > now()
  on conflict (fingerprint, source) do update
    set started_at = greatest(d.started_at, excluded.started_at),
        thumbs = excluded.thumbs;

  delete from auth.users u where u.id = v_me;
end $$;


-- What a client may do at all, before any policy narrows it to which rows.
-- Everything is taken away first, whichever role applied this file and
-- whatever the platform granted before it, and then named back. A grant that
-- is not below does not exist.
revoke all on all tables    in schema public  from public, anon, authenticated;
revoke all on all sequences in schema public  from public, anon, authenticated;
revoke all on all routines  in schema public  from public, anon, authenticated;
revoke all on all tables    in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all routines  in schema private from public, anon, authenticated;

-- `service_role` bypasses row-level security and is the only role that may
-- name `private`. That is safe because there is no PostgREST route to that
-- schema, only a direct connection holding the service key.
grant all on all tables    in schema public  to service_role;
grant all on all tables    in schema private to service_role;
grant all on all sequences in schema public  to service_role;
grant all on all sequences in schema private to service_role;
grant execute on function private.load_prefilled(text, text, jsonb) to service_role;

-- `anon` is a signed-out visitor, and there are no anonymous sessions. It
-- holds no table privilege, and one function, below.

-- No INSERT (the trigger on `auth.users` creates the row) and no DELETE.
grant select (id, display_name, photo_url, created_at, prefilled, handle)
  on public.profiles to authenticated;
grant update (display_name, photo_url) on public.profiles to authenticated;

-- No INSERT and no UPDATE: a follow is written by one of three functions,
-- each of which says why the caller may follow that account. DELETE is
-- unfollowing, and removing a follower.
grant select, delete on public.follows to authenticated;

-- No UPDATE and no DELETE for anybody: a name everyone shares must not become
-- something else after the fact. `created_at` is unforgeable and `created_by`
-- unreadable, each by being absent from one of these lines.
grant select (id, search_id) on public.items to authenticated;
grant insert (id, search_id) on public.items to authenticated;

-- UPDATE is on `value` alone, so changing a thumb cannot re-point it at
-- another thing. `rated_at` and `revision` are in neither list: not writable,
-- not readable.
grant select (user_id, item_id, tag, value) on public.ratings to authenticated;
grant insert (user_id, item_id, tag, value) on public.ratings to authenticated;
grant update (value) on public.ratings to authenticated;
grant delete on public.ratings to authenticated;

-- `owner_id` is not selectable, and the token is made on the server, so a
-- client can neither choose one nor plant one. DELETE is turning the link off.
grant select (token, created_at) on public.invite_links to authenticated;
grant delete on public.invite_links to authenticated;

-- INSERT of the name alone. No SELECT: who reported what is nobody's to read,
-- the reporter's own rows included, so the table cannot be used to learn
-- anything.
grant insert (item_id) on public.reports to authenticated;

grant select (item_id, source, ref) on public.item_refs to authenticated;
grant insert (item_id, source, ref) on public.item_refs to authenticated;

-- A policy expression and a CHECK constraint name their functions by OID,
-- resolved when they were created, so evaluating one does no name lookup and
-- needs no USAGE on the schema, but it does check EXECUTE against the
-- querying role. Measured: without these, `select * from public.profiles` as
-- `authenticated` fails with "permission denied for function".
--
-- `authenticated` therefore holds EXECUTE on these and still cannot call any
-- of them, because the name `private.…` does not resolve for it. Each answers
-- only about the caller or about a string the caller supplied.
grant execute on function private.is_normalized_id(text)     to authenticated, service_role;
grant execute on function private.following()                to authenticated;
grant execute on function private.followers()                to authenticated;
grant execute on function private.is_unlocked()              to authenticated;
grant execute on function private.is_removed(text)           to authenticated;
grant execute on function private.unpurged_names()           to authenticated;
grant execute on function private.is_ref_removed(text, text) to authenticated;

grant execute on function public.record_debug_event(text, text) to authenticated;
grant execute on function public.account_locked()               to authenticated;
grant execute on function public.account_is_admin()             to authenticated;
grant execute on function public.set_invite_link()              to authenticated;
grant execute on function public.redeem_invite(text)            to authenticated;
grant execute on function public.follow_back(uuid)              to authenticated;
grant execute on function public.follow_prefilled(uuid)         to authenticated;
grant execute on function public.followed_stamps()              to authenticated;
grant execute on function public.account_thumbs(uuid)           to authenticated;
grant execute on function public.account_thumbs_since(uuid, bigint, bigint) to authenticated;
grant execute on function public.reported_names()               to authenticated;
grant execute on function public.remove_reported_name(text)     to authenticated;
grant execute on function public.dismiss_reports(text)          to authenticated;
grant execute on function public.remove_reference(text)         to authenticated;
grant execute on function public.import_thumbs(text, jsonb)     to authenticated;
grant execute on function public.import_state()                 to authenticated;
grant execute on function public.delete_account()               to authenticated;
-- Signed out too: the welcome screen names whose link it is.
grant execute on function public.invite_owner(text) to anon, authenticated;


-- Yourself, anyone you follow, anyone who follows you, and every prefilled
-- account. The first three are live relationships and end with them. The last
-- is public by design, to anyone signed in.
--
-- So `select * from profiles` returns exactly those, and no clause matches a
-- stranger: there is no lookup of a person by anything, and nothing here may
-- become one. A link's holder sees a name and a photo through `invite_owner`.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or prefilled
    or id = any ((select private.following())::uuid[])
    or id = any ((select private.followers())::uuid[])
  );

-- Your own row. A prefilled profile is nobody's own; saying so costs nothing
-- and does not depend on no session ever carrying its id.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and not prefilled)
  with check (id = (select auth.uid()) and not prefilled);

-- A row you are named in, at either end. So you can list who you follow and
-- who follows you, and nobody else's follows at all: who a prefilled account's
-- followers are is no client's to read, since no session is that account.
create policy follows_select on public.follows
  for select to authenticated
  using (follower_id = (select auth.uid()) or followed_id = (select auth.uid()));

-- The follower unfollows; the followed account removes a follower, which is
-- what makes being followed something a person agreed to.
create policy follows_delete on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()) or followed_id = (select auth.uid()));

-- A shared catalog: everyone signed in sees that a thing exists, and may add
-- one. What an id may be is a CHECK.
create policy items_select on public.items
  for select to authenticated
  using (true);

create policy items_insert on public.items
  for insert to authenticated
  with check (true);

-- Your own thumbs, and those of the accounts you follow, which is what a
-- follow is. Unfollowing, or being removed as a follower, ends the read with
-- the row. The array is an InitPlan, so a read of several accounts' thumbs is
-- index probes on the key's first column.
create policy ratings_select on public.ratings
  for select to authenticated
  using (user_id = (select auth.uid())
         or user_id = any ((select private.following())::uuid[]));

-- Writing is the owner's alone. Three policies rather than one `for all`,
-- which would have had to share the read's wider clause.
create policy ratings_insert on public.ratings
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy ratings_update on public.ratings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy ratings_delete on public.ratings
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy invite_links_select on public.invite_links
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy invite_links_delete on public.invite_links
  for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy reports_insert on public.reports
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- As shared as the catalog it annotates.
create policy item_refs_select on public.item_refs
  for select to authenticated
  using (true);

create policy item_refs_insert on public.item_refs
  for insert to authenticated
  with check (created_by = (select auth.uid()));

-- RESTRICTIVE, so these AND with the policies above instead of widening them:
-- those say whose row it is, these what name it may carry. A removed name
-- cannot be created, rated, linked or reported again.
create policy items_not_removed on public.items
  as restrictive for insert to authenticated
  with check (not private.is_removed(id));

create policy ratings_not_removed on public.ratings
  as restrictive for insert to authenticated
  with check (not private.is_removed(item_id) and not private.is_removed(tag));

create policy reports_not_removed on public.reports
  as restrictive for insert to authenticated
  with check (not private.is_removed(item_id));

create policy item_refs_not_removed on public.item_refs
  as restrictive for insert to authenticated
  with check (not private.is_ref_removed(source, ref)
              and not private.is_removed(item_id));

-- A thumb on a removed name is unreadable from the moment of removal, before
-- the purge has deleted it. Each call is a scalar subquery, so it is an
-- InitPlan evaluated once per statement, and the whole test short-circuits on
-- an empty set: `<> all` with a runtime array unpacks it on every row.
create policy ratings_not_removed_read on public.ratings
  as restrictive for select to authenticated
  using ((select cardinality(private.unpurged_names()) = 0)
         or (item_id <> all ((select private.unpurged_names())::text[])
             and tag <> all ((select private.unpurged_names())::text[])));
