/**
 * Which characters a name or an attribute may hold, as regular expressions
 * that read the same in JavaScript and in Postgres (DESIGN §3.2).
 *
 * The client and the column `CHECK` must refuse exactly the same ids, and
 * neither can be trusted to agree with the other about Unicode: JavaScript's
 * `\p{…}` follows the engine's Unicode version and Postgres's regular
 * expressions have no `\p{…}` at all. So both are built here from one table,
 * `name-tables.ts`, written by `scripts/generate-name-rules.ts` from a pinned
 * Unicode version, and the only difference between the two copies is how a
 * code point is escaped. `isNormalizedId` compiles the JavaScript copy; the
 * generator writes the Postgres copy into the migration that defines
 * `private.is_normalized_id`, and `tests/name-rules.test.ts` checks that
 * migration still holds it.
 *
 * Every construct used is one both engines read alike: bracket classes of
 * escaped code points, `*`, `{n}`, alternation, anchors, one back-reference
 * and negative lookbehind and lookahead.
 */

import {
  ALLOWED,
  BASE,
  COMMON,
  JOIN_LEFT,
  JOIN_RIGHT,
  JOIN_TRANSPARENT,
  MARK,
  SCRIPTS,
  VIRAMA,
} from "./name-tables.ts";

export type Escape = (codePoint: number) => string;

export const jsEscape: Escape = (codePoint) => `\\u{${codePoint.toString(16)}}`;

export const pgEscape: Escape = (codePoint) =>
  `\\U${codePoint.toString(16).toUpperCase().padStart(8, "0")}`;

// More marks than this on one letter is stacking (Zalgo text), not spelling:
// Burmese, the deepest ordinary case, puts four on a consonant.
export const MAX_MARKS = 4;

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

export type NameRules = {
  // The whole id must match this: every character on the allow-list.
  readonly whole: string;
  // No part of the id may match any of these.
  readonly refused: readonly string[];
  // A space-separated word passes if it matches one of these, which is one
  // script throughout (with what every script shares)...
  readonly singleScriptWords: readonly string[];
  // ...or if, once `latinOrCommon` is deleted from it, what is left matches
  // `latinPlusOne`: Latin with at most one other script, or with one of the
  // CJK combinations.
  readonly latinOrCommon: string;
  readonly latinPlusOne: string;
};

function members(escapeCodePoint: Escape, ...tables: string[]): string {
  return tables
    .flatMap((table) => table.split(" "))
    .map((range) => {
      const [low, high] = range.split("-");
      const first = escapeCodePoint(Number.parseInt(low as string, 16));
      return high === undefined
        ? first
        : `${first}-${escapeCodePoint(Number.parseInt(high, 16))}`;
    })
    .join("");
}

function script(code: string): string {
  const table = SCRIPTS[code];
  if (table === undefined) throw new Error(`no script ${code} in the table`);
  return table;
}

/**
 * The rules in one engine's escaping. UTS #39's "moderately restrictive"
 * level, applied to each word rather than to the whole id, so that a name can
 * carry two scripts side by side (`tokyo 東京`) and no word can mix them.
 */
export function nameRules(escapeCodePoint: Escape): NameRules {
  const anyOf = (...tables: string[]) =>
    `[${members(escapeCodePoint, ...tables)}]`;
  const noneOf = (...tables: string[]) =>
    `[^${members(escapeCodePoint, ...tables)}]`;
  const mark = anyOf(MARK);
  const virama = anyOf(VIRAMA);
  const transparent = anyOf(JOIN_TRANSPARENT);
  const zwnj = escapeCodePoint(ZWNJ);
  const zwj = escapeCodePoint(ZWJ);
  // Cyrillic and Greek hold most of Latin's look-alikes, so UTS #39 lets
  // neither share a word with it; every other script may.
  const others = Object.keys(SCRIPTS)
    .filter((code) => !["Latn", "Cyrl", "Grek"].includes(code))
    .map((code) => `${anyOf(script(code))}*`);
  const cjk = [
    ["Hani", "Hira", "Kana"],
    ["Hani", "Bopo"],
    ["Hani", "Hang"],
  ].map((codes) => `${anyOf(...codes.map(script))}*`);
  return {
    whole: `^${anyOf(ALLOWED)}*$`,
    refused: [
      // `!`, `#` or `@` at the front of a word is an operator in the list's
      // search (`search.ts`), so a word like that could not be searched for
      // by its own name. `yahoo!` is fine: only the front of a word is taken.
      `(^|${escapeCodePoint(0x20)})[${[0x21, 0x23, 0x40].map(escapeCodePoint).join("")}]`,
      // A mark with nothing to sit on: at the start of a word, or after
      // punctuation.
      `(^|${noneOf(BASE, MARK)})${mark}`,
      `${mark}{${MAX_MARKS + 1}}`,
      // The same mark twice is drawn once, so it spells nothing (UTS #39 §5.4).
      `(${mark})\\1`,
      // ZWJ and ZWNJ only where RFC 5892 lets a word need them: after a
      // virama, and ZWNJ also between two letters that would otherwise join.
      `(?<!${virama})${zwj}`,
      `(?<!${virama})(?<!${anyOf(JOIN_LEFT)}${transparent}*)${zwnj}`,
      `(?<!${virama})${zwnj}(?!${transparent}*${anyOf(JOIN_RIGHT)})`,
    ],
    singleScriptWords: [
      `^${anyOf(COMMON, script("Cyrl"))}*$`,
      `^${anyOf(COMMON, script("Grek"))}*$`,
    ],
    latinOrCommon: anyOf(COMMON, script("Latn")),
    latinPlusOne: `^(?:${[...cjk, ...others].join("|")})$`,
  };
}
