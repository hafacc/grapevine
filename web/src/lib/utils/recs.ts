import { allFinite, foldScores } from "grapevine-shared/entries";
import { type Cell, createCell } from "./cell";
import { readFollowed, writeFollowed } from "./followed-cache";
import { ratingsCell, reloadMyRatings } from "./ratings";
import { retryTransient, supabase } from "./supabase";
import {
  applyThumbsSince,
  buildSnapshot,
  type CoreResult,
  type Held,
  inBatches,
  readThumbsSince,
  type Snapshot,
  type Stamp,
  staleAccounts,
  stampSignature,
  type Thumbs,
  type ThumbsSince,
} from "./taste";
import {
  NO_PLOT,
  ratedThings,
  readPlot,
  type TastePlot,
  trimPlot,
} from "./taste-map";
import { currentRank } from "./taste-rank";
import type { TasteAsk, TasteRequest, TasteResponse } from "./taste-worker";
import type { Ratings, RecsEntry } from "./types";

export const NO_ENTRIES: readonly RecsEntry[] = [];

/** The list, as the last computation left it. */
export type FeedState = {
  readonly uid: string | null;
  readonly entries: readonly RecsEntry[];
  // The viewer's map (`taste-map.ts`), from the same computation as the list.
  readonly plot: TastePlot;
  readonly computedAt: number;
  // A computation has finished in this session, so an empty list is an answer.
  readonly ready: boolean;
  // No computation has finished in this session and the last one failed: what
  // is on screen is at best an earlier session's list, and an empty one is not
  // "there is nothing in it". Kept apart for the same reason
  // `profileUnreachable` is, and read by every screen below: the sentences they
  // render about an empty list are only true when the emptiness is an answer.
  readonly failed: boolean;
  // The last ask to bring the list up to date failed. With a cached list that
  // is a stale screen; with none it is the whole reason the screen is empty,
  // and "nothing yet" would be a claim about the viewer.
  readonly refreshFailed: boolean;
};

const NO_FEED: FeedState = {
  uid: null,
  entries: NO_ENTRIES,
  plot: NO_PLOT,
  computedAt: 0,
  ready: false,
  failed: false,
  refreshFailed: false,
};

export const feedCell: Cell<FeedState> = createCell(NO_FEED);

// Per viewer, because a shared device is two lists and neither may be shown to
// the other.
const CACHE_PREFIX = "grapevine.recs.";

function cacheKey(uid: string): string {
  return `${CACHE_PREFIX}${uid}`;
}

/**
 * Every cached list on this device, whoever's it was.
 *
 * Called on sign-out, so the next person at a shared device finds nothing of
 * the last one's: a key per viewer keeps two lists apart while both are in
 * use, and keeps neither private once one of them has left.
 */
export function forgetCachedFeeds(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

type CachedFeed = {
  entries: readonly RecsEntry[];
  plot: TastePlot;
  computedAt: number;
};

/**
 * The last list this browser computed, for first paint and for offline.
 *
 * It is the viewer's own list, which they may see anyway, and it is the only
 * thing on the device that could make the list render before the network
 * answers. The thumbs it was computed from are not kept: they are other
 * people's. Every access is guarded: storage throws in a private window, and
 * it can come back with whatever an older version of this app wrote.
 */
function readCache(uid: string): CachedFeed | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      entries?: unknown;
      plot?: unknown;
      computedAt?: unknown;
    };
    if (!Array.isArray(parsed.entries) || typeof parsed.computedAt !== "number")
      return null;
    return {
      entries: parsed.entries as RecsEntry[],
      plot: readPlot(parsed.plot),
      computedAt: parsed.computedAt,
    };
  } catch {
    return null;
  }
}

function writeCache(uid: string, feed: CachedFeed): void {
  try {
    window.localStorage.setItem(cacheKey(uid), JSON.stringify(feed));
  } catch {
    // A full quota costs first paint on the next open and nothing else.
  }
}

// How many followed accounts' thumbs are read at once: enough that forty are
// a few round trips, few enough to leave the connection to everything else.
const READS_AT_ONCE = 4;

async function fetchStamps(): Promise<Stamp[]> {
  const { data, error } = await supabase().rpc("followed_stamps");
  if (error) throw error;
  return ((data ?? []) as { user_id: string; stamp: string }[]).map((row) => ({
    uid: row.user_id,
    stamp: row.stamp,
  }));
}

// One request per account, as one JSON value: a select would be cut at
// PostgREST's `max_rows`, and one critic can hold thousands of thumbs. Asked
// from what is already held, so the answer is only what changed since; from
// nothing, it is everything.
async function fetchThumbsSince(
  uid: string,
  from: Held | undefined,
): Promise<ThumbsSince> {
  const { data, error } = await supabase().rpc("account_thumbs_since", {
    p_user: uid,
    p_revision: from?.revision ?? 0,
    p_removed: from?.removed ?? null,
  });
  if (error) throw error;
  const answer = readThumbsSince(data);
  if (answer === null)
    throw new Error("the thumbs came back in no known shape");
  return answer;
}

