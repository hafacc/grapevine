-- Deleting your own account, from the app (DESIGN §3.3, §4).
--
-- The whole of it is one `delete from auth.users` for the caller. Every row
-- about a person already hangs off that one by `on delete cascade` — profile,
-- ratings, both halves of every friendship, `user_recs`, `user_model`,
-- `invite_links`, `ratings_changed`, `write_budget`, and GoTrue's own
-- identities and sessions — and 17_account_deletion and 24_delete_account pin
-- that. `items.created_by` is the one reference
-- that is set null instead: a name is shared and outlives whoever added it.
--
-- A function rather than a second Edge Function: the admin API would need the
-- service key in a server for what is one statement under the caller's own
-- `auth.uid()`. A function rather than a client DELETE: no client role may be
-- given a verb on `auth.users`.

-- SECURITY DEFINER because deleting from `auth.users` is the one thing here
-- no client role may do; the function's owner can. What keeps that from being
-- a hazard is the same thing 0004's functions rely on: no argument at all. The
-- only account it can reach is `auth.uid()`, so there is no key to vary and
-- nothing to enumerate.
--
-- One thing does not hang off `auth.users` and is cleared by hand, because it
-- would otherwise carry the uuid past the account: `private.debug_events.user_id`
-- has no foreign key (a diagnostic must be writable before anything else about
-- the account is), and would keep the uuid for up to its seven-day TTL.
--
-- A signed-in caller whose account is already gone (a second tab, a retry
-- after a lost response) matches no row and succeeds, so a retry is harmless.
create function public.delete_account() returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  delete from private.debug_events d where d.user_id = v_me;

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

  delete from auth.users u where u.id = v_me;
end $$;

-- 0002's default-privilege flip already keeps PUBLIC off it; the revokes say
-- so independently of which role applied this file, as 0004's do.
revoke all on function public.delete_account() from public, anon, authenticated;
grant execute on function public.delete_account() to authenticated;


-- Deleting and signing in again must not reset anything (DESIGN §4). The one
-- thing an account carries from day to day that a fresh account would not is
-- today's spent write budget, so a deletion leaves behind a one-way fingerprint
-- of each identity the account signed in with, beside that UTC day's count,
-- and an account created from the same identity on the same day starts from
-- it. No email, no name and no uuid is kept.
--
-- The fingerprint is HMAC-SHA256 of `provider:provider_id` — for Google,
-- `provider_id` is the account's stable subject id — under a random key held
-- in Supabase Vault. Keyed, because a plain hash of a subject id can be
-- confirmed by anybody who knows the id; in Vault rather than a table, because
-- Vault keeps it encrypted at rest under a key held outside the database, so a
-- dump of `public`, `private` and `auth` (the backups CLAUDE.md describes)
-- carries fingerprints nobody can test a subject id against. The key is made
-- here, on the server that applies this, and is in no file.
--
-- Kept until the end of that UTC day and swept a few minutes after: the budget
-- it carries resets at midnight anyway, so a fingerprint older than its day has
-- nothing left to stop.
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets
                  where name = 'identity_fingerprint_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'identity_fingerprint_key',
      'HMAC key for private.deleted_identities (0012). Never leaves the database.');
  end if;
end $$;

create table private.deleted_identities (
  fingerprint  bytea primary key,
  day          date not null,
  writes       integer not null check (writes > 0)
);

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
-- because GoTrue writes the identity after the user: the profile the budget row
-- hangs off already exists by then (`handle_new_user`), and the identity is the
-- provider's own record, where `raw_user_meta_data` is the user's to edit.
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

select cron.schedule(
  'deleted-identities-sweep',
  '9 0 * * *',
  $$delete from private.deleted_identities where day < (now() at time zone 'utc')::date$$
);

-- Nobody calls either: one is a trigger, the other runs inside definers.
revoke all on function private.identity_fingerprint(text, text) from public, anon, authenticated;
revoke all on function private.carry_deleted_budget()          from public, anon, authenticated;
