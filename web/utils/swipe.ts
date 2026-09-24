import type { RatingValue } from "./types";

// Right is yes and left is no, everywhere and on both sides of the screen: the
// same two sides carry the desktop buttons welded to each end of a row.
export type SwipeDirection = "left" | "right";

// What shows behind the moving row. `clear` is neither answer — swiping the way
// you already voted takes the rating away, and the reveal has to say so before
// the gesture finishes.
export type SwipeReveal = "yes" | "no" | "clear";

export type SwipeOutcome = {
  // What the rating becomes, null being no opinion.
  readonly next: RatingValue | null;
  readonly reveal: SwipeReveal;
  readonly glyph: "up" | "down" | "minus";
};

/**
 * What a swipe (or the button on that side) would do to a rating.
 *
 * Swiping the way you already voted clears; swiping the other way flips
 * straight over with no clear in between, so two of the three states are always
 * one gesture away. The gesture is therefore its own undo, which is what lets
 * the empty screen say nothing about which direction means what.
 */
export function swipeOutcome(
  current: RatingValue | null,
  direction: SwipeDirection,
): SwipeOutcome {
  const asked: RatingValue = direction === "right" ? 1 : -1;
  if (current === asked) return { next: null, reveal: "clear", glyph: "minus" };
  else if (asked === 1) return { next: 1, reveal: "yes", glyph: "up" };
  else return { next: -1, reveal: "no", glyph: "down" };
}

/**
 * The side the reveal's glyph is pinned to: the one the row came from, so the
 * glyph is uncovered by the movement rather than chased by it.
 */
export function glyphSide(direction: SwipeDirection): SwipeDirection {
  return direction === "right" ? "left" : "right";
}
