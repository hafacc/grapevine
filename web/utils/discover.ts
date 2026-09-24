import { confusableSkeleton, normalizeId, searchFold } from "grapevine-shared";
import type { Item, Ratings, RatingValue, RecsEntry } from "./types";

/**
 * A tag score at or below this is a clear no (DESIGN §2.6). Anything above it —
 * including "nothing is known", which is a tag with no score at all — passes,
 * because unknown is not "no".
 */
export const TAG_NO_EDGE = -0.1;

/** The viewer's own thumb on a thing (`tag` empty) or on one of its attributes. */
function ownRating(
  ratings: Ratings,
  itemId: string,
  tag: string,
): RatingValue | null {
  return ratings[itemId]?.[tag] ?? null;
}

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
 * attribute, or a person's handle and name on the people screen.
 */
export function matchesText(foldedQuery: string, candidate: string): boolean {
  if (foldedQuery.length === 0) return true;
  // The candidate is folded the same way the query was, and the lower-casing is
  // not redundant: an id arrives lower-case already, but a display name on the
  // people screen does not.
  const target = foldQuery(candidate);
  // By code point on both sides: an emoji is two UTF-16 units, and indexing
  // the query by unit compares half of one with the whole of another.
  const wanted = Array.from(foldedQuery);
  let at = 0;
  for (const character of target) {
    if (character === wanted[at]) at += 1;
    if (at === wanted.length) return true;
  }
  return false;
}

/** One attribute of a thing, as a row or a chip draws it. */
export type Attribute = {
  readonly tag: string;
  // §2.6's `s_u(i,t)`. Null is "nothing in reach has weighed in" — an attribute
  // the viewer rated themselves and nobody else did — which a bar draws as no
  // score rather than as the middle.
  readonly score: number | null;
  readonly own: RatingValue | null;
};

/**
 * Every attribute a thing carries for this viewer: the ones their own feed
 * scores, plus every one they have rated themselves.
 *
 * Most uncertain first, which on §2.6's `−1..1` scale is `|s|` ascending and
 * puts "nothing known" at the very front (DESIGN §1). Ties alphabetical, so the
 * order is the same twice running. The union is what keeps an attribute somebody
 * has just added on screen: the feed is recomputed on a staleness window, so
 * until then their own thumb is the only trace of it.
 */
export function attributesOf(
  itemId: string,
  entry: RecsEntry | undefined,
  ratings: Ratings,
): Attribute[] {
  const tags = new Set<string>(Object.keys(entry?.tags ?? {}));
  for (const tag of Object.keys(ratings[itemId] ?? {})) {
    if (tag !== "") tags.add(tag);
  }
  return [...tags]
    .map((tag) => ({
      tag,
      score: entry?.tags[tag] ?? null,
      own: ownRating(ratings, itemId, tag),
    }))
    .sort((left, right) => {
      const leftSure = left.score === null ? -1 : Math.abs(left.score);
      const rightSure = right.score === null ? -1 : Math.abs(right.score);
      return leftSure !== rightSure
        ? leftSure - rightSure
        : left.tag.localeCompare(right.tag);
    });
}

/**
 * Does this attribute let the thing through a query naming it?
 *
 * DESIGN §2.6's lenient rule, applied when a typed word matches an attribute:
 * the viewer said yes themselves, or the score is not clearly no, or nothing is
 * known. A tag with no score IS "nothing is known" — the core drops everything
 * below `W_min` before a feed is written, so a score that is here is already
 * above the floor.
 */
export function attributeAllows(attribute: Attribute): boolean {
  if (attribute.own === 1) return true;
  else if (attribute.score === null) return true;
  else return attribute.score > TAG_NO_EDGE;
}

/** One row of the one list. */
export type FeedRow = {
  // The id IS what is drawn: it is the text somebody typed, folded, and there is
  // no name to look up (DESIGN §3.2).
  readonly itemId: string;
  // §2.6's `s_u(i)`, null for a thing nobody in reach has rated. What the list
  // is ranked by with an empty field, and never drawn.
  readonly score: number | null;
  // `W_u(i)`, what a query ranks by. Never drawn either: a support figure is the
  // kind of count DESIGN §4 keeps off every screen.
  readonly conf: number | null;
  // What this row's bar draws: the matched attribute's score when a typed word
  // matched one, the thing's own otherwise (DESIGN §1). Null is "nothing known
  // yet", which the bar has a state for.
  readonly barScore: number | null;
  // The attribute the query matched, or null when the id matched or nothing was
  // typed. It is why this row is here, which is the whole answer the list owes.
  readonly matchedTag: string | null;
  readonly attributes: readonly Attribute[];
  readonly own: RatingValue | null;
};

