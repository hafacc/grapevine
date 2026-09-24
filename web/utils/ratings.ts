"use client";

import { useEffect } from "react";
import { type Cell, createCell, useCell } from "./cell";
import { readAllPages } from "./paging";
import { createSerializer } from "./serial";
import { useGrapevine } from "./store";
import { errorCode, retryTransient, supabase } from "./supabase";
import type { Ratings, RatingValue } from "./types";

const NO_RATINGS: Ratings = {};

/** The viewer's own thumb on a thing (`tag` empty) or on one of its attributes. */
export function ratingOf(
  ratings: Ratings,
  itemId: string,
  tag: string,
): RatingValue | null {
  return ratings[itemId]?.[tag] ?? null;
}

type RatingsState = {
  readonly uid: string | null;
  readonly ratings: Ratings;
  readonly ready: boolean;
  // The read failed, which is not "this person has rated nothing". Kept apart
  // for the same reason `profileUnreachable` is: the screens below say things
  // about an empty map that are only true when the map is an answer.
  readonly failed: boolean;
};

const EMPTY: RatingsState = {
  uid: null,
  ratings: NO_RATINGS,
  ready: false,
  failed: false,
};

const cell: Cell<RatingsState> = createCell(EMPTY);

// Nobody else's rows are writable, so the uid is never a caller's choice. Read
// from the persisted session rather than asked of the server: this is local, and
// a thumb should not wait on a round trip to find out whose it is.
async function ownUid(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("not signed in");
  return uid;
}

/**
 * Applies a thumb locally, so the screen answers the swipe and not the network.
 *
 * An item with no thumbs left is removed rather than left holding an empty map,
 * so "has this person said anything about this thing?" is one lookup and the
 * shape a reader sees is the shape a fresh read produces.
 */
function applyLocal(
  itemId: string,
  tag: string,
  value: RatingValue | null,
): void {
  const current = cell.get();
  const forItem: Record<string, RatingValue> = { ...current.ratings[itemId] };
  if (value === null) delete forItem[tag];
  else forItem[tag] = value;
  const next: Record<string, Readonly<Record<string, RatingValue>>> = {
    ...current.ratings,
  };
  if (Object.keys(forItem).length === 0) delete next[itemId];
  else next[itemId] = forItem;
  cell.set({ ...current, ratings: next });
}

type ItemRatingRow = { item_id: string; tag: string; value: number };

async function reload(uid: string): Promise<void> {
  // In key order, which is the primary key's, so the pages neither overlap nor
  // skip a row.
  const rows = await readAllPages<ItemRatingRow>(async (from, to) => {
    const { data, error } = await supabase()
      .from("ratings")
      .select("item_id,tag,value")
      .eq("user_id", uid)
      .order("item_id")
      .order("tag")
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as ItemRatingRow[];
  });
  const ratings: Record<string, Record<string, RatingValue>> = {};
  for (const { item_id: itemId, tag, value } of rows) {
    // One row per thumb and a CHECK on the column, so this can only fail on a
    // schema that changed under a tab that was already open.
    if (value !== 1 && value !== -1) continue;
    const forItem = ratings[itemId] ?? {};
    forItem[tag] = value;
    ratings[itemId] = forItem;
  }
  cell.set({ uid, ratings, ready: true, failed: false });
}

// The two halves of a thumb's key, joined the way the core joins them: no id
// or tag can contain a NUL, so no pair of them can collide.
function thumbKey(itemId: string, tag: string): string {
  return `${itemId}\0${tag}`;
}

const submit = createSerializer<RatingValue | null>((key, value) => {
  const [itemId = "", tag = ""] = key.split("\0");
  applyLocal(itemId, tag, value);
});

