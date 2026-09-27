// One viewer's recompute (DESIGN §3.4, §3.4a): patch the cached neighbourhood
// with what changed since (or load it in full), call the core, write the feed
// and the cache, return the feed. It exists because a viewer's feed is computed from
// other people's ratings, which no client may hold (DESIGN §4).
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
  type RefreshResult,
  type ScoreData,
  type StoredPriors,
  storedPriors,
} from "../../../shared/src/entries.ts";
import {
  applyDelta,
  CACHE_VERSION,
  type CachedNeighbourhood,
  canonicalNeighbourhood,
  type DeltaRow,
  neighbourhoodDifference,
  neighbourhoodFromRows,
  type NodeRow,
  packNeighbourhood,
  RELOAD_EVERY,
  unpackNeighbourhood,
} from "../../../shared/src/snapshot-cache.ts";
import init, { computeUser } from "./core-wasm/grapevine_core.js";

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
 * DESIGN §3.4 — after this many rounds, whoever is still at the boundary is left
 * there: what a feed says is relative to the `N_max` people nearest the viewer.
 */
const MAX_BOUNDARY_ROUNDS = 3;

/** How many boundary nodes one extra round pulls in, strongest chain first. */
const BOUNDARY_NODES_PER_ROUND = 200;

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
 * `computeUser`'s result (`ResultData` in rust/src/data.rs), declared here
 * because the wasm-pack typings say `any`.
 */
type CoreResult = {
  /** People with a non-zero chain: what `user_model.nodes_touched` stores. */
  readonly reached: number;
  /** Strongest first; what the loader reads for another round. */
  readonly boundaryNodes: readonly BoundaryNodeData[];
  /** DESIGN §2.9's tallies, by distance class. `pairTallies` flattens them. */
  readonly pairs: unknown;
  readonly scores: Readonly<Record<string, ScoreData>>;
};

