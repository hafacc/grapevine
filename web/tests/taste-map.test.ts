import { describe, expect, it } from "bun:test";
import {
  choose,
  DOTS,
  flat,
  LIKING,
  NO_PLOT,
  NOTHING,
  nearest,
  placeAt,
  placeFlat,
  pointsOf,
  ratedThings,
  readPlot,
  shade,
  step,
  trimPlot,
} from "../src/lib/utils/taste-map";

describe("readPlot", () => {
  it("keeps every point that is one to six finite numbers", () => {
    const plot = readPlot({
      things: {
        a: [1, 2],
        b: [1],
        c: [1, Number.NaN],
        d: "no",
        e: [1, "2"],
        f: [1, 2, 3],
        g: [1, 2, 3, 4, 5, 6, 7],
        h: [],
        i: [4],
      },
      attributes: { "": [0, 1], cozy: [3, 4] },
    });
    expect(plot.things).toEqual({ a: [1, 2], b: [1], f: [1, 2, 3], i: [4] });
    expect(plot.attributes).toEqual({ "": [0, 1], cozy: [3, 4] });
  });

  it("reads what is not a plot as an empty one", () => {
    expect(readPlot(undefined)).toEqual(NO_PLOT);
    expect(readPlot({ things: 3 })).toEqual(NO_PLOT);
  });

  it("holds a thing named like a property of every object", () => {
    const plot = readPlot(
      JSON.parse('{"things":{"__proto__":[1,1]},"attributes":{}}'),
    );
    expect(Object.hasOwn(plot.things, "__proto__")).toBe(true);
  });
});

