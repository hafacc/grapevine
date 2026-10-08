import type { Attachment } from "svelte/attachments";

/**
 * Focuses an element when it appears, whatever held focus before: the button
 * that opened a sheet keeps focus otherwise, and Enter would press it again.
 *
 * A microtask later, because a sheet is moved onto <body> as it mounts and an
 * element moved while focused loses it.
 */
export const focusOnMount: Attachment<HTMLElement> = (node) => {
  queueMicrotask(() => node.focus());
};
