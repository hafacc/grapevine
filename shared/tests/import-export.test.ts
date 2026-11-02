import { describe, expect, it } from "bun:test";

import { parseCsv } from "../src/import/csv";
import { type ExportedRating, ratingsCsv } from "../src/import/export";

const RATINGS: ExportedRating[] = [
  {
    itemId: "dune (2021 film)",
    tag: "",
    value: 1,
    reference: { source: "wikidata", ref: "Q60834962" },
  },
  { itemId: "dune (2021 film)", tag: "long", value: -1, reference: null },
  {
    itemId: 'joe\'s pizza (carmine street, "the village")',
    tag: "",
    value: -1,
    reference: { source: "osm", ref: "n931799207" },
  },
  { itemId: "café bleu", tag: "", value: 1, reference: null },
  { itemId: "+1 (album)", tag: "@home", value: 1, reference: null },
];

describe("ratingsCsv", () => {
  it("round-trips through the reader", () => {
    expect(parseCsv(ratingsCsv(RATINGS))).toEqual([
      ["name", "attribute", "rating", "source", "id", "link"],
      [
        "dune (2021 film)",
        "",
        "yes",
        "wikidata",
        "Q60834962",
        "https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q60834962",
      ],
      ["dune (2021 film)", "long", "no", "", "", ""],
      [
        'joe\'s pizza (carmine street, "the village")',
        "",
        "no",
        "osm",
        "n931799207",
        "https://www.openstreetmap.org/node/931799207",
      ],
      ["café bleu", "", "yes", "", "", ""],
      ["'+1 (album)", "'@home", "yes", "", "", ""],
    ]);
  });

  it("starts with a BOM and ends each row with CRLF", () => {
    const csv = ratingsCsv(RATINGS.slice(0, 1));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("Q60834962\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it.each(["=1+1", "+1", "-1", "@sum", "\tx"])(
    "does not let %p run as a formula",
    (name) => {
      const [, row] = parseCsv(
        ratingsCsv([{ itemId: name, tag: "", value: 1, reference: null }]),
      );
      expect(row?.[0]).toBe(`'${name}`);
    },
  );

  it("quotes a comma, a quote and a newline", () => {
    expect(
      ratingsCsv([{ itemId: 'a, "b"', tag: "", value: 1, reference: null }]),
    ).toContain('"a, ""b""",,yes');
  });

  it("is only the header for somebody who has rated nothing", () => {
    expect(ratingsCsv([])).toBe("﻿name,attribute,rating,source,id,link\r\n");
  });
});
