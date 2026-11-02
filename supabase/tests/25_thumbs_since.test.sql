-- Reading only what changed. A browser keeps the thumbs it read from a
-- followed account and asks `account_thumbs_since` for the difference, by the
-- account's revision and the count of removed names it last saw. The claim
-- under test is one: applying each answer on top of what was held gives
-- exactly what `account_thumbs` would return in full.
--
-- That the answer is exact beside a writer who has not committed needs two
-- connections, and is `races.sh`'s.

begin;
select plan(58);

-- V follows A and D (who never rates). B is a stranger.
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
insert into public.ratings (user_id, item_id, tag, value) values
  ('11111111-1111-1111-1111-111111111111', 'tea',       '',           1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', '',           1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', 'late night', -1),
  ('22222222-2222-2222-2222-222222222222', 'dune',      '',           -1);

-- What a browser does. `held` is what it kept; `sync` asks for the difference
-- from there, applies it the way the function's comment says to, keeps the
-- result, and hands back the answer it was given.
create temporary table held (
  user_id uuid primary key, revision bigint, removed bigint, thumbs jsonb not null default '{}');
grant all on held to authenticated;

create function pg_temp.sync(p_user uuid) returns jsonb language plpgsql as $f$
declare
  v_held   held;
  v_answer jsonb;
  v_thumbs jsonb;
  v_item   text;
  v_key    jsonb;
begin
  select * into v_held from held h where h.user_id = p_user;
  v_answer := public.account_thumbs_since(p_user, v_held.revision, v_held.removed);
  if (v_answer ->> 'full')::boolean then
    v_thumbs := v_answer -> 'thumbs';
  else
    v_thumbs := coalesce(v_held.thumbs, '{}');
    for v_item in select jsonb_object_keys(v_answer -> 'thumbs') loop
      v_thumbs := jsonb_set(v_thumbs, array[v_item],
        coalesce(v_thumbs -> v_item, '{}') || (v_answer -> 'thumbs' -> v_item));
    end loop;
    for v_key in select jsonb_array_elements(v_answer -> 'cleared') loop
      v_item := v_key ->> 0;
      if v_thumbs ? v_item then
        v_thumbs := jsonb_set(v_thumbs, array[v_item], (v_thumbs -> v_item) - (v_key ->> 1));
        if v_thumbs -> v_item = '{}' then
          v_thumbs := v_thumbs - v_item;
        end if;
      end if;
    end loop;
  end if;
  insert into held values (p_user, (v_answer ->> 'revision')::bigint,
                           (v_answer ->> 'removed')::bigint, v_thumbs)
  on conflict (user_id) do update
    set revision = excluded.revision, removed = excluded.removed, thumbs = excluded.thumbs;
  return v_answer;
end $f$;
grant execute on function pg_temp.sync(uuid) to authenticated;

create temporary table answer (n int primary key, was jsonb);
grant all on answer to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- The first read.
insert into answer values (1, pg_temp.sync('22222222-2222-2222-2222-222222222222'));
select is(
  (select was from answer where n = 1),
  '{"revision":3,"removed":0,"full":true,"cleared":[],
    "thumbs":{"café bleu":{"":1,"late night":-1},"dune":{"":-1}}}'::jsonb,
  'holding nothing, the answer is everything, at the account''s revision');
select is((select thumbs from held), public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'which is what a full read returns');

-- Every way of holding nothing trustworthy is answered in full.
select is(
  (select count(*)::int
     from (values (0::bigint, 0::bigint), (-1, 0), (4, 0), (3, null), (3, 1), (null, 0)) as asked (rev, removed)
    where public.account_thumbs_since('22222222-2222-2222-2222-222222222222', asked.rev, asked.removed)
          = (select was from answer where n = 1)),
  6, 'a revision of zero, below it, or past the account''s, and a removed count that is missing or wrong, all read in full');

-- Nothing changed.
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":3,"removed":0,"full":false,"thumbs":{},"cleared":[]}'::jsonb,
  'an unchanged account answers an empty difference at the same revision');

-- A new thumb.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into public.ratings (user_id, item_id, value) values ((select auth.uid()), 'tea', 1);
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":4,"removed":0,"full":false,"thumbs":{"tea":{"":1}},"cleared":[]}'::jsonb,
  'a new thumb arrives alone');
