import { useCell } from "./cell.svelte";
import { feedCell, forgetFeed, NO_ENTRIES, retainFeed } from "./recs";
import { grapevine } from "./store.svelte";
import { NO_PLOT, type TastePlot } from "./taste-map";
import type { RecsEntry } from "./types";

/**
 * The signed-in user's list.
 *
 * Computed in this browser from the viewer's own thumbs and the thumbs of the
 * accounts they follow (`recs.ts`); nothing on a server holds it.
 *
 * Called while a component is being set up; read the fields off what it
 * returns rather than copying them out, so the reader follows a change.
 */
export function useMyRecs(): {
  readonly entries: readonly RecsEntry[];
  readonly byItemId: ReadonlyMap<string, RecsEntry>;
  readonly plot: TastePlot;
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
    retainFeed(mine, grapevine.channelGeneration);
  });

  const view = $derived.by(() => {
    const state = cell.current;
    const mine = state.uid === uid;
    return {
      entries: mine ? state.entries : NO_ENTRIES,
      plot: mine ? state.plot : NO_PLOT,
      computedAt: mine ? state.computedAt : 0,
      ready: mine && state.ready,
      failed: mine && state.failed,
      refreshFailed: mine && state.refreshFailed,
    };
  });
  const entries = $derived(view.entries);
  // Its own derived value, as `entries` is: `view` is a new object on every
  // write to the cell, and the map lays its dots out again whenever this
  // changes.
  const plot = $derived(view.plot);
  const byItemId = $derived.by(() => {
    const byId = new Map<string, RecsEntry>();
    // One entry per item across the whole list — it is one computation's
    // answer, so nothing here has to decide which of two entries is real.
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
    get plot() {
      return plot;
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
