import type { RatingValue } from "./types";

// The people screen's one switch, shown in friend suggestions
// (`user_prefs.discoverable_by_taste`), drawn as a line that is swiped like a
// row (DESIGN-UI, "Switch lines").

/**
 * Which way a switch line may be swiped. Right is yes everywhere, so right is
 * on; an off switch has nothing to say no to and moves only that way, and an on
 * one goes off whichever way it is swiped — right clears the yes, left says no.
 */
export function switchSides(on: boolean): "both" | "yes" {
  return on ? "both" : "yes";
}

/** The setting a swipe leaves the switch at, from the rating it produced. */
export function switchAfter(next: RatingValue | null): boolean {
  return next === 1;
}
