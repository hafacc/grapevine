-- Invite-only. An account that follows no person is locked: every write it
-- could make is refused, and it has no link. Redeeming a live link unlocks it;
-- losing its last follow of a person locks it again, whichever end removed the
-- follow. Following a prefilled account and being followed unlock nothing.
-- Nothing is deleted for being locked.

begin;
select plan(50);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com',    now()),
  ('22222222-2222-2222-2222-222222222222', 'newcomer@example.com', now()),
  ('66666666-6666-6666-6666-666666666666', 'other@example.com',    now());
insert into public.profiles (id, display_name, prefilled, handle) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'A Critic', true, 'critic');
-- The owner and 6 follow each other, and 6 follows the newcomer.
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666'),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111'),
  ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222');
update public.profiles set display_name = 'Newcomer'
  where id = '22222222-2222-2222-2222-222222222222';
insert into public.items (id, search_id) values ('café bleu', 'cafe bleu');
-- A thumb from before the lock, as an account that lost its last follow has.
insert into public.ratings (user_id, item_id, value)
  values ('22222222-2222-2222-2222-222222222222', 'café bleu', -1);

create temporary table made (label text primary key, token text);
grant all on made to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.account_locked(), false, 'an account that follows a person is unlocked');
insert into made values ('owner', public.set_invite_link());

set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
insert into made values ('other', public.set_invite_link());

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.account_locked(), true,
  'an account that follows nobody is locked, though somebody follows it, and can read that it is');
select throws_ok(
  $$update public.ratings set value = 1 where user_id = (select auth.uid())$$,
  '42501', null, 'a locked account cannot turn a thumb over');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'dune', 1)$$,
  '42501', null, 'or give one');
select throws_ok(
  $$insert into public.items (id, search_id) values ('new thing', 'new thing')$$,
  '42501', null, 'or name a thing');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('café bleu', 'osm', 'n1')$$,
  '42501', null, 'or link one');
select throws_ok(
  $$insert into public.reports (item_id) values ('café bleu')$$, '42501', null,
  'or report one');
select throws_ok($$select public.set_invite_link()$$, '42501', null,
  'or make a link');
select throws_ok($$select public.record_debug_event('stall', 'x')$$, '42501', null,
  'or write a diagnostic');
select throws_ok($$update public.profiles set display_name = 'Renamed'$$, '42501', null,
  'or rename itself, refused rather than matching nothing');
select throws_ok($$delete from public.ratings where user_id = (select auth.uid())$$,
  '42501', null, 'or clear a thumb');
select throws_ok(
  $$select public.import_thumbs('imdb', '[]')$$, '42501', null, 'or import');
select throws_ok(
  $$select public.follow_back('66666666-6666-6666-6666-666666666666')$$, '42501', null,
  'or follow its follower back, which would be a way in with no link');
select throws_ok(
  $$select public.follow_prefilled('cccccccc-cccc-cccc-cccc-cccccccccccc')$$, '42501', null,
  'or follow a prefilled account');

-- Even holding such a follow, it is locked: a critic is not an invitation.
set local role postgres;
insert into public.follows (follower_id, followed_id) values
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
set local role authenticated;
select is(public.account_locked(), true, 'following a prefilled account unlocks nothing');
select throws_ok(
  $$update public.ratings set value = 1 where user_id = (select auth.uid())$$,
  '42501', null, 'so it still cannot rate');

select is(public.redeem_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null,
  'a dead link answers nothing');
select is(public.account_locked(), true, 'and unlocks nothing');

select is(public.redeem_invite((select token from made where label = 'owner')),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a live link answers with its owner, to a locked account too');
select is(public.account_locked(), false, 'and unlocks the account');
select lives_ok(
  $$update public.ratings set value = 1 where user_id = (select auth.uid())$$,
  'which can now rate');
select lives_ok(
  $$select public.follow_back('66666666-6666-6666-6666-666666666666')$$,
  'and follow its follower back');
insert into made values ('newcomer', public.set_invite_link());
select isnt((select token from made where label = 'newcomer'), null,
  'and make a link of its own');

-- Losing follows of people, one at a time. Unfollowing one of two changes
-- nothing.
delete from public.follows
 where follower_id = (select auth.uid()) and followed_id = '66666666-6666-6666-6666-666666666666';
select is(public.account_locked(), false, 'unfollowing one of two people leaves it unlocked');
select is((select count(*)::int from public.invite_links), 1, 'with its link');

-- The owner removes the newcomer as a follower: the last person it follows.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.follows
 where follower_id = '22222222-2222-2222-2222-222222222222' and followed_id = (select auth.uid());
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.account_locked(), true,
  'being removed by the last person it followed locks it again');
