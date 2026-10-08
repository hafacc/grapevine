/**
 * One value, shared by every component that reads it.
 *
 * The feed and the viewer's own thumbs are each read by several components at
 * once, and a write from one has to show in the others. State held by each
 * reader does not do that: each would hold its own copy and a thumb would appear
 * in one place only.
 *
 * The value is replaced, never mutated, so a reader can tell one from the next
 * by identity. `useCell` in `cell.svelte.ts` is how a component follows one.
 */
export type Cell<T> = {
  readonly get: () => T;
  readonly set: (next: T) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createCell<T>(initial: T): Cell<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
