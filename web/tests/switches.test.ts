import { describe, expect, it } from "bun:test";
import { swipeOutcome } from "../utils/swipe";
import { switchAfter, switchSides } from "../utils/switches";

// A switch line is swiped like a rated row, and what a swipe does to it is
// read off the rating the swipe would produce.
describe("a switch line", () => {
  const swiped = (on: boolean, direction: "left" | "right"): boolean =>
    switchAfter(swipeOutcome(on ? 1 : null, direction).next);

  it("comes on with a swipe right", () => {
    expect(swiped(false, "right")).toBe(true);
  });

  it("goes off with a swipe either way", () => {
    expect(swiped(true, "right")).toBe(false);
    expect(swiped(true, "left")).toBe(false);
  });

  it("moves only the way that changes it while it is off", () => {
    // Off, a swipe left would say no to a switch that is already no, and at
    // desktop width that would be a button that does nothing.
    expect(switchSides(false)).toBe("yes");
    expect(switchSides(true)).toBe("both");
  });
});
