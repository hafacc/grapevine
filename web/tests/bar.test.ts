import { describe, expect, it } from "bun:test";
import {
  barValue,
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

// The core's score is the chance itself, every doubt already inside it, so
// the bar draws it as it is.
describe("barValue", () => {
  it("is the score itself", () => {
    expect(barValue(0.9)).toBe(0.9);
    expect(barValue(-0.45)).toBe(-0.45);
    expect(barValue(0)).toBe(0);
  });

  it("has nothing to draw with no score, or a number that is not one", () => {
    expect(barValue(null)).toBeNull();
    expect(barValue(Number.NaN)).toBeNull();
    expect(barValue(Number.POSITIVE_INFINITY)).toBeNull();
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
