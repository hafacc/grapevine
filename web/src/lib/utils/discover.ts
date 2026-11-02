import { confusableSkeleton, foldId } from "grapevine-shared";
import type { TagEntry } from "grapevine-shared/entries";
import {
  bestSegmentation,
  foldQuery,
  MAX_SEGMENT_WORDS,
  matchTerm,
  NO_RELATION,
  type Prepared,
  parseQuery,
  prepare,
  type SearchField,
  type SearchWord,
  type Segmentation,
  type TagRelation,
  type TermMatch,
} from "grapevine-shared/search";
import { barValue } from "./bar";
import { ratingOf } from "./ratings";
import type { Item, Ratings, RatingValue, RecsEntry } from "./types";

export { foldQuery };

const ownRating = ratingOf;

// A feed entry's word on one attribute, by its own keys only: an attribute
// may be named `constructor`.
function tagEntry(entry: RecsEntry | undefined, tag: string): TagEntry | null {
  if (entry === undefined || !Object.hasOwn(entry.tags, tag)) return null;
  return entry.tags[tag] ?? null;
}

/**
 * Does every character of the query appear in the candidate, in order?
 *
 * An ordered-subsequence match, not an edit distance and not a library: it costs
 * one pass per candidate, it runs on every keystroke over the whole feed, and
 * what it buys is that a dropped letter still finds the thing that exists rather
 * than offering to make a second one (DESIGN §1). What it does not do is rank by
 * how good the match was — the order is §2.6's, not the matcher's.
 *
 * The query is already folded (`foldQuery`); the candidate is folded here,
 * because a candidate is text held in memory rather than a column — an id, an
 * attribute, or a person's name on the people screen.
 */
export function matchesText(foldedQuery: string, candidate: string): boolean {
  if (foldedQuery.length === 0) return true;
  // The candidate is folded the same way the query was, and the lower-casing is
  // not redundant: an id arrives lower-case already, but a display name on the
  // people screen does not.
  const target = foldQuery(candidate);
  // By code point on both sides: a character past the BMP (much of Han, or an
  // emoji typed into the query) is two UTF-16 units, and indexing
  // the query by unit compares half of one with the whole of another.
  const wanted = Array.from(foldedQuery);
  let at = 0;
  for (const character of target) {
    if (character === wanted[at]) at += 1;
    if (at === wanted.length) return true;
  }
  return false;
}

/**
 * One attribute of a thing, as a row or a chip draws it. A rating of an
 * attribute says it applies, whichever way the thumb points; the thumb says
 * how good an example of it the thing is.
 */
export type Attribute = {
  readonly tag: string;
  // How good an example, as the bar draws it: `barValue` of what the
  // accounts the viewer follows said. Null is "nobody has said" — an attribute
  // only the viewer rated — which a bar draws as no score rather than as the
  // middle.
  readonly score: number | null;
  // How far it counts as on the thing, in [0, 1]: one where the viewer rated
  // it, otherwise how far the followed accounts' thumbs on it lean up.
  readonly applies: number;
  readonly own: RatingValue | null;
};

/**
 * Whether a thing is shown as having an attribute: the viewer rated it, which
 * `attributesOf` reads as applying whichever way the thumb points, or the
 * accounts they follow put it on and their thumbs on it lean up. One they
 * mostly thumbed down is found by a search and not shown (DESIGN §1).
 */
export function carries(attribute: Attribute): boolean {
  return attribute.applies > 0.5;
}

/**
 * Every attribute known about a thing for this viewer: the ones their own
 * feed scores, plus every one they have rated themselves. `carries`
 * says which of them the thing is shown as having.
 *
 * Most uncertain first, which on §2.6's `−1..1` scale is `|s|` ascending and
 * puts "nothing known" at the very front (DESIGN §1). Ties alphabetical, so the
 * order is the same twice running. The union is what keeps an attribute somebody
 * has just added on screen: the list is computed when the list is opened, so
 * until then their own thumb is the only trace of it.
 */
