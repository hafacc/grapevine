// Everything between the core's answer and the list a screen reads: turning
// one account's thumbs into what the core takes, dropping what a crafted row
// could hold, and folding ratable scores into one entry per item.
//
// It lives here rather than in `web/` because it is pure, and the same shapes
// are the core's boundary. `tests/entries.test.ts` is the whole contract.

import { isNormalizedId } from "./index.ts";

/**
 * What joins an item to one of its attributes for the core, which wants one map
 * key per rated thing: `café bleu`, or `café bleu` and `coffee` with this
 * between them (DESIGN §3.2).
 *
 * A NUL, because Postgres text cannot hold one at all — the server refuses the
 * byte on input — so no name anybody can type can forge the join or smuggle a
 * second separator into a half. That holds by construction, which matters
 * because an id is any script's letters and punctuation, and no pattern
 * `CHECK` could enumerate what a half may contain.
 *
 * It exists here and in `rust/src/data.rs` and nowhere else: never stored,
 * never queried, never shown. The database keys a rating by its columns and
 * every client shape is nested.
 */
export const RATABLE_JOIN = String.fromCodePoint(0);

// The wasm-boundary shapes the folding touches, declared here so that the pure
// half depends on no build output.

/**
 * One ratable's score in `(−1, 1)` — what the followed accounts say of it plus
 * the viewer's own fitted departure from that — and the count of followed
 * accounts that said anything of it.
 */
export type ScoreData = {
  readonly score: number;
  readonly confidence: number;
  /** One for a thing itself; for a tag on a thing, `score` on `(0, 1)`. */
  readonly applies: number;
};

/**
 * One tag on one thing, for the viewer. A rating of a tag says the tag applies,
 * whichever way its thumb points, and the thumb says how good an example of
 * it the thing is.
 */
export type TagEntry = {
  /** How good an example, `s ∈ (−1, 1)`; zero when nobody has said. */
  readonly score: number;
  /** How many followed accounts made the statement. */
  readonly conf: number;
  /** `score` on `(0, 1)`: above one half when the tag counts as on the thing. */
  readonly applies: number;
};

/**
 * DESIGN §3.2: one entry per item, with that item's tags beside it.
 *
 * There is no name: the id IS the display text, so an entry carries what a
 * screen draws and there is nothing to look up.
 */
export type RecsEntry = {
  readonly itemId: string;
  /** How far the viewer would like it, `s ∈ (−1, 1)`. */
  readonly score: number;
  /**
   * How many followed accounts rated it, which only breaks ties between equal
   * scores. Zero for a thing only its tags were spoken of.
   */
  readonly conf: number;
  readonly tags: Readonly<Record<string, TagEntry>>;
};

/**
 * Turns one account's thumbs as the database hands them over (item to tag to
 * thumb, the empty string for the thing itself) into what the core takes: one
 * key per rated thing, the two halves joined. Everything a crafted row can
 * hold is dropped: a value that is not `1` or `-1`, an item id or a tag that
 * is not canonical, and a half holding the join character.
 *
 * `ratings` carries the same refusals as column constraints, so this is defence
 * in depth rather than the only check: it is what protects a viewer's list
 * from a schema that changes, and it runs before the wasm boundary so junk
 * never crosses it at all. `to_snapshot` in the crate drops the same things a
 * third time.
 *
 * NFKC-normality is not among the refusals it can really make. `isNormalizedId`
 * asks `toLowerCase` and `normalize`, which are the client's implementation of
 * a table the database also holds, and where the two disagree the database is
 * the authority — so an id that reaches here non-canonical is at worst a second
 * key for one word, which cannot forge the join and cannot make a score
 * non-finite.
 */
export function sanitizeRatings(
  stored: unknown,
): Record<string, number> | null {
  if (typeof stored !== "object" || stored === null) return null;
  // Entries first, here and below: a thing or an attribute may be named
  // `__proto__`, which assigning into a plain object swallows and
  // `Object.fromEntries` defines like any other key.
  const kept: [string, number][] = [];
  for (const [itemId, tags] of Object.entries(stored)) {
    if (typeof tags !== "object" || tags === null) continue;
    if (!isNormalizedId(itemId)) continue;
    for (const [tag, value] of Object.entries(tags)) {
      if (value !== 1 && value !== -1) continue;
      if (tag.length > 0 && !isNormalizedId(tag)) continue;
      kept.push([
        tag.length > 0 ? `${itemId}${RATABLE_JOIN}${tag}` : itemId,
        value,
      ]);
    }
  }
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

/**
 * The core's per-ratable scores as one entry per item.
 *
 * Everything a followed account rated is in `scores` (DESIGN §2.6: there is
 * no floor), so every one gets an entry. The core scores a thing whenever it
 * scores a tag of it, at a count of zero where only its tags were spoken of,
 * so a tag is always folded into its thing's entry; one whose thing is
 * missing is not the core's answer and is left out.
 *
 * An item the catalog has no row for is kept rather than dropped. A ratings row
 * can name an id nobody created, and drawing it is harmless: the id has been
 * through the
 * same folding and the same `CHECK`s the catalog holds, and renders as the same
 * plain text.
 */
export function foldScores(
  scores: Readonly<Record<string, ScoreData>>,
): RecsEntry[] {
  const own = new Map<string, ScoreData>();
  const tags = new Map<string, [string, TagEntry][]>();
  for (const [ratable, score] of Object.entries(scores)) {
    const join = ratable.indexOf(RATABLE_JOIN);
    const itemId = join < 0 ? ratable : ratable.slice(0, join);
    const tag = join < 0 ? "" : ratable.slice(join + RATABLE_JOIN.length);
    if (itemId.length === 0) continue;
    if (tag.length === 0) {
      own.set(itemId, score);
    } else {
      const forItem = tags.get(itemId) ?? [];
      forItem.push([
        tag,
        {
          score: score.score,
          conf: score.confidence,
          applies: score.applies,
        },
      ]);
      tags.set(itemId, forItem);
    }
  }
  return [...own]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([itemId, scored]) => ({
      itemId,
      score: scored.score,
      conf: scored.confidence,
      tags: Object.fromEntries(tags.get(itemId) ?? []),
    }));
}

/**
 * True when every number in the list is one a viewer could be shown. The core
 * already refuses a non-finite score, so this is the second copy of
 * that refusal, on the side of the boundary that draws it.
 */
export function allFinite(entries: readonly RecsEntry[]): boolean {
  return entries.every(
    (entry) =>
      Number.isFinite(entry.score) &&
      Number.isFinite(entry.conf) &&
      Object.values(entry.tags).every(
        (tag) =>
          Number.isFinite(tag.score) &&
          Number.isFinite(tag.conf) &&
          Number.isFinite(tag.applies),
      ),
  );
}
