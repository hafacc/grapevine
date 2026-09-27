-- Reporting a thing's name, and the owner removing one (0013).

begin;
select plan(23);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'reporter@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'namer@example.com',    now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

insert into public.items (id, search_id, created_by) values
  ('bad name', 'bad name', '22222222-2222-2222-2222-222222222222'),
  ('café bleu', 'cafe bleu', '22222222-2222-2222-2222-222222222222');
insert into public.ratings (user_id, item_id, tag, value) values
  ('22222222-2222-2222-2222-222222222222', 'bad name', '', 1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', 'bad name', 1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', 'coffee', 1),
  ('11111111-1111-1111-1111-111111111111', 'bad name', '', -1);
insert into public.user_recs (user_id, computed_at, entries, feed_hash, error) values
  ('11111111-1111-1111-1111-111111111111', now(),
   '[{"itemId":"bad name","score":0.4,"conf":1,"tags":{}},
     {"itemId":"café bleu","score":0.2,"conf":1,"tags":{"bad name":0.5,"coffee":0.3}},
     {"itemId":"tea","score":0,"conf":0,"tags":{"bad name":0.4}}]'::jsonb,
   'h', 0.04);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into public.reports (item_id) values ('bad name')$$,
  'a signed-in person reports a name');
select throws_ok(
  $$insert into public.reports (item_id) values ('bad name')$$, '23505', null,
  'once: a second report of the same name is a duplicate');
select throws_ok(
  $$insert into public.reports (user_id, item_id)
    values ('22222222-2222-2222-2222-222222222222', 'café bleu')$$, '42501', null,
  'and never in somebody else''s name');
select throws_ok(
  $$insert into public.reports (item_id) values ('Not Folded')$$, '23514', null,
  'a report names an id, folded like any other');
select throws_ok(
  $$select count(*) from public.reports$$, '42501', null,
  'nobody reads reports through the API, not even their own');
select throws_ok(
  $$delete from public.reports$$, '42501', null, 'nor deletes one');
select throws_ok(
  $$update public.reports set item_id = 'café bleu'$$, '42501', null, 'nor changes one');
select throws_ok(
  $$select private.remove_name('bad name')$$, '42501', null,
  'and no client can remove a name');

set local role postgres;
select is(
  (select user_id from public.reports),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the report is filed under the caller');
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  1, 'and spent one write');
select ok(
  not has_table_privilege('anon', 'public.reports', 'insert'),
  'signed out, there is nothing to report with');

select is(private.remove_name('bad name'), 3,
  'removing the name deletes every thumb that names it, as a thing or an attribute');
select is((select count(*)::int from public.items where id = 'bad name'), 0,
  'and its catalog row');
select is((select count(*)::int from public.reports), 0, 'and its reports');
select is((select count(*)::int from public.ratings), 1,
  'and nothing else: the other attribute''s thumb stays');
select is(
  (select entries from public.user_recs
    where user_id = '11111111-1111-1111-1111-111111111111'),
  '[{"itemId":"café bleu","score":0.2,"conf":1,"tags":{"coffee":0.3}}]'::jsonb,
  'and it is gone from stored feeds, as a thing and as an attribute, with any entry it was the only reason for');
select lives_ok($$select private.remove_name('bad name')$$, 'removing twice is harmless');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$insert into public.items (id, search_id) values ('bad name', 'bad name')$$, '42501', null,
  'a removed name cannot be created again');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select auth.uid()), 'bad name', 1)$$, '42501', null,
  'nor rated into existence');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
    values ((select auth.uid()), 'café bleu', 'bad name', 1)$$, '42501', null,
  'nor used as an attribute');
select lives_ok(
  $$insert into public.items (id, search_id) values ('good name', 'good name')$$,
  'while any other name still can be');
select throws_ok(
  $$insert into public.reports (item_id) values ('bad name')$$, '42501', null,
  'nor reported again, which would put it back in the queue');

set local role postgres;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
insert into public.reports (user_id, item_id) values
  ('22222222-2222-2222-2222-222222222222', 'café bleu');
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.reports), 0,
  'a deleted account''s reports go with it');

select * from finish();
rollback;
