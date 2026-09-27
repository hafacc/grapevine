-- No name or attribute may have a word that starts with `!`, `#` or `@` (0008):
-- the list's search reads each as an operator, so such a word could never be
-- searched for by its own name. The same rule is `isNormalizedId` in `shared/`.

begin;
select plan(15);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$insert into public.items (id, search_id) values ('!!!', '')$$,
  '23514', null, 'id: a ! at the front');
select throws_ok(
  $$insert into public.items (id, search_id) values ('not !hip', 'not hip')$$,
  '23514', null, 'id: a ! at the front of a later word');
select lives_ok(
  $$insert into public.items (id, search_id) values ('yahoo!', 'yahoo')$$,
  'a ! at the end of a word is punctuation');
select lives_ok(
  $$insert into public.items (id, search_id) values ('panic! at the disco', 'panic at the disco')$$,
  'and so is one before a space');
select lives_ok(
  $$insert into public.items (id, search_id) values ('a!b', 'ab')$$,
  'and one inside a word');

select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), '!hip', '', 1)$$,
  '23514', null, 'a rating''s item carries the rule');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), 'yahoo!', '!hip', 1)$$,
  '23514', null, 'and so does its attribute');
select lives_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), 'yahoo!', 'wow!', 1)$$,
  'an attribute ending in ! is fine');

select throws_ok(
  $$insert into public.items (id, search_id) values ('#1 hits', '1 hits')$$,
  '23514', null, 'id: a # at the front');
select throws_ok(
  $$insert into public.items (id, search_id) values ('at @home', 'at home')$$,
  '23514', null, 'id: an @ at the front of a later word');
select lives_ok(
  $$insert into public.items (id, search_id) values ('c# a@b', 'c ab')$$,
  'a # or @ inside a word is punctuation');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), 'yahoo!', '#hip', 1)$$,
  '23514', null, 'and an attribute carries it');

select lives_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), 'yahoo!', 'noise:loud', 1)$$,
  'an attribute may hold a :');
select lives_ok(
  $$insert into public.items (id, search_id) values ('star wars: a new hope', 'star wars a new hope')$$,
  'and so may a name');

reset role;
select ok(private.is_normalized_id('café bleu'), 'an ordinary id is still one');

select * from finish();
rollback;
