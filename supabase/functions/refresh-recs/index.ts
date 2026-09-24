// One viewer's recompute (DESIGN §3.4): load the neighbourhood, call the core,
// write the feed, return it. It exists because a viewer's walk reads other
// people's ratings, which no client may hold (DESIGN §4).
//
// Two identities are in play here and they must not be confused. The **caller**
// is whoever holds the bearer token, and the only thing that decides who that is
// is the auth server's answer about the token; a uid in a body or a header is a
// claim. The **database connection** is the service role, which every policy is
// written to ignore: it is how the neighbourhood is read at all, and everything
// it touches is addressed by the verified uid and by nothing the request said.

import postgres from "npm:postgres@3.4.7";

import {
  allFinite,
  type BoundaryNodeData,
  feedSignature,
  foldScores,
  needsRecompute,
  nextBoundaryNodes,
  NO_PRIORS,
  pairTallies,
  type Priors,
  type RecsEntry,
  type RefreshResult,
  sanitizeFriendIds,
  sanitizeRatings,
  type ScoreData,
  type StoredPriors,
  storedPriors,
} from "../../../shared/src/entries.ts";
import init, { computeUser, rescoreUser } from "./core-wasm/grapevine_core.js";

/**
 * `T_stale` (DESIGN §3.4): how long a feed stays current after it was last
 * *checked*, which is not when it was last computed — a recompute that finds
 * nothing new still counts as a check.
 */
const STALE_AFTER_MS = 10 * 60 * 1000;

/** `N_max` on demand: every node the recompute loads, boundary rounds included. */
const MAX_LOADED_NODES = 2_000;

/**
 * The depth backstop `private.neighbourhood` takes. It is not the semantic bound
 * — the node cap is — and it must never be the thing that fires: a fixed horizon
 * is what DESIGN §2.4 refuses. At degree 15 the node cap binds at depth 3.
 */
const MAX_DEPTH = 6;

/**
 * `ε_total`: the truncation a feed may carry and still be written, and the
 * boundary residual below which another boundary round would not move a score.
 */
const ERROR_BUDGET = 0.02;

/**
 * DESIGN §3.4 — after this many rounds, whatever mass is still waiting at the
 * boundary is left there. It is reported (`user_model.boundary_residual`) and
 * not counted against `ε_total`: the accuracy a feed promises is relative to
 * the `N_max` people nearest the viewer, and influence from beyond them is
 * ignored rather than refused.
 */
const MAX_BOUNDARY_ROUNDS = 3;

/** How many boundary nodes one extra round pulls in, largest residual first. */
const BOUNDARY_NODES_PER_ROUND = 200;

/**
 * DESIGN §3.4: how many consecutive rescores over the cached masses are allowed
 * before a full walk happens anyway. A belt and not a bound — the adjacency
 * hash is what decides staleness — so that a long-lived cache cannot drift
 * unexamined.
 */
const REACH_REUSE_MAX = 20;

/**
 * `L` from DESIGN §2.8's table, and the one number of that table this function
 * keeps a copy of.
 *
 * The core reports `truncation` in friend-units and the bar's step is in score
 * units, so the conversion is `·L`; `UserResult::error` does the same
 * multiplication inside the crate, but the wasm boundary hands back the two
 * halves rather than their maximum.
 *
 * No parameter table is passed to the core, so the rest of §2.8 lives in one
 * place. `E_max` is not a knob here either: the work is derived from the
 * neighbourhood (`Budget::for_snapshot`), and `E_max` is only the CPU backstop
 * the core applies on top of that.
 */
const ALIGNMENT_CLAMP = 2;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

await init({
  module_or_path: await Deno.readFile(
    new URL("./core-wasm/grapevine_core_bg.wasm", import.meta.url),
  ),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// The platform supplies one of these, and which one depends on whether the
// project still has its legacy JWT keys: disabling those empties
// `SUPABASE_ANON_KEY`, and `/auth/v1/user` refuses a request with no `apikey` —
// so the identity check below would fail every caller.
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

// `SUPABASE_DB_URL` and not PostgREST: `private.neighbourhood` lives in a schema
// the API does not serve (supabase/config.toml), which is the whole of DESIGN
// §3.3's privacy boundary — there is no REST address for it to be reached by,
// for this function or for anyone else. `prepare: false` because the connection
// may land on a transaction-mode pooler, where a prepared statement does not
// belong to the session that goes on to use it.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", {
  prepare: false,
  max: 3,
  idle_timeout: 30,
  connect_timeout: 10,
});

