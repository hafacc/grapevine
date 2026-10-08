// The browser's own `pushState` and `replaceState`.
//
// SvelteKit wraps the two on `window.history` in dev, to warn that its router
// should be asked instead. Its router is not what moves between this app's
// screens: they live in the fragment (`router.ts`), on one SvelteKit page. So
// the calls go past the wrapper, to the methods it wraps, and every state
// written is the entry's own with SvelteKit's keys still in it.

export function pushHistory(state: unknown, url: string): void {
  History.prototype.pushState.call(window.history, state, "", url);
}

export function replaceHistory(state: unknown, url: string): void {
  History.prototype.replaceState.call(window.history, state, "", url);
}