let worker: Worker | null = null;
let asked = 0;
const waiting = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>();

function failWaiting(error: Error): void {
  for (const { reject } of waiting.values()) reject(error);
  waiting.clear();
}

// Longer than the core takes on the largest list measured, many times over.
// A worker the browser killed sends nothing at all, and an ask that waited on
// it forever would hold up every later one.
const COMPUTE_PATIENCE_MS = 60_000;

// Ends a worker that failed or went quiet: whoever is waiting is told, and the
// next ask makes a new one.
function dropWorker(made: Worker, reason: string): void {
  made.terminate();
  if (worker !== made) return;
  worker = null;
  failWaiting(new Error(reason));
}

function coreWorker(): Worker {
  if (worker !== null) return worker;
  const made = new Worker(new URL("./taste-worker.ts", import.meta.url), {
    type: "module",
  });
  made.addEventListener("message", (event: MessageEvent<TasteResponse>) => {
    const answer = event.data;
    const pending = waiting.get(answer.id);
    if (!pending) return;
    waiting.delete(answer.id);
    if ("error" in answer) {
      pending.reject(new Error(answer.error));
      // A core that could not load, or that trapped, is finished: it closes
      // itself or is in no state to be asked again. A refusal is an answer,
      // and whoever else is waiting still gets theirs.
      if (answer.fatal) dropWorker(made, answer.error);
    } else {
      pending.resolve(answer.result);
    }
  });
  made.addEventListener("error", (event) =>
    dropWorker(made, event.message || "the core failed to load"),
  );
  made.addEventListener("messageerror", () =>
    dropWorker(made, "the core's answer could not be read"),
  );
  worker = made;
  return made;
}

// One ask of the worker, answered or refused.
function ask(request: TasteAsk): Promise<unknown> {
  return new Promise((resolve, reject) => {
    asked += 1;
    const id = asked;
    const made = coreWorker();
    const timer = setTimeout(
      () => dropWorker(made, "the core did not answer"),
      COMPUTE_PATIENCE_MS,
    );
    waiting.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    made.postMessage({ id, ...request } satisfies TasteRequest);
  });
}

function compute(
  snapshot: Snapshot,
  viewer: string,
  rank: number,
): Promise<CoreResult> {
  return ask({ snapshot, viewer, rank }) as Promise<CoreResult>;
}

/**
 * A place in the plane for each of a plot's points, by name: the core's
 * layout (`rust/src/layout.rs`), worked out in the worker because it is a few
 * hundred milliseconds of arithmetic. Asked for only when the map is opened.
 */
export async function placePoints(
  points: Readonly<Record<string, readonly number[]>>,
): Promise<Record<string, readonly number[]>> {
  const places = await ask({ points });
  if (typeof places !== "object" || places === null)
    throw new Error("the layout came back in no known shape");
  return places as Record<string, readonly number[]>;
}

// The followed accounts' thumbs for one viewer, as last read and as kept on
// the device (`followed-cache.ts`): what makes a computation read only what
// changed, in this session and across them.
let held = new Map<string, Held>();
let heldFor: string | null = null;
// What the list on screen was computed from. The viewer's own thumbs are
// replaced on every change, never mutated, so identity is the comparison.
let computedFrom: {
  uid: string;
  stamps: string;
  own: Ratings;
  rank: number;
} | null = null;

function settle(uid: string, refreshFailed: boolean): void {
  const current = feedCell.get();
  if (current.uid !== uid) return;
  feedCell.set({
    ...current,
    refreshFailed,
    failed: refreshFailed && !current.ready,
  });
}

async function ownThumbs(uid: string): Promise<Ratings> {
  const current = ratingsCell.get();
  if (current.uid === uid && current.ready) return current.ratings;
  else return reloadMyRatings();
}

