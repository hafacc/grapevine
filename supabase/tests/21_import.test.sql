-- Importing ratings: one function writes a chunk of names, links and
-- thumbs as its owner, under an allowance of its own — one import per source
-- every 30 days, 10 000 thumbs, open for a day — and checks everything a
-- client's own insert is checked for.

begin;
select plan(69);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'importer@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com',   now()),
  ('33333333-3333-3333-3333-333333333333', 'locked@example.com',   now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-importer', '11111111-1111-1111-1111-111111111111', '{}');
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

-- The catalog before: a film under another name that holds its link, a plain
-- name with no link, a name that holds a different link, and a thing the
-- importer rated by hand.
insert into public.items (id, search_id) values
  ('alien (1979 film)', 'alien 1979 film'),
  ('heat (1995 film)', 'heat 1995 film'),
  ('solaris', 'solaris'),
  ('paddington 2', 'paddington 2');
insert into public.item_refs (item_id, source, ref) values
  ('alien (1979 film)', 'wikidata', 'Q103569'),
  ('solaris', 'wikidata', 'Q1'),
  ('paddington 2', 'wikidata', 'Q29001566');
insert into public.ratings (user_id, item_id, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'paddington 2', -1, now() - interval '3 days');
insert into private.removed_names (id) values ('a removed name');
insert into private.removed_refs (source, ref) values ('wikidata', 'Q666');
delete from private.write_budget;

select ok(
  not has_function_privilege('anon', 'public.import_thumbs(text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.import_state()', 'execute')
  and has_function_privilege('authenticated', 'public.import_thumbs(text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.import_state()', 'execute'),
  'importing is for a signed-in account, and nobody else');
select is(
  (select array_agg(source order by source) from private.import_sources),
  array['goodreads', 'google-maps', 'imdb', 'letterboxd', 'netflix', 'spotify', 'storygraph', 'trakt'],
  'every source formats.ts recognizes can be imported');
select ok(
  not has_table_privilege('authenticated', 'private.imports', 'select')
  and not has_table_privilege('authenticated', 'private.import_sources', 'select')
  and not has_table_privilege('authenticated', 'private.deleted_imports', 'select')
  and not has_function_privilege('authenticated', 'private.sweep_imports()', 'execute'),
  'and what records an import is no client''s to read');

set local role authenticated;
select throws_ok(
  $$select public.import_thumbs('imdb', '[]')$$, '42501', null,
  'no session, no import');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$select public.import_thumbs('imdb',
      '[{"id":"dune (2021 film)","search_id":"dune 2021 film","source":"wikidata","ref":"Q60834962","value":1}]')$$,
  '42501', null, 'a locked account cannot import');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$select public.import_thumbs('yelp', '[]')$$, '22023', null,
  'a source that is not listed is refused');
select throws_ok(
  $$select public.import_thumbs('imdb', '{"id":"dune"}')$$, '22023', null,
  'things must be an array');
select throws_ok(
  $$select public.import_thumbs('imdb',
      (select jsonb_agg(jsonb_build_object('id', 'thing ' || n, 'search_id', 'thing ' || n,
                                           'source', 'wikidata', 'ref', 'Q' || n, 'value', 1))
         from generate_series(1, 501) n))$$,
  '22023', null, 'and no longer than a chunk');

set local role postgres;
select is((select count(*)::int from private.write_budget), 0,
  'a refused call spends nothing');
select is((select count(*)::int from private.imports), 0,
  'and starts no import');
set local role authenticated;

-- One chunk with every case in it.
create temp table answer on commit drop as
select public.import_thumbs('imdb', $json$[
  {"id":"dune (2021 film)","search_id":"dune 2021 film","source":"wikidata","ref":"Q60834962","value":1},
  {"id":"alien (film)","search_id":"alien film","source":"wikidata","ref":"Q103569","value":-1},
  {"id":"heat (1995 film)","search_id":"heat 1995 film","source":"wikidata","ref":"Q42198","value":1},
  {"id":"solaris","search_id":"solaris","source":"wikidata","ref":"Q2","value":1},
  {"id":"paddington 2","search_id":"paddington 2","source":"wikidata","ref":"Q29001566","value":1},
  {"id":"Cats","search_id":"cats","source":"wikidata","ref":"Q3","value":1},
  {"id":"cats (2019 film)","search_id":"cats 2019 film","source":"wikidata","ref":"Q0","value":-1},
  {"id":"cats (2019 film)","search_id":"cats 2019 film","source":"imdb","ref":"tt5697572","value":-1},
  {"id":"a removed name","search_id":"a removed name","source":"wikidata","ref":"Q4","value":1},
  {"id":"the room","search_id":"the room","source":"wikidata","ref":"Q666","value":-1},
  {"id":"tenet","search_id":"tenet","source":"wikidata","ref":"Q5","value":0},
  {"id":"dune again","search_id":"dune again","source":"wikidata","ref":"Q60834962","value":-1},
  {"id":"no link","search_id":"no link","value":1},
  "not a thing"
]$json$::jsonb) as counts;

