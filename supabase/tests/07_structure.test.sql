-- The guarantees that are not policies: column and table privileges, default
-- privileges, and what the private schema holds shut.
--
-- Everything here is read from the catalog or run from a plain `authenticated`
-- session, so a migration that widens a grant fails here rather than in a
-- review somebody skims.

begin;
select plan(43);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test

set local role postgres;

-- `anon` holds nothing but one call: with no anonymous sessions a first visit
-- is signed out, and signed out reads and writes nothing except whose
-- link it is holding, by that link's exact token (`invite_owner`).
select is(
  (select coalesce(string_agg(distinct table_name || '/' || privilege_type, ', '), '')
   from information_schema.role_table_grants
   where table_schema in ('public', 'private') and grantee = 'anon'),
  '', 'anon holds no table privilege anywhere');
select is(
  (select coalesce(string_agg(distinct routine_name, ', '), '')
   from information_schema.role_routine_grants
   where specific_schema in ('public', 'private') and grantee = 'anon'),
  'invite_owner', 'and EXECUTE on the one lookup a link authorizes, and nothing else');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'private' and grantee in ('anon', 'authenticated')),
  0, 'neither client role holds a grant on anything in schema private');
select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon holds no USAGE on the schema');
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'and neither does authenticated — both locks, not one');

-- Postgres grants EXECUTE on a new function to PUBLIC by default. Every
-- function here must carry an explicit ACL with PUBLIC out of it: `proacl` is
-- NULL exactly when a function is still at that built-in default.
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  '', 'no function in public or private is executable by PUBLIC');

-- A trigger fires with no EXECUTE check (that check happens once, when the
-- trigger is created), so the revokes cost the triggers nothing, and the
-- profile this suite's `insert into auth.users` made is the proof.
select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  1, 'and the trigger that wrote this profile still fired, with no EXECUTE to fire under');

-- The asymmetry the policies rest on, and it is not what it looks like: a
-- policy expression names its functions by OID, resolved when the policy was
-- created, so evaluating one does no name lookup and needs no schema USAGE,
-- but it does check EXECUTE against the querying role. So `authenticated`
-- holds EXECUTE on exactly the helpers a policy or a CHECK calls, and on
-- nothing else in the schema.
select is(
  (select string_agg(p.proname, ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')),
  'followers,following,is_normalized_id,is_ref_removed,is_removed,is_unlocked,unpurged_names',
  'authenticated holds EXECUTE on the policy helpers and on nothing else in private');
select ok(
  not has_function_privilege('authenticated', 'private.is_unlocked(uuid)', 'execute'),
  'and of the two lock checks, only the one about the caller');

-- Everything a client can call, by name. A function added to `public` shows
-- up here, which is the point: it is one more thing every signed-in account
-- can run.
select is(
  (select string_agg(p.proname, ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')),
  'account_is_admin,account_locked,account_thumbs,account_thumbs_since,delete_account,dismiss_reports,'
  'follow_back,follow_prefilled,followed_stamps,import_state,import_thumbs,invite_owner,'
  'record_debug_event,redeem_invite,remove_reference,remove_reported_name,reported_names,'
  'set_invite_link',
  'the whole list of what a signed-in client may call');
select is(
  (select string_agg(p.proname, ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and prosecdef = false),
  'account_thumbs',
  'and one of them runs as its caller, so the policies decide what it reads');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select count(*) from public.profiles$$,
  'so a read of the table the helper guards succeeds');
select throws_ok(
  $$select private.following()$$, '42501', null,
  'while calling that same helper by name is refused at the schema');
select throws_ok(
  $$select private.load_prefilled('critic', 'A Critic', '[]')$$, '42501', null,
  'and so is the loader of prefilled accounts, which is behind both locks');
select throws_ok(
  $$select 1 from private.write_budget$$, '42501', null,
  'and no table in private can be read');

-- A column absent from an insert grant takes its DEFAULT and is therefore
-- unforgeable.
set local role postgres;
select is(
  (select coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name), '')
   from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE')
     and (table_name, column_name) in (
       ('items', 'created_at'), ('items', 'created_by'),
       ('follows', 'since'), ('ratings', 'rated_at'),
       ('profiles', 'created_at'), ('profiles', 'prefilled'), ('profiles', 'handle'),
       ('profiles', 'tags'), ('profiles', 'id'))),
  '', 'no insert or update grant admits a column the server owns');

-- A column absent from a select grant is in no response.
select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'items' and column_name = 'created_by'
     and grantee in ('anon', 'authenticated')),
  0, 'and created_by is in no select grant, so creation stays unattributed');