// Whose session the browser holds right now. Every read below is answered for
// that account whatever `uid` says, so a list is only computed for it.
async function sessionUid(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

async function recompute(uid: string): Promise<void> {
  // Another tab signed in as somebody else: this viewer's thumbs and that
  // session's follows are not one person's list.
  if ((await sessionUid()) !== uid) return;
  if (heldFor !== uid) {
    held = new Map();
    heldFor = uid;
    computedFrom = null;
    const kept = await readFollowed(uid);
    if (heldFor !== uid) return;
    held = kept;
  }
  const [own, stamps] = await Promise.all([
    ownThumbs(uid),
    retryTransient(fetchStamps),
  ]);
  const signature = stampSignature(stamps);
  // Read once: a change during the computation is the next one's.
  const rank = currentRank();
  if (
    computedFrom !== null &&
    computedFrom.uid === uid &&
    computedFrom.stamps === signature &&
    computedFrom.own === own &&
    computedFrom.rank === rank &&
    feedCell.get().ready
  )
    return;

  const stale = staleAccounts(stamps, held);
  const before = held;
  const read = await inBatches(stale, READS_AT_ONCE, (account) =>
    retryTransient(() => fetchThumbsSince(account, before.get(account))),
  );
  // A sign-out or another account in the meantime: what was read is not this
  // viewer's to keep.
  if (heldFor !== uid || held !== before) return;
  const stampOf = new Map(stamps.map(({ uid: id, stamp }) => [id, stamp]));
  const changed = new Map<string, Held>();
  stale.forEach((account, index) => {
    const answer = read[index];
    if (answer === undefined) return;
    const next: Held = {
      stamp: stampOf.get(account) ?? "",
      revision: answer.revision,
      removed: answer.removed,
      thumbs: applyThumbsSince(held.get(account)?.thumbs ?? {}, answer),
    };
    held.set(account, next);
    changed.set(account, next);
  });
  // Unfollowed, or left with nothing visible: not kept, and not computed over.
  const gone = [...held.keys()].filter((account) => !stampOf.has(account));
  for (const account of gone) held.delete(account);
  void writeFollowed(uid, changed, gone);

  const followed = new Map<string, Thumbs>();
  for (const [account, { thumbs }] of held) followed.set(account, thumbs);
  const result = await compute(buildSnapshot(uid, own, followed), uid, rank);
  const entries = foldScores(result.scores);
  if (!allFinite(entries)) throw new Error("the core answered a non-number");
  if (heldFor !== uid || feedCell.get().uid !== uid) return;
  computedFrom = { uid, stamps: signature, own, rank };
  const feed = {
    entries,
    plot: trimPlot(readPlot(result.plot), ratedThings(own)),
    computedAt: Date.now(),
  };
  feedCell.set({
    ...feedCell.get(),
    ...feed,
    ready: true,
    failed: false,
    refreshFailed: false,
  });
  writeCache(uid, feed);
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Brings the viewer's list up to date: reads which followed accounts changed,
 * reads those, and computes the list here, in the browser.
 *
 * Nothing is computed when nothing changed, so asking on every open is one
 * small request. One computation at a time: an ask that arrives during one is
 * answered by a second run after it, since the first may have read before
 * whatever prompted the ask.
 */
export function refreshMyRecs(): Promise<void> {
  if (running !== null) {
    again = true;
    return running;
  }
  const run = async (): Promise<void> => {
    do {
      again = false;
      const uid = feedCell.get().uid;
      if (uid === null) return;
      try {
        await recompute(uid);
        settle(uid, false);
      } catch (error) {
        settle(uid, true);
        if (!again) throw error;
      }
    } while (again);
  };
  running = run().finally(() => {
    running = null;
  });
  return running;
}

/**
 * The key whose list has been asked for. Several screens read the list
 * (`useMyRecs` in `recs.svelte.ts`), and the first of them to mount does the
 * asking; a re-attach after a lost connection asks again.
 */
let retained: string | null = null;

/** Shows `uid` their cached list and brings it up to date. */
export function retainFeed(uid: string, generation: number): void {
  const key = `${uid}:${generation}`;
  if (retained === key) return;
  retained = key;
  if (feedCell.get().uid !== uid) {
    const cached = readCache(uid);
    feedCell.set({
      uid,
      entries: cached?.entries ?? NO_ENTRIES,
      plot: cached?.plot ?? NO_PLOT,
      computedAt: cached?.computedAt ?? 0,
      // A cache is something to look at, not an answer: `ready` waits for a
      // computation, so "you have nothing yet" is never said on the strength
      // of a browser that has never asked.
      ready: false,
      failed: false,
      refreshFailed: false,
    });
  }
  void refreshMyRecs().catch((failure) => {
    console.error("recs: refresh failed", failure);
  });
}

/**
 * The session is `uid`'s now, or nobody's: what is held for anybody else was
 * theirs, the list and the thumbs behind it. Called on every change of
 * session, since the screens that read the list are gone by the time a
 * sign-out could tell them.
 */
export function forgetFeedUnless(uid: string | null): void {
  if (uid !== null && feedCell.get().uid === uid) return;
  forgetFeed();
}

/** Nobody is signed in: the list on screen was somebody's, and so were the thumbs behind it. */
export function forgetFeed(): void {
  feedCell.set(NO_FEED);
  held = new Map();
  heldFor = null;
  computedFrom = null;
  retained = null;
}