select is((select counts from answer),
  '{"saved": 3, "kept": 1, "refused": 10, "over": 0, "left": 9997}'::jsonb,
  'the answer counts what was saved, kept and refused');

select is(
  (select value::int from public.ratings where item_id = 'dune (2021 film)'), 1,
  'a new thing is named, and rated');
select is(
  (select ref from public.item_refs where item_id = 'dune (2021 film)'), 'Q60834962',
  'and linked');
select is(
  (select value::int from public.ratings where item_id = 'alien (1979 film)'), -1,
  'a thumb goes on the thing that holds the link, whatever the file called it');
select is((select count(*)::int from public.items where id = 'alien (film)'), 0,
  'and no second name is made for it');
select is(
  (select ref from public.item_refs where item_id = 'heat (1995 film)'), 'Q42198',
  'a name with no link gains one');
select is((select count(*)::int from public.ratings where item_id = 'solaris'), 0,
  'a name that holds a different link is refused');
select is(
  (select value::int from public.ratings where item_id = 'paddington 2'), -1,
  'a thumb the importer already has is not overwritten');
select is(
  (select count(*)::int from public.items
    where id in ('Cats', 'cats (2019 film)', 'a removed name', 'the room', 'tenet',
                 'dune again', 'no link')),
  0, 'nothing is made for a bad name, a bad link, a removed name, a removed link, '
     'a value that is no thumb, a link sent twice or a thing with no link');
select is((select count(*)::int from public.ratings), 4,
  'three thumbs written, beside the one already there');

set local role postgres;
select is(
  (select created_by from public.items where id = 'dune (2021 film)'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'the name is its importer''s');
select is(
  (select created_by from public.item_refs where item_id = 'heat (1995 film)'),
  '11111111-1111-1111-1111-111111111111'::uuid, 'and so is the link');
select is(
  (select search_id from public.items where id = 'dune (2021 film)'), 'dune 2021 film',
  'with the stripped copy the client sent');
select is(
  (select count(*)::int from public.ratings
    where item_id <> 'paddington 2' and rated_at = now()),
  3, 'each thumb is stamped by the server''s clock');
select is(
  (select rated_at from public.ratings where item_id = 'paddington 2'),
  now() - interval '3 days', 'and the kept one keeps its own');
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  1, 'the chunk spent one write, not one a row');
select is(
  (select thumbs from private.imports
    where user_id = '11111111-1111-1111-1111-111111111111' and source = 'imdb'),
  3, 'and the import has counted its thumbs');
set local role authenticated;

-- A write by hand after it is counted as ever.
select lives_ok(
  $$insert into public.ratings (user_id, item_id, value)
    values ('11111111-1111-1111-1111-111111111111', 'solaris', 1)$$,
  'a thumb by hand in the same transaction');
set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  2, 'spends its write: the import''s exemption ended with the call');
set local role authenticated;

select results_eq(
  $$select source, open, thumbs_left, again_in_seconds from public.import_state()$$,
  $$values ('imdb'::text, true, 9997, 30 * 86400)$$,
  'the importer reads their own import: open, what is left, and how long until the next');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.import_state()), 0,
  'and nobody else''s');

-- A second person imports the same film: the catalog already has it.
select is(
  public.import_thumbs('letterboxd',
    '[{"id":"dune (2021 film)","search_id":"dune 2021 film","source":"wikidata","ref":"Q60834962","value":-1}]'),
  '{"saved": 1, "kept": 0, "refused": 0, "over": 0, "left": 9999}'::jsonb,
  'a second person''s import lands on the same thing');
select is((select count(*)::int from public.items where id = 'dune (2021 film)'), 1,
  'which is still one thing');

-- The same import goes on within its day.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  public.import_thumbs('imdb',
    '[{"id":"arrival (film)","search_id":"arrival film","source":"wikidata","ref":"Q20022676","value":1},
      {"id":"dune (2021 film)","search_id":"dune 2021 film","source":"wikidata","ref":"Q60834962","value":-1}]'),
  '{"saved": 1, "kept": 1, "refused": 0, "over": 0, "left": 9996}'::jsonb,
  'a later chunk of the same import adds to it, and sending a thing again changes nothing');
select is(
  (select value::int from public.ratings
    where user_id = '11111111-1111-1111-1111-111111111111' and item_id = 'dune (2021 film)'),
  1, 'the thumb from the first chunk stands');

