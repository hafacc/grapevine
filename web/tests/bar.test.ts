import { describe, expect, it } from "bun:test";
import { fillFor, fillTone, SEGMENTS, segmentFills } from "../utils/bar";

// DESIGN §1 "The bar": map s to (s + 1) / 2, round that to a multiple of q, and
// fill four segments with it. q is `user_recs.error / 2` — the error is already
// on the score's own scale, so the halving is all that is left.
describe("fillFor", () => {
  it("puts a middling score in the middle", () => {
    expect(fillFor(0, 0.02)).toBeCloseTo(0.5, 10);
  });

  it("fills nothing at the bottom and everything at the top", () => {
    expect(fillFor(-1, 0.02)).toBe(0);
    expect(fillFor(1, 0.02)).toBe(1);
  });

  it("rounds to the step rather than to the segment", () => {
    // 0.625 of the way up lands inside the third segment, not on its edge.
    expect(fillFor(0.25, 0.02)).toBeCloseTo(0.62, 10);
    expect(fillFor(0.27, 0.02)).toBeCloseTo(0.64, 10);
  });

  it("cannot move by less than the step", () => {
    const coarse = 0.25;
    expect(fillFor(0.11, coarse)).toBe(fillFor(0.2, coarse));
  });

  it("clamps a score from outside the scale", () => {
    expect(fillFor(-4, 0.02)).toBe(0);
    expect(fillFor(4, 0.02)).toBe(1);
  });

  // A default step would be a silent claim about how accurate the walk was, so
  // there is none: no step means nothing to draw.
  it("says nothing without a step", () => {
    expect(fillFor(0.5, null)).toBeNull();
    expect(fillFor(0.5, 0)).toBeNull();
    expect(fillFor(0.5, -0.1)).toBeNull();
    expect(fillFor(0.5, Number.NaN)).toBeNull();
  });

  it("says nothing about a score that is not a number", () => {
    expect(fillFor(Number.NaN, 0.02)).toBeNull();
    expect(fillFor(Number.POSITIVE_INFINITY, 0.02)).toBeNull();
  });
});

describe("segmentFills", () => {
  it("fills left to right", () => {
    expect(segmentFills(0)).toEqual([0, 0, 0, 0]);
    expect(segmentFills(1)).toEqual([1, 1, 1, 1]);
    expect(segmentFills(0.5)).toEqual([1, 1, 0, 0]);
  });

  it("part-fills the segment a value lands in", () => {
    expect(segmentFills(0.62)).toEqual([1, 1, 0.48, 0]);
  });

  it("always describes every segment", () => {
    expect(segmentFills(0.3)).toHaveLength(SEGMENTS);
  });
});

describe("fillTone", () => {
  it("is danger at or below the midpoint and accent above it", () => {
    expect(fillTone(0)).toBe("danger");
    expect(fillTone(0.5)).toBe("danger");
    expect(fillTone(0.52)).toBe("accent");
    expect(fillTone(1)).toBe("accent");
  });
});
