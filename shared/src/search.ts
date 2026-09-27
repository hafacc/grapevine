/**
 * The list's query language and its word matcher (DESIGN §1 "Search", a proposal).
 *
 * Pure text: which words were typed, with which operators, and how well one
 * word matches one name or one attribute. What a row is, which attributes
 * count and how rows rank is `web/utils/discover.ts`'s, because that needs the
 * feed.
 * Nothing here reads anybody's ratings, and nothing on a server imports it.
 */

import { searchFold } from "./index.ts";

/**
 * What is typed, in the shape the matcher compares with: lower case, NFKC, and
 * then `searchFold`'s accents and punctuation off.
 *
 * `normalizeId` is not used here and must not be: it REFUSES what it cannot
 * make an id of, and a query is not on its way into a row — somebody halfway
 * through typing, or past 128 characters, still has to see the list narrow.
 */
export function foldQuery(typed: string): string {
  return searchFold(typed.toLowerCase().normalize("NFKC"));
}

/** Where a term looks: a thing's name, its attributes, or either. */
export type SearchField = "any" | "name" | "tag";

/** One whitespace-separated word of a query. */
export type SearchWord = {
  // Folded (`foldQuery`) and without its operators, which is what every
  // comparison uses.
  readonly text: string;
  // As typed, NFKC, operators and all: what a note on screen quotes back.
  readonly raw: string;
  // Typed with a leading `!`: the term it starts ranks low-rated first.
  readonly low: boolean;
  // Typed with a leading `@` (names) or `#` (attributes), after any `!`.
  readonly field: SearchField;
};

export type ParsedQuery = {
  readonly words: readonly SearchWord[];
  // No word starts with an operator: the query is only words, so what was
  // typed is also a name that could be added.
  readonly plain: boolean;
};

/**
 * The operators, each read only at the front of a word. No id may have a word
 * that starts with one (`isNormalizedId`), so the query language never
 * collides with a name.
 */
export const LOW_FIRST = "!";
export const NAMES_ONLY = "@";
export const TAGS_ONLY = "#";

/**
 * Words split on whitespace. A word may start with `!` (low-rated first), then
 * `@` (names only) or `#` (attributes only).
 *
 * NFKC first, so a full-width `！` is the ASCII one — the same folding that
 * refuses it in an id. Nothing is an error, because the field is parsed on
 * every keystroke: an operator alone, or a word that folds to nothing, is
 * dropped. Which words make up one attribute or one name is not decided here:
 * that is `bestSegmentation`'s job, against what the viewer's list holds.
 */
export function parseQuery(typed: string): ParsedQuery {
  const words: SearchWord[] = [];
  let plain = true;
  for (const raw of typed.normalize("NFKC").split(/\s+/u)) {
    let rest = raw;
    const low = rest.startsWith(LOW_FIRST);
    if (low) rest = rest.slice(LOW_FIRST.length);
    let field: SearchField = "any";
    if (rest.startsWith(NAMES_ONLY)) field = "name";
    else if (rest.startsWith(TAGS_ONLY)) field = "tag";
    if (field !== "any") rest = rest.slice(1);
    if (rest.length < raw.length) plain = false;
    const text = foldQuery(rest);
    if (text.length > 0) words.push({ text, raw, low, field });
  }
  return { words, plain };
}

/**
 * Which way a word matched, tried in this order. The kind decides nothing on
 * its own: what a match is worth is its `weight`.
 */
