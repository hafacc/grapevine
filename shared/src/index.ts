import { jsEscape, nameRules } from "./name-rules.ts";

/**
 * The cap on an id, counted in code points rather than in UTF-16 units or
 * bytes, because that is what the column `CHECK` counts with `char_length`.
 */
export const MAX_ID_LENGTH = 128;

// The allow-list, compiled from the same patterns the column `CHECK` holds.
const RULES = nameRules(jsEscape);
const WHOLE = new RegExp(RULES.whole, "u");
const REFUSED = RULES.refused.map((pattern) => new RegExp(pattern, "u"));
const SINGLE_SCRIPT_WORDS = RULES.singleScriptWords.map(
  (pattern) => new RegExp(pattern, "u"),
);
const LATIN_OR_COMMON = new RegExp(RULES.latinOrCommon, "gu");
const LATIN_PLUS_ONE = new RegExp(RULES.latinPlusOne, "u");

/**
 * Is every character of this id on the allow-list — letters, marks, digits,
 * space, ordinary punctuation and `$ € £ ¥ %` — whatever else is wrong with it?
 */
export function usesAllowedCharacters(id: string): boolean {
  return WHOLE.test(id);
}

/**
 * Does some word of this id mix scripts the way a look-alike does — Latin
 * with Cyrillic or Greek, or two scripts that are not Latin plus one other or
 * one of the CJK combinations (UTS #39's "moderately restrictive", per word)?
 */
export function mixesScripts(id: string): boolean {
  return id
    .split(" ")
    .some(
      (word) =>
        !SINGLE_SCRIPT_WORDS.some((pattern) => pattern.test(word)) &&
        !LATIN_PLUS_ONE.test(word.replace(LATIN_OR_COMMON, "")),
    );
}

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
  const folded = foldId(input);
  return isNormalizedId(folded) ? folded : null;
}

/**
 * `normalizeId`'s folding without its refusals: what the typed text would be
 * as an id if it were allowed. For saying why it is not, and for matching a
 * look-alike somebody typed against the thing it imitates.
 */
export function foldId(input: string): string {
  return input.toLowerCase().normalize("NFKC").replace(/\s+/gu, " ").trim();
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
  // Letters, marks, digits, space and ordinary punctuation only, no word
  // starting with one of search's operators, a mark on a letter and not too
  // many, ZWJ and ZWNJ only where a script needs them, and no word mixing
  // scripts: `name-rules.ts`, and DESIGN §3.2.
  if (!usesAllowedCharacters(id)) return false;
  if (REFUSED.some((pattern) => pattern.test(id))) return false;
  return !mixesScripts(id);
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
 * Symbols survive, the currency signs and `+` among them: they are how
 * somebody would type the thing and there is nothing to strip them down to.
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
 * scripts: Latin `a` and Cyrillic `а` survive it as two characters. A word
 * mixing the two is refused outright (`mixesScripts`), but a word written
 * wholly in Cyrillic can still imitate a Latin one, and a typed mixture is
 * still worth matching to the thing it imitates. This catches the accident of
 * two people and two keyboards, at lookup and before offering to add a second
 * copy.
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