export function attributesOf(
  itemId: string,
  entry: RecsEntry | undefined,
  ratings: Ratings,
): Attribute[] {
  const tags = new Set<string>(Object.keys(entry?.tags ?? {}));
  const rated = Object.hasOwn(ratings, itemId) ? ratings[itemId] : undefined;
  for (const tag of Object.keys(rated ?? {})) {
    if (tag !== "") tags.add(tag);
  }
  return [...tags]
    .map((tag) => {
      const said = tagEntry(entry, tag);
      const own = ownRating(ratings, itemId, tag);
      return {
        tag,
        score: said === null ? null : barValue(said.score),
        applies: own !== null ? 1 : (said?.applies ?? UNKNOWN_PRESENCE),
        own,
      };
    })
    .sort((left, right) => {
      const leftSure = left.score === null ? -1 : Math.abs(left.score);
      const rightSure = right.score === null ? -1 : Math.abs(right.score);
      return leftSure !== rightSure
        ? leftSure - rightSure
        : left.tag.localeCompare(right.tag);
    });
}

/** One row of the one list. */
export type FeedRow = {
  // The id IS what is drawn: it is the text somebody typed, folded, and there is
  // no name to look up (DESIGN §3.2).
  readonly itemId: string;
  // The thing's `barValue`, what the list is ranked by with an empty
  // field. Null for a thing nothing has scored.
  readonly score: number | null;
  // The tie-break after the score, and nothing else: the score already holds
  // how little stands behind it. Never drawn: a support figure is the kind of
  // count DESIGN §4 keeps off every screen.
  readonly conf: number | null;
  // What this row's bar draws: the score of `matchedTag` when there is one,
  // `score` otherwise (DESIGN §1). Null is "nothing known yet", which the bar
  // has a state for.
  readonly barScore: number | null;
  // Of the attributes the query matched, the one the network is least sure
  // the thing has, which is what limits how well it fits. Null when only the
  // name matched or nothing was typed.
  readonly matchedTag: string | null;
  // Every attribute the query matched, which the row's chips mark: they show
  // how the words were read, `late night` as one attribute or as two words.
  readonly matchedTags: readonly string[];
  readonly attributes: readonly Attribute[];
  readonly own: RatingValue | null;
};

export type FeedFilter = {
  readonly query: string;
  // The eye: things the viewer has already answered are out of the way.
  readonly hideRated: boolean;
  // Catalog rows the field turned up (`searchItems`), merged in so a thing
  // nobody the viewer follows has rated is still found by its own name rather than added
  // a second time. Ignored without a word to find: the list is the feed then,
  // not the catalog.
  readonly catalog?: readonly Item[];
  // Learned attribute nearness (DESIGN §1 "Search"). Absent, a word finds only text.
  readonly relation?: TagRelation;
};

export type FeedSearch = {
  readonly rows: FeedRow[];
  // What was typed that nothing on the list matched, as typed, operators and
  // all: left out rather than emptying the list, and named when the list is
  // empty anyway.
  readonly unmatched: readonly string[];
};

// What a term contributes when the thing says nothing about it: the midpoint,
// so unknown sits above "said not" and below any yes (DESIGN §1 "Search").
export const UNKNOWN_PRESENCE = 0.5;

/**
 * How present an attribute is on a thing, in `[0, 1]`: the chance it applies.
 * One where the viewer rated it, whichever way: a bad fantasy is a fantasy.
 */
export function presence(attribute: Attribute): number {
  return attribute.applies;
}

/**
 * How good a thing is, or how good an example of an attribute, in `[0, 1]`:
 * the viewer's own thumb when there is one, 1 or 0; otherwise the bar's value
 * read back as the chance it was made from, `(1 + s) / 2`, with nothing known
 * at one half.
 */
export function goodness(known: {
  readonly score: number | null;
  readonly own: RatingValue | null;
}): number {
  if (known.own !== null) return (1 + known.own) / 2;
  else if (known.score !== null) return (1 + known.score) / 2;
  else return UNKNOWN_PRESENCE;
}

// A match that is only `weight` likely to be what was meant is, the rest of
// the time, no information at all: the expectation of the two.
function discount(weight: number, evidence: number): number {
  return UNKNOWN_PRESENCE + weight * (evidence - UNKNOWN_PRESENCE);
}

/** One reading of a span on one row: the name (`tag` null) or an attribute. */
type Reading = {
  // How likely this is what the words meant, for the split.
  readonly weight: number;
  // What the term contributes to the row's strength, in [0, 1].
  readonly presence: number;
  readonly tag: string | null;
  // Reached through learned nearness rather than spelled.
  readonly related: boolean;
};

