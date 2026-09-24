-- The shared catalog: everyone signed in can read and add to it, and nobody can
-- change it afterwards. The id IS the name — the text somebody typed, folded by
-- `normalizeId` (DESIGN §3.2) — so what a valid id looks like is as much of the
-- surface as what the row may hold, and it is the longer half of this file.

begin;
select plan(35);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'two@example.com', now());

insert into public.items (id, search_id, created_by)
  values ('café bleu', 'cafe bleu', '11111111-1111-1111-1111-111111111111');

-- Nothing is public to signed-out visitors except the app shell (DESIGN §4),
-- and the catalog names what the people here care about.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select id from public.items$$, '42501',
  'a signed-out visitor cannot read the catalog');
select throws_ok($$insert into public.items (id, search_id) values ('x', 'x')$$, '42501',
  'nor add to it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Byte for byte what the first person typed, accent and space kept: there is no
-- display name beside it, because this IS the display text.
select is((select id from public.items where search_id = 'cafe bleu'), 'café bleu',
  'a signed-in user reads the id back exactly as it was written');

-- The two prefix searches, which range over the two `text_pattern_ops` indexes.
-- The stripped one is what finds a thing when the person typing does not have
-- the accent, which is the whole reason the column exists: without it the
-- viewer finds nothing and adds the thing a second time.
select is(
  (select string_agg(id, ',' order by id) from public.items
   where id >= 'café' and id < 'café' || chr(255)),
  'café bleu', 'the literal prefix range is one search');
select is(
  (select string_agg(id, ',' order by id) from public.items
   where search_id >= 'cafe' and search_id < 'cafe' || chr(255)),
  'café bleu', 'and the stripped one is the other');

select lives_ok(
  $$insert into public.items (id, search_id) values ('blue bottle', 'blue bottle')$$,
  'and can add a valid one');

-- What an id may be: each of these is a name somebody can type.
select lives_ok(
  $$insert into public.items (id, search_id) values ('日本', '日本')$$,
  'a script with no Latin in it');
select lives_ok(
  $$insert into public.items (id, search_id) values ('late night', 'late night')$$,
  'a space between two words');
select lives_ok(
  $$insert into public.items (id, search_id) values ('o''brien''s', 'obriens')$$,
  'punctuation, which only search_id drops');
select lives_ok(
  $$insert into public.items (id, search_id) values ('zero' || chr(8204) || 'width', 'zerowidth')$$,
  'and ZWNJ, which several scripts need to spell an ordinary word');
select lives_ok(
  $$insert into public.items (id, search_id) values (repeat('a', 128), repeat('a', 128))$$,
  'up to the length bound itself');

-- And what it may not. Every one of these is a CHECK violation rather than a
-- policy refusal: the client folds first, so a row that gets here at all was
-- written by something that did not.
select throws_ok(
  $$insert into public.items (id, search_id) values ('Café Bleu', 'cafe bleu')$$,
  '23514', 'id: a capital');
select throws_ok(
  $$insert into public.items (id, search_id) values ('cafe' || chr(769) || ' bleu', 'cafe bleu')$$,
  '23514', 'id: a decomposed é, which is not NFKC-normal');
select throws_ok(
  $$insert into public.items (id, search_id) values ('café  bleu', 'cafe bleu')$$,
  '23514', 'id: a doubled space');
select throws_ok(
  $$insert into public.items (id, search_id) values (' café', 'cafe')$$,
  '23514', 'id: a leading space');
select throws_ok(
  $$insert into public.items (id, search_id) values ('café' || chr(9) || 'bleu', 'cafe bleu')$$,
  '23514', 'id: a tab, which the folding turns into a space');
-- One of these in a name reverses the rest of the row it is drawn in, which is
-- why DESIGN §3.2 refuses the bidirectional overrides by name.
select throws_ok(
  $$insert into public.items (id, search_id) values ('caf' || chr(8238) || 'é', 'cafe')$$,
  '23514', 'id: a bidi override');
select throws_ok(
  $$insert into public.items (id, search_id) values ('caf' || chr(57344), 'caf')$$,
  '23514', 'id: a private-use code point');
select throws_ok(
  $$insert into public.items (id, search_id) values ('caf' || chr(327680), 'caf')$$,
  '23514', 'id: an unassigned one');
select throws_ok(
  $$insert into public.items (id, search_id) values ('', '')$$,
  '23514', 'id: empty');
select throws_ok(
  $$insert into public.items (id, search_id) values (repeat('a', 129), repeat('a', 129))$$,
  '23514', 'id: 129 characters');

-- The two that cannot be a CHECK violation, because the value cannot be built
-- at all: Postgres refuses the NUL byte and a lone surrogate on input, before
-- any constraint is consulted. The NUL is also what the core joins an item to
-- an attribute with, and this is why that join cannot be forged.
select throws_ok(
  $$insert into public.items (id, search_id) values ('caf' || chr(0) || 'é', 'cafe')$$,
  '54000', 'id: a NUL is refused by the encoding, not by the CHECK');
select throws_ok(
  $$insert into public.items (id, search_id) values ('caf' || chr(55296), 'caf')$$,
  '54000', 'and so is a lone surrogate');

-- De-duplication is structural: the second creator is refused and reads back
-- the first one's row rather than renaming it.
select throws_ok(
  $$insert into public.items (id, search_id) values ('café bleu', 'cafe bleu')$$,
  '23505', 'the same id cannot be created twice');

-- **No SQL strips anything.** `search_id` is `searchFold(id)` and the CLIENT
-- writes it, so that the stripping rule exists in one place rather than once in
-- TypeScript and again here where the two can disagree — a disagreement being a
-- row nobody can find by its own name. A client that writes something else gets
-- a thing that surfaces under a name it does not have, which naming it
-- misleadingly already allows, and `web/scripts/search-id-check.ts` is what
-- catches it.
select lives_ok(
  $$insert into public.items (id, search_id) values ('flat white', 'something else')$$,
  'nothing in the database ties search_id to id, deliberately');

-- A url would be a global free-text field pointing anywhere, and a tag list a
-- global aggregate — the tags a viewer sees come from their own feed instead,
-- so what they see stays bounded by their reach (DESIGN §3.2).
select throws_ok(
  $$insert into public.items (id, search_id, url) values ('x', 'x', 'https://evil.example.com')$$,
  '42703', 'there is no url column');
select throws_ok(
  $$insert into public.items (id, search_id, tags) values ('x', 'x', array['coffee'])$$,
  '42703', 'nor a tag list');
-- The id is the display text.
select throws_ok(
  $$insert into public.items (id, search_id, name) values ('x', 'x', 'X')$$,
  '42703', 'nor a display name');

-- A name everyone in every network shares must not become something else after
-- the fact, and a delete would strand every rating pointing at the id. It is
-- also what keeps `search_id` honest: neither column can move after the insert.
select throws_ok($$update public.items set search_id = 'chase support' where id = 'café bleu'$$,
  '42501', 'an item cannot be re-indexed');
select throws_ok($$delete from public.items where id = 'café bleu'$$,
  '42501', 'nor deleted');

-- Unforgeable, so an item cannot claim to have been in the catalog longer than
-- it has. A column absent from the insert grant.
select throws_ok(
  $$insert into public.items (id, search_id, created_at) values ('x', 'x', 'epoch')$$,
  '42501', 'an item cannot be backdated');

-- "Who added this is never readable" is `created_by` without a SELECT
-- privilege.
select throws_ok($$select created_by from public.items$$, '42501',
  'creation is unattributed everywhere a reader can look');
select throws_ok(
  $$insert into public.items (id, search_id, created_by)
    values ('x', 'x', '22222222-2222-2222-2222-222222222222')$$,
  '42501', 'and nobody can name anyone but themselves as creator');

set local role postgres;
select is(
  (select created_by from public.items where id = 'blue bottle'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'because the column defaults to auth.uid() and is not insertable');
select ok(
  (select created_at from public.items where id = 'blue bottle')
    between now() - interval '1 second' and now(),
  'and created_at is the server''s clock');

select * from finish();
rollback;
