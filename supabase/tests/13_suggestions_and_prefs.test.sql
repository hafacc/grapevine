-- Suggestions (owner read, no client write) and prefs.
--
-- A suggestion names a person and says the algorithm thinks you two agree, so a
-- planted entry would be a stranger presented as vouched for — and reading
-- somebody else's list is reading who they were told about. The row is a name
-- and an order; what a row shows beside the name is the attributes the two of
-- you agree on against the grain, computed on request and stored nowhere
-- (DESIGN §5.1).

begin;
select plan(30);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'viewer@example.com',   now()),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com', now()),
  ('33333333-3333-3333-3333-333333333333', 'far@example.com',      now());

update public.profiles set display_name = 'Far One', username = 'far_one', searchable = true
  where id = '33333333-3333-3333-3333-333333333333';
update public.user_prefs set discoverable_by_taste = true
  where user_id = '33333333-3333-3333-3333-333333333333';

insert into public.suggestions (user_id, rank, suggested_id) values
  ('11111111-1111-1111-1111-111111111111', 1, '33333333-3333-3333-3333-333333333333');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.suggestions), 1,
  'the owner reads their own suggestions');

-- The row carries no name: anyone in your own list is readable by you, which is
-- at most five rows and reveals strictly less than the suggestion already does.
select is(
  (select display_name from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'Far One', 'and the suggested person''s real row, through the suggestion policy');

select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'suggestions'),
  'user_id,rank,suggested_id',
  'a suggestion carries a name and an order, and no word about alignment at all');

select throws_ok(
  $$insert into public.suggestions (user_id, rank, suggested_id)
    values ((select auth.uid()), 2, '22222222-2222-2222-2222-222222222222')$$,
  '42501', null, 'nobody writes a suggestion, their owner included');
select throws_ok(
  $$update public.suggestions set rank = 2$$, '42501', null, 'nor edits one');
select throws_ok(
  $$delete from public.suggestions$$, '42501', null, 'nor removes one');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.suggestions), 0,
  'and another user reads none of mine');
select throws_ok(
  $$insert into public.suggestions (user_id, rank, suggested_id)
    values ('11111111-1111-1111-1111-111111111111', 2, (select auth.uid()))$$,
  '42501', null, 'nor plants themselves in it');


-- `public.shared_attributes` (DESIGN §5.1): the attributes the two of you
-- answered the same way AND against what the viewer's own network says about
-- the same thing. The grain is the viewer's own feed, so the fixture writes one.
set local role service_role;
insert into public.user_recs (user_id, computed_at, entries, feed_hash, error) values
  ('11111111-1111-1111-1111-111111111111', now(),
   '[{"itemId":"café bleu","score":0.2,"conf":1.4,
      "tags":{"coffee":-0.8,"tea":-0.5,"bread":-0.5,"wifi":0.9,"pastry":1.0}}]'::jsonb,
   'abc', 0.04);