select is((select thumbs from held), public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and applied, gives the full read');

-- A flip.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.ratings set value = 1 where user_id = (select auth.uid()) and item_id = 'dune';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":5,"removed":0,"full":false,"thumbs":{"dune":{"":1}},"cleared":[]}'::jsonb,
  'a flipped thumb arrives alone, with its new value');
select is((select thumbs from held), public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and applied, gives the full read');

-- Writing the value a thumb already has.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.ratings set value = 1 where user_id = (select auth.uid()) and item_id = 'dune';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":5,"removed":0,"full":false,"thumbs":{},"cleared":[]}'::jsonb,
  'a thumb rewritten with the value it has is no change, and takes no revision');

-- A clear.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.ratings where user_id = (select auth.uid()) and tag = 'late night';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":6,"removed":0,"full":false,"thumbs":{},"cleared":[["café bleu","late night"]]}'::jsonb,
  'a cleared thumb arrives as its key');
select is((select thumbs from held), public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and applied, gives the full read');

-- Cleared and given again before the reader is back: a key is never both.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.ratings where user_id = (select auth.uid()) and item_id = 'tea';
insert into public.ratings (user_id, item_id, value) values ((select auth.uid()), 'tea', -1);
delete from public.ratings where user_id = (select auth.uid()) and item_id = 'café bleu';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":9,"removed":0,"full":false,"thumbs":{"tea":{"":-1}},"cleared":[["café bleu",""]]}'::jsonb,
  'a thumb cleared and given again arrives as a thumb, and one cleared for good as a key');
select is((select thumbs from held), public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and applied, gives the full read, with the emptied thing gone');
-- A reader two steps behind gets both steps at once.
select is(
  public.account_thumbs_since('22222222-2222-2222-2222-222222222222', 5, 0),
  '{"revision":9,"removed":0,"full":false,"thumbs":{"tea":{"":-1}},
    "cleared":[["café bleu",""],["café bleu","late night"]]}'::jsonb,
  'a reader further behind is answered from where it was, in one difference');

-- A bulk import.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.import_thumbs('imdb', '[
    {"id":"heat (1995 film)","search_id":"heat 1995 film","source":"wikidata","ref":"Q42","value":1},
    {"id":"alien (1979 film)","search_id":"alien 1979 film","source":"wikidata","ref":"Q43","value":-1}]') -> 'saved',
  '2'::jsonb, 'A imports two thumbs');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222') - 'revision',
  '{"removed":0,"full":false,"cleared":[],
    "thumbs":{"heat (1995 film)":{"":1},"alien (1979 film)":{"":-1}}}'::jsonb,
  'an import arrives as the thumbs it wrote');
