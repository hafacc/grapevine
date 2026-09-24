// The *suggested* rail's estimator (DESIGN §2.11). The histories below are
// small enough to work out by hand, and the expected list is written out
// rather than recomputed: a test that redoes the arithmetic agrees with any
// mistake in it.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_SUGGESTIONS,
  ownAttributes,
  type RatedAttributes,
  suggestAttributes,
} from "../src/suggest-attributes";

// coffee is on four things, quiet on three, wifi on two, cheap on one. The
// thumbs-down on `wifi` and on `quiet` are there to be counted: without them
// wifi and cheap are carried by one thing each and the last two proposals swap.
const HISTORY: RatedAttributes = {
  "blue bottle": { "": 1, coffee: 1, wifi: 1 },
  "corner cafe": { "": -1, coffee: 1, quiet: 1 },
  "reading room": { "": 1, coffee: 1, wifi: -1 },
  kiosk: { coffee: 1 },
  "night owl": { "": 1, quiet: -1 },
  "the annex": { "": 1, quiet: 1, cheap: 1 },
};

describe("suggestAttributes", () => {
  it("takes the most-used, then what it missed, then the cascade", () => {
    // coffee covers blue bottle, corner cafe, reading room and kiosk. quiet is
    // next because it reaches the two things coffee did not (night owl, the
    // annex) where cheap reaches one and wifi none. With everything covered
    // once, wifi covers two things a second time and cheap one, so the concave
    // weight keeps going where plain coverage would stall — and nothing is
    // proposed twice.
    expect(suggestAttributes(HISTORY, [])).toEqual([
      "coffee",
      "quiet",
      "wifi",
      "cheap",
    ]);
  });

  it("proposes nothing past the words the viewer has used", () => {
    // Four candidates and four proposals: the list is short because the
    // vocabulary is, not because a floor cut it.
    expect(suggestAttributes(HISTORY, []).length).toBe(4);
  });

  it("holds five", () => {
    const wordy: RatedAttributes = {
      one: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 },
      two: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 },
    };
    expect(suggestAttributes(wordy, [])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ] as string[]);
    expect(suggestAttributes(wordy, []).length).toBe(MAX_SUGGESTIONS);
  });

  it("narrows to the things carrying what the viewer said here", () => {
    // With wifi rated on the thing being shown, only the two things that also
    // carry wifi weigh anything, and coffee is all they have.
    expect(suggestAttributes(HISTORY, ["wifi"])).toEqual(["coffee"]);
  });

  it("weights a partial overlap rather than filtering on it", () => {
    // Only `corner cafe` carries both of these, and it carries nothing else —
    // so a rule that asked a thing to carry all of `A` would propose nothing.
    // Everything carrying one of the two counts a half, which is where wifi and
    // cheap come from.
    expect(suggestAttributes(HISTORY, ["coffee", "quiet"])).toEqual([
      "wifi",
      "cheap",
    ]);
  });

  it("has no floor", () => {
    expect(suggestAttributes({ kiosk: { coffee: 1 } }, [])).toEqual(["coffee"]);
    expect(suggestAttributes({ kiosk: { "": 1 } }, [])).toEqual([]);
    expect(suggestAttributes({}, [])).toEqual([]);
  });

  it("proposes nothing the viewer has already answered here", () => {
    expect(suggestAttributes(HISTORY, ["coffee"])).not.toContain("coffee");
  });
});

// The whole of the poisoning defence: what somebody else put on a thing reaches
// neither argument, so it cannot move the row. The fixture is built so that it
// WOULD move the row if it did — otherwise this passes on a function that
// ignores its second argument.
describe("only the viewer's own attributes condition the row", () => {
  const SHOWN = "café bleu";
  const HISTORY_WITH_ITEM: RatedAttributes = {
    [SHOWN]: { "": 1, wifi: 1 },
    "blue bottle": { coffee: 1, wifi: 1 },
    "reading room": { coffee: 1, wifi: 1 },
    "corner cafe": { coffee: 1, quiet: 1 },
    "night owl": { loud: 1, tea: 1 },
    "the annex": { loud: 1, tea: 1 },
    kiosk: { loud: 1, tea: 1 },
  };

  // What the client does: the thing's attributes come off the viewer's own
  // ratings, and the screen's list of attributes is not an input at all.
  const row = (history: RatedAttributes): string[] =>
    suggestAttributes(history, ownAttributes(history, SHOWN));

  it("ignores an attribute somebody else rated on the thing", () => {
    // `loud` is on the screen because other people rated it there.
    const shownOnScreen = ["wifi", "loud"];
    expect(ownAttributes(HISTORY_WITH_ITEM, SHOWN)).toEqual(["wifi"]);
    expect(row(HISTORY_WITH_ITEM)).toEqual(["coffee"]);
    // And it is not that `loud` says nothing: conditioning on it moves the row,
    // which is exactly what the viewer's own ratings are the only source of.
    expect(suggestAttributes(HISTORY_WITH_ITEM, shownOnScreen)).toEqual([
      "tea",
      "coffee",
    ]);
  });

  it("moves when the viewer rates that attribute themselves", () => {
    const rated: RatedAttributes = {
      ...HISTORY_WITH_ITEM,
      [SHOWN]: { "": 1, wifi: 1, loud: 1 },
    };
    expect(row(rated)).toEqual(["tea", "coffee"]);
  });
});

describe("the estimator's module", () => {
  it("names nothing on a server", () => {
    const source = readFileSync(
      new URL("../src/suggest-attributes.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/neighbourhood|visit_mass|user_recs|supabase/);
    // It imports nothing at all, which is the strongest form of "local": there
    // is no module it could reach a server through.
    expect(source).not.toMatch(/^import\s/m);
  });
});
