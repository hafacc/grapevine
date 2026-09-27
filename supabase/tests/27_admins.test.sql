-- Admins (0014): a row in `private.admins`, which no client reads or writes.
-- An admin is never locked, and is the only caller the review queue answers:
-- everyone else gets nothing from the list and a refusal from the two writes.

begin;
select plan(28);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com',   now()),
  ('22222222-2222-2222-2222-222222222222', 'member@example.com',  now()),
  ('33333333-3333-3333-3333-333333333333', 'friend@example.com',  now()),
  ('44444444-4444-4444-4444-444444444444', 'loner@example.com',   now());
insert into private.admins (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.friendships (user_id, friend_id) values
  ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');
insert into public.items (id, search_id) values
  ('bad name', 'bad name'), ('fine name', 'fine name'), ('café bleu', 'cafe bleu');
insert into public.ratings (user_id, item_id, value) values
  ('22222222-2222-2222-2222-222222222222', 'bad name', 1),
  ('33333333-3333-3333-3333-333333333333', 'bad name', -1);
insert into public.reports (user_id, item_id) values
  ('22222222-2222-2222-2222-222222222222', 'bad name'),
  ('33333333-3333-3333-3333-333333333333', 'bad name'),
  ('22222222-2222-2222-2222-222222222222', 'fine name');
create temporary table made (token text);
grant all on made to authenticated;

set local role authenticated;

-- A member with a connection: unlocked, and not an admin.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(public.account_is_admin(), false, 'a member is not an admin');
select is((select count(*)::int from public.reported_names()), 0,
  'and the queue answers a member nothing');
select throws_ok($$select public.remove_reported_name('bad name')$$, '42501', null,
  'a member cannot remove a name');
select throws_ok($$select public.dismiss_reports('bad name')$$, '42501', null,
  'or dismiss its reports');
select throws_ok($$select 1 from private.admins$$, '42501', null,
  'or read who the admins are');
select throws_ok(
  $$insert into private.admins (user_id) values ((select auth.uid()))$$, '42501', null,
  'or make itself one');
select throws_ok($$select private.is_admin()$$, '42501', null,
  'or call the check directly');

-- A locked account fares no better.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(public.account_locked(), true, 'an account with no connection is locked');
select is((select count(*)::int from public.reported_names()), 0,
  'and the queue answers it nothing');
select throws_ok($$select public.remove_reported_name('bad name')$$, '42501', null,
  'and refuses its removal');

set local role postgres;
select is((select count(*)::int from public.reports), 3, 'nothing a non-admin did touched a report');
select is((select count(*)::int from public.ratings where item_id = 'bad name'), 2,
  'or a thumb');
set local role authenticated;

-- The admin: no connection, and not locked.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(public.account_is_admin(), true, 'an admin is one');
select is(public.account_locked(), false, 'and is not locked, with no connection');
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'café bleu', 1)$$,
  'so it can rate');
insert into made values (public.set_invite_link());
select isnt((select token from made), null, 'and make the first link');

select results_eq(
  $$select item_id, reports from public.reported_names()$$,
  $$values ('bad name'::text, 2), ('fine name'::text, 1)$$,
  'the queue lists each reported name with its count, most reported first');
select is(public.dismiss_reports('fine name'), 1, 'dismissing deletes the name''s reports');
select is((select count(*)::int from public.items where id = 'fine name'), 1,
  'and keeps the name');
select is(public.remove_reported_name('bad name'), 2,
  'removing answers with the thumbs it deleted');
select is((select count(*)::int from public.reported_names()), 0, 'and the queue is empty');

set local role postgres;
select is((select count(*)::int from public.items where id = 'bad name'), 0,
  'the removed name is gone from the catalog');
select ok(private.is_removed('bad name'), 'and cannot be typed back');

-- Losing admin with no connection locks the account, and takes its link.
delete from private.admins where user_id = '11111111-1111-1111-1111-111111111111';
select is((select count(*)::int from public.invite_links
            where owner_id = '11111111-1111-1111-1111-111111111111'), 0,
  'an admin removed with no connection loses its link');
select ok(not private.is_unlocked('11111111-1111-1111-1111-111111111111'),
  'and is locked');

select ok(
  not has_function_privilege('anon', 'public.account_is_admin()', 'execute')
  and not has_function_privilege('anon', 'public.reported_names()', 'execute')
  and not has_function_privilege('anon', 'public.remove_reported_name(text)', 'execute')
  and not has_function_privilege('anon', 'public.dismiss_reports(text)', 'execute'),
  'nobody signed out calls any of it');
select ok(
  not has_function_privilege('authenticated', 'private.is_admin()', 'execute')
  and not has_function_privilege('anon', 'private.is_admin()', 'execute')
  and not has_table_privilege('authenticated', 'private.admins', 'select')
  and not has_table_privilege('authenticated', 'private.admins', 'insert')
  and not has_table_privilege('anon', 'private.admins', 'select'),
  'no client holds the table or the check');
select ok(
  has_function_privilege('authenticated', 'public.reported_names()', 'execute')
  and has_function_privilege('authenticated', 'public.remove_reported_name(text)', 'execute')
  and has_function_privilege('authenticated', 'public.dismiss_reports(text)', 'execute'),
  'the queue is callable signed in, and answers only admins');

select * from finish();
rollback;
