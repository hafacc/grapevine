import { useCell } from "./cell.svelte";
import {
  ensureRatingsLoaded,
  forgetRatings,
  NO_RATINGS,
  ratingsCell,
} from "./ratings";
import { grapevine } from "./store.svelte";
import type { Ratings } from "./types";

/**
 * The signed-in user's own thumbs.
 *
 * Fetched on mount rather than subscribed: these rows change when this person
 * swipes something, which this tab already knows about — and the one channel a
 * viewer's own screen needs is the feed, whose rewrite comes from somewhere
 * else. `setRating` and `clearRating` apply their change here first and put it
 * back if the write is refused.
 *
 * Called while a component is being set up; read the fields off what it
 * returns rather than copying them out, so the reader follows a change.
 */
export function useMyRatings(): {
  readonly ratings: Ratings;
  readonly ready: boolean;
  readonly failed: boolean;
} {
  const cell = useCell(ratingsCell);
  const uid = $derived(grapevine.user?.uid ?? null);

  $effect(() => {
    if (!uid) forgetRatings();
    else ensureRatingsLoaded(uid, grapevine.channelGeneration);
  });

  const view = $derived.by(() => {
    const state = cell.current;
    const mine = state.uid === uid;
    return {
      ratings: mine ? state.ratings : NO_RATINGS,
      ready: mine && state.ready,
      failed: mine && state.failed,
    };
  });

  return {
    get ratings() {
      return view.ratings;
    },
    get ready() {
      return view.ready;
    },
    get failed() {
      return view.failed;
    },
  };
}