/**
 * Every query this function makes, as the service role and nothing else.
 *
 * The platform's `SUPABASE_DB_URL` logs in as `postgres`, and whether it points
 * at the database or at Supavisor is the platform's business and undocumented.
 * Not a `role` startup parameter: Supavisor forwards nothing from a startup
 * packet but `search_path`, so behind it every query would run as a superuser
 * and 0002's grants and 0004's `grant execute ... to service_role` would be
 * decoration. `set local role` is a statement, so no pooler in any mode can drop
 * it, and it ends with the transaction instead of leaking into a backend
 * somebody else is handed next. A connection that is not the service
 * role after it fails the request rather than answering on rights the grants
 * never gave.
 */
async function asServiceRole<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`set local role service_role`;
    const [row] = await tx`select current_user as role`;
    if (row?.role !== "service_role") {
      throw new Error(`queries run as ${String(row?.role)}, not service_role`);
    }
    return work(tx);
  });
  return result as T;
}

type Snapshot = {
  readonly users: readonly string[];
  readonly friendIds: Readonly<Record<string, readonly string[]>>;
  readonly loaded: readonly string[];
  /**
   * Per person, one key per rated thing: the item, or the item and one of its
   * attributes joined by the NUL `sanitizeRatings` puts between them. The
   * database returns these NESTED and keyed by columns; the join belongs to
   * this boundary and to the core (DESIGN §3.2).
   */
  readonly ratings: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/**
 * What the walk behind a set of masses reported. A rescore reuses the masses,
 * so it hands these back unchanged rather than inventing a better walk than the
 * one that was paid for.
 */
type WalkReport = {
  readonly truncation: number;
  readonly boundaryResidual: number;
  readonly settleMovement: number;
  readonly passes: number;
  readonly settled: boolean;
};

type CoreResult = {
  readonly reach: number;
  /** `π̃` per reached person: what `user_model.reach` stores and a rescore reads. */
  readonly reachMasses: Readonly<Record<string, number>>;
  readonly truncation: number;
  readonly settleMovement: number;
  readonly passes: number;
  readonly settled: boolean;
  readonly boundaryResidual: number;
  readonly boundaryNodes: readonly BoundaryNodeData[];
  /** DESIGN §2.10's tallies, by distance class. `pairTallies` flattens them. */
  readonly pairs: unknown;
  readonly scores: Readonly<Record<string, ScoreData>>;
};

/** `max(truncation·L, settleMovement)`: the step the bar's fill may move in. */
function feedError(result: CoreResult): number {
  return Math.max(result.truncation * ALIGNMENT_CLAMP, result.settleMovement);
}

function millis(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Who is calling, decided by the auth server and by nothing else.
 *
 * The bearer token is handed to GoTrue, which checks its signature and its
 * expiry and answers with the account it was minted for. This is the ONLY check:
 * `verify_jwt = false` in supabase/config.toml turns the gateway's off, so a
 * request that reaches this function has been authenticated by nobody, and
 * anything short of GoTrue naming an account — no header, a refused token, an
 * anon key, GoTrue itself failing — is a 401 before any query runs. There is
 * no uid parameter here and there never can be one — "refresh someone else's
 * feed" is not a request this API can express.
 */
async function callerUid(request: Request): Promise<string | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: ANON_KEY },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: unknown };
  return typeof user.id === "string" && user.id.length > 0 ? user.id : null;
}

/**
 * The staleness rule's stamps, and the database's clock, in one round trip.
 *
 * "Have the viewer's thumbs changed since?" reads `private.ratings_changed`, a
 * stamp a trigger moves on every insert, flip and clear. `max(rated_at)` could
 * not answer it: a flip is an update and a clear is a delete, and neither moves
 * the maximum of what is left.
 *
 * `now` is taken here, before the neighbourhood is read, and is what the
 * recompute stamps its rows with. Not the function's own clock after the walk:
 * a thumb given while the walk ran, and missing from it, would be dated older
 * than the feed, so the feed would read as current and the thumb would wait for
 * the next window.
 */
