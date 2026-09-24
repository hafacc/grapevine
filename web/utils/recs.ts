"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
// What `refresh-recs` answers with. It lives in `shared/` because the Edge
// Function that writes the response and this file that reads it are the two ends
// of one call.
import type { RefreshResult } from "grapevine-shared/entries";
import { useEffect, useMemo } from "react";
import { type Cell, createCell, useCell } from "./cell";
import { useGrapevine } from "./store";
import { retryTransient, subscribeChannel, supabase } from "./supabase";
import type { RecsEntry } from "./types";

export type { RefreshResult };

const NO_ENTRIES: readonly RecsEntry[] = [];

/**
 * The feed, and the step its bar may be drawn in.
 *
 * `error` is `user_recs.error`: the walk behind these entries was accurate to
 * within this much, so a difference smaller than it is one the walk cannot
 * support and must not be drawn (DESIGN §1 "The bar"). Null is "there is no feed
 * to quantize", and a bar handed no step says nothing known yet rather than
 * picking one — a default there would be a silent claim about precision.
 */
type FeedState = {
  readonly uid: string | null;
  readonly entries: readonly RecsEntry[];
  readonly computedAt: number;
  readonly error: number | null;
  readonly ready: boolean;
  // The stored feed could not be read, which is not "there is nothing in it".
  // Kept apart for the same reason `profileUnreachable` is, and read by every
  // screen below: the sentences they render about an empty feed are only true
  // when the emptiness is an answer.
  readonly failed: boolean;
  // The last ask to bring the feed up to date failed. With a stored feed that
  // is a stale screen; with none it is the whole reason the screen is empty,
  // and "nothing yet" would be a claim about the viewer.
  readonly refreshFailed: boolean;
};

const EMPTY: FeedState = {
  uid: null,
  entries: NO_ENTRIES,
  computedAt: 0,
  error: null,
  ready: false,
  failed: false,
  refreshFailed: false,
};

const cell: Cell<FeedState> = createCell(EMPTY);

// Per viewer, because a shared device is two feeds and neither may be shown to
// the other.
const CACHE_PREFIX = "grapevine.recs.";

function cacheKey(uid: string): string {
  return `${CACHE_PREFIX}${uid}`;
}

/**
 * Every cached feed on this device, whoever's it was.
 *
 * Called on sign-out, so the next person at a shared device finds nothing of
 * the last one's: a key per viewer keeps two feeds apart while both are in
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

/** A number the database or an older cache may have written as anything else. */
function reportedError(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

type CachedFeed = {
  entries: readonly RecsEntry[];
  computedAt: number;
  error: number | null;
};

/**
 * The last feed this browser saw, for first paint and for offline.
 *
 * It is the viewer's own feed, which they may see anyway, and it is the only
 * thing on the device that could make the list render before the network
 * answers. Every access is guarded: storage throws in a private window, and it
 * can come back with whatever an older version of this app wrote — which is why
 * the step the bar draws in is read back the same way the row is, and a cache
 * with no step reads as no step rather than as zero.
 */
function readCache(uid: string): CachedFeed | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      entries?: unknown;
      computedAt?: unknown;
      error?: unknown;
    };
    if (!Array.isArray(parsed.entries) || typeof parsed.computedAt !== "number")
      return null;
    return {
      entries: parsed.entries as RecsEntry[],
      computedAt: parsed.computedAt,
      error: reportedError(parsed.error),
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

function apply(uid: string, feed: CachedFeed): void {
  if (cell.get().uid !== uid) return;
  cell.set({ ...cell.get(), uid, ...feed, ready: true, failed: false });
  writeCache(uid, feed);
}

/** The stored feed, which is one row and one request. */
async function loadStored(uid: string): Promise<void> {
  const { data, error } = await supabase()
    .from("user_recs")
    .select("computed_at,entries,error")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // Nobody has run the recompute for this account yet. That is an answer — an
    // empty feed — and not a reason to keep waiting.
    if (cell.get().uid === uid)
      cell.set({ ...cell.get(), ready: true, failed: false });
    return;
  }
  const row = data as {
    computed_at: string;
    entries: unknown;
    error: unknown;
  };
  apply(uid, {
    entries: Array.isArray(row.entries)
      ? (row.entries as RecsEntry[])
      : NO_ENTRIES,
    computedAt: Date.parse(row.computed_at) || 0,
    error: reportedError(row.error),
  });
}

/**
 * Asks the Edge Function to bring this viewer's feed up to date, and takes the
 * answer inline.
 *
 * There is no uid parameter and there cannot be one: the function reads the
 * caller from the verified token and from nowhere else, so the only feed it can
 * touch is the caller's own. When it recomputed, the entries come back in the
 * same response — one body instead of a stamp followed by a second read of
 * everything the stamp was about — and the step the bar draws in rides out with
 * them, so the common path needs no second read for that either.
 */