/**
 * One thumb on a thing (`tag` empty) or on one of its attributes, leaving every
 * other rating alone.
 *
 * An insert first and an update only where that collides, rather than an upsert,
 * and the reason is the column grant: UPDATE on `ratings` is granted on `value`
 * alone, so that changing a thumb cannot silently re-point it at another thing
 * or another attribute. An upsert sends every column of the payload in its
 * `do update set`, which asks for UPDATE on the three key columns too and is
 * refused — and refused only on the second thumb for a thing, which no first
 * test would catch. Changing one's mind costs the extra round
 * trip; rating something for the first time does not.
 *
 * Queued behind any earlier write to the same thumb rather than sent at once.
 * One statement per write would not fix a race between two of them — a slow
 * first request still lands after a fast second one — so the order has to be
 * kept here, where both intents are known.
 */
export async function setRating(
  itemId: string,
  tag: string,
  value: RatingValue,
): Promise<void> {
  await submit(
    thumbKey(itemId, tag),
    value,
    ratingOf(cell.get().ratings, itemId, tag),
    async () => {
      const uid = await ownUid();
      const inserted = await supabase()
        .from("ratings")
        .insert({ user_id: uid, item_id: itemId, tag, value });
      const error =
        inserted.error && errorCode(inserted.error) === "23505"
          ? (
              await supabase()
                .from("ratings")
                .update({ value })
                .eq("user_id", uid)
                .eq("item_id", itemId)
                .eq("tag", tag)
            ).error
          : inserted.error;
      if (error) throw error;
    },
  );
}

// Removed rather than stored as a zero: the core reads "no opinion" as absent,
// and a third value would be one more thing every reader has to know about.
export async function clearRating(itemId: string, tag: string): Promise<void> {
  await submit(
    thumbKey(itemId, tag),
    null,
    ratingOf(cell.get().ratings, itemId, tag),
    async () => {
      const uid = await ownUid();
      const { error } = await supabase()
        .from("ratings")
        .delete()
        .eq("user_id", uid)
        .eq("item_id", itemId)
        .eq("tag", tag);
      if (error) throw error;
    },
  );
}

/**
 * The key whose read has landed or is in flight — several screens read these,
 * and the first of them to mount does the reading.
 *
 * Nothing is counted here, unlike the feed's Realtime channel: there is no
 * subscription to tear down, so the last screen to leave has nothing to release
 * and a read already made is one nobody has to make again. A FAILED read is
 * cleared, so the next screen to want the thumbs asks. Kept, one transient
 * failure would be permanent for the session, with every thing rendering the
 * viewer's own thumbs un-given — so swiping the way you already voted would set
 * it again instead of clearing it, with nothing on screen saying so.
 */
let loadedFor: string | null = null;

function ensureLoaded(uid: string, generation: number): void {
  const key = `${uid}:${generation}`;
  if (loadedFor === key) return;
  loadedFor = key;
  // Not `EMPTY`: blanking a list of thumbs on a refetch makes every screen flash
  // its "nothing rated" state. The stale answer is the better one until the new
  // one lands.
  if (cell.get().uid !== uid)
    cell.set({ uid, ratings: NO_RATINGS, ready: false, failed: false });
  void retryTransient(() => reload(uid)).catch((error) => {
    console.error("ratings: load failed", error);
    if (loadedFor === key) loadedFor = null;
    if (cell.get().uid === uid)
      cell.set({ ...cell.get(), ready: false, failed: true });
  });
}

/**
 * The signed-in user's own thumbs.
 *
 * Fetched on mount rather than subscribed: these rows change when this person
 * swipes something, which this tab already knows about — and the one channel a
 * viewer's own screen needs is the feed, whose rewrite comes from somewhere
 * else. The two writes above apply their change here first and put it back if
 * the write is refused.
 */
export function useMyRatings(): {
  ratings: Ratings;
  ready: boolean;
  failed: boolean;
} {
  const { user, channelGeneration } = useGrapevine();
  const uid = user?.uid ?? null;
  const state = useCell(cell, EMPTY);

  useEffect(() => {
    if (!uid) {
      cell.set(EMPTY);
      loadedFor = null;
      return;
    }
    ensureLoaded(uid, channelGeneration);
  }, [uid, channelGeneration]);

  const mine = state.uid === uid;
  return {
    ratings: mine ? state.ratings : NO_RATINGS,
    ready: mine && state.ready,
    failed: mine && state.failed,
  };
}