-- What one account may know of another: a name, a face, and for a prefilled
-- account its handle and the attributes its thumbs use. No contact detail is a
-- column at all.
select is(
  (select string_agg(column_name, ',' order by column_name)
   from information_schema.column_privileges
   where table_schema = 'public' and grantee = 'authenticated' and table_name = 'profiles'
     and privilege_type = 'SELECT'),
  'created_at,display_name,handle,id,photo_url,prefilled,tags',
  'a profile is readable as its name, photo, and a prefilled account''s handle and tags');

-- When a thumb was given is in no response at all: a follower reading it
-- would have a record of that person's days.
select is(
  (select string_agg(column_name, ',' order by column_name)
   from information_schema.column_privileges
   where table_schema = 'public' and grantee = 'authenticated' and table_name = 'ratings'
     and privilege_type = 'SELECT'),
  'item_id,tag,user_id,value', 'a thumb is readable as whose, on what, and which way');

-- The whole of what a client may do to each table, in one place. A verb that
-- is not here is "nobody has it".
select is(
  (select string_agg(t || ':' || verbs, ' ' order by t)
     from (select table_name as t,
                  string_agg(distinct privilege_type, ',' order by privilege_type) as verbs
             from (select table_name, privilege_type from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'authenticated'
                   union
                   select table_name, privilege_type from information_schema.column_privileges
                    where table_schema = 'public' and grantee = 'authenticated') g
            group by table_name) per_table),
  'follows:DELETE,SELECT invite_links:DELETE,SELECT item_refs:INSERT,SELECT '
  'items:INSERT,SELECT profiles:SELECT,UPDATE ratings:DELETE,INSERT,SELECT,UPDATE '
  'reports:INSERT',
  'every table verb a signed-in client holds');

-- The catalog's grants are per COLUMN, so they sit in `column_privileges` and
-- in no table-level row at all — which is also how `created_by` and
-- `created_at` are absent from one list while the table is readable.
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
   from information_schema.column_privileges
   where table_schema = 'public' and grantee = 'authenticated' and table_name = 'items'),
  'INSERT,SELECT', 'and the catalog has no update and no delete for anybody');
select is(
  (select string_agg(column_name, ',' order by column_name)
   from information_schema.column_privileges
   where table_schema = 'public' and grantee = 'authenticated' and table_name = 'items'
     and privilege_type = 'INSERT'),
  'id,search_id',
  'an item is written with an id and the stripped copy search matches, and nothing else');

select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and not rowsecurity),
  0, 'row-level security is on for every table in public');
select is(
  (select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname = 'public'),
  'follows,invite_links,item_refs,items,profiles,ratings,reports',
  'which are these seven');

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which is the
-- standing hazard: "no client verb" is not the default here, and has
-- to be arranged.
--
-- Probed by creating one rather than read out of `pg_default_acl`: what has to
-- hold is that the NEXT function somebody adds is not callable by everyone, and
-- which catalog row arranges that is not the claim. Asked with
-- `has_function_privilege` and not by counting PUBLIC out of `proacl`, because
-- `proacl` is NULL exactly when the function is at the built-in default — so
-- the reading that looks strictest passes even while `anon` can call anything
-- new in `public`.
-- `anon` is a member of PUBLIC, so one question covers both the built-in grant
-- and any grant by name.
create function public.default_privilege_probe() returns int language sql as $probe$ select 1 $probe$;
create function private.default_privilege_probe() returns int language sql as $probe$ select 1 $probe$;
select ok(
  not has_function_privilege('anon', 'public.default_privilege_probe()', 'execute'),
  'a function added to public is not callable by anon');
select ok(
  not has_function_privilege('authenticated', 'public.default_privilege_probe()', 'execute'),
  'nor by authenticated');
select ok(
  not has_function_privilege('anon', 'private.default_privilege_probe()', 'execute'),
  'and neither is one added to private, which is behind an address as well');