select is((select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222'),
          public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and applied, gives the full read');

-- A prefilled account, reloaded by the owner.
set local role postgres;
set local request.jwt.claims = '';
select private.load_prefilled('critic', 'A Critic', '[
  {"item":"dune","search_id":"dune","value":1},
  {"item":"dune","tag":"slow","value":-1},
  {"item":"chai","search_id":"chai","value":1}]');
create temporary table critic as select id from public.profiles where handle = 'critic';
grant select on critic to authenticated;
insert into public.follows (follower_id, followed_id)
  select '11111111-1111-1111-1111-111111111111', id from critic;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((pg_temp.sync((select id from critic)) ->> 'full')::boolean, true,
  'a prefilled account is first read in full');
set local role postgres;
set local request.jwt.claims = '';
select private.load_prefilled('critic', 'A Critic', '[
  {"item":"dune","search_id":"dune","value":-1},
  {"item":"chai","search_id":"chai","value":1},
  {"item":"tea","search_id":"tea","value":1}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  pg_temp.sync((select id from critic)) - 'revision',
  '{"removed":0,"full":false,"thumbs":{"dune":{"":-1},"tea":{"":1}},"cleared":[["dune","slow"]]}'::jsonb,
  'a reload arrives as what it turned over, added and took away, and nothing it left alone');
select is((select thumbs from held where user_id = (select id from critic)),
          public.account_thumbs((select id from critic)),
  'and applied, gives the full read');
set local role postgres;
select private.load_prefilled('critic', 'A Critic', '[
  {"item":"dune","search_id":"dune","value":-1},
  {"item":"chai","search_id":"chai","value":1},
  {"item":"tea","search_id":"tea","value":1}]');
set local role authenticated;
select is(
  pg_temp.sync((select id from critic)) - 'revision',
  '{"removed":0,"full":false,"thumbs":{},"cleared":[]}'::jsonb,
  'a reload with the thumbs it has is an empty difference');

-- Removing a name hides thumbs with no revision moving, so it forces a full
-- read; the purge that follows is then nothing the reader needs telling.
set local role postgres;
select private.remove_name('tea');
set local role authenticated;
insert into answer values (2, pg_temp.sync('22222222-2222-2222-2222-222222222222'));
select is(
  (select was - 'revision' from answer where n = 2),
  '{"removed":1,"full":true,"cleared":[],
    "thumbs":{"dune":{"":1},"heat (1995 film)":{"":1},"alien (1979 film)":{"":-1}}}'::jsonb,
  'a name removed since the last read forces a full one, without the name');
select is((select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222'),
          public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'which is the full read');
select is(
  (select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222') ? 'tea',
  false, 'so the reader no longer holds the removed name');
select is(
  public.account_thumbs_since('22222222-2222-2222-2222-222222222222', 1, 1) -> 'thumbs' ? 'tea',
  false, 'and a difference from an old revision does not carry it either, before the purge has run');
set local role postgres;
select is(private.purge_removed_names(), 3, 'the purge deletes every thumb on it: A''s, the critic''s and the reader''s own');
select is((select count(*)::int from private.ratings_cleared where item_id = 'tea' and revision >
            (select (was ->> 'revision')::bigint from answer where n = 2)), 0,
  'leaving no tombstone that would hand the removed name to a follower');
set local role authenticated;
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222') - 'revision',
  '{"removed":1,"full":false,"thumbs":{},"cleared":[]}'::jsonb,
  'so after the purge the reader is told of nothing');
select is((select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222'),
          public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'and still holds the full read');

-- A tombstone is kept 30 days. A reader who was away longer is below the
-- floor, and reads in full; one who was not, does not.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.ratings where user_id = (select auth.uid()) and item_id = 'dune';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into answer values
  (3, public.account_thumbs_since('22222222-2222-2222-2222-222222222222',
        (select revision from held where user_id = '22222222-2222-2222-2222-222222222222'), 1));
select is((select was -> 'cleared' from answer where n = 3), '[["dune",""]]'::jsonb,
  'while its tombstone is kept, a clear is a difference');
set local role postgres;
set local request.jwt.claims = '';
update private.ratings_cleared set cleared_at = now() - interval '31 days'
 where user_id = '22222222-2222-2222-2222-222222222222' and item_id = 'dune';
do $$ begin
  execute (select command from cron.job where jobname = 'cleared-thumbs-sweep');
end $$;
select is(
  (select count(*)::int from private.ratings_cleared
    where user_id = '22222222-2222-2222-2222-222222222222' and item_id = 'dune'),
  0, 'the sweep deletes a tombstone a month old');
select is(
  (select count(*)::int from private.ratings_cleared
    where user_id = '22222222-2222-2222-2222-222222222222'),
  2, 'and leaves the newer ones');
select is(
  (select floor from private.ratings_revision where user_id = '22222222-2222-2222-2222-222222222222'),
  (select (was ->> 'revision')::bigint from answer where n = 3),
  'and raises the account''s floor to the revision it swept');
select is(
  (select floor from private.ratings_revision where user_id = (select id from critic)),
  0::bigint, 'and nobody else''s');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into answer values (4, pg_temp.sync('22222222-2222-2222-2222-222222222222'));
select is(
  (select was - 'revision' from answer where n = 4),
  '{"removed":1,"full":true,"cleared":[],
    "thumbs":{"heat (1995 film)":{"":1},"alien (1979 film)":{"":-1}}}'::jsonb,
  'a reader below the floor is answered in full, since the clear it missed is remembered nowhere');
select is((select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222'),
          public.account_thumbs('22222222-2222-2222-2222-222222222222'),
  'which leaves it holding the full read');
select is(
  (pg_temp.sync('22222222-2222-2222-2222-222222222222') ->> 'full')::boolean, false,
  'a reader at the floor is not: nothing above it was swept');

-- The caller's own.
select is(
  public.account_thumbs_since('11111111-1111-1111-1111-111111111111', null, null) -> 'thumbs',
  '{}'::jsonb, 'the caller''s own thumbs read the same way: here none, its one having been on the removed name');
select is(
  (public.account_thumbs_since('11111111-1111-1111-1111-111111111111', null, null) ->> 'revision')::bigint,
  2::bigint, 'at the caller''s own revision, which the purge moved');

-- Nobody the caller may read: one answer, whoever it is not.
select is(
  public.account_thumbs_since('44444444-4444-4444-4444-444444444444', null, null),
  '{"revision":0,"removed":1,"full":true,"thumbs":{},"cleared":[]}'::jsonb,
  'a followed account that never rated answers an empty full read at revision zero');
select is(
  public.account_thumbs_since('33333333-3333-3333-3333-333333333333', null, null),
  public.account_thumbs_since('44444444-4444-4444-4444-444444444444', null, null),
  'and so does an account the caller does not follow');
select is(
  public.account_thumbs_since('99999999-9999-9999-9999-999999999999', 7, 1),
  public.account_thumbs_since('44444444-4444-4444-4444-444444444444', null, null),
  'and a uuid that names nobody, whatever revision is claimed');
select is(
  public.account_thumbs_since(null, null, null),
  public.account_thumbs_since('44444444-4444-4444-4444-444444444444', null, null),
  'and a null');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is(
  public.account_thumbs_since('22222222-2222-2222-2222-222222222222', null, null),
  '{"revision":0,"removed":1,"full":true,"thumbs":{},"cleared":[]}'::jsonb,
  'a stranger asking for A gets that same answer');
select is(
  public.account_thumbs_since('22222222-2222-2222-2222-222222222222', 9, 1),
  '{"revision":0,"removed":1,"full":true,"thumbs":{},"cleared":[]}'::jsonb,
  'with a guessed revision too: no difference, no tombstone, no revision');

-- One-way, and it ends with the follow.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  public.account_thumbs_since('11111111-1111-1111-1111-111111111111', null, null) ->> 'revision',
  '0', 'the followed account reads nothing of its follower');
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
delete from public.follows
 where follower_id = (select auth.uid()) and followed_id = '22222222-2222-2222-2222-222222222222';
select is(
  pg_temp.sync('22222222-2222-2222-2222-222222222222'),
  '{"revision":0,"removed":1,"full":true,"thumbs":{},"cleared":[]}'::jsonb,
  'after unfollowing, a reader holding a revision is answered an empty full read');
select is((select thumbs from held where user_id = '22222222-2222-2222-2222-222222222222'),
  '{}'::jsonb, 'which empties what it held');

-- What stays unreadable.
select throws_ok($$select revision from public.ratings$$, '42501', null,
  'no client reads a thumb''s revision');
select throws_ok(
  $$update public.ratings set revision = 0 where user_id = (select auth.uid())$$, '42501', null,
  'or writes one');
select throws_ok($$select 1 from private.ratings_cleared$$, '42501', null,
  'or reads a tombstone');
select throws_ok($$select 1 from private.ratings_revision$$, '42501', null,
  'or a counter');
select throws_ok($$select private.next_revision((select auth.uid()))$$, '42501', null,
  'or takes a revision by hand');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.account_thumbs_since('22222222-2222-2222-2222-222222222222', null, null)$$,
  '42501', null, 'signed out, there is nothing to read');

set local role postgres;
set local request.jwt.claims = '';
-- STABLE is load-bearing: it is what puts the revision and the rows on one
-- snapshot. VOLATILE would read each on its own.
select ok(
  (select prosecdef and provolatile = 's'
     from pg_proc where oid = 'public.account_thumbs_since(uuid, bigint, bigint)'::regprocedure),
  'the function runs as its owner and on its caller''s snapshot');
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'ratings' and column_name = 'revision'
      and grantee in ('anon', 'authenticated')),
  0, 'and the column it reads is in no client grant');

-- An account's deletion takes its tombstones and leaves none behind.
select lives_ok(
  $$delete from auth.users where id = '22222222-2222-2222-2222-222222222222'$$,
  'an account with thumbs and tombstones can be deleted');
select is(
  (select count(*)::int from private.ratings_cleared
    where user_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*)::int from private.ratings_revision
      where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'and neither its tombstones nor its counter outlive it');

select * from finish();
rollback;
