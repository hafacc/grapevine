import { useCell } from "./cell.svelte";
import {
  feedCell,
  forgetFeed,
  NO_ENTRIES,
  releaseFeed,
  retainFeed,
} from "./recs";
import { grapevine } from "./store.svelte";
import type { RecsEntry } from "./types";

/**
 * The signed-in user's recommendations.
 *
 * One Realtime channel, not a stamp to watch and a collection to re-read: the
 * payload of a feed rewritten by something other than this tab's own call IS the
 * feed. RLS applies to Realtime, so nobody receives another viewer's row.
 *
 * Called while a component is being set up; read the fields off what it
 * returns rather than copying them out, so the reader follows a change.
 */
export function useMyRecs(): {
  readonly entries: readonly RecsEntry[];
  readonly byItemId: ReadonlyMap<string, RecsEntry>;
  readonly computedAt: number;
  readonly ready: boolean;
  readonly failed: boolean;
  readonly refreshFailed: boolean;
} {
  const cell = useCell(feedCell);
  const uid = $derived(grapevine.user?.uid ?? null);

  $effect(() => {
    const mine = uid;
    if (!mine) {
      forgetFeed();
      return;
    }
    const generation = grapevine.channelGeneration;
    retainFeed(mine, generation);
    return () => releaseFeed(mine, generation);
  });

  const view = $derived.by(() => {
    const state = cell.current;
    const mine = state.uid === uid;
    return {
      entries: mine ? state.entries : NO_ENTRIES,
      computedAt: mine ? state.computedAt : 0,
      ready: mine && state.ready,
      failed: mine && state.failed,
      refreshFailed: mine && state.refreshFailed,
    };
  });
  const entries = $derived(view.entries);
  const byItemId = $derived.by(() => {
    const byId = new Map<string, RecsEntry>();
    // One entry per item across the whole feed — it is one recompute's answer,
    // so nothing here has to decide which of two entries for an item is real.
    for (const entry of entries) byId.set(entry.itemId, entry);
    return byId;
  });

  return {
    get entries() {
      return entries;
    },
    get byItemId() {
      return byItemId;
    },
    get computedAt() {
      return view.computedAt;
    },
    get ready() {
      return view.ready;
    },
    get failed() {
      return view.failed;
    },
    get refreshFailed() {
      return view.refreshFailed;
    },
  };
}