select is((select count(*)::int from public.follows where follower_id = (select auth.uid())), 1,
  'though it still follows the prefilled account');
select is((select count(*)::int from public.invite_links), 0, 'and its link is revoked');
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'newcomer'))),
  0, 'which answers nothing now');
select throws_ok($$select public.set_invite_link()$$, '42501', null,
  'and it cannot make another');
select is((select count(*)::int from public.ratings where user_id = (select auth.uid())), 1,
  'its ratings stay');
select lives_ok(
  $$delete from public.follows where follower_id = (select auth.uid())$$,
  'and it can still unfollow');

-- The other direction: 6 unfollows the only person it follows.
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is(public.account_locked(), false, '6 follows the owner, and is unlocked');
delete from public.follows where follower_id = (select auth.uid());
select is(public.account_locked(), true, 'unfollowing the last person locks the one who did it');
select is(
  (select count(*)::int from public.invite_owner((select token from made where label = 'other'))),
  0, 'and revokes their link');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.account_locked(), false, 'the owner, who still follows 6, stays unlocked');
select is((select count(*)::int from public.invite_links), 1,
  'and keeps a link (a new one, since it removed a follower: 22_follows)');

-- The owner's last follow goes with the other account.
set local role postgres;
delete from auth.users where id = '66666666-6666-6666-6666-666666666666';
set local role authenticated;
select is(public.account_locked(), true,
  'the last person it follows deleting their account locks the one left behind');
select is((select count(*)::int from public.invite_links), 0,
  'and revokes that one''s link');

-- The belt: the owner is locked and should have no link. One that outlived
-- the lock (the two-connection races in `races.sh`) is dead all the same.
set local role postgres;
set local request.jwt.claims = '';
insert into public.invite_links (owner_id, token) values
  ('11111111-1111-1111-1111-111111111111', 'StrayTokenStrayTokenStrayTokenStrayTokenStr');
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.redeem_invite('StrayTokenStrayTokenStrayTokenStrayTokenStr'), null,
  'a link whose owner is locked redeems as a dead one');
select is(public.account_locked(), true, 'and unlocks nobody');
set local role postgres;
select is((select count(*)::int from public.follows
            where followed_id = '11111111-1111-1111-1111-111111111111'), 0,
  'writing no follow');
select is((select count(*)::int from public.invite_links), 1,
  'and deleting nothing: the redeemer only read somebody else''s row');
delete from public.invite_links;
set local role authenticated;
select lives_ok($$select public.delete_account()$$, 'a locked account can delete itself');

set local role postgres;
select is(
  (select array_agg(id::text order by id) from auth.users),
  array['11111111-1111-1111-1111-111111111111'],
  'nothing else deletes a locked account');
select is(
  (select string_agg(jobname, ',' order by jobname) from cron.job),
  'cleared-thumbs-sweep,debug-ttl,deleted-identities-sweep,imports-sweep,removed-names-purge,'
  'write-budget-sweep',
  'and nothing scheduled sweeps one: these six are all that runs');
select ok(
  not has_function_privilege('anon', 'public.account_locked()', 'execute')
  and has_function_privilege('authenticated', 'public.account_locked()', 'execute'),
  'a signed-in account asks whether it is locked, and nobody signed out does');
select ok(
  not has_function_privilege('authenticated', 'private.is_unlocked(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.is_unlocked(uuid)', 'execute'),
  'no client asks about anybody else');
select ok(
  not has_function_privilege('authenticated', 'private.revoke_link_if_locked(uuid)', 'execute'),
  'and no client calls the revocation');

-- A Google account with no name is called "unknown".
insert into auth.users (id, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', '{}');
select is((select display_name from public.profiles
            where id = '77777777-7777-7777-7777-777777777777'),
  'unknown', 'a new account Google shares no name for is "unknown"');

select * from finish();
rollback;
