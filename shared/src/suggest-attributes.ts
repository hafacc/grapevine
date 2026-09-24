/**
 * The *suggested* rail: which attributes to propose on a thing (DESIGN §2.11).
 *
 * It reads the viewer's own ratings and nothing else — not the feed, not the
 * walk's output, not any aggregate over anybody — and the reason is an attack
 * rather than a privacy rule: candidates drawn from the network would let
 * somebody poison a viewer's suggestions by rating the things that viewer
 * rates. Drawing only on the viewer's own vocabulary makes that impossible by
 * construction, which is also why this runs on the client and re-ranks the
 * instant a thumb lands.
 */

/** The row's capacity: what fits two lines at the chip sizes `DESIGN-UI` gives. */
export const MAX_SUGGESTIONS = 5;

/**
 * The viewer's own thumbs: item id, then tag, with the empty string for the
 * thing itself.
 *
 * The value is unread — a thumbs-down counts as having used an attribute,
 * because a chip asks a question and engaging with the question is what makes
 * the word yours, not the answer.
 */
export type RatedAttributes = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

/** One rated thing, as the objective sees it. */
type HistoryThing = {
  readonly attributes: readonly string[];
  // `|attrs(i) ∩ A| / |A|`, and 1 with `A` empty: a thing carrying two of the
  // three attributes the viewer has rated here counts two thirds. Not the
  // unnormalized overlap, which lets a thing with many attributes dominate, and
  // never a filter — requiring all of `A` collapses to nothing past two.
  readonly weight: number;
};

// Two gains that differ by less than this are the same gain: `sqrt` makes
// arithmetically equal sums differ in the last bits depending on the order the
// history arrived in, and the tie-break below is what keeps the row the same
// twice running.
const SAME_GAIN = 1e-12;

function attributesRated(tags: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(tags).filter((tag) => tag !== "");
}

/** What the viewer themselves has rated on one thing — `A` of DESIGN §2.11. */
export function ownAttributes(
  history: RatedAttributes,
  itemId: string,
): string[] {
  const tags = history[itemId];
  return tags === undefined ? [] : attributesRated(tags);
}

/**
 * At most five attributes to propose, best first.
 *
 * Maximum coverage over the viewer's own history: choose `S` to maximize
 * `V(S) = Σ_i w(i)·√|{t in S : i carries t}|`, adding one attribute at a time
 * and each time taking the one that raises `V` the most. Most-used attribute
 * first, then whichever covers the most things that one missed; `V` is monotone
 * and submodular, so greedy is within `1 − 1/e` of the best set of that size.
 *
 * The concave `√` is what replaces a special case: covering something already
 * covered still helps, just less, so the cascade to things carrying one
 * suggestion, then two, falls out at every depth instead of being a fallback.
 * Linear would rank by total usage and propose near-duplicates; a step function
 * would be plain coverage and stall once everything is covered.
 *
 * `rated` is what the VIEWER has rated on the thing being shown, never what the
 * screen shows: an attribute somebody else put there is not a condition, and
 * the row must not narrow because of anyone else's thumb. Those attributes are
 * also the only ones dropped from the candidates — proposing a question the
 * viewer has already answered is the one exclusion that is theirs.
 *
 * No floor: a viewer with one rated attribute anywhere is proposed that one,
 * and a viewer with none gets an empty list rather than a placeholder.
 */
export function suggestAttributes(
  history: RatedAttributes,
  rated: readonly string[],
): string[] {
  const narrowing = new Set(rated);
  const things: HistoryThing[] = [];
  for (const tags of Object.values(history)) {
    const attributes = attributesRated(tags);
    if (attributes.length === 0) continue;
    const overlap = attributes.filter((tag) => narrowing.has(tag)).length;
    const weight = narrowing.size === 0 ? 1 : overlap / narrowing.size;
    // A thing sharing nothing with what the viewer has said here contributes
    // nothing to `V` at any depth, so it is dropped rather than carried.
    if (weight > 0) things.push({ attributes, weight });
  }

  // Which things carry each candidate. The thing on screen is in the history
  // like any other and needs no special case: everything it carries is in
  // `rated`, so it covers no candidate and adds `f(0) = 0` whatever is chosen.
  const carriedBy = new Map<string, number[]>();
  things.forEach((thing, at) => {
    for (const tag of thing.attributes) {
      if (narrowing.has(tag)) continue;
      const carriers = carriedBy.get(tag);
      if (carriers === undefined) carriedBy.set(tag, [at]);
      else carriers.push(at);
    }
  });

  const covered = things.map(() => 0);
  const chosen: string[] = [];
  while (chosen.length < MAX_SUGGESTIONS && carriedBy.size > 0) {
    let best: string | null = null;
    let bestGain = 0;
    let bestCarriers = 0;
    for (const [tag, carriers] of carriedBy) {
      let gain = 0;
      for (const at of carriers) {
        const thing = things[at];
        const already = covered[at];
        if (thing === undefined || already === undefined) continue;
        gain += thing.weight * (Math.sqrt(already + 1) - Math.sqrt(already));
      }
      const better =
        gain - bestGain > SAME_GAIN ||
        (Math.abs(gain - bestGain) <= SAME_GAIN &&
          best !== null &&
          (carriers.length !== bestCarriers
            ? carriers.length > bestCarriers
            : tag.localeCompare(best) < 0));
      if (better) {
        best = tag;
        bestGain = gain;
        bestCarriers = carriers.length;
      }
    }
    // Every remaining candidate is carried by nothing that still weighs
    // anything, so no order of them says more than another.
    if (best === null) break;
    for (const at of carriedBy.get(best) ?? []) {
      covered[at] = (covered[at] ?? 0) + 1;
    }
    carriedBy.delete(best);
    chosen.push(best);
  }
  return chosen;
}
