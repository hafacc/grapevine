-- A thing's link to a public index (0018): insert-only, one per thing and one
-- thing per link, an id in its index's format, a write from the budget, gone
-- with the name, and an admin's to take off and block.

begin;
select plan(37);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com',  now()),
  ('22222222-2222-2222-2222-222222222222', 'member@example.com', now());
insert into private.admins (user_id) values ('11111111-1111-1111-1111-111111111111');
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

insert into public.items (id, search_id) values
  ('dune (novel)', 'dune novel'), ('dune', 'dune'), ('the spice book', 'the spice book'),
  ('joe''s pizza (university village, new york)', 'joes pizza university village new york'),
  ('bad name', 'bad name');
insert into public.ratings (user_id, item_id, value) values
  ('22222222-2222-2222-2222-222222222222', 'dune', 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune (novel)', 'wikidata', 'Q190192')$$,
  'a member links a thing to a Wikipedia page');
select lives_ok(
  $$insert into public.item_refs (item_id, source, ref)
    values ('joe''s pizza (university village, new york)', 'osm', 'n931799207')$$,
  'and a place to OpenStreetMap');
select results_eq(
  $$select item_id, source, ref from public.item_refs order by item_id$$,
  $$values ('dune (novel)'::text, 'wikidata'::text, 'Q190192'::text),
           ('joe''s pizza (university village, new york)', 'osm', 'n931799207')$$,
  'anyone signed in reads every link');
select throws_ok($$select created_by from public.item_refs$$, '42501', null,
  'but not who made it');
select throws_ok($$select created_at from public.item_refs$$, '42501', null,
  'or when');

select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'wikidata', 'Q190192')$$,
  '23505', null, 'a link already held by another thing is refused');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune (novel)', 'wikidata', 'Q1')$$,
  '23505', null, 'and a thing holds one link');
select throws_ok(
  $$update public.item_refs set ref = 'Q2' where item_id = 'dune (novel)'$$,
  '42501', null, 'nobody changes a link');
select throws_ok(
  $$delete from public.item_refs where item_id = 'dune (novel)'$$,
  '42501', null, 'or deletes one');

select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'wikidata', 'Q0')$$,
  '23514', null, 'a Wikidata id starting with zero is refused');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'wikidata', 'Q1/../x')$$,
  '23514', null, 'as is one carrying a path');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'osm', 'x12')$$,
  '23514', null, 'an OpenStreetMap id must be a node, way or relation');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'osm', 'n12?a=b')$$,
  '23514', null, 'and nothing else');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'imdb', 'tt0087182')$$,
  '23514', null, 'an index that is not listed is refused');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('not in the catalog', 'wikidata', 'Q5')$$,
  '23503', null, 'and a link needs its thing in the catalog');
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref, created_by)
    values ('dune', 'wikidata', 'Q25391', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, 'a link cannot be made in somebody else''s name');
select throws_ok($$select 1 from private.ref_sources$$, '42501', null,
  'the list of indices is not the client''s to read');

set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '22222222-2222-2222-2222-222222222222'),
  2, 'each link made spent one write, and a refused one none');
select is(
  (select created_by from public.item_refs where item_id = 'dune (novel)'),
  '22222222-2222-2222-2222-222222222222'::uuid, 'and it is its maker''s');
set local role authenticated;

-- An admin takes a wrong link off.
select throws_ok($$select public.remove_reference('dune (novel)')$$, '42501', null,
  'a member cannot take a link off');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$select public.remove_reference('dune (novel)')$$,
  'an admin can');
select is((select count(*)::int from public.item_refs where item_id = 'dune (novel)'), 0,
  'the link is gone');
select is((select count(*)::int from public.items where id = 'dune (novel)'), 1,
  'and the name stays');
select lives_ok($$select public.remove_reference('the spice book')$$,
  'taking off a link that is not there does nothing');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('the spice book', 'wikidata', 'Q190192')$$,
  '42501', null, 'the link taken off cannot come back, on any thing');
select lives_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune (novel)', 'wikidata', 'Q8')$$,
  'and the name can take another');

-- The owner's by hand, with no session: the private one, which no client
-- may call.
select throws_ok($$select private.remove_reference('dune (novel)')$$, '42501', null,
  'a signed-in account cannot call the unchecked removal');
reset role;
select ok(
  not has_function_privilege('authenticated', 'private.remove_reference(text)', 'execute')
  and not has_function_privilege('anon', 'private.remove_reference(text)', 'execute'),
  'and neither client role may execute it');
select lives_ok($$select private.remove_reference('dune (novel)')$$,
  'the owner takes a link off by hand');
select is((select count(*)::int from public.item_refs where item_id = 'dune (novel)'), 0,
  'the link is gone');
select is((select count(*)::int from private.removed_refs where source = 'wikidata' and ref = 'Q8'), 1,
  'and blocked');
set local role authenticated;

-- Removing the name takes its link.
select lives_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('bad name', 'wikidata', 'Q42')$$,
  'a link on a name about to be removed');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$select public.remove_reported_name('bad name')$$, 'the admin removes the name');
select is((select count(*)::int from public.item_refs where item_id = 'bad name'), 0,
  'and its link goes with it');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('the spice book', 'wikidata', 'Q42')$$,
  'the link itself is free again for another name');

-- A name the member rated before it had a link takes one with no new thumb.
select lives_ok(
  $$insert into public.item_refs (item_id, source, ref) values ('dune', 'wikidata', 'Q25391')$$,
  'a thing already rated is linked without a new thumb');
select is((select ref from public.item_refs where item_id = 'dune'), 'Q25391',
  'and the link is saved');

select * from finish();
rollback;
