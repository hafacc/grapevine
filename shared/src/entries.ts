// Everything between the core's answer and the feed a client reads, with no
// database in it: folding ratable scores into one entry per item, deciding
// whether the answer changed, dropping what a crafted row could hold, and
// reading a stored `private.params` row back as something the core may be
// handed.
//
// It lives here rather than inside a function's own directory because both Edge
// Functions import it directly, where it is — Deno reads the TypeScript, so
// there is nothing to generate and no copy to keep in step.
// `tests/entries.test.ts` is the whole contract.

import { isNormalizedId } from "./index.ts";

/**
 * What joins an item to one of its attributes for the core, which wants one map
 * key per rated thing: `café bleu`, or `café bleu` and `coffee` with this
 * between them (DESIGN §3.2).
 *
 * A NUL, because Postgres text cannot hold one at all — the server refuses the
 * byte on input — so no name anybody can type can forge the join or smuggle a
 * second separator into a half. That holds by construction, which matters
 * because an id is arbitrary Unicode and no pattern `CHECK` could enumerate what
 * a half may contain.
 *
 * It exists here and in `rust/src/data.rs` and nowhere else: never stored,
 * never queried, never shown. The database keys a rating by its columns and
 * every client shape is nested.
 */
const RATABLE_JOIN = String.fromCodePoint(0);

// The wasm-boundary shapes the folding touches, declared here so that the pure
// half depends on no build output.

/** One ratable's score and its weight `W_u(i)` — `ScoreData` in `rust/src/data.rs`. */
export type ScoreData = {
  readonly score: number;
  readonly confidence: number;
};

/** A node nobody read, and the mass still waiting on it. */
export type BoundaryNodeData = {
  readonly id: string;
  readonly residual: number;
};

/**
 * DESIGN §3.2: one entry per item, with that item's tags beside it.
 *
 * There is no name: the id IS the display text, so an entry carries what a
 * screen draws and there is nothing to look up.
 */
export type RecsEntry = {
  readonly itemId: string;
  readonly score: number;
  /** `W_u(i)`. Zero for an item carried only by a tag of it — see `foldScores`. */
  readonly conf: number;
  readonly tags: Readonly<Record<string, number>>;
};

/**
 * What `refresh-recs` answers with, declared where both ends of the call can see
 * it: the Edge Function that writes the response
 * (`supabase/functions/refresh-recs/index.ts`) and the client that reads it
 * (`web/utils/recs.ts`). The field that would drift first is `entries`, whose
 * null is a whole branch on the client.
 */
export type RefreshResult = {
  /** When the feed on the server was computed, in epoch milliseconds. */
  readonly computedAt: number;
  /**
   * False when the stored feed was already current, or when the recompute landed
   * on the same answer — which is the same thing to a reader, and the reason
   * `computed_at` did not move.
   */
  readonly recomputed: boolean;
  /**
   * The feed, when this call computed one. Null says "what you have is current":
   * the client already holds it, and a cold start reads `user_recs` instead —
   * which is the one case where sending it again would have been the point, and
   * it is one row rather than a second call per open.
   */
  readonly entries: readonly RecsEntry[] | null;
  /**
   * The step the bar's fill may move in, for the feed this answer describes:
   * `max(truncation·L, settleMovement)`, and `user_recs.error` for the row.
   * It rides out beside the entries so the common path needs no second read.
   *
   * Null only when there is no feed at all — a first open whose walk did not
   * resolve. A bar with no quantum draws "nothing known yet" rather than
   * picking one, because a default there would be a silent claim about
   * precision.
   */
  readonly error: number | null;
  /** The unresolved mass this feed was computed with, in friend-units. */
  readonly truncation: number | null;
  /** The largest score movement in the settling loop's last pass. */
  readonly settleMovement: number | null;
};

/**
 * What `refresh-suggestions` answers with, declared beside `RefreshResult` for
 * the same reason: the Edge Function that writes it and the screen that reads it
 * are two packages apart.
 *
 * `suggested` is the uids in rank order, strongest first — the rows the call
 * just wrote, so the common path needs no second read — and is null when the
 * list was already current and nothing was written. An empty array is a real
 * answer: nobody far enough away agrees with you enough, or you have taste
 * discovery turned off, and neither is an error.
 */