type Candidate = {
  readonly itemId: string;
  readonly entry: RecsEntry | undefined;
  readonly attributes: readonly Attribute[];
  readonly own: RatingValue | null;
  // The thing's `barValue`.
  readonly score: number | null;
  // The thing's own presence, what a piece of the query that reads as its
  // name contributes: how good it is, on the scale an attribute uses.
  readonly presence: number;
};

function joinWords(
  words: readonly SearchWord[],
  start: number,
  end: number,
): string {
  return words
    .slice(start, end)
    .map((word) => word.text)
    .join(" ");
}

/** A run of words read as one term, and everything about it that no row changes. */
type Span = {
  readonly text: string;
  readonly prepared: Prepared;
  // Match per attribute, filled as rows ask: attributes repeat across the
  // list, names do not.
  readonly tagMatches: Map<string, TermMatch | null>;
  // Attributes the viewer's feed says go with an attribute this span spells:
  // the correlation, already discounted by how well the span spelled it.
  readonly related: ReadonlyMap<string, number>;
};

// Names and attributes are folded on every keystroke and change only when the
// feed does, so each is folded once. Cleared when full, so a long session over
// a changing catalog cannot grow it without bound.
const FOLD_CACHE_LIMIT = 50_000;
const foldCache = new Map<string, { folded: string; prepared: Prepared }>();

function foldedCandidate(text: string): {
  folded: string;
  prepared: Prepared;
} {
  const known = foldCache.get(text);
  if (known !== undefined) return known;
  if (foldCache.size >= FOLD_CACHE_LIMIT) foldCache.clear();
  const folded = foldQuery(text);
  const entry = { folded, prepared: prepare(folded) };
  foldCache.set(text, entry);
  return entry;
}

const AS_NAME = { loose: true, typos: true, whole: false } as const;
const AS_ATTRIBUTE = { loose: true, typos: true, whole: true } as const;
// An attribute a relation is looked up for has to be spelled, not guessed at.
const AS_SPELLED = { loose: false, typos: true, whole: true } as const;

function tagMatch(span: Span, tag: string): TermMatch | null {
  const known = span.tagMatches.get(tag);
  if (known !== undefined) return known;
  const match = matchTerm(
    span.prepared,
    foldedCandidate(tag).prepared,
    AS_ATTRIBUTE,
  );
  span.tagMatches.set(tag, match);
  return match;
}

function relatedTo(
  prepared: Prepared,
  tags: Iterable<string>,
  relation: TagRelation,
): Map<string, number> {
  const related = new Map<string, number>();
  if (relation === NO_RELATION) return related;
  for (const tag of tags) {
    const spelled = matchTerm(
      prepared,
      foldedCandidate(tag).prepared,
      AS_SPELLED,
    );
    if (spelled === null) continue;
    for (const { tag: other, similarity } of relation(tag)) {
      const implied = spelled.weight * similarity;
      const before = related.get(other) ?? 0;
      if (Math.abs(implied) > Math.abs(before)) related.set(other, implied);
    }
  }
  return related;
}

/**
 * The best reading of one span on one row, or null when nothing on the row
 * answers it. `field` is `tag` for a span typed with `#`, which reads as an
 * attribute only.
 *
 * Spelled readings — the name, which contributes how good the thing is, or an
 * attribute, which contributes how present it is — are compared by what they
 * contribute, and the stronger wins. Only a span no spelled reading answers
 * falls back to learned nearness, which is about attributes, and a relation
 * can imply "not": `quiet` on a thing the feed calls `loud` reads below
 * unknown. A `!` span takes the same reading and flips it afterwards.
 */
