import type { RatingValue } from "./types";

// The people screen's two switches: findable by handle (`profiles.searchable`)
// and shown in friend suggestions (`user_prefs.discoverable_by_taste`).
export type Switches = {
  // Whether the account has a handle at all.
  readonly claimed: boolean;
  readonly findable: boolean;
  readonly discoverable: boolean;
};

export type SwitchWrite = {
  readonly name: keyof Switches;
  readonly on: boolean;
};

/**
 * The writes one swipe on a switch makes, in the order they are made.
 *
 * Suggestable means findable: a request to someone who is not `searchable` is
 * refused by the `connect_requests` insert policy, so suggesting them would put
 * a row on somebody's screen whose yes side always fails. So turning findable
 * off takes suggestions with it, and turning suggestions on while unfindable
 * turns findable on too. Findable is on whenever suggestions are, between the
 * two writes as well — which is what fixes their order.
 *
 * Neither comes on without a handle: `profiles_searchable_needs_handle` refuses
 * findable, and so suggestions with it. The screen offers neither switch until
 * one is claimed, so this answers "nothing to write" rather than a write the
 * database will refuse.
 */
export function switchWrites(
  current: Switches,
  name: keyof Switches,
  on: boolean,
): SwitchWrite[] {
  if (on && !current.claimed) {
    return [];
  } else if (name === "findable" && !on && current.discoverable) {
    return [
      { name: "discoverable", on: false },
      { name: "findable", on: false },
    ];
  } else if (name === "discoverable" && on && !current.findable) {
    return [
      { name: "findable", on: true },
      { name: "discoverable", on: true },
    ];
  } else {
    return [{ name, on }];
  }
}

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