export type SuggestionsResult = {
  /** When the search behind this list ran, in epoch milliseconds. */
  readonly suggestedAt: number;
  readonly recomputed: boolean;
  readonly suggested: readonly string[] | null;
};

// Far finer than any step the bar can draw, so two results a viewer could tell
// apart are never called equal, and coarse enough that the last bits of a float
// do not rewrite the feed on a recompute that found nothing new.
const COMPARISON_PLACES = 6;

function rounded(value: number): number {
  return Number(value.toFixed(COMPARISON_PLACES));
}

/**
 * Turns one person's ratings as `private.neighbourhood` returns them (item to
 * tag to thumb, the empty string for the thing itself) into what the core
 * takes: one key per rated thing, the two halves joined. Everything a crafted
 * row can hold is dropped: a value that is not exactly a thumb, an item id or a
 * tag that is not canonical, and a half holding the join character.
 *
 * `ratings` carries the same refusals as column constraints, so this is defence
 * in depth rather than the only check: it is what protects a walk from a schema
 * that changes, and it runs before the wasm boundary so junk never crosses it
 * at all. `to_snapshot` in the crate drops the same things a third time.
 *
 * NFKC-normality is not among the refusals it can really make. `isNormalizedId`
 * asks `toLowerCase` and `normalize`, which are the client's implementation of
 * a table the database also holds, and where the two disagree the database is
 * the authority — so an id that reaches here non-canonical is at worst a second
 * key for one word, which cannot forge the join and cannot make a mass
 * non-finite.
 */
export function sanitizeRatings(
  stored: unknown,
): Record<string, number> | null {
  if (typeof stored !== "object" || stored === null) return null;
  const kept: Record<string, number> = {};
  let any = false;
  for (const [itemId, tags] of Object.entries(stored)) {
    if (typeof tags !== "object" || tags === null) continue;
    if (!isNormalizedId(itemId)) continue;
    for (const [tag, value] of Object.entries(tags)) {
      if (value !== 1 && value !== -1) continue;
      if (tag.length > 0 && !isNormalizedId(tag)) continue;
      kept[tag.length > 0 ? `${itemId}${RATABLE_JOIN}${tag}` : itemId] = value;
      any = true;
    }
  }
  return any ? kept : null;
}

/** The ids an adjacency list actually names, with anything else dropped. */
export function sanitizeFriendIds(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}

/**
 * The core's per-ratable scores as one entry per item.
 *
 * An item earns an entry if its own `W ≥ W_min` or any of its tags does
 * (DESIGN §3.4) — the core has already applied the floor per ratable, so
 * presence in `scores` IS being above it. An item carried only by a tag has
 * `conf: 0`, which keeps it out of the ranking and out of search order while
 * still giving the item page its chips.
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
  const tags = new Map<string, Record<string, number>>();
  const items = new Set<string>();
  for (const [ratable, score] of Object.entries(scores)) {
    const join = ratable.indexOf(RATABLE_JOIN);
    const itemId = join < 0 ? ratable : ratable.slice(0, join);
    const tag = join < 0 ? "" : ratable.slice(join + RATABLE_JOIN.length);
    if (itemId.length === 0) continue;
    items.add(itemId);
    if (tag.length === 0) {
      own.set(itemId, score);
    } else {
      const forItem = tags.get(itemId) ?? {};
      forItem[tag] = score.score;
      tags.set(itemId, forItem);
    }
  }
  const entries: RecsEntry[] = [];
  for (const itemId of [...items].sort()) {
    const scored = own.get(itemId);
    entries.push({
      itemId,
      score: scored?.score ?? 0,
      conf: scored?.confidence ?? 0,
      tags: tags.get(itemId) ?? {},
    });
  }
  return entries;
}

/**
 * True when every number the recompute produced is one a viewer could be shown.
 *
 * `figures` is whatever the caller is about to store beside the entries — the
 * truncation, the boundary residual, the settling distance — because a
 * non-finite one of those is a walk that went wrong, and writing it stores a
 * `NaN` rather than refusing.
 */
export function allFinite(
  entries: readonly RecsEntry[],
  figures: readonly number[],
): boolean {
  return (
    figures.every((figure) => Number.isFinite(figure)) &&
    entries.every(
      (entry) =>
        Number.isFinite(entry.score) &&
        Number.isFinite(entry.conf) &&
        Object.values(entry.tags).every((score) => Number.isFinite(score)),
    )
  );
}