-- Another source is another allowance.
select is(
  public.import_thumbs('goodreads',
    '[{"id":"dune (novel)","search_id":"dune novel","source":"wikidata","ref":"Q190192","value":1}]'),
  '{"saved": 1, "kept": 0, "refused": 0, "over": 0, "left": 9999}'::jsonb,
  'each source has its own allowance');
select is(
  public.import_thumbs('google-maps',
    '[{"id":"tartine bakery","search_id":"tartine bakery","source":"osm","ref":"n123456","value":1}]'),
  '{"saved": 1, "kept": 0, "refused": 0, "over": 0, "left": 9999}'::jsonb,
  'and a place is linked to OpenStreetMap');

-- A day on, the import has closed.
set local role postgres;
update private.imports set started_at = now() - interval '25 hours'
 where user_id = '11111111-1111-1111-1111-111111111111' and source = 'imdb';
set local role authenticated;
select throws_ok(
  $$select public.import_thumbs('imdb',
      '[{"id":"her (2013 film)","search_id":"her 2013 film","source":"wikidata","ref":"Q788822","value":1}]')$$,
  'GV429', null, 'a day after it began an import takes no more');
select is((select count(*)::int from public.items where id = 'her (2013 film)'), 0,
  'and writes nothing');
select results_eq(
  $$select open, again_in_seconds from public.import_state() where source = 'imdb'$$,
  $$values (false, 30 * 86400 - 25 * 3600)$$,
  'the importer is told it is closed, and for how long');
select is(
  (public.import_thumbs('letterboxd',
    '[{"id":"her (2013 film)","search_id":"her 2013 film","source":"wikidata","ref":"Q788822","value":1}]')
   ->> 'saved')::int,
  1, 'another source is still open to them');
set local role postgres;
select is(
  (select writes from private.write_budget
    where user_id = '11111111-1111-1111-1111-111111111111'),
  6, 'the refused chunk spent nothing');

-- Thirty days on, the next import starts from nothing.
update private.imports set started_at = now() - interval '720 hours'
 where user_id = '11111111-1111-1111-1111-111111111111' and source = 'imdb';
set local role authenticated;
select is((select count(*)::int from public.import_state() where source = 'imdb'), 0,
  'after 30 days the import no longer counts');
select is(
  public.import_thumbs('imdb',
    '[{"id":"moonlight (2016 film)","search_id":"moonlight 2016 film","source":"wikidata","ref":"Q22000542","value":1}]'),
  '{"saved": 1, "kept": 0, "refused": 0, "over": 0, "left": 9999}'::jsonb,
  'and the source can be imported again, with a whole allowance');
set local role postgres;
select is(
  (select started_at from private.imports
    where user_id = '11111111-1111-1111-1111-111111111111' and source = 'imdb'),
  now(), 'its 30 days run from this import');

-- The allowance is 10 000 thumbs.
update private.imports set thumbs = private.import_thumb_limit() - 1
 where user_id = '11111111-1111-1111-1111-111111111111' and source = 'imdb';
set local role authenticated;
select is(
  public.import_thumbs('imdb',
    '[{"id":"get out","search_id":"get out","source":"wikidata","ref":"Q27536918","value":1},
      {"id":"whiplash (2014 film)","search_id":"whiplash 2014 film","source":"wikidata","ref":"Q15648198","value":1},
      {"id":"inception","search_id":"inception","source":"wikidata","ref":"Q25188","value":1}]'),
  '{"saved": 1, "kept": 0, "refused": 0, "over": 2, "left": 0}'::jsonb,
  'an import stops at its allowance, in the order sent');
select is(
  (select count(*)::int from public.items where id in ('whiplash (2014 film)', 'inception')),
  0, 'and names nothing past it');
select is(
  public.import_thumbs('imdb',
    '[{"id":"inception","search_id":"inception","source":"wikidata","ref":"Q25188","value":1}]'),
  '{"saved": 0, "kept": 0, "refused": 0, "over": 1, "left": 0}'::jsonb,
  'a full import takes nothing more');

-- An import that wrote nothing has not started.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.import_thumbs('goodreads',
    '[{"id":"Bad Name","search_id":"bad name","source":"wikidata","ref":"Q7","value":1}]'),
  '{"saved": 0, "kept": 0, "refused": 1, "over": 0, "left": 10000}'::jsonb,
  'a chunk with nothing in it to save');
select is((select count(*)::int from public.import_state() where source = 'goodreads'), 0,
  'starts no import');

-- The daily limit still bounds the calls.
set local role postgres;
update private.write_budget set writes = private.daily_write_limit()
 where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select throws_ok(
  $$select public.import_thumbs('goodreads',
      '[{"id":"emma (novel)","search_id":"emma novel","source":"wikidata","ref":"Q223880","value":1}]')$$,
  'PT429', null, 'an account past its daily limit cannot send a chunk');

