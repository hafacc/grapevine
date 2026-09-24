"use client";

import { useSyncExternalStore } from "react";

// Tailwind's `md`, where the swipe gives way to side buttons.
const DESKTOP = "(min-width: 768px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True at desktop width.
 *
 * A media query rather than a CSS breakpoint because the two layouts are
 * different TREES, not the same tree at two sizes: a swiped row at phone width,
 * a row between side buttons at desktop. Rendering both and hiding one would
 * mount every row twice, and a check script (or a screen reader) would then
 * find two of everything.
 *
 * The server snapshot is `false` so the prerendered HTML and the first client
 * render agree; the subscription corrects it on the same tick as hydration.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}