async function readStamps(uid: string) {
  const [row] = await asServiceRole(
    (tx) => tx`
      select now() as now, m.computed_at, m.checked_at, m.truncation, m.settle_movement,
             m.boundary_residual, m.passes, m.settled, m.reach_hash, m.reach_reuses,
             c.changed_at, f.feed_hash, f.error
      from (select ${uid}::uuid as id) v
      left join public.user_model m on m.user_id = v.id
      left join public.user_recs f on f.user_id = v.id
      left join private.ratings_changed c on c.user_id = v.id`,
  );
  if (!(row?.now instanceof Date)) {
    throw new Error("the database did not report its clock");
  }
  return {
    now: row.now,
    computedAt: millis(row.computed_at),
    checkedAt: millis(row.checked_at),
    // The stamp itself, not its milliseconds: the "has anyone in reach rated
    // since?" query compares against it in the database's own clock.
    checkedAtStamp: row.checked_at instanceof Date ? row.checked_at : null,
    ratingsChangedAt: millis(row.changed_at),
    feedHash: typeof row.feed_hash === "string" ? row.feed_hash : null,
    error: number(row.error),
    truncation: number(row.truncation),
    settleMovement: number(row.settle_movement),
    walk: storedWalk(row),
    reachHash: typeof row.reach_hash === "string" ? row.reach_hash : null,
    reachReuses: number(row.reach_reuses) ?? 0,
  };
}

type Stamps = Awaited<ReturnType<typeof readStamps>>;

/**
 * The walk report behind the cached masses, or null when any part of it is
 * missing — a rescore carries every field through, so without all of them there
 * is nothing to reuse.
 */
function storedWalk(row: Record<string, unknown>): WalkReport | null {
  const truncation = number(row.truncation);
  const boundaryResidual = number(row.boundary_residual);
  const settleMovement = number(row.settle_movement);
  const passes = number(row.passes);
  if (
    truncation === null || boundaryResidual === null || settleMovement === null ||
    passes === null || typeof row.settled !== "boolean"
  ) {
    return null;
  } else {
    return { truncation, boundaryResidual, settleMovement, passes, settled: row.settled };
  }
}

/**
 * The population's estimate of `κ` and `a₀(d)`, or DESIGN §2.8's table.
 *
 * `storedPriors` is what decides which: every column is read on its own, and a
 * row half-written by the pooling statement, or one written before a column
 * existed, can only fail to move a number. The stamp comes back only beside
 * numbers that were usable, because `user_model.priors_at` names the estimate a
 * feed was computed under.
 *
 * A read that THROWS is not a reason to fail the viewer's recompute either. The
 * estimate is an improvement on a constant and the constant is right here, so
 * one unreadable row of `private.params` is logged and the table is used —
 * rather than a 500 that takes the feed down for that viewer.
 */
async function readPriors(): Promise<StoredPriors> {
  try {
    const [row] = await asServiceRole(
      (tx) => tx`
        select computed_at, kappa, a0_d1, a0_d2, a0_d3plus from private.params limit 1`,
    );
    return storedPriors(row);
  } catch (error) {
    console.error(JSON.stringify({ fn: "refresh-recs", at: "readPriors", error: String(error) }));
    return NO_PRIORS;
  }
}

/**
 * The snapshot being built up, round by round.
 *
 * `friendIds` stays directed. Reciprocity is a deferred constraint on
 * `friendships`, so a one-sided edge cannot commit — but the core checks it
 * anyway (`SnapshotData::to_snapshot`), free and nearly always vacuous, and an
 * edge into a node nobody loaded is a boundary edge rather than a dropped one
 * either way.
 */
type Neighbourhood = {
  readonly friendIds: Record<string, string[]>;
  readonly loaded: Set<string>;
  readonly ratings: Record<string, Record<string, number>>;
  /** Everyone named by anyone, loaded or not: the snapshot's `users`. */
  readonly seen: Set<string>;
};

type NodeRow = { id: string; friend_ids: unknown; ratings: unknown };

function absorb(neighbourhood: Neighbourhood, rows: readonly NodeRow[]): void {
  for (const row of rows) {
    neighbourhood.loaded.add(row.id);
    neighbourhood.seen.add(row.id);
    const friends = sanitizeFriendIds(row.friend_ids);
    neighbourhood.friendIds[row.id] = friends;
    for (const friend of friends) neighbourhood.seen.add(friend);
    const kept = sanitizeRatings(row.ratings);
    if (kept) neighbourhood.ratings[row.id] = kept;
  }
}

function toSnapshot(neighbourhood: Neighbourhood): Snapshot {
  return {
    users: [...neighbourhood.seen],
    friendIds: neighbourhood.friendIds,
    loaded: [...neighbourhood.loaded],
    ratings: neighbourhood.ratings,
  };
}