function readSpan(
  span: Span,
  field: SearchField,
  name: Prepared,
  candidate: Candidate,
): Reading | null {
  let best: Reading | null = null;
  const consider = (reading: Reading) => {
    if (
      best === null ||
      reading.presence > best.presence ||
      (reading.presence === best.presence &&
        best.tag !== null &&
        (reading.tag === null || reading.tag.localeCompare(best.tag) < 0))
    )
      best = reading;
  };
  const byName =
    field === "tag" ? null : matchTerm(span.prepared, name, AS_NAME);
  if (byName !== null)
    consider({
      weight: byName.weight,
      presence: discount(byName.weight, candidate.presence),
      tag: null,
      related: false,
    });
  for (const attribute of candidate.attributes) {
    const match = tagMatch(span, attribute.tag);
    if (match === null) continue;
    consider({
      weight: match.weight,
      presence: discount(match.weight, presence(attribute)),
      tag: attribute.tag,
      related: false,
    });
  }
  if (best !== null) return best;
  let strongest: Reading | null = null;
  for (const attribute of candidate.attributes) {
    const implied = span.related.get(attribute.tag);
    if (implied === undefined) continue;
    const reading = {
      weight: Math.abs(implied),
      presence:
        UNKNOWN_PRESENCE + implied * (presence(attribute) - UNKNOWN_PRESENCE),
      tag: attribute.tag,
      related: true,
    };
    if (
      strongest === null ||
      Math.abs(reading.presence - UNKNOWN_PRESENCE) >
        Math.abs(strongest.presence - UNKNOWN_PRESENCE)
    )
      strongest = reading;
  }
  return strongest;
}

// What a reading adds to a row's strength: its presence, or for a `!` term,
// the chance of the opposite.
function contribution(reading: Reading, low: boolean): number {
  return low ? 1 - reading.presence : reading.presence;
}

function toRow(candidate: Candidate, readings: readonly Reading[]): FeedRow {
  // The bar goes to the spelled attribute that fits least: a related one
  // would draw a different word's score under this one.
  const limiting = readings
    .filter((reading) => reading.tag !== null && !reading.related)
    .reduce<Reading | null>(
      (worst, reading) =>
        worst === null ||
        reading.presence < worst.presence ||
        (reading.presence === worst.presence &&
          (reading.tag as string).localeCompare(worst.tag as string) < 0)
          ? reading
          : worst,
      null,
    );
  const { entry } = candidate;
  const matchedTag = limiting?.tag ?? null;
  return {
    itemId: candidate.itemId,
    score: candidate.score,
    conf: entry?.conf ?? null,
    barScore:
      matchedTag === null
        ? candidate.score
        : (candidate.attributes.find((known) => known.tag === matchedTag)
            ?.score ?? null),
    matchedTag,
    matchedTags: [
      ...new Set(
        readings.flatMap((reading) =>
          reading.tag === null ? [] : [reading.tag],
        ),
      ),
    ],
    attributes: candidate.attributes,
    own: candidate.own,
  };
}

/**
 * The one list: the viewer's feed with the field empty, and what the query
 * matches otherwise (DESIGN §1 "Search").
 *
 * With no word to find it is every entry of the viewer's feed — everything an
 * account they follow rated (DESIGN §2: nothing is hidden) — plus everything
 * the viewer has rated, ranked by `barValue`, then by `conf`.
 *
 * With words, a thing is on the list when any part of the query reads as its
 * name or one of its attributes, and is ranked by its strength: the geometric
 * mean, per typed word and once more for how good an example it is when no
 * word read as its name, of what each term contributes — the thing's
 * `barValue` for a piece read as its name, the attribute's presence for one read as an
 * attribute, both as `presence` reads them and discounted by how well they were
 * spelled, one minus that for a piece typed with `!`, and `UNKNOWN_PRESENCE`
 * for a word the thing says nothing about — under whichever split of the
 * words scores it highest. A thing that lacks a word is lower, not gone. Ties
 * go to `conf`, then alphabetical.
 */