-- And the same question for a table. The platform installs `alter default
-- privileges in schema public grant all on tables to anon, authenticated`, so
-- without the schema's own default-privilege revokes the next table anybody
-- adds arrives with ALL granted to a client role and no migration is there to
-- catch it. Probed the same way: what has to hold is about the NEXT table, not
-- about a catalog row.
create table public.default_privilege_probe (id int primary key);
select ok(
  not has_table_privilege('anon', 'public.default_privilege_probe', 'select'),
  'a table added to public is not readable by anon without a grant that says so');
select ok(
  not has_table_privilege('authenticated', 'public.default_privilege_probe', 'select'),
  'nor by authenticated, which is the half the platform grants by default');

-- A link's token is a bearer secret its owner must be able to copy again, so
-- it is readable, and by its owner alone: the policy, not the grant, is what
-- narrows it (the enumeration probe below).
select is(
  (select coalesce(string_agg(column_name, ',' order by column_name), '')
   from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'invite_links'
     and grantee = 'authenticated' and privilege_type = 'SELECT'),
  'created_at,token', 'a link is readable as its token and when it was made, and not by owner id');
select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'invite_links'
     and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')),
  0, 'and no client may write one: the token is made on the server');
select is(
  (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), '')
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'invite_links' and grantee = 'authenticated'),
  'DELETE', 'the one table verb is turning the link off');

select ok(
  not has_function_privilege('anon', 'public.set_invite_link()', 'execute')
  and has_function_privilege('anon', 'public.invite_owner(text)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_invite(text)', 'execute'),
  'and signed out, only whose link it is');
select ok(
  not has_function_privilege('authenticated', 'private.spend_write()', 'execute')
  and not has_function_privilege('anon', 'private.spend_write()', 'execute'),
  'the budget spender is callable by neither client role');

-- The exact-key rule, for the two lookups that take a token.
select is(
  (select count(*)::int from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('invite_owner', 'redeem_invite', 'follow_back', 'follow_prefilled',
                     'account_thumbs', 'remove_reported_name', 'dismiss_reports',
                     'remove_reference')
     and prosrc ~* '(like|ilike|similar to)'),
  0, 'the lookups by token, account and name carry no pattern operator');

-- Enumeration is the default, so seed twenty accounts, each with a link, a
-- thumb and a follow of the next, none of whom follows or is followed by the
-- caller. The whole-table reads still return the caller alone.
set local role postgres;
insert into auth.users (id)
  select ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 20) as n;
insert into public.invite_links (owner_id, token)
  select id, left(replace(id::text || id::text, '-', ''), 43) from public.profiles;
insert into public.ratings (user_id, item_id, value)
  select id, 'café bleu', 1 from public.profiles;
insert into public.follows (follower_id, followed_id)
  select ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
         ('aaaaaaaa-0000-0000-0000-' || lpad((n % 20 + 1)::text, 12, '0'))::uuid
    from generate_series(1, 20) as n;

set local role authenticated;
select is(
  (select count(*)::int from public.profiles),
  1, 'twenty strangers later, the profile read is still one row');
select is(
  (select count(*)::int from public.ratings),
  1, 'the thumb read is the caller''s own thumb');
select is(
  (select count(*)::int from public.follows),
  0, 'the follow read is empty: none of them names the caller');
select is(
  (select count(*)::int from public.followed_stamps()),
  0, 'no account answers with a stamp');
select is(
  public.account_thumbs('aaaaaaaa-0000-0000-0000-000000000001'),
  '{}'::jsonb, 'and asking for a stranger''s thumbs by id answers nothing');
select is(
  (select count(*)::int from public.invite_links),
  1, 'and the link read is the caller''s own link');
select is(
  (select count(*)::int from public.invite_links
    where token = left(replace('aaaaaaaa-0000-0000-0000-000000000001' ||
                               'aaaaaaaa-0000-0000-0000-000000000001', '-', ''), 43)),
  0, 'and filtering on somebody else''s token finds nothing');

-- There is no column for an email address or a phone number: a contact detail
-- exists in exactly one place, the auth account, in a schema the API does not
-- serve and no policy exposes.
set local role postgres;
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public'
     and column_name ~* '(email|phone|e_mail)'),
  0, 'no table in public has a column for an address or a number');

select * from finish();
rollback;
