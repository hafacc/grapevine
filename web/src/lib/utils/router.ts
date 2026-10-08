import { normalizeId } from "grapevine-shared";
import { pushHistory, replaceHistory } from "./history";
import type { Screen } from "./types";

export const LIST_SCREEN: Screen = { kind: "list" };
const PEOPLE_SCREEN: Screen = { kind: "people" };
const REPORTS_SCREEN: Screen = { kind: "reports" };

// The fragment rather than a path, because the site is a static export with no
// server to route with. The ids are not secrets — every read they name is gated
// by the policies.
export function screenHash(screen: Screen): string {
  switch (screen.kind) {
    case "list":
      return "#/";
    case "people":
      return "#/people";
    case "reports":
      return "#/reports";
    case "item":
      return `#/item/${encodeURIComponent(screen.id)}`;
  }
}

// The inverse. Null for anything unrecognized, which callers read as "go to the
// list" rather than "render nothing".
export function screenForHash(hash: string): Screen | null {
  let segments: string[];
  try {
    segments = hash
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return null; // a malformed %-escape names no screen either
  }
  const [first, second] = segments;
  switch (segments.length) {
    case 0:
      return LIST_SCREEN;
    case 1:
      if (first === "people") return PEOPLE_SCREEN;
      else if (first === "reports") return REPORTS_SCREEN;
      else return null;
    case 2:
      if (first === "item") {
        // A pasted or hand-typed link carries whatever spelling it was written
        // with, and the id is that text folded — so folding here is what makes
        // `#/item/Caf%C3%A9%20Bleu` and `#/item/caf%C3%A9%20bleu` one link.
        // `normalizeId` refuses what no id can be, which names no item.
        const id = normalizeId(second);
        return id === null ? null : { kind: "item", id };
      } else return null;
    default:
      return null;
  }
}

// A fragment names only the top screen, so a pasted link gets the list seeded
// beneath it — otherwise arriving on a thing means arriving with no way back.
// The reports screen gets the people screen too, which is where it is opened
// from and so where its Back goes.
export function stackForHash(hash: string): Screen[] {
  const screen = screenForHash(hash) ?? LIST_SCREEN;
  if (screen.kind === "list") return [screen];
  else if (screen.kind === "reports")
    return [LIST_SCREEN, PEOPLE_SCREEN, screen];
  else return [LIST_SCREEN, screen];
}

// `depth` is how back() tells "a screen of ours is behind this" from "leaving
// the site".
type NavState = {
  readonly grapevineStack?: readonly Screen[];
  readonly grapevineDepth?: number;
  readonly grapevineScroll?: number;
};

/** The stack an entry's state carries, or none when the entry is not ours. */
export function stackIn(state: unknown): readonly Screen[] {
  return (state as NavState | null)?.grapevineStack ?? [];
}

export function historyDepth(): number {
  return (window.history.state as NavState | null)?.grapevineDepth ?? 0;
}

// Merged, not replaced: SvelteKit's router keeps its own data in
// history.state, and clobbering it loses the page an entry belongs to.
function entryState(
  stack: readonly Screen[],
  depth: number,
  scroll = 0,
): unknown {
  return {
    ...window.history.state,
    grapevineStack: stack,
    grapevineDepth: depth,
    grapevineScroll: scroll,
  };
}

// Per history entry rather than in component state, since that's what survives
// a reload and a forward.
export function historyScroll(): number {
  return (window.history.state as NavState | null)?.grapevineScroll ?? 0;
}

// Called by the list, the only place that knows which element scrolls.
export function rememberScroll(offset: number): void {
  const state = window.history.state as NavState | null;
  if (!state?.grapevineStack) return;
  replaceHistory(
    { ...window.history.state, grapevineScroll: offset },
    window.location.hash,
  );
}

export function pushEntry(stack: readonly Screen[]): void {
  pushHistory(
    entryState(stack, historyDepth() + 1),
    screenHash(stack[stack.length - 1]),
  );
}

export function replaceEntry(
  stack: readonly Screen[],
  depth = historyDepth(),
): void {
  replaceHistory(
    // Carrying the scroll, because a replace changes what this entry POINTS AT
    // and not where the reader is standing in it. Defaulting to 0, coming back
    // to the entry later would land at the top of a list the reader had
    // scrolled deep into.
    entryState(stack, depth, historyScroll()),
    screenHash(stack[stack.length - 1]),
  );
}
