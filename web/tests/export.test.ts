import { describe, expect, it } from "bun:test";
import { exportRows } from "../src/lib/utils/export";

describe("exportRows", () => {
  it("lists every thumb by name, the thing before its attributes, each with its thing's link", () => {
    expect(
      exportRows(
        {
          "tartine bakery": { "worth the line": 1, "": 1 },
          "dune (2021 film)": { "": -1, long: 1 },
          "café bleu": { quiet: -1 },
        },
        new Map([
          ["dune (2021 film)", { source: "wikidata", ref: "Q60834962" }],
        ]),
      ),
    ).toEqual([
      { itemId: "café bleu", tag: "quiet", value: -1, reference: null },
      {
        itemId: "dune (2021 film)",
        tag: "",
        value: -1,
        reference: { source: "wikidata", ref: "Q60834962" },
      },
      {
        itemId: "dune (2021 film)",
        tag: "long",
        value: 1,
        reference: { source: "wikidata", ref: "Q60834962" },
      },
      { itemId: "tartine bakery", tag: "", value: 1, reference: null },
      { itemId: "tartine bakery", tag: "worth the line", value: 1, reference: null },
    ]);
  });
});
