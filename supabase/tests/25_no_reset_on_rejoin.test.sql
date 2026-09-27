-- Deleting an account and signing in again resets nothing (0012, DESIGN §4):
-- the day's spent write budget survives under a keyed fingerprint of the
-- Google identity, and only for that UTC day.

begin;
select plan(13);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'leaver@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'idle@example.com',   now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-leaver', '11111111-1111-1111-1111-111111111111', '{}'),
  ('google', 'sub-idle',   '33333333-3333-3333-3333-333333333333', '{}');

-- The leaver has spent the whole day's budget; the idle account nothing.
insert into private.write_budget (user_id, day, writes) values
  ('11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date,
   private.daily_write_limit());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$select public.delete_account()$$, 'the leaver deletes their account');
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$select public.delete_account()$$, 'so does an account that wrote nothing today');

set local role postgres;
select is((select count(*)::int from private.deleted_identities), 1,
  'one fingerprint is kept: an account that spent nothing leaves none');
select is(
  (select writes from private.deleted_identities),
  private.daily_write_limit(),
  'beside the day''s spent budget');
select is(
  (select fingerprint from private.deleted_identities),
  extensions.hmac('google:sub-leaver',
    (select decrypted_secret from vault.decrypted_secrets
      where name = 'identity_fingerprint_key'), 'sha256'),
  'the fingerprint is the keyed hash of the Google subject id');
select isnt(
  (select fingerprint from private.deleted_identities),
  extensions.digest('google:sub-leaver', 'sha256'),
  'and not a plain hash anybody holding the subject id could recompute');
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
    where table_schema = 'private' and table_name = 'deleted_identities'),
  array['day', 'fingerprint', 'writes'],
  'no email, no name and no account id is kept');
select ok(
  not has_table_privilege('authenticated', 'private.deleted_identities', 'select')
  and not has_function_privilege('authenticated',
        'private.identity_fingerprint(text, text)', 'execute'),
  'no client can read the fingerprints or compute one');

-- The same Google account signs in again: GoTrue writes the user, then the
-- identity.
insert into auth.users (id, email, email_confirmed_at) values
  ('55555555-5555-5555-5555-555555555555', 'leaver@example.com', now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-leaver', '55555555-5555-5555-5555-555555555555', '{}');

select is(
  (select writes from private.write_budget
    where user_id = '55555555-5555-5555-5555-555555555555'),
  private.daily_write_limit(),
  'the new account starts the day where the deleted one left it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select throws_ok(
  $$insert into public.items (id, search_id) values ('fresh start', 'fresh start')$$,
  'PT429', null,
  'so the daily limit holds across the deletion');

set local role postgres;
-- A different Google account starts at nothing.
insert into auth.users (id, email, email_confirmed_at) values
  ('66666666-6666-6666-6666-666666666666', 'someone@example.com', now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-someone', '66666666-6666-6666-6666-666666666666', '{}');
select is(
  (select count(*)::int from private.write_budget
    where user_id = '66666666-6666-6666-6666-666666666666'),
  0, 'a different Google account inherits nothing');

-- A fingerprint from an earlier day carries nothing, and the sweep takes it.
delete from auth.users where id = '55555555-5555-5555-5555-555555555555';
update private.deleted_identities set day = day - 1;
insert into auth.users (id, email, email_confirmed_at) values
  ('77777777-7777-7777-7777-777777777777', 'leaver@example.com', now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-leaver', '77777777-7777-7777-7777-777777777777', '{}');
select is(
  (select count(*)::int from private.write_budget
    where user_id = '77777777-7777-7777-7777-777777777777'),
  0, 'yesterday''s fingerprint carries nothing into today');

do $$ begin
  execute (select command from cron.job where jobname = 'deleted-identities-sweep');
end $$;
select is((select count(*)::int from private.deleted_identities), 0,
  'and the nightly sweep deletes it');

select * from finish();
rollback;