export function searchFeed(
  entries: readonly RecsEntry[],
  ratings: Ratings,
  filter: FeedFilter,
): FeedSearch {
  const { words } = parseQuery(filter.query);
  const relation = filter.relation ?? NO_RELATION;
  const byItemId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const itemIds = new Set<string>(byItemId.keys());
  // Everything the viewer has rated, the thing or only an attribute of it: the
  // feed leaves out what nobody they follow has rated, so without this a thing
  // only they rated is on no list at all once the field is cleared.
  for (const itemId of Object.keys(ratings)) itemIds.add(itemId);
  if (words.length > 0) {
    for (const item of filter.catalog ?? []) itemIds.add(item.id);
  }

  const candidates: Candidate[] = [];
  // Every attribute on the list, as stored: what a relation is keyed by.
  const tags = new Set<string>();
  for (const itemId of itemIds) {
    const own = ownRating(ratings, itemId, "");
    if (filter.hideRated && own !== null) continue;
    const entry = byItemId.get(itemId);
    const score = barValue(entry?.score ?? null);
    const attributes = attributesOf(itemId, entry, ratings);
    for (const attribute of attributes) tags.add(attribute.tag);
    candidates.push({
      itemId,
      entry,
      attributes,
      own,
      score,
      presence: goodness({ score, own }),
    });
  }

  if (words.length === 0) {
    const rows = candidates.map((candidate) => toRow(candidate, []));
    rows.sort((left, right) => {
      const leftScore = left.score ?? 0;
      const rightScore = right.score ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      const leftConf = left.conf ?? 0;
      const rightConf = right.conf ?? 0;
      if (leftConf !== rightConf) return rightConf - leftConf;
      else return left.itemId.localeCompare(right.itemId);
    });
    return { rows, unmatched: [] };
  }

  const spans = new Map<string, Span>();
  function spanFor(text: string): Span {
    const known = spans.get(text);
    if (known !== undefined) return known;
    const prepared = prepare(text);
    const span: Span = {
      text,
      prepared,
      tagMatches: new Map(),
      related: relatedTo(prepared, tags, relation),
    };
    spans.set(text, span);
    return span;
  }
  // A word with an operator starts a new term, which may run on over the
  // plain words after it and takes that word's operators: `!@dune messiah` is
  // one name, low-rated first. Every run of words a term could be, spelled
  // once rather than per row: `[start][length − 1]`.
  const termSpans = words.map((_, start) => {
    const lengths: Span[] = [];
    for (
      let end = start + 1;
      end <= words.length && end - start <= MAX_SEGMENT_WORDS;
      end += 1
    ) {
      if (end > start + 1 && isOperated(words[end - 1] as SearchWord)) break;
      lengths.push(spanFor(joinWords(words, start, end)));
    }
    return lengths;
  });

  const live = new Set<number>();
  const unmatched: string[] = [];
  const scored: {
    candidate: Candidate;
    strength: number;
    readings: Reading[];
  }[] = [];
  for (const candidate of candidates) {
    const name = foldedCandidate(candidate.itemId).prepared;
    const read = termSpans.map((lengths, start) => {
      const { field } = words[start] as SearchWord;
      return lengths.map((span) => readSpan(span, field, name, candidate));
    });
    // A word may be left unread only where nothing on the row answers it:
    // otherwise the best split would simply skip a "not".
    const answerable = words.map((_, at) =>
      read.some((lengths, start) =>
        lengths.some(
          (reading, length) =>
            reading !== null && start <= at && at <= start + length,
        ),
      ),
    );
    const split = bestSplit(words, read, answerable);
    const readings: Reading[] = [];
    let logSum = 0;
    let visible = false;
    for (const segment of split.segments) {
      const reading = segment.match;
      const size = segment.end - segment.start;
      if (reading === null) {
        logSum += size * Math.log(UNKNOWN_PRESENCE);
        continue;
      }
      const added = contribution(
        reading,
        (words[segment.start] as SearchWord).low,
      );
      readings.push(reading);
      logSum += size * Math.log(Math.max(added, Number.MIN_VALUE));
      if (!reading.related || added > UNKNOWN_PRESENCE) visible = true;
      for (let at = segment.start; at < segment.end; at += 1) live.add(at);
    }
    if (!visible) continue;
    // Asked for by what it is rather than by name, a thing is wanted in
    // proportion to how good an example it is: `fantasy` is the good
    // fantasies, which a book the viewer would not otherwise like can be. Each
    // attribute asked for says how good an example the thing is where anybody
    // has said, and how good the thing is where nobody has. A piece read as
    // the name has already counted how good the thing is.
    const named = readings.some((reading) => reading.tag === null);
    const examples = named
      ? []
      : readings
          .filter((reading) => reading.tag !== null && !reading.related)
          .map((reading) => {
            const attribute = candidate.attributes.find(
              (known) => known.tag === reading.tag,
            );
            return attribute !== undefined &&
              (attribute.own !== null || attribute.score !== null)
              ? goodness(attribute)
              : candidate.presence;
          });
    if (!named && examples.length === 0) examples.push(candidate.presence);
    const example =
      examples.reduce(
        (sum, value) => sum + Math.log(Math.max(value, Number.MIN_VALUE)),
        0,
      ) / Math.max(examples.length, 1);
    const strength = named
      ? Math.exp(logSum / words.length)
      : Math.exp((logSum + example) / (words.length + 1));
    scored.push({ candidate, strength, readings });
  }

  words.forEach((word, index) => {
    if (!live.has(index)) unmatched.push(word.raw);
  });
  scored.sort((left, right) => {
    if (left.strength !== right.strength) return right.strength - left.strength;
    const leftConf = left.candidate.entry?.conf ?? Number.NEGATIVE_INFINITY;
    const rightConf = right.candidate.entry?.conf ?? Number.NEGATIVE_INFINITY;
    if (leftConf !== rightConf) return rightConf - leftConf;
    return left.candidate.itemId.localeCompare(right.candidate.itemId);
  });
  return {
    rows: scored.map((entry) => toRow(entry.candidate, entry.readings)),
    unmatched,
  };
}

