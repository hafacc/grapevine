import { describe, expect, it } from "bun:test";
import {
  currentRank,
  LEAST_RANK,
  MOST_RANK,
  nearestRank,
  rankCell,
  setRank,
  USUAL_RANK,
} from "../src/lib/utils/taste-rank";

describe("nearestRank", () => {
  it("is the rank itself where the core is built for it", () => {
    for (let rank = LEAST_RANK; rank <= MOST_RANK; rank += 1)
      expect(nearestRank(rank)).toBe(rank);
  });

  it("holds anything else to the nearest one that is", () => {
    expect(nearestRank(0)).toBe(LEAST_RANK);
    expect(nearestRank(-3)).toBe(LEAST_RANK);
    expect(nearestRank(99)).toBe(MOST_RANK);
    expect(nearestRank(2.4)).toBe(2);
  });

  it("reads what is not a number as the usual rank", () => {
    expect(nearestRank(Number.NaN)).toBe(USUAL_RANK);
    expect(nearestRank(Number("three"))).toBe(USUAL_RANK);
  });
});

// No storage here, as in a private window: the rank is kept for the visit.
describe("setRank", () => {
  it("starts at the usual rank and says whether it changed", () => {
    expect(currentRank()).toBe(USUAL_RANK);
    expect(setRank(USUAL_RANK)).toBe(false);
    expect(setRank(USUAL_RANK + 1)).toBe(true);
    expect(rankCell.get()).toBe(USUAL_RANK + 1);
  });

  it("stops at either end", () => {
    setRank(MOST_RANK);
    expect(setRank(MOST_RANK + 1)).toBe(false);
    setRank(LEAST_RANK);
    expect(setRank(LEAST_RANK - 1)).toBe(false);
    expect(currentRank()).toBe(LEAST_RANK);
  });
});
