import { describe, expect, it } from "bun:test";
import { swipeOutcome } from "../utils/swipe";
import { switchAfter, switchSides, switchWrites } from "../utils/switches";

describe("switchWrites", () => {
  it("turns suggestions off before findable goes off", () => {
    expect(
      switchWrites({ claimed: true, findable: true, discoverable: true }, "findable", false),
    ).toEqual([
      { name: "discoverable", on: false },
      { name: "findable", on: false },
    ]);
  });

  it("turns findable on before suggestions come on", () => {
    expect(
      switchWrites({ claimed: true, findable: false, discoverable: false }, "discoverable", true),
    ).toEqual([
      { name: "findable", on: true },
      { name: "discoverable", on: true },
    ]);
  });

  it("turns nothing on without a handle", () => {
    expect(
      switchWrites(
        { claimed: false, findable: false, discoverable: false },
        "discoverable",
        true,
      ),
    ).toEqual([]);
    expect(
      switchWrites(
        { claimed: false, findable: false, discoverable: false },
        "findable",
        true,
      ),
    ).toEqual([]);
  });

  it("touches only the one switch when the other already agrees", () => {
    expect(
      switchWrites({ claimed: true, findable: true, discoverable: false }, "findable", false),
    ).toEqual([{ name: "findable", on: false }]);
    expect(
      switchWrites({ claimed: true, findable: true, discoverable: false }, "discoverable", true),
    ).toEqual([{ name: "discoverable", on: true }]);
    expect(
      switchWrites({ claimed: true, findable: false, discoverable: false }, "findable", true),
    ).toEqual([{ name: "findable", on: true }]);
    expect(
      switchWrites({ claimed: true, findable: true, discoverable: true }, "discoverable", false),
    ).toEqual([{ name: "discoverable", on: false }]);
  });
});

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
