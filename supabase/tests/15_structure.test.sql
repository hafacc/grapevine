-- The guarantees that are not policies: column and table privileges, default
-- privileges, and what the private schema holds shut.
--
-- Everything here is read from the catalog or run from a plain `authenticated`
-- session, so a migration that widens a grant fails here rather than in a
-- review somebody skims.

begin;
select plan(34);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com', now());

set local role postgres;

-- `anon` holds nothing: with no anonymous sessions a first visit is signed out,
-- and signed out reads and writes nothing.
select is(
  (select coalesce(string_agg(distinct table_name || '/' || privilege_type, ', '), '')
   from information_schema.role_table_grants
   where table_schema in ('public', 'private') and grantee = 'anon'),
  '', 'anon holds no table privilege anywhere');
select is(
  (select coalesce(string_agg(distinct routine_name, ', '), '')
   from information_schema.role_routine_grants
   where specific_schema in ('public', 'private') and grantee = 'anon'),
  '', 'and no EXECUTE on anything either');

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

-- `private.neighbourhood` returns the raw ratings of up to N_max people, so a
-- grant on it, or a move into `public`, hands every viewer the ratings of
-- everyone within two hops and breaks DESIGN §4's "nothing about another user
-- is ever computed on a client".
select ok(
  not has_function_privilege('anon', 'private.neighbourhood(uuid, int, int)', 'execute'),
  'the neighbourhood loader carries no EXECUTE for anon');
select ok(
  not has_function_privilege('authenticated', 'private.neighbourhood(uuid, int, int)', 'execute'),
  'nor for authenticated');
select ok(
  not has_function_privilege('anon', 'private.load_nodes(uuid[])', 'execute'),
  'and neither does the boundary-round loader, for anon');
select ok(
  not has_function_privilege('authenticated', 'private.load_nodes(uuid[])', 'execute'),
  'nor for authenticated');
select ok(
  has_function_privilege('service_role', 'private.neighbourhood(uuid, int, int)', 'execute'),
  'while service_role, which reaches them over a direct connection, does');

-- The eight functions in 0001 are created before 0002 turns off
-- Postgres' default of granting EXECUTE on a new function to PUBLIC, so a
-- revoke list that named only the functions created after it would leave them
-- at `proacl = NULL` — the built-in default, which is EXECUTE to PUBLIC. None is
-- reachable (no USAGE on the schema, and six of them return `trigger`, which
-- is not a type a caller can pass or receive), but DESIGN §3.3 claims both locks rather
-- than one, and an exception that has to be discovered is not a lock.
--
-- `is_normalized_id` is the one of the eight that a client role really does
-- hold EXECUTE on, because a CHECK constraint calling a function checks it
-- against the role doing the INSERT. It is still behind the schema lock, and
-- PUBLIC is still not in its ACL, which is what this asks.
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('assert_symmetric', 'handle_new_user',
                       'stamp_ratings_changed', 'stamp_rating_flip',
                       'forget_suggestions_search',
                       'count_write', 'daily_write_limit', 'is_normalized_id')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0, 'the eight functions 0001 creates carry an explicit ACL, and PUBLIC is not in it');

-- A trigger fires with no EXECUTE check — that check happens once, when the
-- trigger is created — so the revoke above costs the triggers nothing, and
-- the profile this suite's `insert into auth.users` made is the proof.
select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  1, 'and the trigger that wrote this profile still fired, with no EXECUTE to fire under');

-- The asymmetry the policies rest on, and it is not what it looks like: a
-- policy expression names its functions by OID, resolved when the policy was
-- created, so evaluating one does no name lookup and needs no schema USAGE —
-- but it does check EXECUTE against the querying role. Without these grants
-- `select * from public.profiles` fails with "permission denied for function
-- is_friend".
select ok(
  has_function_privilege('authenticated', 'private.is_friend(uuid)', 'execute'),
  'the six policy helpers DO carry EXECUTE for authenticated');
