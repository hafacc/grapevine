-- Deleting an account. A profile is not a foreign key to `auth.users` (a
-- prefilled account has no sign-in), so a trigger on the auth row takes the
-- profile and the profile's cascade takes everything else about the person.
-- The catalog does not go: a thing's name is shared and permanent, and every
-- thumb anywhere points at its id.

begin;
select plan(18);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'leaver@example.com',  now()),
  ('22222222-2222-2222-2222-222222222222', 'stayer@example.com',  now()),
  ('33333333-3333-3333-3333-333333333333', 'another@example.com', now());
insert into public.profiles (display_name, prefilled, handle) values ('A Critic', true, 'critic');

-- The leaver added something and the stayer rated it, so the item is load-
-- bearing for somebody else by the time its creator goes.
insert into public.items (id, search_id, created_by)
  values ('café bleu', 'cafe bleu', '11111111-1111-1111-1111-111111111111');
insert into public.item_refs (item_id, source, ref, created_by)
  values ('café bleu', 'osm', 'n42', '11111111-1111-1111-1111-111111111111');
insert into public.ratings (user_id, item_id, value) values
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', -1);
-- The leaver follows and is followed, by a person and a prefilled account.
-- The stayer follows nobody but the leaver; 3 follows the stayer as well.
insert into public.follows (follower_id, followed_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');
insert into public.follows (follower_id, followed_id)
  select '11111111-1111-1111-1111-111111111111', id from public.profiles where handle = 'critic';
insert into public.invite_links (owner_id, token) values
  ('22222222-2222-2222-2222-222222222222', 'StayerTokenStayerTokenStayerTokenStayerToke'),
  ('33333333-3333-3333-3333-333333333333', 'ThirdTokenThirdTokenThirdTokenThirdTokenThi');
insert into private.write_budget (user_id, day, writes) values
  ('11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date, 3);
insert into public.reports (user_id, item_id) values
  ('11111111-1111-1111-1111-111111111111', 'café bleu');
insert into private.debug_events (user_id, kind, detail) values
  ('11111111-1111-1111-1111-111111111111', 'stall', 'the leaver''s'),
  ('22222222-2222-2222-2222-222222222222', 'stall', 'the stayer''s');

set local role postgres;

-- With `created_by` at `no action`, the line below would raise 23503 and the
-- account could not be removed at all.
select lives_ok(
  $$delete from auth.users where id = '11111111-1111-1111-1111-111111111111'$$,
  'an account that added an item can be deleted');

select is((select count(*)::int from public.profiles
           where id = '11111111-1111-1111-1111-111111111111'), 0,
  'the profile goes with it, though no foreign key ties them');
select is((select count(*)::int from public.ratings
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and their ratings');
select is(
  (select string_agg(follower_id || '>' || followed_id, ',') from public.follows),
  '33333333-3333-3333-3333-333333333333>22222222-2222-2222-2222-222222222222',
  'and every follow they were either end of, and no other');
select is((select count(*)::int from private.write_budget), 0, 'and their budget row');
select is((select count(*)::int from public.reports), 0, 'and their reports');
select is((select count(*)::int from private.ratings_revision
            where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and the count of how often their thumbs changed');
-- No foreign key reaches a diagnostic, and this deletion is the dashboard's,
-- not `delete_account`'s.
select is(
  (select array_agg(detail order by detail) from private.debug_events),
  array['the stayer''s'],
  'and their diagnostics, however the account was deleted, and nobody else''s');

-- Whoever followed nobody else is locked by it, and loses their link.
select ok(not private.is_unlocked('22222222-2222-2222-2222-222222222222'),
  'a follower left following no person is locked');
select is(
  (select count(*)::int from public.invite_links
    where owner_id = '22222222-2222-2222-2222-222222222222'), 0,
  'and loses their link');
select is(
  (select count(*)::int from public.invite_links
    where owner_id = '33333333-3333-3333-3333-333333333333'), 1,
  'while one who still follows somebody keeps theirs');

-- The half that must NOT cascade. `items` has no update and no delete verb for
-- anyone, so a name that disappeared here would be unrecoverable.
select is((select search_id from public.items where id = 'café bleu'), 'cafe bleu',
  'the thing they added stays in the catalog');
select ok((select created_by from public.items where id = 'café bleu') is null,
  'with the attribution set null rather than cascaded away');
select ok((select created_by is null and ref = 'n42' from public.item_refs),
  'and its link the same');
select is((select value::int from public.ratings
           where user_id = '22222222-2222-2222-2222-222222222222'), -1,
  'and somebody else''s thumb on it still points at something');
select ok(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'items'
             and indexname = 'items_created_by_idx'),
  'the items an account named are found by index, not a scan of the catalog');

-- A prefilled account belongs to no auth row, so no auth deletion can take it.
select is((select count(*)::int from public.profiles where prefilled), 1,
  'the prefilled account is untouched');

-- Null is an answer the column can hold, and still one no client can ask for.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$select created_by from public.items$$, '42501', null,
  'and creation is still unattributed everywhere a reader can look');

select * from finish();
rollback;