-- A removed name's thumbs: the name cannot come back through an import.
set local role postgres;
select private.remove_name('get out');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (public.import_thumbs('letterboxd',
    '[{"id":"get out","search_id":"get out","source":"wikidata","ref":"Q27536918","value":1}]')
   ->> 'refused')::int,
  1, 'a name removed since cannot be imported back');
select is((select count(*)::int from public.items where id = 'get out'), 0,
  'and is not in the catalog');

-- Deleting the account and signing in again resets no import.
set local role postgres;
update private.imports set started_at = now() - interval '240 hours'
 where user_id = '11111111-1111-1111-1111-111111111111' and source = 'goodreads';
update private.imports set started_at = now() - interval '744 hours'
 where user_id = '11111111-1111-1111-1111-111111111111' and source = 'google-maps';
set local role authenticated;
select lives_ok($$select public.delete_account()$$, 'the importer deletes their account');
set local role postgres;
select is((select count(*)::int from private.imports
            where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'the account''s imports go with it');
select is(
  (select array_agg(source order by source) from private.deleted_imports),
  array['goodreads', 'imdb', 'letterboxd'],
  'each import inside its 30 days is kept under the identity''s fingerprint');
select is(
  (select array_agg(column_name::text order by column_name)
     from information_schema.columns
    where table_schema = 'private' and table_name = 'deleted_imports'),
  array['fingerprint', 'source', 'started_at', 'thumbs'],
  'with no email, no name and no account id');
select is(
  (select count(distinct fingerprint)::int from private.deleted_imports
    where fingerprint = extensions.hmac('google:sub-importer',
      (select decrypted_secret from vault.decrypted_secrets
        where name = 'identity_fingerprint_key'), 'sha256')),
  1, 'the fingerprint is the keyed hash a deleted identity leaves');

insert into auth.users (id, email, email_confirmed_at) values
  ('55555555-5555-5555-5555-555555555555', 'importer@example.com', now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-importer', '55555555-5555-5555-5555-555555555555', '{}');
insert into public.follows (follower_id, followed_id) values
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222');
select is(
  (select array_agg(source order by source) from private.imports
    where user_id = '55555555-5555-5555-5555-555555555555'),
  array['goodreads', 'imdb', 'letterboxd'],
  'the same Google account, signed in again, starts with its imports made');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select throws_ok(
  $$select public.import_thumbs('goodreads',
      '[{"id":"emma (novel)","search_id":"emma novel","source":"wikidata","ref":"Q223880","value":1}]')$$,
  'GV429', null, 'so the 30 days hold across the deletion');
select is(
  (public.import_thumbs('google-maps',
    '[{"id":"tartine bakery","search_id":"tartine bakery","source":"osm","ref":"n123456","value":1}]')
   ->> 'saved')::int,
  1, 'and a source whose 30 days were up is open');

set local role postgres;
insert into auth.users (id, email, email_confirmed_at) values
  ('66666666-6666-6666-6666-666666666666', 'someone@example.com', now());
insert into auth.identities (provider, provider_id, user_id, identity_data) values
  ('google', 'sub-someone', '66666666-6666-6666-6666-666666666666', '{}');
select is((select count(*)::int from private.imports
            where user_id = '66666666-6666-6666-6666-666666666666'),
  0, 'a different Google account inherits nothing');

-- The nightly sweep.
update private.imports set started_at = now() - interval '720 hours'
 where user_id = '55555555-5555-5555-5555-555555555555' and source = 'imdb';
update private.deleted_imports set started_at = now() - interval '720 hours'
 where source = 'imdb';
do $$ begin
  execute (select command from cron.job where jobname = 'imports-sweep');
end $$;
select is(
  (select array_agg(source order by source) from private.imports
    where user_id = '55555555-5555-5555-5555-555555555555'),
  array['goodreads', 'google-maps', 'letterboxd'],
  'the sweep deletes an import past its 30 days');
select is(
  (select array_agg(source order by source) from private.deleted_imports),
  array['goodreads', 'letterboxd'],
  'and a deleted account''s');
select is(
  (select count(*)::int from private.imports where started_at + private.import_every() <= now()),
  0, 'leaving none that no longer counts');

-- The numbers, each written once.
select is(private.import_thumb_limit(), 10000, 'an import is 10 000 thumbs');
select is(private.import_chunk_limit(), 500, 'in chunks of 500');
select is(private.import_every(), interval '720 hours', 'once every 30 days');
select is(private.import_open_for(), interval '24 hours', 'and open for a day');

select * from finish();
rollback;
