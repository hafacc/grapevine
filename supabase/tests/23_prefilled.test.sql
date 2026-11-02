-- Prefilled accounts: profiles the owner loads to hold a notable critic's or
-- source's taste. Each is a profile with a handle and no sign-in, readable by
-- anyone signed in, written by `private.load_prefilled` and by no client.

begin;
select plan(54);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'member@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'locked@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'person@example.com', now());
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
insert into private.removed_names (id) values ('a removed name');
insert into public.items (id, search_id) values ('café bleu', 'cafe bleu');

create temporary table loaded (run int primary key, answer jsonb);

-- The first load. As the owner would run it, but with a locked account's
-- session lying about: neither the lock nor anybody's budget is asked.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into loaded values (1, private.load_prefilled('critic', 'A Critic', '[
  {"item":"dune","search_id":"dune","value":1,"source":"wikidata","ref":"Q190192"},
  {"item":"dune","search_id":"dune","tag":"slow","value":-1},
  {"item":"café bleu","tag":"","value":1},
  {"item":"a removed name","search_id":"a removed name","value":1},
  {"item":"dune","tag":"a removed name","value":1}
]'));
set local request.jwt.claims = '';

select is(
  (select answer - 'id' from loaded where run = 1),
  '{"saved":3,"changed":0,"deleted":0,"skipped":2,"items":1,"refs":1}'::jsonb,
  'a load answers with what it did: thumbs on a removed name are left out');
select is(
  (select display_name || '/' || handle || '/' || prefilled from public.profiles
    where id = (select (answer ->> 'id')::uuid from loaded where run = 1)),
  'A Critic/critic/true', 'the account is a profile with its handle');
select is(
  (select count(*)::int from auth.users
    where id = (select (answer ->> 'id')::uuid from loaded where run = 1)),
  0, 'and no sign-in: nobody can be it');
select results_eq(
  $$select item_id, tag, value::int from public.ratings r
      join public.profiles p on p.id = r.user_id
     where p.handle = 'critic' order by item_id collate "C", tag$$,
  $$values ('café bleu'::text, ''::text, 1), ('dune', '', 1), ('dune', 'slow', -1)$$,
  'its thumbs are the array''s, less the removed name');
select ok(
  (select created_by is null and search_id = 'dune' from public.items where id = 'dune'),
  'a thing nobody had named is created, attributed to nobody');
select is((select count(*)::int from public.items where id = 'a removed name'), 0,
  'and a removed name is not');
select is(
  (select source || ':' || ref from public.item_refs where item_id = 'dune'),
  'wikidata:Q190192', 'a link given with a thing is added');
select is((select count(*)::int from private.write_budget), 0,
  'and nobody''s budget was spent');
select is((select tags from public.profiles where handle = 'critic'), '{slow}'::text[],
  'it carries the attributes its thumbs use, less a removed name');

-- The second load: the same account, and its thumbs made equal to the array.
update public.ratings set rated_at = 'epoch';
insert into loaded values (2, private.load_prefilled('critic', 'The Critic', '[
  {"item":"dune","value":-1,"source":"wikidata","ref":"Q999"},
  {"item":"café bleu","value":1},
  {"item":"tea","search_id":"tea","value":1,"source":"osm","ref":"not an osm id"},
  {"item":"dune ii","search_id":"dune ii","value":1,"source":"wikidata","ref":"Q190192"}
]'));
select is(
  (select answer ->> 'id' from loaded where run = 2),
  (select answer ->> 'id' from loaded where run = 1),
  'loading a handle again is the same account, with the same id');
select is(
  (select answer - 'id' from loaded where run = 2),
  '{"saved":2,"changed":1,"deleted":1,"skipped":0,"items":2,"refs":0}'::jsonb,
  'and answers with one turned over, one gone and two new');
select is((select count(*)::int from public.profiles where prefilled), 1, 'there is still one');
select is((select display_name from public.profiles where handle = 'critic'),
  'The Critic', 'renamed');
select results_eq(
  $$select item_id, tag, value::int, rated_at = now() from public.ratings r
      join public.profiles p on p.id = r.user_id
     where p.handle = 'critic' order by item_id collate "C", tag$$,
  $$values ('café bleu'::text, ''::text, 1, false), ('dune', '', -1, false),
           ('dune ii', '', 1, true), ('tea', '', 1, true)$$,
  'its thumbs equal the array exactly, and only the new ones are dated now');
select is(
  (select string_agg(item_id || '=' || ref, ',' order by item_id) from public.item_refs),
  'dune=Q190192',
  'a thing keeps the link it has, a link stays with the thing that holds it, and a malformed one is ignored');
select is((select tags from public.profiles where handle = 'critic'), '{}'::text[],
  'an account whose thumbs use no attribute carries none');

-- Loading nothing empties the account and keeps it.
select is(
  private.load_prefilled('critic', 'The Critic', '[]') - 'id',
  '{"saved":0,"changed":0,"deleted":4,"skipped":0,"items":0,"refs":0}'::jsonb,
  'an empty array clears its thumbs');
select is((select count(*)::int from public.profiles where handle = 'critic'), 1,
  'and the account stays, for whoever follows it');
select lives_ok(
  $$select private.load_prefilled('critic', 'The Critic',
      '[{"item":"dune","value":1},{"item":"dune","tag":"slow","value":-1},{"item":"tea","value":1},
        {"item":"tea","tag":"warm","value":1},{"item":"dune","tag":"warm","value":-1}]')$$,
  'and it loads again');
select is((select tags from public.profiles where handle = 'critic'), '{warm,slow}'::text[],
  'its attributes, the one on the most things first, whichever way the thumbs point');
select private.remove_name('warm');
select is((select tags from public.profiles where handle = 'critic'), '{slow}'::text[],
  'a removed name leaves its tags at once, before the purge reaches its thumbs');

-- A wrong entry fails the whole load, and names itself.
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '[{"item":"Not Folded","value":1}]')$$,
  '22023', null, 'a name that is not folded');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '[{"item":"dune","tag":"Slow","value":1}]')$$,
  '22023', null, 'an attribute that is not');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '[{"item":"dune","value":0}]')$$,
  '22023', null, 'a value that is not a thumb');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '[{"item":"dune"}]')$$,
  '22023', null, 'or no value');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic',
      '[{"item":"dune","value":1},{"item":"dune","tag":"","value":-1}]')$$,
  '22023', null, 'the same thumb twice');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '[{"item":"never named","value":1}]')$$,
  '22023', null, 'a new thing with no stripped copy to search by');
