import { describe, expect, test } from "bun:test";
import {
  type ChannelHealth,
  decideReattach,
  HEALTHY,
  NO_LOSSES,
  onChannelJoined,
  onChannelLoss,
  REATTACH_DELAYS,
  REATTACH_QUIET,
  type ReattachState,
} from "../utils/reattach";

// Walks a run of losses through the decision, returning what each one bought.
function run(
  gaps: readonly number[],
): { verdicts: string[]; delays: number[] } {
  let state: ReattachState = NO_LOSSES;
  let now = 1_000_000;
  const verdicts: string[] = [];
  const delays: number[] = [];
  for (const gap of gaps) {
    now += gap;
    const decision = decideReattach(state, now);
    verdicts.push(decision.verdict);
    if (decision.verdict === "retry") {
      delays.push(decision.delay);
      state = decision.next;
    }
  }
  return { verdicts, delays };
}

describe("reattach budget", () => {
  test("spends the delays in order, then gives up", () => {
    // Four losses in quick succession: three buy a retry, the fourth is the one
    // that finds the budget spent. Pinned because the count is easy to state
    // wrongly — three RETRIES means giving up on the fourth LOSS.
    const { verdicts, delays } = run([0, 100, 100, 100]);
    expect(delays).toEqual([...REATTACH_DELAYS]);
    expect(verdicts).toEqual(["retry", "retry", "retry", "giveUp"]);
  });

  test("stays given up once the budget is spent", () => {
    const { verdicts } = run([0, 100, 100, 100, 100, 100]);
    expect(verdicts.slice(3)).toEqual(["giveUp", "giveUp", "giveUp"]);
  });

  test("a loss after the quiet window refills the budget", () => {
    // Three retries, then silence, then a fresh incident starts over rather
    // than giving up immediately.
    const { verdicts, delays } = run([0, 100, 100, REATTACH_QUIET + 1]);
    expect(verdicts).toEqual(["retry", "retry", "retry", "retry"]);
    expect(delays).toEqual([...REATTACH_DELAYS, REATTACH_DELAYS[0]]);
  });

  test("a loss just inside the quiet window keeps spending the budget", () => {
    // The boundary is the whole point of the window, so both sides are pinned.
    const { verdicts, delays } = run([0, 100, 100, REATTACH_QUIET]);
    expect(verdicts).toEqual(["retry", "retry", "retry", "giveUp"]);
    expect(delays).toEqual([...REATTACH_DELAYS]);
  });

  test("the quiet window is measured from the last loss, not the first", () => {
    // Losses spaced just under the window never refill, however long the run
    // goes on — otherwise a slow bleed would retry forever.
    const gap = REATTACH_QUIET - 1;
    const { verdicts } = run([0, gap, gap, gap]);
    expect(verdicts).toEqual(["retry", "retry", "retry", "giveUp"]);
  });

  test("a first-ever loss retries however old the clock is", () => {
    // `lastLoss: 0` reads as a 1970 timestamp, so the very first loss always
    // looks like the end of a long quiet spell. Harmless only because the budget
    // it refills is already full, which is what this pins.
    const decision = decideReattach(NO_LOSSES, 1_000_000);
    expect(decision.verdict).toBe("retry");
    if (decision.verdict === "retry") {
      expect(decision.delay).toBe(REATTACH_DELAYS[0]);
      expect(decision.next.spent).toBe(1);
    }
  });
});

describe("the stale-screen banner", () => {
  // Losses a moment apart until the budget runs out, then whatever follows.
  function exhaust(): { health: ChannelHealth; now: number } {
    let health = HEALTHY;
    let now = 1_000_000;
    for (let loss = 0; loss < REATTACH_DELAYS.length; loss += 1) {
      const response = onChannelLoss(health, now);
      if (response.kind !== "retry") throw new Error(response.kind);
      health = response.health;
      now += 100;
    }
    return { health, now };
  }

  test("goes up once when the budget runs out", () => {
    const { health, now } = exhaust();
    const response = onChannelLoss(health, now);
    expect(response.kind).toBe("report");
    if (response.kind === "report") {
      expect(response.health.lost).toBe(true);
      // Every channel reports its own loss; the rest of the burst says nothing.
      expect(onChannelLoss(response.health, now + 1).kind).toBe("ignore");
      expect(onChannelLoss(response.health, now + 2).kind).toBe("ignore");
    }
  });

  test("comes down when a channel joins again", () => {
    const { health, now } = exhaust();
    const response = onChannelLoss(health, now);
    if (response.kind !== "report") throw new Error(response.kind);
    const joined = onChannelJoined(response.health);
    expect(joined.lost).toBe(false);
    // And a later incident is reported again rather than swallowed.
    const later = onChannelLoss(joined, now + REATTACH_QUIET + 1);
    expect(later.kind).toBe("retry");
  });

  test("a join with nothing lost changes nothing", () => {
    expect(onChannelJoined(HEALTHY)).toBe(HEALTHY);
  });
});
