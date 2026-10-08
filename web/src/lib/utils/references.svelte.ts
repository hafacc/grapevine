import type { Reference } from "grapevine-shared/references";
import { useCell } from "./cell.svelte";
import { pendingLinks, readLink, readLinks } from "./references";

/**
 * A thing's link: the one it holds, or the one held for it until its first
 * thumb. Null for none.
 *
 * Called while a component is being set up, with a function so the reader
 * follows the thing the screen is showing.
 */
export function useItemReference(itemId: () => string): {
  readonly current: Reference | null;
} {
  const read = useCell(readLinks);
  const held = useCell(pendingLinks);
  $effect(() => {
    readLink(itemId()).catch((error) => console.error("link", error));
  });
  return {
    get current() {
      const id = itemId();
      return held.current.get(id) ?? read.current.get(id) ?? null;
    },
  };
}