export const TIER = {
  // The whole word, or a run of whole words.
  exact: 0,
  // The start of a word: what somebody still typing produces.
  prefix: 1,
  // The start of a word, within `typoBudget` edits.
  typo: 2,
  // Every character in order somewhere: the old matcher, kept so an initialism
  // (`bbmint`) still finds its thing, and weighing little because it is also
  // what finds nonsense.
  loose: 3,
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

/**
 * Edits allowed for a word of this many characters: none up to three, where
 * one edit turns a word into a different common word; one up to six; two past
 * that.
 */
export function typoBudget(length: number): number {
  if (length <= 3) return 0;
  else if (length <= 6) return 1;
  else return 2;
}

/**
 * The fewest edits — insert, delete, substitute, or swap two neighbours — that
 * turn `word` into some prefix of `target` from `offset` on, stopping as soon
 * as it must exceed `limit`.
 *
 * Against a prefix rather than the whole of `target` because the field is
 * typed into: `cofe` is one edit from `coff`, which is where `coffee` starts.
 */
export function prefixEditDistance(
  word: readonly string[],
  target: readonly string[],
  limit: number,
  offset = 0,
): number {
  const width = Math.min(target.length - offset, word.length + limit);
  if (width < 0) return word.length <= limit ? word.length : limit + 1;
  // Three rows are enough for the neighbour swap, which looks two back.
  let before = new Int32Array(width + 1);
  let previous = new Int32Array(width + 1);
  let current = new Int32Array(width + 1);
  for (let column = 0; column <= width; column += 1) previous[column] = column;
  for (let row = 1; row <= word.length; row += 1) {
    current[0] = row;
    let rowBest = row;
    const wanted = word[row - 1];
    for (let column = 1; column <= width; column += 1) {
      const found = target[offset + column - 1];
      let cost = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        (previous[column - 1] as number) + (wanted === found ? 0 : 1),
      );
      if (
        row > 1 &&
        column > 1 &&
        wanted === target[offset + column - 2] &&
        word[row - 2] === found
      )
        cost = Math.min(cost, (before[column - 2] as number) + 1);
      current[column] = cost;
      if (cost < rowBest) rowBest = cost;
    }
    if (rowBest > limit) return limit + 1;
    const spare = before;
    before = previous;
    previous = current;
    current = spare;
  }
  let best = limit + 1;
  for (const cost of previous) if (cost < best) best = cost;
  return best;
}

// Three letters in order are somewhere in most names: `hip` is in `hilltop
// pizza`. From four, what a scattered match finds is mostly what was meant.
export const LOOSE_MIN_LENGTH = 4;

/**
 * Folded text split by code point, with where each word starts: what the
 * matcher compares, prepared once per name or attribute rather than once per
 * keystroke and term.
 *
 * By code point because a character past the BMP (much of Han, or an emoji
 * typed into a query) is two UTF-16 units, and indexing by unit
 * compares half of one with the whole of another.
 */
export type Prepared = {
  readonly chars: readonly string[];
  readonly starts: readonly number[];
};

export function prepare(folded: string): Prepared {
  const chars = Array.from(folded);
  const starts: number[] = chars.length > 0 ? [0] : [];
  chars.forEach((character, index) => {
    if (character === " " && index + 1 < chars.length) starts.push(index + 1);
  });
  return { chars, starts };
}

function isSubsequence(
  wanted: readonly string[],
  target: readonly string[],
): boolean {
  let at = 0;
  for (const character of target) {
    if (character === wanted[at]) at += 1;
    if (at === wanted.length) return true;
  }
  return wanted.length === 0;
}

// A cheap necessary condition for `prefixEditDistance` within `budget`: at
// least `length − budget` of the word's characters occur in the stretch of
// target an alignment could use. Most candidates fail it, and it costs no
// table.
function mightBeWithin(
  word: readonly string[],
  target: readonly string[],
  offset: number,
  budget: number,
): boolean {
  const end = Math.min(target.length, offset + word.length + budget);
  let missing = 0;
  for (const character of word) {
    let seen = false;
    for (let at = offset; at < end; at += 1) {
      if (target[at] === character) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      missing += 1;
      if (missing > budget) return false;
    }
  }
  return true;
}

/** A match of one term against one candidate. */
export type TermMatch = {
  readonly tier: Tier;
  // In (0, 1]: how much of what was matched the typing accounts for — the
  // chance, read plainly, that the candidate is what was meant. 1 is every
  // character of it, typed right.
  readonly weight: number;
};

export type MatchOptions = {
  // Scattered letters in order (`TIER.loose`).
  readonly loose: boolean;
  // Up to `typoBudget` edits (`TIER.typo`).
  readonly typos: boolean;
  // What `weight` is a share of. An attribute is one concept, so a word of it
  // is part of it: `night` is half of `late night`. A name is a label people
  // find by any of its words, so a whole word of it is a whole match.
  readonly whole: boolean;
};

const MATCH_EVERYTHING: MatchOptions = {
  loose: true,
  typos: true,
  whole: true,
};

// Where the word that position `at` falls in ends.
function wordEnd(target: readonly string[], at: number): number {
  let end = Math.max(at, 0);
  while (end < target.length && target[end] !== " ") end += 1;
  return end;
}

