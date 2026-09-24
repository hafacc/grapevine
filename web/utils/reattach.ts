// When to re-attach a Realtime channel the server dropped. Split from the store
// because the effect around it needs React, a live client and a clock, and this
// needs none of them.

// Backing off rather than retrying flat: the first failure is usually a race
// that has already resolved, and nothing still failing at six seconds is a race.
export const REATTACH_DELAYS: readonly number[] = [500, 2_000, 6_000];
// A loss this long after the previous one starts a new budget. Without it, one
// hiccup early in a long session leaves it permanently one loss from giving up.
export const REATTACH_QUIET = 60_000;

export type ReattachState = {
  // Indexes REATTACH_DELAYS, so it is also how many retries are left.
  readonly spent: number;
  readonly lastLoss: number; // 0 is the initial state, not 1970
};

export const NO_LOSSES: ReattachState = { spent: 0, lastLoss: 0 };

export type ReattachDecision =
  | {
      readonly verdict: "retry";
      readonly delay: number;
      readonly next: ReattachState;
    }
  // Retrying into a standing refusal only hammers it, so the caller tells the
  // user instead.
  | { readonly verdict: "giveUp" };

// `now` is a parameter so a test can walk the clock.
export function decideReattach(
  state: ReattachState,
  now: number,
): ReattachDecision {
  const spent = now - state.lastLoss > REATTACH_QUIET ? 0 : state.spent;
  const delay = REATTACH_DELAYS[spent];
  if (delay === undefined) {
    return { verdict: "giveUp" };
  } else {
    return {
      verdict: "retry",
      delay,
      next: { spent: spent + 1, lastLoss: now },
    };
  }
}

/**
 * The retry budget and whether the screen has been told it may be stale.
 *
 * `lost` is what the banner shows, so it clears the moment a channel joins
 * again: a reconnection that happens without a reload is still a
 * reconnection, and a banner that outlives it says something untrue.
 */
export type ChannelHealth = {
  readonly budget: ReattachState;
  readonly lost: boolean;
};

export const HEALTHY: ChannelHealth = { budget: NO_LOSSES, lost: false };

export type LossResponse =
  | {
      readonly kind: "retry";
      readonly delay: number;
      readonly health: ChannelHealth;
    }
  // The budget ran out for this incident: say so, once.
  | { readonly kind: "report"; readonly health: ChannelHealth }
  // Already said. Every channel reports its own loss, so without this one
  // incident is one diagnostic per channel.
  | { readonly kind: "ignore" };

export function onChannelLoss(
  health: ChannelHealth,
  now: number,
): LossResponse {
  if (health.lost) return { kind: "ignore" };
  const decision = decideReattach(health.budget, now);
  if (decision.verdict === "giveUp") {
    return { kind: "report", health: { ...health, lost: true } };
  } else {
    return {
      kind: "retry",
      delay: decision.delay,
      health: { budget: decision.next, lost: false },
    };
  }
}

// The budget is left as it is: `REATTACH_QUIET` is what decides whether a later
// loss is the same incident, and a channel that joins and drops again at once is.
export function onChannelJoined(health: ChannelHealth): ChannelHealth {
  return health.lost ? { ...health, lost: false } : health;
}
