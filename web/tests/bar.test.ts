import { describe, expect, it } from "bun:test";
import {
  cautiousScore,
  fillFor,
  fillTone,
  SEGMENTS,
  segmentFills,
} from "../src/lib/utils/bar";

// DESIGN §1 "The bar": map the value to (v + 1) / 2 and fill four segments with
// it, as it is.
describe("fillFor", () => {
  it("puts a middling value in the middle", () => {
    expect(fillFor(0)).toBeCloseTo(0.5, 10);
  });

  it("fills nothing at the bottom and everything at the top", () => {
    expect(fillFor(-1)).toBe(0);
    expect(fillFor(1)).toBe(1);
  });

  it("draws the value itself, with no step", () => {
    expect(fillFor(0.25)).toBeCloseTo(0.625, 10);
    expect(fillFor(0.2501)).toBeGreaterThan(fillFor(0.25) ?? 1);
  });

  it("clamps a value from outside the scale", () => {
    expect(fillFor(-4)).toBe(0);
    expect(fillFor(4)).toBe(1);
  });

  it("says nothing about a missing value, or one that is not a number", () => {
    expect(fillFor(null)).toBeNull();
    expect(fillFor(Number.NaN)).toBeNull();
    expect(fillFor(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

// The posterior mean with W thumbs of evidence and one pseudo-thumb of prior,
// on the bar's scale: s · W / (1 + W).
describe("cautiousScore", () => {
  it("is high only with a high score and much behind it", () => {
    expect(cautiousScore(0.9, 9)).toBeCloseTo(0.81, 10);
    expect(cautiousScore(0.9, 0.1)).toBeCloseTo(0.9 / 11, 10);
    expect(cautiousScore(0.9, 9) ?? 0).toBeGreaterThan(
      cautiousScore(0.9, 0.1) ?? 1,
    );
  });

  it("ranks a strong score with little behind it below a milder, well-supported one", () => {
    expect(cautiousScore(0.95, 0.2) ?? 1).toBeLessThan(
      cautiousScore(0.5, 5) ?? 0,
    );
  });

  // A lower quantile would draw a thing little stands behind as disliked.
  it("pulls a dislike toward the middle as well, not past it", () => {
    expect(cautiousScore(-0.9, 1)).toBeCloseTo(-0.45, 10);
    expect(cautiousScore(-0.9, 0.1) ?? -1).toBeGreaterThan(-0.1);
  });

  it("draws an attribute's score, which carries no weight, as it is", () => {
    expect(cautiousScore(0.6, null)).toBe(0.6);
  });

  // `W = 0` is a thing carried only by an attribute of it: its own score is
  // the prior, which the bar draws as nothing known.
  it("has nothing to draw with no score, no evidence, or a number that is not one", () => {
    expect(cautiousScore(null, 3)).toBeNull();
    expect(cautiousScore(0, 0)).toBeNull();
    expect(cautiousScore(0.5, -1)).toBeNull();
    expect(cautiousScore(0.5, Number.NaN)).toBeNull();
    expect(cautiousScore(Number.NaN, 3)).toBeNull();
  });

  it("is the score itself with unbounded evidence", () => {
    expect(cautiousScore(0.7, Number.POSITIVE_INFINITY)).toBe(0.7);
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