/** The neighbourhood `private.neighbourhood` returns, before any extra round. */
async function loadNeighbourhood(viewer: string): Promise<Neighbourhood> {
  const neighbourhood: Neighbourhood = {
    friendIds: {},
    loaded: new Set(),
    ratings: {},
    seen: new Set([viewer]),
  };
  absorb(
    neighbourhood,
    (await asServiceRole(
      (tx) => tx`
        select id, friend_ids, ratings
        from private.neighbourhood(${viewer}::uuid, ${MAX_LOADED_NODES}, ${MAX_DEPTH})`,
    )) as unknown as NodeRow[],
  );
  return neighbourhood;
}

/**
 * The graph the walk would run on, as one string (DESIGN §3.4): every loaded
 * node with its friend list, both in order.
 *
 * This is the whole of the cache's staleness test, and it needs no trigger, no
 * change feed and no new table because the recompute reads the neighbourhood on
 * every call anyway. A walk that took a boundary round hashes the larger set it
 * ended on, so the next call's hash of the plain neighbourhood does not match
 * and it walks in full — which is what keeps a reuse a reuse of exactly the
 * graph the masses came from.
 */
async function adjacencyHash(neighbourhood: Neighbourhood): Promise<string> {
  const lines = [...neighbourhood.loaded]
    .sort()
    .map((id) => `${id}:${(neighbourhood.friendIds[id] ?? []).join(",")}`);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines.join("\n")),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Whether anyone whose alignment steers this viewer's walk has rated since the
 * last check.
 *
 * Ratings do not change the graph, so the adjacency hash cannot see them — but
 * they change the steering, which is why this is asked separately and about
 * everyone loaded rather than about the viewer alone.
 */
async function ratingsMovedInReach(
  loaded: ReadonlySet<string>,
  since: Date,
): Promise<boolean> {
  const rows = await asServiceRole(
    (tx) => tx`
      select 1 from private.ratings_changed c
      where c.user_id = any(${[...loaded]}::uuid[]) and c.changed_at > ${since}
      limit 1`,
  );
  return rows.length > 0;
}

/** The masses the last full walk left, or null when there is no usable map. */
async function readReach(uid: string): Promise<Record<string, number> | null> {
  const [row] = await asServiceRole(
    (tx) => tx`select reach from public.user_model where user_id = ${uid}::uuid`,
  );
  const stored = row?.reach;
  if (typeof stored !== "object" || stored === null) return null;
  const masses: Record<string, number> = {};
  for (const [id, mass] of Object.entries(stored)) {
    if (typeof mass === "number" && Number.isFinite(mass)) masses[id] = mass;
  }
  return Object.keys(masses).length > 0 ? masses : null;
}

/**
 * The core, plus DESIGN §3.4's extra rounds: while the mass waiting at the
 * boundary could still move a score, read the nodes holding most of it and
 * compute again.
 *
 * `truncation` and `boundaryResidual` are separate answers — the first is what
 * the walk left in flight inside the loaded set, the second what is waiting on
 * nodes nobody read — so this can tell "one more read is worth it" from "the
 * walk is done". Only the first decides whether a feed is written; whatever is
 * still at the boundary after the last round is reported and ignored.
 *
 * Every round is another crossing of the wasm boundary over the whole snapshot,
 * and that crossing costs more than the walk does. `N_max` counts the nodes a
 * round adds, so a first pass that stopped at the cap has nothing to spend here.
 */
async function computeWithBoundaryRounds(
  neighbourhood: Neighbourhood,
  viewer: string,
  priors: Priors | null,
): Promise<CoreResult> {
  let result = computeUser(toSnapshot(neighbourhood), viewer, null, priors) as CoreResult;
  for (let round = 0; round < MAX_BOUNDARY_ROUNDS; round += 1) {
    if (result.boundaryResidual <= ERROR_BUDGET) break;
    const next = nextBoundaryNodes(
      result.boundaryNodes,
      neighbourhood.loaded,
      MAX_LOADED_NODES,
      BOUNDARY_NODES_PER_ROUND,
    );
    if (next.length === 0) break;
    absorb(
      neighbourhood,
      (await asServiceRole(
        (tx) => tx`
          select id, friend_ids, ratings
          from private.load_nodes(${next}::uuid[])`,
      )) as unknown as NodeRow[],
    );
    result = computeUser(toSnapshot(neighbourhood), viewer, null, priors) as CoreResult;
  }
  return result;
}

