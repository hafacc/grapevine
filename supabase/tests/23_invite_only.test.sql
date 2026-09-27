-- Invite-only (0010). An account with no connection is locked: every write it
-- could make is refused, and it has no link. Redeeming a live link unlocks it;
-- removing its last connection locks it again. Nothing is deleted for being
-- locked.

begin;
select plan(31);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',    now()),
  ('22222222-2222-2222-2222-222222222222', 'newcomer@example.com', now()),
  ('66666666-6666-6666-6666-666666666666', 'friend@example.com',   now());
insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666'),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111');
update public.profiles set display_name = 'Newcomer'
  where id = '22222222-2222-2222-2222-222222222222';
insert into public.items (id, search_id) values ('café bleu', 'cafe bleu');
-- A thumb from before the lock, as an account that removed its last
-- connection has.
insert into public.ratings (user_id, item_id, value)
  values ('22222222-2222-2222-2222-222222222222', 'café bleu', -1);

create temporary table made (label text primary key, token text);
grant all on made to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.account_locked(), false, 'an account with a connection is unlocked');
insert into made values ('owner', public.set_invite_link());

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.account_locked(), true, 'an account with none is locked, and can read that it is');
select throws_ok(
  $$update public.ratings set value = 1 where user_id = (select auth.uid())$$,
  '42501', null, 'a locked account cannot rate');
select throws_ok(
  $$insert into public.items (id, search_id) values ('new thing', 'new thing')$$,
  '42501', null, 'or name a thing');
select throws_ok($$select public.set_invite_link()$$, '42501', null,
  'or make a link');
select throws_ok(
  $$update public.ratings set value = 1 where user_id = auth.uid()$$, '42501', null,
  'or turn a thumb over');
select throws_ok($$select public.record_debug_event('stall', 'x')$$, '42501', null,
  'or write a diagnostic');
select throws_ok($$update public.profiles set display_name = 'Renamed'$$, '42501', null,
  'or rename itself, refused rather than matching nothing');
select throws_ok($$delete from public.ratings where user_id = (select auth.uid())$$,
  '42501', null, 'or clear a thumb');

select is(public.redeem_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null,
  'a dead link answers nothing');
select is(public.account_locked(), true, 'and unlocks nothing');

select is(public.redeem_invite((select token from made where label = 'owner')),
  '11111111-1111-1111-1111-111111111111'::uuid, 'a live link answers with its owner');
select is(public.account_locked(), false, 'and unlocks the account');
select lives_ok(
  $$update public.ratings set value = 1 where user_id = (select auth.uid())$$,
  'which can now rate');
insert into made values ('newcomer', public.set_invite_link());
select isnt((select token from made where label = 'newcomer'), null,
  'and make a link of its own');

-- Removing the last connection.
delete from public.friendships
 where (user_id = auth.uid() and friend_id = '11111111-1111-1111-1111-111111111111')
    or (user_id = '11111111-1111-1111-1111-111111111111' and friend_id = auth.uid());
select is(public.account_locked(), true, 'removing its last connection locks it again');
select is((select count(*)::int from public.invite_links), 0, 'and revokes its link');
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'newcomer'))),
  0, 'which answers nothing now');
select throws_ok($$select public.set_invite_link()$$, '42501', null,
  'and it cannot make another');
select is((select count(*)::int from public.ratings where user_id = auth.uid()), 1,
  'its ratings stay');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.account_locked(), false, 'the other end, with a connection left, stays unlocked');
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'owner'))),
  1, 'and keeps its link');

-- The owner's last connection goes with the other account.
set local role postgres;
delete from auth.users where id = '66666666-6666-6666-6666-666666666666';
set local role authenticated;
select is(public.account_locked(), true,
  'a connection deleting its account locks the one left behind');
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'owner'))),
  0, 'and revokes that one''s link');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$select public.delete_account()$$, 'a locked account can delete itself');

set local role postgres;
select is(
  (select array_agg(id::text order by id) from auth.users),
  array['11111111-1111-1111-1111-111111111111'],
  'nothing else deletes a locked account');
select is((select count(*)::int from cron.job where jobname = 'unjoined-accounts-sweep'), 0,
  'and nothing sweeps one');
select ok(
  not has_function_privilege('anon', 'public.account_locked()', 'execute')
  and has_function_privilege('authenticated', 'public.account_locked()', 'execute'),
  'a signed-in account asks whether it is locked, and nobody signed out does');
select ok(
  not has_function_privilege('authenticated', 'private.is_unlocked(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.is_unlocked(uuid)', 'execute')
  and has_function_privilege('service_role', 'private.is_unlocked(uuid)', 'execute'),
  'no client asks about anybody else');
select ok(
  not has_function_privilege('authenticated', 'private.revoke_link_if_locked()', 'execute'),
  'and no client calls the revocation');

-- A Google account with no name is called "unknown".
insert into auth.users (id, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', '{}');
select is((select display_name from public.profiles
            where id = '77777777-7777-7777-7777-777777777777'),
  'unknown', 'a new account Google shares no name for is "unknown"');

select * from finish();
rollback;