function isOperated(word: SearchWord): boolean {
  return word.low || word.field !== "any";
}

/**
 * The split of the words that scores the row highest:
 * `Σ words · ln(contribution)`, so every typed word counts once however the
 * words are grouped. A dynamic programme over split points
 * (`bestSegmentation`), maximising rather than minimising, with "unread"
 * allowed only for a word nothing answers.
 */
function bestSplit(
  words: readonly SearchWord[],
  read: readonly (readonly (Reading | null)[])[],
  answerable: readonly boolean[],
): Segmentation<Reading> {
  return bestSegmentation(
    words.length,
    (start, end) => {
      const reading = read[start]?.[end - start - 1] ?? null;
      if (reading === null) return null;
      const added = contribution(reading, (words[start] as SearchWord).low);
      return {
        cost: -(end - start) * Math.log(Math.max(added, 1e-12)),
        match: reading,
      };
    },
    (at) =>
      answerable[at] ? Number.POSITIVE_INFINITY : -Math.log(UNKNOWN_PRESENCE),
  );
}

/** `searchFeed`'s rows alone. */
export function feedRows(
  entries: readonly RecsEntry[],
  ratings: Ratings,
  filter: FeedFilter,
): FeedRow[] {
  return searchFeed(entries, ratings, filter).rows;
}

/**
 * Whether the eye is what emptied the list: it is on, and without it there
 * would be rows. Somebody there has a list of their own, so the first-run
 * screen, which tells them to go and start one, is the wrong thing to show.
 */
export function hiddenByEye(
  entries: readonly RecsEntry[],
  ratings: Ratings,
  filter: FeedFilter,
): boolean {
  return (
    filter.hideRated &&
    feedRows(entries, ratings, filter).length === 0 &&
    feedRows(entries, ratings, { ...filter, hideRated: false }).length > 0
  );
}

/**
 * A thing the viewer could reach that a reader could not tell the typed name
 * apart from, or null.
 *
 * DESIGN §3.2 asks for the skeleton at lookup and not only at the add button:
 * `café bleu` and a spelling of it with a Cyrillic `а` are two ids NFKC leaves
 * alone and no reader can distinguish, so the second one is offered the first
 * rather than an *add*. It catches the accident of two people and two keyboards
 * and makes no claim about a determined one.
 *
 * `ids` is every id the viewer's feed and the catalog search hold, NOT the rows
 * the query left on screen: the look-alike is by definition a name the typed
 * text does not match, so the filtered list never contains it.
 *
 * Null when the typed name IS one of the ids: an add that collides is a find,
 * and there is nothing to warn about.
 *
 * The typed text is folded but not refused: a Latin word with a Cyrillic `а`
 * in it could never be added, and is exactly what should point at the thing it
 * imitates.
 */
export function lookAlike(typed: string, ids: Iterable<string>): string | null {
  const id = foldId(typed);
  if (id === "") return null;
  const known = [...ids];
  if (known.includes(id)) return null;
  const skeleton = confusableSkeleton(id);
  return known.find((other) => confusableSkeleton(other) === skeleton) ?? null;
}