select throws_ok(
  $$select private.load_prefilled('critic', 'The Critic', '{"item":"dune","value":1}')$$,
  '22023', null, 'something that is not an array');
select throws_ok(
  $$select private.load_prefilled('Not A Handle', 'Somebody', '[]')$$,
  '23514', null, 'and a handle that is not one');
select is(
  (select count(*)::int from public.ratings r join public.profiles p on p.id = r.user_id
    where p.handle = 'critic'),
  5, 'none of which touched a thumb');

-- A profile is a person or a prefilled account, never half of each.
select throws_ok(
  $$insert into public.profiles (display_name, prefilled) values ('No Handle', true)$$,
  '23514', null, 'a prefilled account needs a handle');
select throws_ok(
  $$update public.profiles set handle = 'person' where id = '33333333-3333-3333-3333-333333333333'$$,
  '23514', null, 'and a person cannot have one');
select throws_ok(
  $$insert into public.profiles (display_name, prefilled, handle) values ('Twin', true, 'critic')$$,
  '23505', null, 'and a handle names one account');
select throws_ok(
  $$update public.profiles set tags = '{film}' where id = '33333333-3333-3333-3333-333333333333'$$,
  '23514', null, 'and a person carries no tags');
select is((select count(*)::int from public.profiles where not prefilled and tags is not null), 0,
  'none does');

-- What a client sees. Signed in, anyone: even a locked account, which follows
-- nobody.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select results_eq(
  $$select display_name, handle, prefilled, tags from public.profiles where prefilled$$,
  $$values ('The Critic'::text, 'critic'::text, true, '{slow}'::text[])$$,
  'any signed-in caller reads a prefilled account, a locked one included');
select is((select count(*)::int from public.profiles), 2,
  'which is all it reads besides itself');
select is((select count(*)::int from public.ratings), 0,
  'its thumbs are not readable for the looking: that takes a follow');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  public.account_thumbs((select id from public.profiles where handle = 'critic')),
  '{}'::jsonb, 'nor through the loader');
select lives_ok(
  $$select public.follow_prefilled((select id from public.profiles where handle = 'critic'))$$,
  'an unlocked account follows it');
select is(
  public.account_thumbs((select id from public.profiles where handle = 'critic')),
  '{"dune":{"":1,"slow":-1},"tea":{"":1}}'::jsonb, 'and then reads its thumbs');

-- No client writes one.
select lives_ok(
  $$update public.profiles set display_name = 'Defaced' where prefilled$$,
  'a client''s update of a prefilled profile runs');
select is((select display_name from public.profiles where prefilled), 'The Critic',
  'and changes nothing');
select throws_ok(
  $$update public.profiles set tags = '{spam}' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'and no client writes tags, not even onto its own row');
select throws_ok(
  $$insert into public.profiles (display_name, prefilled, handle) values ('Mine', true, 'mine')$$,
  '42501', null, 'nobody makes one');
select throws_ok(
  $$delete from public.profiles where prefilled$$, '42501', null, 'or deletes one');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ((select id from public.profiles where prefilled), 'dune ii', 1)$$,
  '42501', null, 'or rates in its name');
select throws_ok(
  $$select private.load_prefilled('mine', 'Mine', '[]')$$, '42501', null,
  'or calls the loader');

-- Even a session that somehow carried its id could not rename it.
set local request.jwt.claims = '';
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles where prefilled),
                    'role', 'authenticated')::text, true);
update public.profiles set display_name = 'Defaced' where prefilled;
select is((select display_name from public.profiles where prefilled), 'The Critic',
  'the update policy names prefilled accounts, and does not rest on no session being one');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select display_name from public.profiles where prefilled$$, '42501', null,
  'signed out, a prefilled account is not readable');

set local role postgres;
select ok(
  not has_function_privilege('anon', 'private.load_prefilled(text, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.load_prefilled(text, text, jsonb)', 'execute'),
  'neither client role holds the loader');
select ok(
  has_function_privilege('service_role', 'private.load_prefilled(text, text, jsonb)', 'execute'),
  'the service role does, over a direct connection');
select is(
  (select count(*)::int from pg_proc where proname = 'load_prefilled'
      and pronamespace = 'public'::regnamespace),
  0, 'and it is not in a schema the API serves');
select is(
  (select count(*)::int from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'profiles'
      and constraint_type = 'FOREIGN KEY'),
  0, 'a profile is tied to no auth row, which is what lets one exist with no sign-in');

select * from finish();
rollback;