export async function refreshMyRecs(): Promise<RefreshResult> {
  const asked = cell.get().uid;
  const settle = (refreshFailed: boolean): void => {
    const current = cell.get();
    if (current.uid === asked && current.refreshFailed !== refreshFailed)
      cell.set({ ...current, refreshFailed });
  };
  const { data, error } = await supabase().functions.invoke<RefreshResult>(
    "refresh-recs",
    {
      method: "POST",
    },
  );
  if (error || !data) {
    settle(true);
    throw error ?? new Error("the recompute returned nothing");
  }
  settle(false);

  const uid = cell.get().uid;
  if (uid) {
    if (data.entries)
      apply(uid, {
        entries: data.entries,
        computedAt: data.computedAt,
        error: reportedError(data.error),
      });
    // Current on the server, and this browser has never seen it: the cold start
    // this function deliberately does not re-send.
    else if (data.computedAt !== cell.get().computedAt) await loadStored(uid);
  }
  return data;
}

/**
 * The one channel, and how the screens share it.
 *
 * The list and a thing both read the feed, and each of them subscribing would be
 * two joins on one topic over one socket — which is not two times the delivery
 * but one topic whose membership the first unmount tears down for everybody. So
 * the subscription is counted: the first reader opens it, the last one to leave
 * closes it, and the read that fills the cell happens once per session rather
 * than once per screen.
 */
let attached: {
  key: string;
  channel: RealtimeChannel;
  readers: number;
} | null = null;

function detach(): void {
  if (!attached) return;
  void supabase().removeChannel(attached.channel);
  attached = null;
}

function retain(uid: string, generation: number): void {
  const key = `${uid}:${generation}`;
  if (attached?.key === key) {
    attached.readers += 1;
    return;
  }
  detach();

  if (cell.get().uid !== uid) {
    const cached = readCache(uid);
    cell.set({
      uid,
      entries: cached?.entries ?? NO_ENTRIES,
      computedAt: cached?.computedAt ?? 0,
      error: cached?.error ?? null,
      // A cache is something to look at, not an answer: `ready` waits for the
      // row, so "you have nothing yet" is never said on the strength of a
      // browser that has never asked.
      ready: false,
      failed: false,
      refreshFailed: false,
    });
  }

  void retryTransient(() => loadStored(uid)).catch((failure) => {
    console.error("recs: load failed", failure);
    // `ready` stays false: a screen may only say "you have nothing yet" about a
    // feed it has read, and this one it has not.
    if (cell.get().uid === uid)
      cell.set({ ...cell.get(), ready: false, failed: true });
  });

  const channel = supabase()
    .channel(`recs:${uid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "user_recs",
        filter: `user_id=eq.${uid}`,
      },
      (payload) => {
        const row = payload.new as {
          computed_at?: string;
          entries?: unknown;
          error?: unknown;
        };
        if (!Array.isArray(row.entries) || typeof row.computed_at !== "string")
          return;
        apply(uid, {
          entries: row.entries as RecsEntry[],
          computedAt: Date.parse(row.computed_at) || 0,
          error: reportedError(row.error),
        });
      },
    );
  subscribeChannel(channel, "recs");
  attached = { key, channel, readers: 1 };
}

function release(uid: string, generation: number): void {
  if (attached?.key !== `${uid}:${generation}`) return;
  attached.readers -= 1;
  if (attached.readers === 0) detach();
}

/**
 * The signed-in user's recommendations, and the step their bars may move in.
 *
 * One Realtime channel, not a stamp to watch and a collection to re-read: the
 * payload of a feed rewritten by something other than this tab's own call IS the
 * feed. RLS applies to Realtime, so nobody receives another viewer's row.
 */
export function useMyRecs(): {
  entries: readonly RecsEntry[];
  byItemId: ReadonlyMap<string, RecsEntry>;
  computedAt: number;
  error: number | null;
  ready: boolean;
  failed: boolean;
  refreshFailed: boolean;
} {
  const { user, channelGeneration } = useGrapevine();
  const uid = user?.uid ?? null;
  const state = useCell(cell, EMPTY);

  useEffect(() => {
    if (!uid) {
      cell.set(EMPTY);
      return;
    }
    retain(uid, channelGeneration);
    return () => release(uid, channelGeneration);
  }, [uid, channelGeneration]);

  const mine = state.uid === uid;
  const entries = mine ? state.entries : NO_ENTRIES;
  const byItemId = useMemo(() => {
    const byId = new Map<string, RecsEntry>();
    // One entry per item across the whole feed — it is one recompute's answer,
    // so nothing here has to decide which of two entries for an item is real.
    for (const entry of entries) byId.set(entry.itemId, entry);
    return byId;
  }, [entries]);

  return {
    entries,
    byItemId,
    computedAt: mine ? state.computedAt : 0,
    error: mine ? state.error : null,
    ready: mine && state.ready,
    failed: mine && state.failed,
    refreshFailed: mine && state.refreshFailed,
  };
}