select ok(
  has_function_privilege('authenticated', 'private.is_searchable(uuid)', 'execute'),
  'all six of them');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$select count(*) from public.profiles$$,
  'so a read of the table the helper guards succeeds');
select throws_ok(
  $$select private.is_friend('11111111-1111-1111-1111-111111111111')$$, '42501', null,
  'while calling that same helper by name is refused at the schema');
select throws_ok(
  $$select private.neighbourhood('11111111-1111-1111-1111-111111111111')$$, '42501', null,
  'and so is the loader, which is behind both locks');
select throws_ok(
  $$select private.load_nodes(array['11111111-1111-1111-1111-111111111111']::uuid[])$$, '42501', null,
  'and its boundary-round twin');

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
       ('friendships', 'since'), ('ratings', 'rated_at'),
       ('connect_requests', 'created_at'), ('profiles', 'created_at'),
       ('profiles', 'username'))),
  '', 'no insert or update grant admits a column the server owns');

-- A column absent from a select grant is in no response.
select is(
  (select count(*)::int from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'items' and column_name = 'created_by'
     and grantee in ('anon', 'authenticated')),
  0, 'and created_by is in no select grant, so creation stays unattributed');

-- "No update verb and no delete verb, for anyone" is a REVOKE.
select is(
  (select coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '
                              order by table_name || ':' || privilege_type), 'none')
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and table_name in ('user_recs', 'user_model', 'suggestions')),
  'suggestions:SELECT, user_recs:SELECT',
  'the three the server writes carry nothing but SELECT, and user_model not that');

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
   where schemaname = 'public' and not rowsecurity
     and tablename in ('profiles', 'friendships', 'connect_requests', 'items', 'ratings',
                       'user_prefs', 'user_recs', 'user_model', 'suggestions')),
  0, 'row-level security is on for all nine tables in public');

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which is the
-- hazard DESIGN §3.3 names: "no client verb" is not the default here, and has
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

-- And the same question for a table, which is the one 0002 answers only about
-- the tables that existed when it ran. The platform installs `alter default
-- privileges in schema public grant all on tables to anon, authenticated`, so
-- without 0002's own default-privilege revokes the next table anybody adds
-- arrives with ALL granted to a client role and no migration is there to catch
-- it. Probed the same way: what has to
-- hold is about the NEXT table, not about a catalog row.
create table public.default_privilege_probe (id int primary key);
select ok(
  not has_table_privilege('anon', 'public.default_privilege_probe', 'select'),
  'a table added to public is not readable by anon without a grant that says so');
select ok(
  not has_table_privilege('authenticated', 'public.default_privilege_probe', 'select'),
  'nor by authenticated, which is the half the platform grants by default');

-- A pattern, a prefix or an unbounded limit in either body is the enumeration
-- they exist to prevent, and that is not a detail to relax later.
select is(
  (select count(*)::int from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('find_by_username', 'profile_by_id')
     and (prosrc ~* '(like|ilike|similar to|%)' or prosrc !~* 'limit 1')),
  0, 'find_by_username and profile_by_id take an exact key and return one row');

set local role authenticated;
select is(
  (select count(*)::int from public.find_by_username('nobody_at_all')),
  0, 'and a handle nobody holds resolves to nothing');

-- Enumeration is the default, so seed twenty searchable accounts who are
-- neither friends nor counterparties of the caller. The whole-table read still
-- returns exactly one row.
set local role postgres;
insert into auth.users (id)
  select ('aaaaaaaa-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 20) as n;
update public.profiles
   set username = 'seeded_' || right(id::text, 3), searchable = true
 where id::text like 'aaaaaaaa-%';
-- Findable themselves, so the second read below is one row rather than none and
-- cannot pass by the caller simply being invisible.
update public.profiles set username = 'viewer_h', searchable = true
 where id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
select is(
  (select count(*)::int from public.profiles),
  1, 'twenty searchable strangers later, the table read is still one row');
select is(
  (select count(*)::int from public.profiles where searchable),
  1, 'and asking for the searchable ones by name does not widen it');

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