/**
 * The cached masses rescored, when this call may have them, or null.
 *
 * Three conditions, and the first is the whole of the design: the adjacency
 * just loaded hashes to what the stored masses were walked on. The other two
 * are the ones a hash cannot see — someone in reach rating, which moves the
 * steering without moving the graph, and a run of reuses long enough that a
 * full walk is worth paying for anyway.
 */
async function reuseReach(
  neighbourhood: Neighbourhood,
  viewer: string,
  hash: string,
  stamps: Stamps,
  priors: Priors | null,
): Promise<CoreResult | null> {
  if (stamps.reachHash !== hash) return null;
  if (stamps.reachReuses >= REACH_REUSE_MAX) return null;
  if (stamps.walk === null) return null;
  if (stamps.checkedAtStamp === null) return null;
  if (await ratingsMovedInReach(neighbourhood.loaded, stamps.checkedAtStamp)) return null;
  const reach = await readReach(viewer);
  if (reach === null) return null;
  return rescoreUser(
    toSnapshot(neighbourhood),
    viewer,
    reach,
    stamps.walk,
    null,
    priors,
  ) as CoreResult;
}

/**
 * One upsert of the recompute's own scratch row, naming whatever the caller
 * actually has to say.
 *
 * Every branch below writes a different part of `user_model`, and writing the
 * whole row from each of them would mean a branch with nothing to say about the
 * cached masses erasing them. So the row is an object and the statement names
 * its keys.
 */
function upsertModel(
  tx: postgres.TransactionSql,
  row: Record<string, unknown>,
): Promise<unknown> {
  const columns = Object.keys(row).filter((column) => column !== "user_id");
  return tx`
    insert into public.user_model ${tx(row)}
    on conflict (user_id) do update set ${tx(row, ...columns)}`;
}

/**
 * The feed as it stands, for the one case that writes none: a walk that could
 * not meet `ε_total`.
 *
 * The client goes on showing what it had, and a cold start gets the stored row
 * rather than nothing — storing this walk's answer instead would put a number
 * on the bar that is really a report that the computation failed. `checked_at`
 * still moves, so the staleness window applies and the next open does not pay
 * for the same failure immediately.
 *
 * The pair tallies are NOT written here. They are moments of the agreement
 * rates this walk computed, and a walk that did not resolve is exactly the case
 * where those rates are a report about the budget rather than about anybody.
 */
async function keepPreviousFeed(uid: string, stamps: Stamps): Promise<RefreshResult> {
  const [row] = await asServiceRole(async (tx) => {
    await upsertModel(tx, {
      user_id: uid,
      checked_at: stamps.now,
      recomputed: false,
    });
    return tx`select entries, error from public.user_recs where user_id = ${uid}::uuid`;
  });
  const entries = Array.isArray(row?.entries) ? (row.entries as RecsEntry[]) : null;
  return {
    computedAt: stamps.computedAt,
    recomputed: false,
    entries,
    error: number(row?.error),
    truncation: stamps.truncation,
    settleMovement: stamps.settleMovement,
  };
}

/**
 * The whole of DESIGN §3.4 for one viewer.
 *
 * Returns the stored stamp untouched when the feed is current, and when a
 * recompute lands on the same answer: `computed_at` is what tells a client its
 * feed changed, so moving it for an identical feed would cost every open tab a
 * reload to be told nothing. `checked_at` moves either way, and that is what
 * buys the next staleness window.
 */
