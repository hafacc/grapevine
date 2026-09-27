// The one folding and the two things read off an id: what search matches
// against, and what tells two spellings a reader cannot distinguish apart.
//
// The refusals below are the client's copy of the `items.id` CHECK in
// `supabase/migrations/0001_schema.sql`, and `09_items.test.sql` is the same
// list against the database, which is the authority where the two disagree.

import { describe, expect, it } from "bun:test";

import {
  confusableSkeleton,
  isNormalizedId,
  MAX_ID_LENGTH,
  normalizeId,
  searchFold,
} from "../src/index";

const codePoint = (value: number): string => String.fromCodePoint(value);

const COMBINING_ACUTE = codePoint(0x0301);
const ZWNJ = codePoint(0x200c);
const ZWJ = codePoint(0x200d);
const RIGHT_TO_LEFT_OVERRIDE = codePoint(0x202e);
const NO_BREAK_SPACE = codePoint(0x00a0);
const IDEOGRAPHIC_SPACE = codePoint(0x3000);
const PRIVATE_USE = codePoint(0xe000);
const UNASSIGNED = codePoint(0x50000);
const CYRILLIC_A = codePoint(0x0430);
// "I want", with the ZWNJ Persian writes between a prefix and its verb.
const PERSIAN = `می${ZWNJ}خواهم`;
// क्‍ष: a virama and ZWJ ask for the half form of क.
const DEVANAGARI_HALF_FORM = `क${codePoint(0x094d)}${ZWJ}ष`;
// 𠀀, one code point and two UTF-16 units.
const ASTRAL_HAN = codePoint(0x20000);
const CYRILLIC_ER = codePoint(0x0440);

describe("normalizeId", () => {
  it("is the text somebody typed, lower case and with one space between words", () => {
    expect(normalizeId("Café  BLEU ")).toBe("café bleu");
    expect(normalizeId("Late Night")).toBe("late night");
    expect(normalizeId("  Joe's Pizza & Sub-Shop ")).toBe(
      "joe's pizza & sub-shop",
    );
  });

  it("leaves a script with no Latin in it intact", () => {
    expect(normalizeId("日本")).toBe("日本");
    expect(normalizeId("Кафе")).toBe("кафе");
  });

  it("composes what NFKC composes, and lowercases before it", () => {
    expect(normalizeId(`cafe${COMBINING_ACUTE} bleu`)).toBe("café bleu");
    expect(normalizeId("ＤＡＴＥ ｎｉｇｈｔ")).toBe("date night");
    expect(normalizeId("ﬁsh")).toBe("fish");
  });

  it("collapses every kind of whitespace run, whatever NFKC leaves of it", () => {
    expect(normalizeId(`late\t\tnight`)).toBe("late night");
    expect(normalizeId(`late${NO_BREAK_SPACE}night`)).toBe("late night");
    expect(normalizeId(`late${IDEOGRAPHIC_SPACE}night`)).toBe("late night");
  });

  it("keeps the two format characters where a word needs them", () => {
    expect(normalizeId(PERSIAN)).toBe(PERSIAN);
    expect(normalizeId(DEVANAGARI_HALF_FORM)).toBe(DEVANAGARI_HALF_FORM);
  });

  it("refuses rather than emptying or shortening", () => {
    expect(normalizeId("")).toBeNull();
    expect(normalizeId("   ")).toBeNull();
    expect(normalizeId("a".repeat(MAX_ID_LENGTH + 1))).toBeNull();
    expect(normalizeId(`caf${RIGHT_TO_LEFT_OVERRIDE}é`)).toBeNull();
    expect(normalizeId(`caf${PRIVATE_USE}é`)).toBeNull();
    expect(normalizeId(`caf${UNASSIGNED}é`)).toBeNull();
  });

  // The cap is code points, not UTF-16 units: a name of 128 astral characters
  // is 256 of those and is a name somebody may write.
  it("counts the cap in code points", () => {
    expect(normalizeId("a".repeat(MAX_ID_LENGTH))?.length).toBe(MAX_ID_LENGTH);
    expect(normalizeId(ASTRAL_HAN.repeat(MAX_ID_LENGTH))).not.toBeNull();
    expect(normalizeId(ASTRAL_HAN.repeat(MAX_ID_LENGTH + 1))).toBeNull();
  });

  it("is idempotent, which is what makes the id canonical", () => {
    for (const input of [
      "Café  BLEU ",
      "日本",
      "ＤＡＴＥ",
      `cafe${COMBINING_ACUTE}`,
      "o'brien's",
    ]) {
      const once = normalizeId(input) as string;
      expect(normalizeId(once)).toBe(once);
    }
  });
});

