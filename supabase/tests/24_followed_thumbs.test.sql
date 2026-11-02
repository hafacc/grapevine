-- What a follow lets you read: the followed account's thumbs, and nothing of
-- anybody else's. The browser computes a list from them, so it loads each
-- followed account's thumbs whole (`account_thumbs`) and asks first which
-- accounts changed (`followed_stamps`). The read ends with the follow,
-- whichever end removed it. What a removed name hides is 19_lazy_removal's.

begin;
select plan(44);

-- V follows A and D. A follows nobody. B is a stranger to all of them.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'v@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'a@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'b@example.com', now()),
  ('44444444-4444-4444-4444-444444444444', 'd@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock is 15_invite_only's to test
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');
insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('11111111-1111-1111-1111-111111111111', 'tea',       '',           1, 'epoch'),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', '',           1, 'epoch'),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', 'late night', -1, 'epoch'),
  ('22222222-2222-2222-2222-222222222222', 'dune',      '',           -1, 'epoch'),
  ('33333333-3333-3333-3333-333333333333', 'dune',      '',           1, 'epoch');

create temporary table seen (label text primary key, stamp text not null);
grant all on seen to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The table itself.
select results_eq(
  $$select item_id, tag, value::int from public.ratings
     where user_id = '22222222-2222-2222-2222-222222222222'
     order by item_id collate "C", tag$$,
  $$values ('café bleu'::text, ''::text, 1), ('café bleu', 'late night', -1), ('dune', '', -1)$$,
  'a follower reads the followed account''s thumbs');
select is((select count(*)::int from public.ratings), 4,
  'which with its own is everything it reads: nothing of a stranger''s');
select is(
  (select count(*)::int from public.ratings where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'not even by naming the stranger');

-- The loader.
select is(
  public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  '{"café bleu":{"":1,"late night":-1},"dune":{"":-1}}'::jsonb,
  'account_thumbs nests thing to attribute to value, with the empty string for the thing itself');
select is(
  public.account_thumbs('11111111-1111-1111-1111-111111111111'),
  '{"tea":{"":1}}'::jsonb, 'the caller''s own load the same way');
select is(public.account_thumbs('33333333-3333-3333-3333-333333333333'), '{}'::jsonb,
  'an account the caller does not follow answers nothing');
select is(public.account_thumbs('99999999-9999-9999-9999-999999999999'), '{}'::jsonb,
  'a uuid that names nobody answers the same');
select is(public.account_thumbs('44444444-4444-4444-4444-444444444444'), '{}'::jsonb,
  'and so does a followed account that has rated nothing');
select is(public.account_thumbs(null), '{}'::jsonb, 'and a null');

-- The stamps. D is given the very thumbs A has, in one statement as A's were,
-- so the two accounts look the same to anybody who can read both.
set local role postgres;
insert into public.ratings (user_id, item_id, tag, value, rated_at) values
  ('44444444-4444-4444-4444-444444444444', 'café bleu', '',           1, 'epoch'),
  ('44444444-4444-4444-4444-444444444444', 'café bleu', 'late night', -1, 'epoch'),
  ('44444444-4444-4444-4444-444444444444', 'dune',      '',           -1, 'epoch');
create function pg_temp.stamp_of(p_user uuid) returns text language sql stable as
  $f$ select stamp from public.followed_stamps() where user_id = p_user $f$;
grant execute on function pg_temp.stamp_of(uuid) to authenticated;
set local role authenticated;

select is(
  (select string_agg(user_id::text, ',' order by user_id) from public.followed_stamps()),
  '22222222-2222-2222-2222-222222222222,44444444-4444-4444-4444-444444444444',
  'one stamp per followed account with a thumb, and none for the caller or a stranger');
select is(
  (select count(*)::int from public.followed_stamps() where stamp !~ '^[0-9a-f]{32}$'),
  0, 'each is 32 hex characters');
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), pg_temp.stamp_of('44444444-4444-4444-4444-444444444444'),
  'two accounts with identical thumbs, changed equally often, have different stamps: a stamp is a function of nothing a follower can see');
select throws_ok(
  $$select max(rated_at) from public.ratings$$, '42501', null,
  'when a thumb was given stays unreadable');
select throws_ok(
  $$select revision, salt from private.ratings_revision$$, '42501', null,
  'and so does what the stamp is made of');

-- It moves on every change to the account's thumbs, whoever made it.
insert into seen values ('start', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.ratings (user_id, item_id, value) values ((select auth.uid()), 'tea', 1);
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'start'),
  'a new thumb moves the stamp');
insert into seen values ('insert', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.ratings set value = 1 where user_id = (select auth.uid()) and item_id = 'dune';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'insert'),
  'a flip moves it');
insert into seen values ('flip', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));
select is(
  public.account_thumbs('22222222-2222-2222-2222-222222222222') -> 'dune',
  '{"":1}'::jsonb, 'and the load carries the flipped thumb');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.ratings where user_id = (select auth.uid()) and tag = 'late night';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'flip'),
  'a clear moves it, though no row is left to say so');
insert into seen values ('clear', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.ratings where user_id = (select auth.uid()) and item_id = 'tea';
insert into public.ratings (user_id, item_id, value) values ((select auth.uid()), 'chai', 1);
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'clear'),
  'a clear and a new thumb together move it, though the account holds as many as before');
insert into seen values ('swap', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));