async function refreshFeed(uid: string): Promise<RefreshResult> {
  const stamps = await readStamps(uid);
  if (!needsRecompute(stamps, stamps.now.getTime(), STALE_AFTER_MS)) {
    return {
      computedAt: stamps.computedAt,
      recomputed: false,
      entries: null,
      error: stamps.error,
      truncation: stamps.truncation,
      settleMovement: stamps.settleMovement,
    };
  }

  const priors = await readPriors();
  const neighbourhood = await loadNeighbourhood(uid);
  const hash = await adjacencyHash(neighbourhood);
  const reused = await reuseReach(neighbourhood, uid, hash, stamps, priors.priors);
  const result = reused ?? (await computeWithBoundaryRounds(neighbourhood, uid, priors.priors));

  // The one case that writes nothing: the walk left more than `ε_total` in
  // flight inside the people it loaded. Mass waiting beyond them
  // (`boundaryResidual`) does not count here — the guarantee is relative to the
  // nearest `N_max` — so it is stored for reporting and nothing else.
  if (!Number.isFinite(result.truncation) || result.truncation > ERROR_BUDGET) {
    console.warn(
      JSON.stringify({
        fn: "refresh-recs",
        at: "unresolved",
        truncation: result.truncation,
        boundaryResidual: result.boundaryResidual,
        loaded: neighbourhood.loaded.size,
      }),
    );
    return keepPreviousFeed(uid, stamps);
  }

  const entries = foldScores(result.scores);
  const error = feedError(result);
  if (
    !allFinite(entries, [
      result.truncation,
      result.boundaryResidual,
      result.settleMovement,
      error,
    ])
  ) {
    // Nothing here is recoverable by the caller and nothing partial may land:
    // the stored feed is a real answer about an earlier moment, and half of a
    // broken one is not.
    throw new Error("the recompute did not produce a feed");
  }

  // Hashed AFTER the rounds, so the set hashed is the set that was walked: a
  // later call hashes the plain neighbourhood, which differs whenever a round
  // added a node, and walks in full rather than rescoring masses that came from
  // a larger graph.
  const walkedHash = reused ? hash : await adjacencyHash(neighbourhood);
  // A rescore stored nothing new about the masses — it reused them — so it
  // spends one of its allowance and leaves the map and the hash alone.
  const cache = reused
    ? { reach_reuses: stamps.reachReuses + 1 }
    : {
      // `sql.json`, not a string: a jsonb column handed a JS string stores the
      // string itself, and the map comes back double-encoded.
      reach: sql.json(result.reachMasses as Record<string, number>),
      reach_hash: walkedHash,
      reach_reuses: 0,
    };
  // The tallies are this walk's, not this feed's: a recompute that landed on
  // the same answer still aligned every pair it walked, and DESIGN §2.10's
  // estimate is over every pair anybody computed. So they ride on the stamp the
  // check writes anyway.
  const model = {
    truncation: result.truncation,
    boundary_residual: result.boundaryResidual,
    settle_movement: result.settleMovement,
    passes: result.passes,
    settled: result.settled,
    priors_at: priors.computedAt,
    ...cache,
    ...pairTallies(result.pairs),
  };

  const hashOfFeed = feedSignature(entries);
  if (hashOfFeed === stamps.feedHash && stamps.computedAt > 0) {
    await asServiceRole((tx) =>
      upsertModel(tx, {
        user_id: uid,
        checked_at: stamps.now,
        recomputed: false,
        ...model,
      })
    );
    return {
      computedAt: stamps.computedAt,
      recomputed: false,
      entries: null,
      error: stamps.error,
      truncation: result.truncation,
      settleMovement: result.settleMovement,
    };
  }

  const ratingCount = Object.keys(neighbourhood.ratings[uid] ?? {}).length;
  const computedAt = stamps.now;
  // One transaction, because the feed and the stamp that describes it are one
  // answer: a reader must never see a moved stamp beside the old feed.
  await asServiceRole(async (tx) => {
    await tx`
      insert into public.user_recs (user_id, computed_at, entries, feed_hash, error)
      values (${uid}::uuid, ${computedAt}, ${tx.json([...entries])}, ${hashOfFeed}, ${error})
      on conflict (user_id) do update set
        computed_at = excluded.computed_at,
        entries = excluded.entries,
        feed_hash = excluded.feed_hash,
        error = excluded.error`;
    await upsertModel(tx, {
      user_id: uid,
      computed_at: computedAt,
      checked_at: computedAt,
      nodes_touched: result.reach,
      rating_count: ratingCount,
      recomputed: true,
      ...model,
    });
  });

  console.log(
    JSON.stringify({
      fn: "refresh-recs",
      loaded: neighbourhood.loaded.size,
      seen: neighbourhood.seen.size,
      entries: entries.length,
      reused: reused !== null,
      truncation: result.truncation,
      boundaryResidual: result.boundaryResidual,
      settleMovement: result.settleMovement,
      passes: result.passes,
      settled: result.settled,
      error,
    }),
  );
  return {
    computedAt: computedAt.getTime(),
    recomputed: true,
    entries,
    error,
    truncation: result.truncation,
    settleMovement: result.settleMovement,
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const uid = await callerUid(request);
  if (!uid) return json(401, { error: "sign in to refresh your feed" });

  try {
    return json(200, await refreshFeed(uid));
  } catch (error) {
    // The viewer is told nothing but that it failed: what went wrong is a
    // database error or a walk that did not resolve, and neither is theirs to
    // act on or to read.
    console.error(JSON.stringify({ fn: "refresh-recs", uid, error: String(error) }));
    return json(500, { error: "the recompute did not produce a feed" });
  }
});
