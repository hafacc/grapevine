import { describe, expect, it } from "bun:test";
import { screenForHash, screenHash, stackForHash } from "../utils/store";
import type { Screen } from "../utils/types";

// Three screens, each with a URL, and a pasted one has to name the same screen
// it was copied from — the fragment is the only routing this static export has.
describe("screenHash / screenForHash", () => {
  const screens: readonly Screen[] = [
    { kind: "list" },
    { kind: "people" },
    { kind: "item", id: "café bleu" },
  ];

  it.each(screens.map((screen) => [screenHash(screen), screen]))(
    "round-trips %p",
    (hash, screen) => {
      expect(screenForHash(hash as string)).toEqual(screen as Screen);
    },
  );

  it("writes the list as the bare fragment", () => {
    expect(screenHash({ kind: "list" })).toBe("#/");
    expect(screenForHash("#/")).toEqual({ kind: "list" });
  });

  it("escapes a thing whose id has a space and an accent in it", () => {
    expect(screenHash({ kind: "item", id: "café bleu" })).toBe(
      "#/item/caf%C3%A9%20bleu",
    );
  });

  // The id is the text somebody typed, folded, so a link written with the name
  // in it opens the thing rather than a screen saying nothing goes by that name.
  it("folds a thing's id written as somebody would type it", () => {
    expect(screenForHash("#/item/Caf%C3%A9%20%20BLEU")).toEqual({
      kind: "item",
      id: "café bleu",
    });
  });

  it("refuses an id no row could hold", () => {
    expect(screenForHash(`#/item/${"x".repeat(129)}`)).toBe(null);
  });

  it.each([
    "#/nowhere",
    "#/people/abc123",
    "#/item/one/two",
    "#/%zz",
  ])("names no screen for %p", (hash) => {
    expect(screenForHash(hash)).toBe(null);
  });
});

describe("stackForHash", () => {
  // Arriving on a thing means arriving with a way back, and there is one place
  // to go back to.
  it("seeds the list under a thing", () => {
    expect(stackForHash("#/item/caf%C3%A9%20bleu")).toEqual([
      { kind: "list" },
      { kind: "item", id: "café bleu" },
    ]);
  });

  it("seeds the list under the people screen", () => {
    expect(stackForHash("#/people")).toEqual([
      { kind: "list" },
      { kind: "people" },
    ]);
  });

  it("leaves the list alone", () => {
    expect(stackForHash("#/")).toEqual([{ kind: "list" }]);
  });

  it("reads an unroutable fragment as the list", () => {
    expect(stackForHash("#/nowhere")).toEqual([{ kind: "list" }]);
  });
});