function millis(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
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
 * recompute stamps its rows with. Not the function's own clock afterwards:
 * a thumb given while the recompute ran, and missing from it, would be dated older
 * than the feed, so the feed would read as current and the thumb would wait for
 * the next window.
 */
async function readStamps(uid: string) {
  const [row] = await asServiceRole(
    (tx) => tx`
      select now() as now, m.computed_at, m.checked_at, c.changed_at, f.feed_hash,
             (select e.epoch::text from private.snapshot_epoch e) as epoch,
             private.is_unlocked(v.id) as unlocked
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
    ratingsChangedAt: millis(row.changed_at),
    feedHash: typeof row.feed_hash === "string" ? row.feed_hash : null,
    // Read before any of the data, so a purge after this point is one the save
    // sees (0016).
    cacheEpoch: typeof row.epoch === "string" ? row.epoch : null,
    unlocked: row.unlocked === true,
  };
}

/**
 * The population's estimate of `κ` and `a₀`, or DESIGN §2.9's table.
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

function absorb(neighbourhood: Neighbourhood, rows: readonly NodeRow[]): void {
  addNodes(neighbourhood, neighbourhoodFromRows(rows));
}

function addNodes(neighbourhood: Neighbourhood, nodes: CachedNeighbourhood): void {
  for (const [id, node] of nodes) {
    neighbourhood.loaded.add(id);
    neighbourhood.seen.add(id);
    neighbourhood.friendIds[id] = [...node.friendIds];
    for (const friend of node.friendIds) neighbourhood.seen.add(friend);
    if (Object.keys(node.ratings).length > 0) neighbourhood.ratings[id] = { ...node.ratings };
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

/** What `private.neighbourhood` returns now, before any extra round. */
async function loadInFull(viewer: string): Promise<CachedNeighbourhood> {
  return neighbourhoodFromRows(
    (await asServiceRole(
      (tx) => tx`
        select id, friend_ids, ratings
        from private.neighbourhood(${viewer}::uuid, ${MAX_LOADED_NODES}, ${MAX_DEPTH})`,
    )) as unknown as NodeRow[],
  );
}

/** Where the neighbourhood came from, and how many refreshes until the next check. */
type Base = {
  readonly nodes: CachedNeighbourhood;
  readonly source: "patched" | "full" | "checked";
  readonly reloadsIn: number;
};

type CacheRow = DeltaRow & { blob: string | null; reloads_in: number | null };

/**
 * DESIGN §3.4a: the cached neighbourhood patched with what changed since it was
 * written, or a full load when there is no usable cache — none, another
 * version, a week old, unreadable, or one the delta does not fit — and on every
 * `RELOAD_EVERY`th refresh, when the patch is compared with a full load, a
 * difference is logged, and the full load is what is used.
 */
async function loadBase(viewer: string): Promise<Base> {
  let rows: CacheRow[] = [];
  try {
    rows = (await asServiceRole(
      (tx) => tx`
        select state, id, friend_ids, ratings, cleared, reloads_in, blob
        from private.snapshot_delta(${viewer}::uuid, ${CACHE_VERSION}, ${MAX_LOADED_NODES},
                                    ${MAX_DEPTH})`,
    )) as unknown as CacheRow[];
  } catch (error) {
    // The cache only saves reading; failing to read it is a full load, not a 500.
    console.error(JSON.stringify({ fn: "refresh-recs", at: "snapshotDelta", error: String(error) }));
  }
  const header = rows.find((row) => row.state === "cache");
  const stored = header?.blob ? await unpackNeighbourhood(header.blob) : null;
  const patched = stored ? applyDelta(stored, viewer, rows) : null;
  if (!patched) {
    if (header) {
      console.error(JSON.stringify({ fn: "refresh-recs", at: "loadBase", unusableCache: true }));
    }
    return { nodes: await loadInFull(viewer), source: "full", reloadsIn: RELOAD_EVERY - 1 };
  }
  const reloadsIn = header?.reloads_in ?? 0;
  if (reloadsIn > 0) {
    return { nodes: patched, source: "patched", reloadsIn: reloadsIn - 1 };
  }
  const fresh = await loadInFull(viewer);
  if (canonicalNeighbourhood(patched) !== canonicalNeighbourhood(fresh)) {
    // A missed stamp or a patch bug, never drift: there is no arithmetic to
    // drift. Counts only, so the event names nobody in the neighbourhood.
    const detail = JSON.stringify(neighbourhoodDifference(patched, fresh));
    console.error(JSON.stringify({ fn: "refresh-recs", at: "cacheCheck", detail }));
    await asServiceRole(
      (tx) => tx`
        insert into private.debug_events (user_id, kind, detail)
        values (${viewer}::uuid, 'snapshot-cache-mismatch', ${detail})`,
    );
  }
  return { nodes: fresh, source: "checked", reloadsIn: RELOAD_EVERY - 1 };
}

/**
 * The core, plus DESIGN §3.4's extra rounds: while the node budget has room and
 * some chain reaches past the loaded set, read the people it reaches most
 * strongly and compute again.
 *
 * Every round is another crossing of the wasm boundary over the whole snapshot,
 * and that crossing costs more than the computation does. `N_max` counts the
 * nodes a round adds, so a first pass that stopped at the cap has nothing to
 * spend here.
 */
async function computeWithBoundaryRounds(
  neighbourhood: Neighbourhood,
  viewer: string,
  priors: Priors | null,
): Promise<CoreResult> {
  let result = computeUser(toSnapshot(neighbourhood), viewer, null, priors) as CoreResult;
  for (let round = 0; round < MAX_BOUNDARY_ROUNDS; round += 1) {
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
          from private.load_nodes(${viewer}::uuid, ${next}::uuid[])`,
      )) as unknown as NodeRow[],
    );
    result = computeUser(toSnapshot(neighbourhood), viewer, null, priors) as CoreResult;
  }
  return result;
}

/**
 * One upsert of the recompute's own scratch row, naming whatever the caller
 * actually has to say.
 *
 * The same-answer branch writes only part of `user_model`, and writing the whole
 * row from it would null the columns it has nothing to say about (`computed_at`,
 * `nodes_touched`). So the row is an object and the statement names its keys.
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
 * The whole of DESIGN §3.4 for one viewer.
 *
 * Returns the stored stamp untouched when the feed is current, and when a
 * recompute lands on the same answer: `computed_at` is what tells a client its
 * feed changed, so moving it for an identical feed would cost every open tab a
 * reload to be told nothing. `checked_at` moves either way, and that is what
 * buys the next staleness window.
 */
