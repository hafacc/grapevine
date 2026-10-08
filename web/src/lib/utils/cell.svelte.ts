import { createSubscriber } from "svelte/reactivity";
import type { Cell } from "./cell";

/**
 * A cell as something a component can follow: reading `current` in a template,
 * a `$derived` or an `$effect` re-runs it when the cell is set.
 */
export function useCell<T>(cell: Cell<T>): { readonly current: T } {
  const subscribe = createSubscriber((update) => cell.subscribe(update));
  return {
    get current() {
      subscribe();
      return cell.get();
    },
  };
}
