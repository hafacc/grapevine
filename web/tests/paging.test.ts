import { describe, expect, it } from "bun:test";
import { readAllPages } from "../utils/paging";

// A table of `total` rows served `size` at a time, as PostgREST's `range` does.
function table(total: number) {
  const rows = Array.from({ length: total }, (_, index) => index);
  const asked: [number, number][] = [];
  const page = async (from: number, to: number): Promise<number[]> => {
    asked.push([from, to]);
    return rows.slice(from, to + 1);
  };
  return { rows, asked, page };
}

describe("readAllPages", () => {
  it("reads past the first capped page", async () => {
    const { rows, asked, page } = table(2_500);
    expect(await readAllPages(page, 1_000)).toEqual(rows);
    expect(asked).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
  });

  it("asks once more when the last page is exactly full", async () => {
    const { rows, asked, page } = table(2_000);
    expect(await readAllPages(page, 1_000)).toEqual(rows);
    expect(asked.length).toBe(3);
  });

  it("stops at an empty first page", async () => {
    const { asked, page } = table(0);
    expect(await readAllPages(page, 1_000)).toEqual([]);
    expect(asked.length).toBe(1);
  });

  it("lets a failed page fail the read", async () => {
    await expect(
      readAllPages(async (from) => {
        if (from > 0) throw new Error("gone");
        return [1, 2];
      }, 2),
    ).rejects.toThrow("gone");
  });
});

describe("readAllPages against a server that ignores the range", () => {
  it("takes the whole answer once rather than asking forever", async () => {
    let asked = 0;
    const rows = await readAllPages(async () => {
      asked += 1;
      return [1, 2, 3];
    }, 2);
    expect(rows).toEqual([1, 2, 3]);
    expect(asked).toBe(1);
  });
});
