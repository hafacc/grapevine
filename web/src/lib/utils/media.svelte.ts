import { MediaQuery } from "svelte/reactivity";

/**
 * True at desktop width: Tailwind's `md`, where the swipe gives way to side
 * buttons.
 *
 * A media query rather than a CSS breakpoint because the two layouts are
 * different TREES, not the same tree at two sizes: a swiped row at phone width,
 * a row between side buttons at desktop. Rendering both and hiding one would
 * mount every row twice, and a check script (or a screen reader) would then
 * find two of everything.
 *
 * False where there is no window to measure, which is the prerender; nothing
 * prerendered draws a row.
 */
export const desktop = new MediaQuery("(min-width: 768px)", false);