/**
 * How well one folded term matches one folded candidate (a name or an
 * attribute), or null for not at all. Either may be passed `prepare`d, which
 * is what a caller matching many terms against one list does.
 *
 * The weight is characters: of the stretch the term landed on — the words it
 * touched for a name, the whole candidate for an attribute — the share the
 * typing confirmed. A prefix confirms what was typed (`cof` is half of
 * `coffee`), a typo what was typed less its edits, a scattered match its own
 * letters of the whole candidate. No tier carries a constant of its own.
 */
export function matchTerm(
  term: string | Prepared,
  candidate: string | Prepared,
  options: MatchOptions = MATCH_EVERYTHING,
): TermMatch | null {
  const wanted = (typeof term === "string" ? prepare(term) : term).chars;
  const { chars: target, starts } =
    typeof candidate === "string" ? prepare(candidate) : candidate;
  if (wanted.length === 0) return { tier: TIER.exact, weight: 1 };
  const length = wanted.length;
  const share = (confirmed: number, start: number, end: number) =>
    confirmed /
    Math.max(
      length,
      options.whole ? target.length : wordEnd(target, end) - start,
    );
  let best: TermMatch | null = null;
  for (const start of starts) {
    const end = start + length;
    if (end > target.length) continue;
    let same = true;
    for (let offset = 0; offset < length; offset += 1) {
      if (target[start + offset] !== wanted[offset]) {
        same = false;
        break;
      }
    }
    if (!same) continue;
    const tier =
      end === target.length || target[end] === " " ? TIER.exact : TIER.prefix;
    const weight = share(length, start, end);
    if (best === null || weight > best.weight) best = { tier, weight };
  }
  if (best !== null) return best;
  const budget = typoBudget(length);
  if (options.typos && budget > 0) {
    for (const start of starts) {
      if (!mightBeWithin(wanted, target, start, budget)) continue;
      const edits = prefixEditDistance(wanted, target, budget, start);
      if (edits > budget) continue;
      const weight = share(length - edits, start, start + length - 1);
      if (best === null || weight > best.weight)
        best = { tier: TIER.typo, weight };
    }
  }
  if (best !== null) return best;
  if (
    options.loose &&
    length >= LOOSE_MIN_LENGTH &&
    isSubsequence(wanted, target)
  )
    return { tier: TIER.loose, weight: length / target.length };
  return null;
}

/** One attribute that tends to be rated the same way as another, or opposite. */
export type RelatedTag = {
  readonly tag: string;
  // In [−1, 1]: near 1, a thing that has one tends to have the other; near −1,
  // a thing that has one tends to lack the other. Symmetric.
  readonly similarity: number;
};

/**
 * The seam for learned attribute nearness: the attributes that move with (or
 * against) `tag` for this viewer, strongest first. `relationFrom` is today's;
 * a later model replaces it without search changing (DESIGN §1 "Search").
 */
export type TagRelation = (tag: string) => readonly RelatedTag[];

export const NO_RELATION: TagRelation = () => [];

/** A thing as the feed scores it: its support and its attribute scores. */
export type ScoredThing = {
  // `W_u(i)`: how much the viewer's network has to say about it.
  readonly weight: number;
  // `s_u(i,t)` per attribute, on §2.6's `(−1, 1)`.
  readonly tags: Readonly<Record<string, number>>;
};

// §2.6's `κ_s`: the same shrinkage a score gets, so a pair of attributes seen
// together on one thing reads as a hint rather than a law.
const KAPPA_S = 1;

// As many as a search could use for one word; the rest are weaker by
// construction.
export const RELATED_PER_TAG = 8;

/**
 * Attribute nearness from the viewer's own feed, and nothing else.
 *
 * A weighted cosine of two attributes' scores across the things in the feed,
 * each thing weighted by its support as §2.6 weights evidence, and shrunk by
 * `κ_s` as a score is:
 *
 *     ρ(a,b)  =  Σ_i W(i)·s(i,a)·s(i,b)  /  ( κ_s + sqrt(Σ_i W(i)·s(i,a)² · Σ_i W(i)·s(i,b)²) )
 *
 * Cosine and not a centred correlation because 0 on §2.6's scale already
 * means "nothing known": an attribute missing from a thing is that 0, adds
 * nothing to the top and nothing to the bottom's own sum, and a thing tagged
 * `loud` that nobody asked about `quiet` weakens the pair rather than being
 * skipped. The feed is already on the client, so this discloses nothing
 * (DESIGN §4).
 */