export type FeedFilter = {
  readonly query: string;
  // The eye: things the viewer has already answered are out of the way.
  readonly hideRated: boolean;
  // Catalog rows the field turned up (`searchItems`), merged in so a thing
  // nobody in reach has rated is still found by its own name rather than added
  // a second time. Ignored with an empty field: the list is the feed then, not
  // the catalog.
  readonly catalog?: readonly Item[];
};

function strongest(attributes: readonly Attribute[]): Attribute {
  return attributes.reduce((best, candidate) => {
    const bestScore = best.score ?? 0;
    const candidateScore = candidate.score ?? 0;
    if (candidateScore !== bestScore)
      return candidateScore > bestScore ? candidate : best;
    else return candidate.tag.localeCompare(best.tag) < 0 ? candidate : best;
  });
}

/**
 * The one list: the viewer's feed with the field empty, and what a typed word
 * matches otherwise.
 *
 * With nothing typed it is §2.6's ranking over the viewer's own feed plus
 * everything the viewer has rated. An entry with `conf: 0` is one carried only
 * by an attribute of it (DESIGN §3.4) — it exists so a thing's screen has its
 * chips, and unless the viewer rated it, it is left out here rather than sorted
 * into the middle of the ranking on a score nothing supports.
 *
 * With something typed, a row is here because the id matched or because one of
 * its attributes did, and a matching attribute has to pass §2.6's filter as
 * well: searching for an attribute the viewer's network says the thing plainly
 * lacks would otherwise answer with exactly the things they meant to exclude.
 * The ranking is then by `conf` — what the viewer's own network has most to say
 * about, first — and alphabetically after that, which is where a catalog row
 * with no feed entry of its own lands.
 */
export function feedRows(
  entries: readonly RecsEntry[],
  ratings: Ratings,
  filter: FeedFilter,
): FeedRow[] {
  const folded = foldQuery(filter.query);
  const searching = folded.length > 0;
  const byItemId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const itemIds = new Set<string>(byItemId.keys());
  // Everything the viewer has rated, the thing or only an attribute of it: the
  // feed is written on a staleness window and leaves out what nobody else in
  // reach has rated, so without this a thing rated with no friends is on no
  // list at all once the field is cleared.
  for (const itemId of Object.keys(ratings)) itemIds.add(itemId);
  if (searching) {
    for (const item of filter.catalog ?? []) itemIds.add(item.id);
  }

  const rows: FeedRow[] = [];
  for (const itemId of itemIds) {
    const entry = byItemId.get(itemId);
    const own = ownRating(ratings, itemId, "");
    if (filter.hideRated && own !== null) continue;
    const attributes = attributesOf(itemId, entry, ratings);
    let matchedTag: string | null = null;
    if (!searching) {
      const rated = Object.keys(ratings[itemId] ?? {}).length > 0;
      if (!rated && (!entry || entry.conf <= 0)) continue;
    } else if (!matchesText(folded, itemId)) {
      const matched = attributes.filter(
        (attribute) =>
          attributeAllows(attribute) && matchesText(folded, attribute.tag),
      );
      if (matched.length === 0) continue;
      // The strongest of the matching attributes carries the row, because that
      // is the one that answers "why is this here" — a thing the network calls
      // coffee, rather than the one it is least sure about.
      matchedTag = strongest(matched).tag;
    }
    rows.push({
      itemId,
      score: entry?.score ?? null,
      conf: entry?.conf ?? null,
      barScore:
        matchedTag === null
          ? (entry?.score ?? null)
          : (entry?.tags[matchedTag] ?? null),
      matchedTag,
      attributes,
      own,
    });
  }

  return rows.sort((left, right) => {
    if (searching) {
      const leftConf = left.conf ?? Number.NEGATIVE_INFINITY;
      const rightConf = right.conf ?? Number.NEGATIVE_INFINITY;
      if (leftConf !== rightConf) return rightConf - leftConf;
    } else {
      const leftScore = left.score ?? 0;
      const rightScore = right.score ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
    }
    return left.itemId.localeCompare(right.itemId);
  });
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
 */
export function lookAlike(typed: string, ids: Iterable<string>): string | null {
  const id = normalizeId(typed);
  if (id === null) return null;
  const known = [...ids];
  if (known.includes(id)) return null;
  const skeleton = confusableSkeleton(id);
  return known.find((other) => confusableSkeleton(other) === skeleton) ?? null;
}