describe("isNormalizedId", () => {
  it("accepts a colon", () => {
    expect(isNormalizedId("noise:loud")).toBe(true);
    expect(normalizeId("Star Wars: A New Hope")).toBe("star wars: a new hope");
  });
  it("accepts every id the folding emits", () => {
    for (const input of [
      "Café Bleu",
      "日本",
      "late night",
      PERSIAN,
      "a".repeat(MAX_ID_LENGTH),
    ]) {
      expect(isNormalizedId(normalizeId(input) as string)).toBe(true);
    }
  });

  it("refuses what the column CHECK refuses", () => {
    expect(isNormalizedId("")).toBe(false);
    expect(isNormalizedId("Café Bleu")).toBe(false);
    expect(isNormalizedId(`cafe${COMBINING_ACUTE} bleu`)).toBe(false);
    expect(isNormalizedId("café  bleu")).toBe(false);
    expect(isNormalizedId(" café")).toBe(false);
    expect(isNormalizedId("café ")).toBe(false);
    expect(isNormalizedId("late\tnight")).toBe(false);
    expect(isNormalizedId(`caf${RIGHT_TO_LEFT_OVERRIDE}é`)).toBe(false);
    expect(isNormalizedId(`caf${codePoint(0)}é`)).toBe(false);
    expect(isNormalizedId(codePoint(0xd800))).toBe(false);
    expect(isNormalizedId(PRIVATE_USE)).toBe(false);
    expect(isNormalizedId(UNASSIGNED)).toBe(false);
    expect(isNormalizedId("a".repeat(MAX_ID_LENGTH + 1))).toBe(false);
  });

  // `!`, `#` and `@` at the front of a word are the list's search operators,
  // so no name or attribute may have one there; anywhere else each is
  // punctuation.
  it("refuses a word that starts with !, # or @", () => {
    for (const id of ["!!!", "!hip", "not !hip", "#1", "#hip", "at @home"]) {
      expect(isNormalizedId(id)).toBe(false);
    }
    expect(normalizeId("！hip")).toBeNull();
    expect(normalizeId("＃hip")).toBeNull();
    expect(normalizeId("＠home")).toBeNull();
    for (const id of ["yahoo!", "panic! at the disco", "a!b", "c#", "a@b"]) {
      expect(isNormalizedId(id)).toBe(true);
    }
  });
});

describe("isNormalizedId, the allow-list", () => {
  it("takes letters of any script in use, digits and ordinary punctuation", () => {
    for (const id of [
      "joe's pizza & sub-shop",
      "c++",
      "ac/dc",
      "m*a*s*h",
      "50% off",
      "$5 €5 £5 ¥5",
      "«le monde»",
      "“quoted”",
      "o’brien",
      "who? (me) at-home no.1; ¡sí! ¿no? c# a@b",
      "ʻokina",
      "हिन्दी",
      "עברית",
      "العربية",
      "ภาษาไทย",
      "ελληνικά",
      "ကြို့",
      "日本語テキスト",
    ]) {
      expect([id, isNormalizedId(id)]).toEqual([id, true]);
    }
  });

  it("refuses emoji and pictographs, and symbols outside the short list", () => {
    for (const id of [
      "🍇",
      "pizza 🍕",
      "♥",
      "a<b",
      "a=b",
      "a~b",
      "a|b",
      "©",
      "°",
    ]) {
      expect([id, isNormalizedId(id)]).toEqual([id, false]);
    }
  });

  // Look-alike spoofing: one word, two scripts (UTS #39, moderately restrictive).
  it("refuses a word mixing Latin with Cyrillic or Greek", () => {
    expect(isNormalizedId(`c${CYRILLIC_A}fé bleu`)).toBe(false);
    expect(isNormalizedId(`${CYRILLIC_ER}izza`)).toBe(false);
    expect(isNormalizedId("abcαβγ")).toBe(false);
    expect(isNormalizedId("абвαβγ")).toBe(false);
  });

  it("allows two scripts side by side, and the usual mixtures in a word", () => {
    expect(isNormalizedId("café кафе")).toBe(true);
    expect(isNormalizedId("abc αβγ")).toBe(true);
    expect(isNormalizedId("tokyo 東京")).toBe(true);
    expect(isNormalizedId("東京とうきょう")).toBe(true);
    expect(isNormalizedId("ramenラーメン")).toBe(true);
    expect(isNormalizedId("서울seoul漢")).toBe(true);
    expect(isNormalizedId("abcع")).toBe(true);
    expect(isNormalizedId("कखabc")).toBe(true);
    expect(isNormalizedId("कखع")).toBe(false);
  });

  it("refuses invisible and default-ignorable characters", () => {
    for (const invisible of [
      0x200b, 0x2060, 0xfeff, 0x00ad, 0x034f, 0x115f, 0x3164, 0xfe0f, 0xe0061,
    ]) {
      expect(isNormalizedId(`caf${codePoint(invisible)}é`)).toBe(false);
    }
    expect(normalizeId(`caf${RIGHT_TO_LEFT_OVERRIDE}é`)).toBeNull();
  });

  it("takes ZWNJ and ZWJ only where a script needs them", () => {
    expect(isNormalizedId(`zero${ZWNJ}width`)).toBe(false);
    expect(isNormalizedId(`zero${ZWJ}width`)).toBe(false);
    expect(isNormalizedId(`${ZWNJ}می`)).toBe(false);
    expect(isNormalizedId(`क${ZWJ}ष`)).toBe(false);
  });

  // Zalgo text: marks stacked past what any script writes.
  it("caps the combining marks on one letter", () => {
    const marks = [0x302, 0x303, 0x304, 0x306, 0x307].map(codePoint);
    expect(isNormalizedId(`q${marks.slice(0, 4).join("")}`)).toBe(true);
    expect(isNormalizedId(`q${marks.join("")}`)).toBe(false);
    expect(isNormalizedId(`q${marks[0]}${marks[0]}`)).toBe(false);
    expect(isNormalizedId(`${marks[0]}q`)).toBe(false);
    expect(isNormalizedId(`a -${marks[0]}`)).toBe(false);
  });

  it("folds full-width to the ordinary letters, which it then allows", () => {
    expect(normalizeId("ＤＡＴＥ ｎｉｇｈｔ")).toBe("date night");
    expect(isNormalizedId("ｄａｔｅ")).toBe(false);
  });
});