export function relationFrom(
  things: Iterable<ScoredThing>,
  perTag = RELATED_PER_TAG,
): TagRelation {
  // Tags interned to numbers and each unordered pair summed once, under one
  // numeric key: the feed holds thousands of things, each a dozen attributes.
  const index = new Map<string, number>();
  const names: string[] = [];
  const squares: number[] = [];
  const cross = new Map<number, number>();
  const stride = 2 ** 21;
  const ids: number[] = [];
  const values: number[] = [];
  for (const { weight, tags } of things) {
    if (!(weight > 0)) continue;
    ids.length = 0;
    values.length = 0;
    for (const tag in tags) {
      const score = tags[tag] as number;
      if (!Number.isFinite(score) || score === 0) continue;
      let id = index.get(tag);
      if (id === undefined) {
        id = names.length;
        index.set(tag, id);
        names.push(tag);
        squares.push(0);
      }
      ids.push(id);
      values.push(score);
      squares[id] = (squares[id] as number) + weight * score * score;
    }
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const leftId = ids[left] as number;
        const rightId = ids[right] as number;
        const key =
          leftId < rightId
            ? leftId * stride + rightId
            : rightId * stride + leftId;
        cross.set(
          key,
          (cross.get(key) ?? 0) +
            weight * (values[left] as number) * (values[right] as number),
        );
      }
    }
  }
  const lists: RelatedTag[][] = names.map(() => []);
  for (const [key, sum] of cross) {
    const leftId = Math.floor(key / stride);
    const rightId = key % stride;
    const similarity =
      sum /
      (KAPPA_S +
        Math.sqrt((squares[leftId] as number) * (squares[rightId] as number)));
    if (similarity === 0) continue;
    lists[leftId]?.push({ tag: names[rightId] as string, similarity });
    lists[rightId]?.push({ tag: names[leftId] as string, similarity });
  }
  const related = new Map<string, readonly RelatedTag[]>();
  names.forEach((name, id) => {
    const list = lists[id] as RelatedTag[];
    list.sort(
      (left, right) =>
        Math.abs(right.similarity) - Math.abs(left.similarity) ||
        (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0),
    );
    if (list.length > 0) related.set(name, list.slice(0, perTag));
  });
  return (tag) => related.get(tag) ?? [];
}

// No name or attribute worth finding by one run of typed words is longer than
// this, and a longer one is still found word by word.
export const MAX_SEGMENT_WORDS = 6;

/** A run of words `[start, end)` read as one term, and what it matched. */
export type Segment<Match> = {
  readonly start: number;
  readonly end: number;
  readonly match: Match | null;
};

export type Segmentation<Match> = {
  readonly cost: number;
  readonly segments: readonly Segment<Match>[];
};

/**
 * The cheapest way to cut `count` words into runs, each run either read by
 * `readSpan(start, end)` at some cost, or, for a single word, left unread at
 * `unreadCost(at)` (which may be infinite, to forbid it). The costs add, so
 * a caller scoring a split by a product passes negative logarithms.
 *
 * A dynamic programme over split points: at most `count · MAX_SEGMENT_WORDS`
 * calls of `readSpan` rather than one per each of the `2^(count − 1)` splits.
 * Ties go to the longer last segment.
 */
export function bestSegmentation<Match>(
  count: number,
  readSpan: (
    start: number,
    end: number,
  ) => { readonly cost: number; readonly match: Match } | null,
  unreadCost: (at: number) => number,
): Segmentation<Match> {
  const best: { cost: number; from: number; match: Match | null }[] = [
    { cost: 0, from: 0, match: null },
  ];
  for (let end = 1; end <= count; end += 1) {
    let here: { cost: number; from: number; match: Match | null } | null = null;
    for (
      let start = Math.max(0, end - MAX_SEGMENT_WORDS);
      start < end;
      start += 1
    ) {
      const found = readSpan(start, end);
      if (found === null) continue;
      const cost = (best[start] as { cost: number }).cost + found.cost;
      if (here === null || cost < here.cost)
        here = { cost, from: start, match: found.match };
    }
    const unread =
      (best[end - 1] as { cost: number }).cost + unreadCost(end - 1);
    if (here === null || unread < here.cost)
      here = { cost: unread, from: end - 1, match: null };
    best.push(here);
  }
  const segments: Segment<Match>[] = [];
  for (let end = count; end > 0; ) {
    const step = best[end] as { from: number; match: Match | null };
    segments.unshift({ start: step.from, end, match: step.match });
    end = step.from;
  }
  return { cost: (best[count] as { cost: number }).cost, segments };
}
