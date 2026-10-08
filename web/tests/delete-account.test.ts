import { describe, expect, it } from "bun:test";
import { confirmsDeletion } from "../src/lib/utils/auth";

describe("confirming a deletion", () => {
  it("takes the word, however it was typed", () => {
    expect(confirmsDeletion("delete")).toBe(true);
    expect(confirmsDeletion(" Delete ")).toBe(true);
  });

  it("takes nothing else", () => {
    expect(confirmsDeletion("")).toBe(false);
    expect(confirmsDeletion("delet")).toBe(false);
    expect(confirmsDeletion("delete account")).toBe(false);
  });
});