/** The two stamps the staleness rule reads, in epoch milliseconds. */
export type FeedStamps = {
  /**
   * When a recompute last looked, whether or not it wrote a feed. Zero when
   * none ever has.
   */
  readonly checkedAt: number;
  /** When the viewer last gave, turned over or cleared a thumb. */
  readonly ratingsChangedAt: number;
};

/**
 * DESIGN §3.4: whether a viewer's cached feed has to be walked again.
 *
 * Both halves key on `checkedAt`, which is when a walk last read the viewer's
 * thumbs, and not on `computedAt`: the same-answer recompute moves only
 * `checkedAt`, so a thumb that did not change the feed would stay newer than
 * `computedAt` and every later open would pay a full walk to learn nothing.
 *
 * Having no feed yet is not a reason on its own either. A walk that could not
 * meet `ε_total` writes no feed but does stamp `checkedAt`; recomputing whenever
 * there is no feed would make that viewer pay a full walk on every open, for
 * the same failure each time.
 */
export function needsRecompute(
  stamps: FeedStamps,
  now: number,
  staleAfterMs: number,
): boolean {
  if (stamps.checkedAt <= 0) {
    return true;
  } else {
    return (
      now - stamps.checkedAt >= staleAfterMs ||
      stamps.ratingsChangedAt > stamps.checkedAt
    );
  }
}

/**
 * The boundary nodes one more round should read: most residual first, never one
 * already loaded, and never more than the node budget has left.
 *
 * `N_max` counts every node a recompute loads, boundary rounds included
 * (DESIGN §3.4), so what is left is `maxLoaded − loaded.size` for the whole of
 * the rest of the walk rather than a fresh allowance each round. The loaded ones
 * are dropped before the cut, not after, so a round that asks for `perRound`
 * nodes reads that many new ones.
 */
export function nextBoundaryNodes(
  boundaryNodes: readonly BoundaryNodeData[],
  loaded: ReadonlySet<string>,
  maxLoaded: number,
  perRound: number,
): string[] {
  const room = Math.min(perRound, maxLoaded - loaded.size);
  if (room <= 0) return [];
  return [...boundaryNodes]
    .sort((left, right) => right.residual - left.residual)
    .map((node) => node.id)
    .filter((id) => !loaded.has(id))
    .slice(0, room);
}

/**
 * What `user_recs.feed_hash` holds, and the whole of what decides whether
 * `computed_at` moves.
 *
 * Rounded, because a recompute on an unchanged snapshot can still differ in the
 * last bits of a float, and rewriting the row for that would move `computed_at`
 * and make every open tab reload a feed that says the same thing.
 */
export function feedSignature(entries: readonly RecsEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => [
      entry.itemId,
      rounded(entry.score),
      rounded(entry.conf),
      Object.keys(entry.tags)
        .sort()
        .map((tag) => [tag, rounded(entry.tags[tag] as number)]),
    ]),
  );
}

/**
 * One recompute's `PairTallies` (`rust/src/priors.rs`) — what it has to say
 * about the population's `κ` and `a₀(d)` (DESIGN §2.10), per distance class —
 * as the twelve `user_model` columns hold them,
 * with anything that is not a finite number dropped to zero.
 *
 * Zero rather than null, and per field: the pooling statement in
 * `0005_cron.sql` adds these across viewers, and a class that contributes
 * nothing is exactly a row of zeros. A crafted or half-read tally can therefore
 * only fail to move the population's estimate, never poison it — which matters
 * because these are the one thing a viewer's own recompute reports about
 * everybody else's agreement.
 */
