"use client";

import { useSyncExternalStore } from "react";

/**
 * One value, shared by every component that reads it.
 *
 * The feed and the viewer's own thumbs are each read by several components at
 * once, and a write from one has to show in the others. A plain `useState` in a
 * hook does not do that: each caller would hold its own copy and a thumb would
 * appear in one place only.
 *
 * The value is replaced, never mutated, so `useSyncExternalStore` can tell one
 * from the next by identity.
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

// The server snapshot is the same object every time, because a prerender has no
// session and React compares the two by identity.
export function useCell<T>(cell: Cell<T>, serverValue: T): T {
  return useSyncExternalStore(cell.subscribe, cell.get, () => serverValue);
}
