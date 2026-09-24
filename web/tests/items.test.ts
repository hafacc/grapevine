import { describe, expect, it } from "bun:test";
import { searchRanges, validateItemId } from "../utils/items";

// The id IS the text somebody typed, folded (DESIGN §3.2), so what this refuses
// is exactly what the column `CHECK` refuses — and it refuses it in the field,
// before the write, rather than as an error nobody can read.
describe("validateItemId", () => {
  it("accepts a name in any script, with its accents and its spaces", () => {
    for (const typed of ["Café  Bleu", "日本", "late night", "!!!"]) {
      expect(validateItemId(typed)).toBeNull();
    }
  });

  it("refuses a name that is nothing but space", () => {
    expect(validateItemId("   ")).not.toBeNull();
  });

  it("refuses a name past the length the column allows", () => {
    expect(validateItemId("x".repeat(129))).not.toBeNull();
  });

  // A bidi override reverses the rest of the row it is drawn in, which is why
  // the refusals are a category list rather than a pattern.
  it("refuses a character no font can draw", () => {
    expect(validateItemId("caf‮eleb")).not.toBeNull();
  });
});

describe("searchRanges", () => {
  // Typing without the accent is the case the stripped range exists for, and
  // it is exactly the query that has nothing of its own to strip.
  it("reads the stripped range for a query with nothing to strip", () => {
    expect(searchRanges("cafe")).toEqual([
      { column: "id", prefix: "cafe" },
      { column: "search_id", prefix: "cafe" },
    ]);
  });

  it("reads the stripped range under the stripped prefix", () => {
    expect(searchRanges("Café B")).toEqual([
      { column: "id", prefix: "café b" },
      { column: "search_id", prefix: "cafe b" },
    ]);
  });

  it("reads no stripped range for a query that strips to nothing", () => {
    expect(searchRanges("!!!")).toEqual([{ column: "id", prefix: "!!!" }]);
  });

  it("reads nothing for an empty box", () => {
    expect(searchRanges("   ")).toEqual([]);
  });
});