describe("searchFold", () => {
  it("takes the accents and the punctuation off and keeps the words apart", () => {
    expect(searchFold("café bleu")).toBe("cafe bleu");
    expect(searchFold("o'brien's café")).toBe("obriens cafe");
    expect(searchFold("sci-fi/fantasy")).toBe("scififantasy");
    expect(searchFold("naïve")).toBe("naive");
  });

  // A deleted hyphen between two words leaves the two spaces around it.
  it("leaves one space where punctuation stood between words", () => {
    expect(searchFold("date - night")).toBe("date night");
    expect(searchFold("...quiet")).toBe("quiet");
  });

  it("leaves a script with no accents to strip alone", () => {
    expect(searchFold("日本")).toBe("日本");
    expect(searchFold("кафе")).toBe("кафе");
  });

  it("strips the tone marks off vietnamese", () => {
    expect(searchFold("phở")).toBe("pho");
  });

  // NFD splits a syllable into jamo, which are letters rather than marks.
  it("keeps a hangul syllable one character", () => {
    const longest = "한".repeat(MAX_ID_LENGTH);
    expect(searchFold(longest)).toBe(longest);
    expect([...searchFold(longest)].length).toBe(MAX_ID_LENGTH);
  });

  it("is idempotent", () => {
    for (const id of [
      "café bleu",
      "phở",
      "한국어",
      "o'brien's",
      "日本",
      "date - night",
    ]) {
      const once = searchFold(id);
      expect(searchFold(once)).toBe(once);
    }
  });
});

describe("confusableSkeleton", () => {
  // The accident this exists for: two people, two keyboards, one name.
  it("reads a Cyrillic look-alike as the Latin letter it is drawn as", () => {
    const lookAlike = `c${CYRILLIC_A}fé bleu`;
    expect(confusableSkeleton(lookAlike)).toBe(confusableSkeleton("café bleu"));
    expect(lookAlike).not.toBe("café bleu");
  });

  it("folds Greek the same way", () => {
    expect(confusableSkeleton(`${codePoint(0x03bf)}pen`)).toBe(
      confusableSkeleton("open"),
    );
  });

  it("does not make two different names one", () => {
    expect(confusableSkeleton("café bleu")).not.toBe(
      confusableSkeleton("café rouge"),
    );
    expect(confusableSkeleton(`${CYRILLIC_ER}iano`)).toBe(
      confusableSkeleton("piano"),
    );
  });

  // Bounded and not prevented (DESIGN §3.2): the table is the common shapes,
  // not TR39's file, so a shape it has never heard of goes through.
  it("leaves a shape the table does not carry alone", () => {
    const armenianOh = codePoint(0x0585);
    expect(confusableSkeleton(`${armenianOh}pen`)).not.toBe(
      confusableSkeleton("open"),
    );
  });
});
