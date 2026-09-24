import { describe, expect, it } from "bun:test";
import { isTransient, retryTransient } from "../utils/supabase";

const noWait = async (): Promise<void> => {};

describe("isTransient", () => {
  it("is the clock-skew refusal and a request that never arrived", () => {
    expect(isTransient({ code: "PGRST303", message: "JWT issued at future" }))
      .toBe(true);
    expect(isTransient({ code: "", message: "TypeError: Failed to fetch" }))
      .toBe(true);
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient({ name: "FunctionsFetchError", message: "x" })).toBe(
      true,
    );
  });

  it("is not a refusal the server meant", () => {
    expect(isTransient({ code: "42501", message: "permission denied" })).toBe(
      false,
    );
    expect(isTransient({ code: "PT429" })).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("retryTransient", () => {
  it("answers with the first read that succeeds", async () => {
    let calls = 0;
    const waited: number[] = [];
    const answer = await retryTransient(
      async () => {
        calls += 1;
        if (calls < 3) throw { code: "PGRST303" };
        return "row";
      },
      [1_000, 3_000],
      async (ms) => {
        waited.push(ms);
      },
    );
    expect(answer).toBe("row");
    expect(waited).toEqual([1_000, 3_000]);
  });

  it("gives up after the last delay with the last failure", async () => {
    let calls = 0;
    const failing = retryTransient(
      async () => {
        calls += 1;
        throw { code: "PGRST303", attempt: calls };
      },
      [1, 1],
      noWait,
    );
    await expect(failing).rejects.toEqual({ code: "PGRST303", attempt: 3 });
  });

  it("does not repeat a read the server refused on purpose", async () => {
    let calls = 0;
    const refused = retryTransient(
      async () => {
        calls += 1;
        throw { code: "42501" };
      },
      [1, 1],
      noWait,
    );
    await expect(refused).rejects.toEqual({ code: "42501" });
    expect(calls).toBe(1);
  });
});
