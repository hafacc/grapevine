-- Names and attributes hold ordinary letters, numbers and punctuation, and no
-- word mixes scripts (0008, DESIGN §3.2). `shared/tests/normalize.test.ts` is
-- the same list against `isNormalizedId`, which compiles the same patterns.

begin;
select plan(44);

-- Ordinary names, in the scripts people write them in.
select ok(private.is_normalized_id('café bleu'), 'accents');
select ok(private.is_normalized_id('日本'), 'Han');
select ok(private.is_normalized_id('кафе'), 'Cyrillic on its own');
select ok(private.is_normalized_id('café кафе'), 'Latin and Cyrillic in separate words');
select ok(private.is_normalized_id('tokyo 東京'), 'Latin and Han side by side');
select ok(private.is_normalized_id('ramenラーメン'), 'Latin and katakana in one word');
select ok(private.is_normalized_id('東京とうきょう'), 'Han and hiragana in one word');
select ok(private.is_normalized_id('서울seoul漢'), 'Hangul, Latin and Han in one word');
select ok(private.is_normalized_id('हिन्दी'), 'Devanagari, with its marks');
select ok(private.is_normalized_id('العربية'), 'Arabic');
select ok(private.is_normalized_id('עברית'), 'Hebrew');
select ok(private.is_normalized_id('ภาษาไทย'), 'Thai');
select ok(private.is_normalized_id('ကြို့'), 'Burmese, four marks on one letter');
select ok(private.is_normalized_id('می' || chr(8204) || 'خواهم'), 'ZWNJ between two joining Persian letters');
select ok(private.is_normalized_id('क' || chr(2381) || chr(8205) || 'ष'), 'ZWJ after a virama');
select ok(private.is_normalized_id('joe''s pizza & sub-shop'), 'apostrophe, ampersand, hyphen');
select ok(private.is_normalized_id('c++ ac/dc m*a*s*h 50% c# a@b re: us'), 'the short list of symbols');
select ok(private.is_normalized_id('$5 €5 £5 ¥5'), 'four currency signs');
select ok(private.is_normalized_id('«le monde» “quoted” o’brien ¿qué?'), 'quotes and inverted marks');

-- Look-alike spoofing: a Latin word with a letter from Cyrillic or Greek.
select ok(not private.is_normalized_id('c' || chr(1072) || 'fé bleu'), 'a Cyrillic а in a Latin word');
select ok(not private.is_normalized_id(chr(1088) || 'izza'), 'a Cyrillic р in a Latin word');
select ok(not private.is_normalized_id('abcαβγ'), 'Latin and Greek in one word');
select ok(not private.is_normalized_id('абвαβγ'), 'Cyrillic and Greek in one word');
select ok(not private.is_normalized_id('कखع'), 'two scripts neither of which is Latin');

-- Emoji, pictographs, and symbols off the list.
select ok(not private.is_normalized_id('🍇'), 'an emoji');
select ok(not private.is_normalized_id('pizza 🍕'), 'an emoji as a word');
select ok(not private.is_normalized_id('♥'), 'a pictographic symbol');
select ok(not private.is_normalized_id('a<b'), 'a symbol off the list');
select ok(not private.is_normalized_id('a~b'), 'and another');

-- Invisible characters, and the one that reverses the row.
select ok(not private.is_normalized_id('caf' || chr(8203) || 'é'), 'a zero-width space');
select ok(not private.is_normalized_id('caf' || chr(8238) || 'é'), 'a right-to-left override');
select ok(not private.is_normalized_id('caf' || chr(65279) || 'é'), 'a byte-order mark');
select ok(not private.is_normalized_id('caf' || chr(173) || 'é'), 'a soft hyphen');
select ok(not private.is_normalized_id('caf' || chr(65039) || 'é'), 'a variation selector');
select ok(not private.is_normalized_id('zero' || chr(8204) || 'width'), 'ZWNJ between Latin letters');
select ok(not private.is_normalized_id('zero' || chr(8205) || 'width'), 'ZWJ between Latin letters');

-- Full-width letters are not NFKC-normal: the folding turns them ASCII.
select ok(not private.is_normalized_id('ｄａｔｅ'), 'full-width letters');
select ok(private.is_normalized_id(normalize('ｄａｔｅ', nfkc)), 'which fold to ordinary ones');

-- Zalgo text: combining marks stacked on one letter.
select ok(private.is_normalized_id('q' || chr(770) || chr(771) || chr(772) || chr(774)),
  'four marks on one letter');
select ok(not private.is_normalized_id('q' || chr(770) || chr(771) || chr(772) || chr(774) || chr(775)),
  'five');
select ok(not private.is_normalized_id('q' || chr(770) || chr(770)), 'the same mark twice');
select ok(not private.is_normalized_id(chr(770) || 'q'), 'a mark with no letter under it');

-- The CHECKs call the function, so a row cannot carry one either.
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'one@example.com', now());
create or replace function private.is_unlocked(p_user uuid) returns boolean
  language sql as $$ select true $$;  -- the lock (0010) is 23's to test
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$insert into public.items (id, search_id) values ('c' || chr(1072) || 'fé', 'cafe')$$,
  '23514', null, 'a look-alike name is a CHECK violation');
select throws_ok(
  $$insert into public.ratings (user_id, item_id, tag, value)
      values ((select auth.uid()), 'café bleu', 'cozy ☕', 1)$$,
  '23514', null, 'and so is an emoji in an attribute');

select * from finish();
rollback;