async function refreshFeed(uid: string): Promise<RefreshResult | null> {
  const stamps = await readStamps(uid);
  // A locked account (0010) writes nothing, this function's rows included.
  if (!stamps.unlocked) return null;
  if (!needsRecompute(stamps, stamps.now.getTime(), STALE_AFTER_MS)) {
    return { computedAt: stamps.computedAt, recomputed: false, entries: null };
  }

  const priors = await readPriors();
  const base = await loadBase(uid);
  // The cache holds what `private.neighbourhood` returns and not the boundary
  // rounds', which are read again every time: they depend on the core's answer.
  const neighbourhood: Neighbourhood = {
    friendIds: {},
    loaded: new Set(),
    ratings: {},
    seen: new Set([uid]),
  };
  addNodes(neighbourhood, base.nodes);
  const result = await computeWithBoundaryRounds(neighbourhood, uid, priors.priors);
  const blob = await packNeighbourhood(base.nodes);

  const entries = foldScores(result.scores);
  if (!allFinite(entries)) {
    // Nothing here is recoverable by the caller and nothing partial may land:
    // the stored feed is a real answer about an earlier moment, and half of a
    // broken one is not.
    throw new Error("the recompute did not produce a feed");
  }

  // The tallies are this recompute's, not this feed's: one that landed on the
  // same answer still compared every pair it loaded, and DESIGN §2.9's estimate
  // is over every pair anybody computed. So they ride on the stamp the check
  // writes anyway.
  const model = {
    priors_at: priors.computedAt,
    ...pairTallies(result.pairs),
  };

  // Exact as of `stamps.now`, which was read before any of it. Refused by the
  // database when a purge ran after that read (0016), and then nothing is kept.
  const saveCache = async (tx: postgres.TransactionSql) => {
    if (!blob || stamps.cacheEpoch === null) return;
    await tx`
      select private.save_snapshot_cache(
        ${uid}::uuid, ${stamps.cacheEpoch}::bigint, ${CACHE_VERSION}, ${stamps.now},
        ${[...base.nodes.keys()]}::uuid[], ${base.reloadsIn}, ${blob}::text)`;
  };

  const hashOfFeed = feedSignature(entries);
  if (hashOfFeed === stamps.feedHash && stamps.computedAt > 0) {
    await asServiceRole(async (tx) => {
      await upsertModel(tx, {
        user_id: uid,
        checked_at: stamps.now,
        recomputed: false,
        ...model,
      });
      await saveCache(tx);
    });
    return { computedAt: stamps.computedAt, recomputed: false, entries: null };
  }

  const ratingCount = Object.keys(neighbourhood.ratings[uid] ?? {}).length;
  const computedAt = stamps.now;
  // One transaction, because the feed and the stamp that describes it are one
  // answer: a reader must never see a moved stamp beside the old feed.
  await asServiceRole(async (tx) => {
    await tx`
      insert into public.user_recs (user_id, computed_at, entries, feed_hash)
      values (${uid}::uuid, ${computedAt}, ${tx.json([...entries])}, ${hashOfFeed})
      on conflict (user_id) do update set
        computed_at = excluded.computed_at,
        entries = excluded.entries,
        feed_hash = excluded.feed_hash`;
    await upsertModel(tx, {
      user_id: uid,
      computed_at: computedAt,
      checked_at: computedAt,
      nodes_touched: result.reached,
      rating_count: ratingCount,
      recomputed: true,
      ...model,
    });
    await saveCache(tx);
  });

  console.log(
    JSON.stringify({
      fn: "refresh-recs",
      source: base.source,
      cacheBytes: blob?.length ?? 0,
      loaded: neighbourhood.loaded.size,
      seen: neighbourhood.seen.size,
      reached: result.reached,
      entries: entries.length,
    }),
  );
  return { computedAt: computedAt.getTime(), recomputed: true, entries };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const uid = await callerUid(request);
  if (!uid) return json(401, { error: "sign in to refresh your feed" });

  try {
    const result = await refreshFeed(uid);
    if (result === null) return json(403, { error: "accept a link first" });
    return json(200, result);
  } catch (error) {
    // The viewer is told nothing but that it failed: what went wrong is a
    // database error or a non-finite result, and neither is theirs to act on or
    // to read.
    console.error(JSON.stringify({ fn: "refresh-recs", uid, error: String(error) }));
    return json(500, { error: "the recompute did not produce a feed" });
  }
});