insert into public.ratings (user_id, item_id, tag, value) values
  ('11111111-1111-1111-1111-111111111111', 'café bleu', '',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'coffee',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'tea',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'bread',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'wifi',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'pastry',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'seats',  1),
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 'noise',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', '',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'coffee',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'tea',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'bread',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'wifi',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'pastry',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'seats',  1),
  ('33333333-3333-3333-3333-333333333333', 'café bleu', 'noise', -1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', 'coffee',  1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- `coffee` deviates by 1.8, `tea` and `bread` by 1.5 each, `wifi` by 0.1. So the
-- order is the deviation's and the tie is alphabetical; `wifi` is cut by the
-- three-chip cap; `pastry` scores exactly the consensus and deviates by nothing,
-- which is never a chip; `seats` has no score in the feed at all, so there is no
-- grain to go against; `noise` was answered the other way; and the thing itself
-- is not an attribute.
select is(
  public.shared_attributes('33333333-3333-3333-3333-333333333333'),
  '{coffee,bread,tea}'::text[],
  'a suggested person''s chips are the attributes you agree on against the grain');

-- An empty list and not an error: an error would separate "nothing in common"
-- from "not allowed to ask", which is itself an answer about somebody.
select is(
  public.shared_attributes('22222222-2222-2222-2222-222222222222'),
  '{}'::text[],
  'and somebody who neither asked you nor was suggested to you yields nothing');

set local role service_role;
insert into public.connect_requests (from_id, to_id) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select is(
  public.shared_attributes('22222222-2222-2222-2222-222222222222'),
  '{coffee}'::text[],
  'while somebody who sent you a request yields theirs — their own act, not the caller''s choice');

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and 0002's
-- revoke of that default is what this asks about: reachable by a signed-in
-- caller, because the client is who calls it, and by nobody else.
select ok(
  has_function_privilege('authenticated', 'public.shared_attributes(uuid)', 'execute'),
  'a signed-in caller may ask');
select ok(
  not has_function_privilege('anon', 'public.shared_attributes(uuid)', 'execute'),
  'and a signed-out one may not');


-- Only the viewer's own search rewrites their list, so a row naming somebody
-- who has since turned either switch off is still there. Every read it grants
-- ends anyway: the row, the profile and the chips — the last of which would
-- otherwise let the viewer probe that person's ratings by changing their own.
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
update public.user_prefs set discoverable_by_taste = false where user_id = (select auth.uid());
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.suggestions), 0,
  'a suggestion stops being readable the moment its person turns taste discovery off');
select is(
  (select count(*)::int from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  0, 'and so does their profile');
select is(
  public.shared_attributes('33333333-3333-3333-3333-333333333333'),
  '{}'::text[], 'and their chips');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
update public.user_prefs set discoverable_by_taste = true where user_id = (select auth.uid());
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.suggestions), 1,
  'and is readable again when they turn it back on');
select is(
  public.shared_attributes('33333333-3333-3333-3333-333333333333'),
  '{coffee,bread,tea}'::text[], 'chips included');

set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
update public.profiles set searchable = false where id = (select auth.uid());
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.suggestions), 0,
  'turning findability off ends it the same way');
select is(
  (select count(*)::int from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  0, 'profile included');
select is(
  public.shared_attributes('33333333-3333-3333-3333-333333333333'),
  '{}'::text[], 'and chips');


set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Discoverability is reciprocal: off means you are named to nobody and your own
-- list is written empty. One channel, both ways.
select lives_ok(
  $$update public.user_prefs set discoverable_by_taste = false where user_id = (select auth.uid())$$,
  'the owner turns discoverability off');

-- A dismissal is a claim about nobody but its owner's own screen, so several may
-- accumulate with no per-write cap.
select lives_ok(
  $$select public.dismiss_suggestion('33333333-3333-3333-3333-333333333333')$$,
  'and dismisses a suggestion');
select lives_ok(
  $$select public.dismiss_suggestion('22222222-2222-2222-2222-222222222222')$$,
  'and another');
select is(
  (select cardinality(dismissed_suggestions) from public.user_prefs where user_id = (select auth.uid())),
  2, 'both of which accumulate');
select lives_ok(
  $$select public.dismiss_suggestion('33333333-3333-3333-3333-333333333333')$$,
  'and dismissing one twice is not two entries');

-- A field nothing knows about is unspellable rather than refused, and a wrong
-- type is a cast error rather than a switch that reads as its default.
select throws_ok(
  $$update public.user_prefs set something_else = 1 where user_id = (select auth.uid())$$,
  '42703', null, 'a field no reader knows about cannot be written');
select throws_ok(
  $$update public.user_prefs set discoverable_by_taste = 'not a boolean'
    where user_id = (select auth.uid())$$,
  '22P02', null, 'and neither can a wrong type');

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_prefs
   where user_id = '11111111-1111-1111-1111-111111111111'),
  0, 'nobody else reads my prefs');
select lives_ok(
  $$update public.user_prefs set discoverable_by_taste = true
    where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'and a write at them moves nothing');

select * from finish();
rollback;
