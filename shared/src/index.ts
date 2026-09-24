/**
 * The cap on an id, counted in code points rather than in UTF-16 units or
 * bytes, because that is what the column `CHECK` counts with `char_length`.
 */
export const MAX_ID_LENGTH = 128;

/** ZWNJ and ZWJ: the two format characters an id may contain. */
const ALLOWED_FORMAT = new Set([0x200c, 0x200d]);

/**
 * The five general categories an id admits nothing from: control, format,
 * surrogate, private-use and unassigned. ZWNJ and ZWJ are taken out of the
 * format half above — Persian and several Indic scripts need them to spell
 * ordinary words, and an emoji sequence is built from them.
 */
const REFUSED_CATEGORY = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;

/**
 * The one folding, per DESIGN §3.2: an id is the text a person typed, and
 * nothing is stripped from it.
 *
 *     lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim
 *
 * NFKC comes AFTER the lowercasing because lowercasing a normalized string is
 * not guaranteed to leave it normalized, and the last step has to be the one
 * whose output the column `CHECK` tests. `"Café  BLEU "` is `café bleu`,
 * `"Late Night"` is `late night`, and `日本` survives intact.
 *
 * Null rather than a shortened or a hollowed-out string: an id past the cap is
 * REFUSED rather than cut, because a cut at 128 can land inside a grapheme
 * cluster or denormalize what it just normalized, and a silently shortened name
 * is a different thing from the one somebody typed. Null also covers an empty
 * result and every refusal `isNormalizedId` carries, so a caller either has an
 * id it may write or has nothing.
 */
export function normalizeId(input: string): string | null {
  const folded = input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  return isNormalizedId(folded) ? folded : null;
}

/**
 * Is this the canonical form of some id — what `normalizeId` would have
 * emitted, and what the column `CHECK` accepts?
 *
 * The database is the authority: `lower` under a non-`C` collation and
 * `toLowerCase` are two implementations of one Unicode table and can disagree
 * on a handful of characters, and it is the `CHECK` that decides whether the
 * row exists. This is the same list read client-side, so that a write is
 * refused before it is sent rather than after.
 */
export function isNormalizedId(id: string): boolean {
  const codePoints = [...id];
  if (codePoints.length === 0 || codePoints.length > MAX_ID_LENGTH)
    return false;
  if (id !== id.normalize("NFKC")) return false;
  if (id !== id.toLowerCase()) return false;
  if (id !== id.trim()) return false;
  // Every whitespace run is one plain space, so a tab, a line separator and a
  // doubled space are each something the folding cannot emit.
  if (/\s\s/u.test(id) || /[^\S ]/u.test(id)) return false;
  return codePoints.every(
    (character) =>
      ALLOWED_FORMAT.has(character.codePointAt(0) as number) ||
      !REFUSED_CATEGORY.test(character),
  );
}

/**
 * An id with its accents and its punctuation taken off, which is what search
 * matches against: `cafe bleu` for `café bleu`.
 *
 * This is the ONLY implementation of that stripping anywhere. The client writes
 * `items.search_id` from it and the list's matcher applies it to a query, so no
 * SQL strips anything — a second implementation that disagreed with this one
 * would be a row nobody can find by its own name (DESIGN §3.2).
 *
 * The input is an id, so it has already been lower-cased by `normalizeId`;
 * this folds nothing but the accents and the punctuation. NFD is what makes an
 * accent reachable — it splits `é` into `e` and a combining mark — and the
 * marks are then dropped. Punctuation is DELETED rather than turned into a
 * space, so `o'brien's` is `obriens` and not three words; the collapse
 * afterwards is for the space a deleted hyphen leaves between two words.
 *
 * NFC last, because NFD also splits every Hangul syllable into two or three
 * jamo that are letters rather than marks, so nothing above removes them: left
 * decomposed, a Korean name's stripped copy runs to three times its length and
 * past the 128 the column `CHECK` allows on `search_id`.
 *
 * Symbols survive, currency signs and emoji among them: they are how somebody
 * would type the thing and there is nothing to strip them down to.
 */
export function searchFold(id: string): string {
  return id
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{P}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFC");
}

/**
 * Latin letters and the look-alikes from Cyrillic and Greek that a person
 * typing on another keyboard lands on.
 *
 * Written as code points so that the two spellings of one shape cannot be
 * confused in this file either, which is the whole failure being defended
 * against.
 */
const CONFUSABLE_CODE_POINTS: readonly (readonly [number, string])[] = [
  [0x0430, "a"], // Cyrillic а
  [0x0435, "e"], // Cyrillic е
  [0x043e, "o"], // Cyrillic о
  [0x0440, "p"], // Cyrillic р
  [0x0441, "c"], // Cyrillic с
  [0x0443, "y"], // Cyrillic у
  [0x0445, "x"], // Cyrillic х
  [0x0456, "i"], // Cyrillic і
  [0x0458, "j"], // Cyrillic ј
  [0x0455, "s"], // Cyrillic ѕ
  [0x04bb, "h"], // Cyrillic һ
  [0x03bf, "o"], // Greek ο
  [0x03b1, "a"], // Greek α
  [0x03b5, "e"], // Greek ε
  [0x03b9, "i"], // Greek ι
  [0x03ba, "k"], // Greek κ
  [0x03bd, "v"], // Greek ν
  [0x03c1, "p"], // Greek ρ
  [0x03c4, "t"], // Greek τ
  [0x03c5, "u"], // Greek υ
  [0x03c7, "x"], // Greek χ
  [0x03f2, "c"], // Greek ϲ
];

const CONFUSABLES = new Map(
  CONFUSABLE_CODE_POINTS.map(([codePoint, latin]) => [
    String.fromCodePoint(codePoint),
    latin,
  ]),
);

/**
 * What two ids that a reader cannot tell apart have in common, over
 * `searchFold` so that an accent and a hyphen are not a distinction either.
 *
 * NFKC removes the compatibility look-alikes — `ﬁ` is `fi`, full-width is
 * half-width — and leaves the ones that are separate letters in separate
 * scripts: Latin `a` and Cyrillic `а` survive it as two characters, so
 * `café bleu` and `cаfé bleu` are two things no reader can distinguish. This
 * catches the accident of two people and two keyboards, at lookup and before
 * offering to add a second copy.
 *
 * It is a HAND-PICKED table of the common Latin/Cyrillic/Greek shapes, not
 * Unicode TR39's confusables data, which is a file per Unicode version and a
 * dependency this package does not take. So it is bounded rather than
 * complete, exactly as DESIGN §3.2 says: nothing here stops a determined
 * account building a homograph out of a shape this table has never heard of.
 */
export function confusableSkeleton(id: string): string {
  return [...searchFold(id)]
    .map((character) => CONFUSABLES.get(character) ?? character)
    .join("");
}