-- A bulk import: two thumbs, two revisions.
set local role postgres;
create temporary table revision_before as
  select revision from private.ratings_revision where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.import_thumbs('imdb', '[
    {"id":"heat (1995 film)","search_id":"heat 1995 film","source":"wikidata","ref":"Q42","value":1},
    {"id":"alien (1979 film)","search_id":"alien 1979 film","source":"wikidata","ref":"Q43","value":-1}]') -> 'saved',
  '2'::jsonb, 'A imports two thumbs');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'swap'),
  'an import moves it');
insert into seen values ('import', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));
set local role postgres;
select is(
  (select revision from private.ratings_revision where user_id = '22222222-2222-2222-2222-222222222222'),
  (select revision + 2 from revision_before),
  'by one revision a thumb, so each can be asked for by the revision it was written at');
set local role authenticated;

-- The caller's own thumbs move nothing of a followed account's.
insert into public.ratings (user_id, item_id, value) values ((select auth.uid()), 'dune', 1);
select is(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'import'),
  'the caller''s own thumbs are in no stamp but their own');

-- A prefilled account, loaded and loaded again by the owner.
set local role postgres;
select private.load_prefilled('critic', 'A Critic',
  '[{"item":"dune","search_id":"dune","value":1},{"item":"chai","search_id":"chai","value":1}]');
insert into public.follows (follower_id, followed_id)
  select '11111111-1111-1111-1111-111111111111', id from public.profiles where handle = 'critic';
insert into seen select 'critic', pg_temp.stamp_of(id) from public.profiles where handle = 'critic';
select private.load_prefilled('critic', 'A Critic',
  '[{"item":"dune","search_id":"dune","value":1},{"item":"chai","search_id":"chai","value":1}]');
set local role authenticated;
select is(pg_temp.stamp_of((select id from public.profiles where handle = 'critic')),
          (select stamp from seen where label = 'critic'),
  'reloading a prefilled account with the thumbs it has moves nothing');
set local role postgres;
select private.load_prefilled('critic', 'A Critic',
  '[{"item":"dune","search_id":"dune","value":-1},{"item":"chai","search_id":"chai","value":1}]');
set local role authenticated;
select isnt(pg_temp.stamp_of((select id from public.profiles where handle = 'critic')),
            (select stamp from seen where label = 'critic'),
  'reloading it with one turned over moves its stamp');

-- A removed name: the removal moves every stamp (19_lazy_removal), and the
-- purge that later deletes the thumbs moves the stamp of whoever held one.
set local role postgres;
select private.remove_name('heat (1995 film)');
insert into seen values ('removed', pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'));
insert into seen values ('removed d', pg_temp.stamp_of('44444444-4444-4444-4444-444444444444'));
select private.purge_removed_names();
set local role authenticated;
select isnt(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), (select stamp from seen where label = 'removed'),
  'the purge moves the stamp of an account it deleted a thumb of');
select is(pg_temp.stamp_of('44444444-4444-4444-4444-444444444444'),
          (select stamp from seen where label = 'removed d'),
  'and of nobody else');

-- One-way: the followed account reads nothing of its follower's.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.ratings where user_id <> (select auth.uid())), 0,
  'being followed is not a read of the follower');
select is(public.account_thumbs('11111111-1111-1111-1111-111111111111'), '{}'::jsonb,
  'through the loader either');
select is((select count(*)::int from public.followed_stamps()), 0, 'or a stamp');

-- A stranger.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.ratings), 1, 'a stranger reads its own thumbs and no others');
select is(public.account_thumbs('22222222-2222-2222-2222-222222222222'), '{}'::jsonb,
  'gets nothing from the loader');
select is((select count(*)::int from public.followed_stamps()), 0, 'and no stamp row');

-- The read ends with the follow: unfollowing.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.follows
 where follower_id = (select auth.uid()) and followed_id = '22222222-2222-2222-2222-222222222222';
select is(
  (select count(*)::int from public.ratings where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'after unfollowing, their thumbs are unreadable');
select is(public.account_thumbs('22222222-2222-2222-2222-222222222222'), '{}'::jsonb,
  'through the loader too');
select is(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), null, 'and they have no stamp');

-- And being removed as a follower.
set local role postgres;
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
set local role authenticated;
select is(
  (select count(*)::int from public.ratings where user_id = '22222222-2222-2222-2222-222222222222'),
  4, 'following again reads them again');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.follows
 where follower_id = '11111111-1111-1111-1111-111111111111' and followed_id = (select auth.uid());
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.ratings where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'after being removed as a follower, their thumbs are unreadable');
select is(public.account_thumbs('22222222-2222-2222-2222-222222222222'), '{}'::jsonb,
  'through the loader too');
select is(pg_temp.stamp_of('22222222-2222-2222-2222-222222222222'), null, 'and they have no stamp');

-- Signed out.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.followed_stamps()$$, '42501', null,
  'signed out, there are no stamps');
select throws_ok(
  $$select public.account_thumbs('22222222-2222-2222-2222-222222222222')$$, '42501', null,
  'and no thumbs');

set local role postgres;
-- The loader must stay under the policies: as SECURITY DEFINER it would answer
-- for any uuid. The stamps cannot (they read a table no client may), so their
-- body carries the follow itself.
select ok(
  (select not prosecdef from pg_proc where oid = 'public.account_thumbs(uuid)'::regprocedure),
  'account_thumbs runs as its caller, so the policies on ratings decide what it returns');
select ok(
  (select prosecdef and prosrc like '%f.follower_id = (select auth.uid())%'
            and prosrc like '%unpurged_names%' and prosrc not like '%rated_at%'
     from pg_proc where oid = 'public.followed_stamps()'::regprocedure),
  'followed_stamps runs as its owner, names the caller''s follows and the removed names itself, and reads no time');

select * from finish();
rollback;
