import { describe, expect, it } from "bun:test";
import { isDailyLimit } from "../utils/supabase";

// The code `private.count_write` raises. A refusal read as a generic failure
// tells somebody to try again, which will fail the same way until tomorrow.
describe("isDailyLimit", () => {
  it("recognizes the budget's refusal", () => {
    expect(
      isDailyLimit({ code: "PT429", message: "daily write limit reached" }),
    ).toBe(true);
  });

  it("is not every refusal", () => {
    expect(isDailyLimit({ code: "42501" })).toBe(false);
    expect(isDailyLimit({ status: 429 })).toBe(false);
    expect(isDailyLimit(null)).toBe(false);
  });
});