export function pairTallies(tallies: unknown): Record<string, number> {
  const classes = (tallies ?? {}) as Record<string, unknown>;
  const flat: Record<string, number> = {};
  for (const [name, suffix] of [
    ["d1", "d1"],
    ["d2", "d2"],
    ["d3plus", "d3"],
  ] as const) {
    const moments = (classes[name] ?? {}) as Record<string, unknown>;
    flat[`pair_n_${suffix}`] = finite(moments.pairs);
    flat[`pair_sum_${suffix}`] = finite(moments.rateTotal);
    flat[`pair_sumsq_${suffix}`] = finite(moments.rateSquares);
    flat[`pair_overlap_${suffix}`] = finite(moments.overlapTotal);
  }
  return flat;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/** A `user_prefs` row, as the client and `refresh-suggestions` both read it. */
export type Prefs = {
  /** DESIGN §5.1: default OFF, and on is one tap. */
  readonly discoverableByTaste: boolean;
  /** Suggestions this person has waved away, never shown again. */
  readonly dismissedSuggestions: readonly string[];
};

/**
 * What an account that has never opened Settings is, and what a missing row
 * reads as.
 *
 * The switch ships off, so only an explicit yes turns it on: taste search is the
 * one channel that names you to somebody you have no edge to, and nobody is in
 * it until they say so.
 */
export const DEFAULT_PREFS: Prefs = {
  discoverableByTaste: false,
  dismissedSuggestions: [],
};

/**
 * The row as it comes back, in the column names PostgREST and the service role
 * both use.
 *
 * `discoverable_by_taste` is `not null default false`, which makes most of this
 * unreachable and none of it wrong: the defaults have to exist anyway for the
 * account that has no row at all.
 */
export function sanitizePrefs(stored: unknown): Prefs {
  if (typeof stored !== "object" || stored === null) return DEFAULT_PREFS;
  const data = stored as Record<string, unknown>;
  const dismissed = Array.isArray(data.dismissed_suggestions)
    ? data.dismissed_suggestions.filter(
        (uid): uid is string => typeof uid === "string" && uid.length > 0,
      )
    : [];
  return {
    discoverableByTaste: data.discoverable_by_taste === true,
    dismissedSuggestions: dismissed,
  };
}

/**
 * `PriorEstimate` in `rust/src/priors.rs`: the population's two priors, as
 * `private.params` stores them. Every field is independently null until its own
 * `N_min` sample exists, and null anywhere — including for the whole object —
 * means DESIGN §2.8's table for that field and nothing else.
 */
export type Priors = {
  readonly kappa: number | null;
  readonly a0: {
    readonly d1: number | null;
    readonly d2: number | null;
    readonly d3plus: number | null;
  };
};

/** One `private.params` row as a consumer holds it, stamp and numbers together. */
export type StoredPriors = {
  /** `private.params.computed_at`, and null whenever `priors` is. */
  readonly computedAt: Date | null;
  /** Null when there is nothing usable to merge: the table stands whole. */
  readonly priors: Priors | null;
};

/** What a consumer with no row, or no readable one, uses: DESIGN §2.8's table. */
export const NO_PRIORS: StoredPriors = { computedAt: null, priors: null };

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The stored row as the core may be handed it.
 *
 * Every column is read on its own and anything that is not a finite number
 * becomes null, which the core reads as "keep the table's value for this one".
 * That covers a row half-written by a run that died, one written before a
 * column existed, and one whose values are the wrong type — none of which may
 * fail a viewer's recompute, because a prior nobody estimated is exactly the
 * state grapevine ships in. A row with nothing usable in it at all reads as no
 * estimate rather than as an object of nulls, so the log line and `user_model`
 * can tell the two apart.
 */
export function sanitizePriors(stored: unknown): Priors | null {
  if (typeof stored !== "object" || stored === null) return null;
  const data = stored as Record<string, unknown>;
  const priors: Priors = {
    kappa: finiteOrNull(data.kappa),
    a0: {
      d1: finiteOrNull(data.a0_d1),
      d2: finiteOrNull(data.a0_d2),
      d3plus: finiteOrNull(data.a0_d3plus),
    },
  };
  const estimated =
    priors.kappa !== null ||
    priors.a0.d1 !== null ||
    priors.a0.d2 !== null ||
    priors.a0.d3plus !== null;
  return estimated ? priors : null;
}

/**
 * A `private.params` row as both consumers take it: the numbers, and the stamp
 * that names them.
 *
 * The two travel together or not at all. `user_model.priors_at` exists to say
 * WHICH estimate a feed was computed under, so a stamp beside a row whose values
 * were every one of them unusable would name an estimate the walk did not use —
 * the one distinction the column is there to make. A row that reads as no
 * estimate is the same answer as no row.
 */
export function storedPriors(row: unknown): StoredPriors {
  const priors = sanitizePriors(row);
  if (priors === null) {
    return NO_PRIORS;
  } else {
    const stamp = (row as { computed_at?: unknown }).computed_at;
    return { computedAt: stamp instanceof Date ? stamp : null, priors };
  }
}