describe("a plot of rank two", () => {
  const plot = {
    things: { up: [2, 0], down: [-1, 0], side: [0, 1], centre: [0, 0] },
    attributes: {
      [LIKING]: [3, 0],
      cozy: [0, 2],
      loud: [0.5, 0],
      unused: [9, 9],
    },
  };
  const chosen = choose(plot, new Set(["down"]), new Set(["cozy", "loud"]));
  const dots = placeFlat(chosen);
  const dot = (id: string) => dots.find((one) => one.thing.id === id);

  it("is places already", () => {
    expect(flat(chosen)).toBe(true);
  });

  it("is turned so that more liked is up", () => {
    expect(dot("up")?.x).toBeCloseTo(0, 10);
    expect(dot("up")?.y).toBeGreaterThan(0);
    expect(dot("down")?.y).toBeLessThan(0);
  });

  it("leaves a thing nothing is said of out, and marks the viewer's own", () => {
    expect(dot("centre")).toBeUndefined();
    expect(dot("down")?.thing.own).toBe(true);
    expect(dot("up")?.thing.own).toBe(false);
  });

  it("colors a thing by which side of the chip it is on", () => {
    const side = dot("side")?.thing;
    expect(side).toBeDefined();
    if (!side) return;
    // `side` is at right angles to liking and along `cozy`.
    expect(shade(side, chosen.facing[LIKING] ?? [])).toBeCloseTo(0, 10);
    expect(shade(side, chosen.facing.cozy ?? [])).toBeGreaterThan(0);
  });

  it("offers liking first, then the viewer's own attributes, longest first", () => {
    expect(chosen.chips).toEqual([LIKING, "cozy", "loud"]);
  });

  it("holds every dot inside the square", () => {
    for (const one of dots)
      expect(Math.hypot(one.x, one.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("a plot of rank three", () => {
  const plot = {
    things: { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, -1] },
    attributes: { [LIKING]: [0, 0, 2], cozy: [1, 0, 0] },
  };
  const chosen = choose(plot, new Set(), new Set(["cozy"]));

  it("has to be laid out, and is drawn where the layout says", () => {
    expect(flat(chosen)).toBe(false);
    expect(Object.keys(pointsOf(chosen)).sort()).toEqual(["a", "b", "c"]);
    const dots = placeAt(chosen, { a: [0.5, 0.5], b: [-1, 0], c: [1, "x"] as never });
    expect(dots.map((dot) => [dot.thing.id, dot.x, dot.y])).toEqual([
      ["a", 0.5, 0.5],
      ["b", -1, 0],
    ]);
  });

  it("colors by all three numbers", () => {
    const thing = (id: string) =>
      chosen.things.find((one) => one.id === id) ?? chosen.things[0];
    expect(shade(thing("c"), chosen.facing[LIKING] ?? [])).toBe(-1);
    expect(shade(thing("a"), chosen.facing[LIKING] ?? [])).toBeCloseTo(0, 10);
    expect(shade(thing("a"), chosen.facing.cozy ?? [])).toBe(1);
  });
});

describe("choose", () => {
  const many = (count: number, prefix: string): Record<string, number[]> => {
    const things: Record<string, number[]> = {};
    for (let index = 0; index < count; index += 1)
      things[`${prefix}${index}`] = [1 + index, 1, 0];
    return things;
  };
  const liking = { [LIKING]: [1, 0, 0] };

  it("draws the viewer's own things before anybody else's", () => {
    const things = { ...many(DOTS + 50, "t"), mine: [0.001, 0.001, 0] };
    const big = choose({ things, attributes: liking }, new Set(["mine"]), new Set());
    expect(big.things.length).toBe(DOTS);
    expect(big.things.some((one) => one.id === "mine")).toBe(true);
  });

  it("never draws more than a map holds, however many the viewer rated", () => {
    const things = { ...many(DOTS + 50, "own"), ...many(40, "other") };
    const rated = new Set(Object.keys(things).filter((id) => id.startsWith("own")));
    const big = choose({ things, attributes: liking }, rated, new Set());
    expect(big.things.length).toBe(DOTS);
    expect(big.things.every((one) => one.own)).toBe(true);
    // The ones left out are the nearest the centre.
    expect(big.things.some((one) => one.id === "own0")).toBe(false);
    expect(big.things.some((one) => one.id === `own${DOTS + 49}`)).toBe(true);
  });

  it("is nothing to draw when no thing has a point", () => {
    expect(choose(NO_PLOT, new Set(), new Set())).toEqual(NOTHING);
  });
});

describe("trimPlot", () => {
  it("keeps what a map could draw and every attribute", () => {
    const things: Record<string, number[]> = {};
    for (let index = 0; index < 2 * DOTS + 10; index += 1) {
      things[`own${index}`] = [1 + index, 0];
      things[`other${index}`] = [1 + index, 0];
    }
    things.nothing = [0, 0];
    const rated = new Set(Object.keys(things).filter((id) => id.startsWith("own")));
    const attributes = { [LIKING]: [1, 0], cozy: [0, 1] };
    const kept = trimPlot({ things, attributes }, rated);
    expect(Object.keys(kept.things).length).toBe(2 * DOTS);
    expect(Object.hasOwn(kept.things, "nothing")).toBe(false);
    expect(Object.hasOwn(kept.things, "own0")).toBe(false);
    expect(kept.attributes).toEqual(attributes);
    // What is drawn from the cut plot is what would be drawn from the whole.
    expect(choose(kept, rated, new Set()).things).toEqual(
      choose({ things, attributes }, rated, new Set()).things,
    );
  });
});

describe("ratedThings", () => {
  it("is the things with a thumb on the thing itself", () => {
    const rated = ratedThings({ a: { "": 1 }, b: { cozy: 1 }, c: { "": -1, cozy: 1 } });
    expect([...rated].sort()).toEqual(["a", "c"]);
  });
});

describe("nearest", () => {
  const thing = { id: "a", point: [0, 0], own: false };
  const dots = [
    { thing, x: 0, y: 0.9 },
    { thing: { ...thing, id: "b" }, x: 0.1, y: -0.1 },
  ];

  it("finds the dot under a tap, and none where there is none", () => {
    expect(nearest(dots, 0.02, 0.85, 0.1)?.thing.id).toBe("a");
    expect(nearest(dots, -0.8, -0.8, 0.1)).toBeNull();
  });
});

describe("step", () => {
  const thing = { id: "a", point: [0, 0], own: false };
  const dot = (id: string, x: number, y: number) => ({
    thing: { ...thing, id },
    x,
    y,
  });
  const dots = [dot("near", 0.2, 0.05), dot("far", 0.8, 0), dot("up", 0, 0.5)];

  it("lands on the nearest dot that way", () => {
    expect(step(dots, { x: 0, y: 0 }, [1, 0])?.thing.id).toBe("near");
    expect(step(dots, { x: 0.2, y: 0.05 }, [1, 0])?.thing.id).toBe("far");
    expect(step(dots, { x: 0, y: 0 }, [0, 1])?.thing.id).toBe("up");
  });

  it("stays put where there is nothing that way", () => {
    expect(step(dots, { x: 0, y: 0 }, [-1, 0])).toBeNull();
    expect(step(dots, { x: 0.8, y: 0 }, [1, 0])).toBeNull();
  });
});
