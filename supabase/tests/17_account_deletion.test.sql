-- Deleting an account, which `items.created_by`'s `on delete set null` is what
-- makes possible: with any other `on delete` action one foreign key refuses it.
--
-- The shape this pins is the whole of what deletion means: everything about the
-- person goes with the `auth.users` row, and the catalog does not, because a
-- thing's name is shared and permanent (`/privacy/`) and every rating anywhere
-- points at its id.

begin;
select plan(10);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'leaver@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'stayer@example.com', now());

-- The leaver added something and the stayer rated it, so the item is load-
-- bearing for somebody else by the time its creator goes.
insert into public.items (id, search_id, created_by)
  values ('café bleu', 'cafe bleu', '11111111-1111-1111-1111-111111111111');
insert into public.ratings (user_id, item_id, value) values
  ('11111111-1111-1111-1111-111111111111', 'café bleu', 1),
  ('22222222-2222-2222-2222-222222222222', 'café bleu', -1);
insert into public.friendships (user_id, friend_id) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

set local role postgres;

-- With `created_by` at `no action`, the line below would raise 23503 and the
-- account could not be removed at all.
select lives_ok(
  $$delete from auth.users where id = '11111111-1111-1111-1111-111111111111'$$,
  'an account that added an item can be deleted');

select is((select count(*)::int from public.profiles
           where id = '11111111-1111-1111-1111-111111111111'), 0,
  'the profile goes with it');
select is((select count(*)::int from public.user_prefs
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and the prefs row the signup trigger created');
select is((select count(*)::int from public.ratings
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and their ratings');
select is((select count(*)::int from public.friendships), 0,
  'and both directions of every friendship they were an end of');
-- Their ratings go by cascade after the profile does, and each one fires the
-- trigger that stamps the ratings clock. Unguarded, that write would fail the
-- clock's own foreign key and refuse the deletion.
select is((select count(*)::int from private.ratings_changed
           where user_id = '11111111-1111-1111-1111-111111111111'), 0,
  'and the clock that said when their thumbs last changed');

-- The half that must NOT cascade. `items` has no update and no delete verb for
-- anyone, so a name that disappeared here would be unrecoverable, and every
-- rating pointing at the id would be orphaned.
select is((select search_id from public.items where id = 'café bleu'), 'cafe bleu',
  'the thing they added stays in the catalog');
select ok((select created_by from public.items where id = 'café bleu') is null,
  'with the attribution set null rather than cascaded away');
select is((select value::int from public.ratings
           where user_id = '22222222-2222-2222-2222-222222222222'), -1,
  'and somebody else''s thumb on it still points at something');

-- Null is an answer the column can hold, and still one no client can ask for:
-- 0002 leaves `created_by` out of the select grant, so the nullability changes
-- nothing about who may look.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$select created_by from public.items$$, '42501', null,
  'and creation is still unattributed everywhere a reader can look');

select * from finish();
rollback;
