import { describe, expect, it } from "bun:test";
import { glyphSide, swipeOutcome } from "../utils/swipe";

// DESIGN §1: right is yes, left is no, and swiping the way you already voted
// clears that rating — the reveal turns grey with a minus rather than green or
// red. Swiping the other way flips straight over, with no clear in between.
describe("swipeOutcome", () => {
  it("rates an unrated thing", () => {
    expect(swipeOutcome(null, "right")).toEqual({
      next: 1,
      reveal: "yes",
      glyph: "up",
    });
    expect(swipeOutcome(null, "left")).toEqual({
      next: -1,
      reveal: "no",
      glyph: "down",
    });
  });

  it("clears when swiped the way it was already rated", () => {
    expect(swipeOutcome(1, "right")).toEqual({
      next: null,
      reveal: "clear",
      glyph: "minus",
    });
    expect(swipeOutcome(-1, "left")).toEqual({
      next: null,
      reveal: "clear",
      glyph: "minus",
    });
  });

  it("flips straight over with no clear in between", () => {
    expect(swipeOutcome(-1, "right").next).toBe(1);
    expect(swipeOutcome(1, "left").next).toBe(-1);
  });

  // The gesture is its own undo, which is what lets the empty screen say
  // nothing about which direction means what.
  it("undoes itself", () => {
    const rated = swipeOutcome(null, "right").next;
    expect(swipeOutcome(rated, "right").next).toBeNull();
  });
});

describe("glyphSide", () => {
  it("pins the glyph to the side the row came from", () => {
    expect(glyphSide("right")).toBe("left");
    expect(glyphSide("left")).toBe("right");
  });
});
