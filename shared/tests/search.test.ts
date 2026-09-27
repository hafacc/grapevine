// The list's query language and word matcher (DESIGN §1 "Search"). Which rows a query
// keeps is `web/tests/discover.test.ts`; this is the text alone.

import { describe, expect, it } from "bun:test";

import {
  bestSegmentation,
  foldQuery,
  MAX_SEGMENT_WORDS,
  matchTerm,
  parseQuery,
  prefixEditDistance,
  relationFrom,
  type ScoredThing,
  TIER,
  typoBudget,
} from "../src/search";

describe("foldQuery", () => {
  it("lower-cases, strips accents and punctuation, and trims", () => {
    expect(foldQuery("  Café,  BLEU ")).toBe("cafe bleu");
  });

  // A query is not on its way into a row, so nothing about it is refused.
  it("keeps what an id could never be", () => {
    expect(foldQuery("x".repeat(200)).length).toBe(200);
  });
});

describe("parseQuery", () => {
  it("splits on whitespace and folds each word", () => {
    expect(parseQuery("  Hip  WORK\tcafé ")).toEqual({
      words: [
        { text: "hip", raw: "Hip", low: false, field: "any" },
        { text: "work", raw: "WORK", low: false, field: "any" },
        { text: "cafe", raw: "café", low: false, field: "any" },
      ],
      plain: true,
    });
  });

  it("reads !, @ and # at the front of a word", () => {
    const { words, plain } = parseQuery(
      "coffee !hip @dune #quiet !@dune !#quiet",
    );
    expect(words.map((word) => [word.text, word.low, word.field])).toEqual([
      ["coffee", false, "any"],
      ["hip", true, "any"],
      ["dune", false, "name"],
      ["quiet", false, "tag"],
      ["dune", true, "name"],
      ["quiet", true, "tag"],
    ]);
    expect(plain).toBe(false);
  });

  it("quotes a word back as typed, operators and all", () => {
    expect(parseQuery("!#Quiet").words[0]?.raw).toBe("!#Quiet");
  });

  // The same NFKC that refuses `！hip` as an id reads it as the operator here.
  it("reads a full-width ! as the ASCII one", () => {
    expect(parseQuery("！hip").words[0]?.low).toBe(true);
    expect(parseQuery("＠dune").words[0]?.field).toBe("name");
  });

  it("keeps an operator that does not start the word", () => {
    expect(parseQuery("yahoo! c#").words).toEqual([
      { text: "yahoo", raw: "yahoo!", low: false, field: "any" },
      { text: "c", raw: "c#", low: false, field: "any" },
    ]);
    expect(parseQuery("yahoo! c#").plain).toBe(true);
  });

  // Typed on every keystroke: an operator with nothing after it yet is not an
  // error, but it is no longer a name either.
  it("drops an operator alone and a word that folds to nothing", () => {
    const { words, plain } = parseQuery("coffee ! # ...");
    expect(words.map((word) => word.text)).toEqual(["coffee"]);
    expect(plain).toBe(false);
  });
});

describe("prefixEditDistance", () => {
  const distance = (word: string, target: string, limit = 3) =>
    prefixEditDistance(Array.from(word), Array.from(target), limit);

  it("measures against the nearest prefix of the target", () => {
    expect(distance("cofe", "coffee")).toBe(1);
    expect(distance("coffee", "coffee shop")).toBe(0);
  });

  it("counts a swap of two neighbours as one edit", () => {
    expect(distance("cofefe", "coffee")).toBe(1);
  });

  it("stops past the limit", () => {
    expect(distance("zzzzzz", "coffee", 1)).toBe(2);
  });

  it("measures a target shorter than the word", () => {
    expect(distance("coffee", "cof")).toBe(3);
  });
});

describe("typoBudget", () => {
  it("allows none up to three characters, one to six, two past", () => {
    expect([3, 4, 6, 7].map(typoBudget)).toEqual([0, 1, 1, 2]);
  });
});

describe("matchTerm", () => {
  const tier = (term: string, candidate: string) =>
    matchTerm(term, candidate)?.tier ?? null;
  const weight = (term: string, candidate: string, whole = true) =>
    matchTerm(term, candidate, { loose: true, typos: true, whole })?.weight ??
    null;

  it("is exact for a whole word or a run of whole words", () => {
    expect(tier("coffee", "coffee")).toBe(TIER.exact);
    expect(tier("night", "late night")).toBe(TIER.exact);
    expect(tier("late night", "late night coffee")).toBe(TIER.exact);
  });

  it("is a prefix for the start of a word", () => {
    expect(tier("cof", "blue coffee")).toBe(TIER.prefix);
    expect(tier("late ni", "late night")).toBe(TIER.prefix);
  });

  it("forgives a typo by the word's length", () => {
    expect(tier("cofee", "coffee")).toBe(TIER.typo);
    expect(tier("resturant", "restaurant")).toBe(TIER.typo);
    expect(tier("hpi", "hip")).toBe(null);
  });

  // The old matcher, kept so an initialism finds its thing.
  it("falls back to every character in order", () => {
    expect(tier("bbmint", "blue bottle mint st")).toBe(TIER.loose);
    expect(tier("hip", "hilltop pizza")).toBe(null);
  });

  it("does neither when asked for text alone", () => {
    const strict = { loose: false, typos: false, whole: true };
    expect(matchTerm("cofee", "coffee", strict)).toBe(null);
    expect(matchTerm("bbmint", "blue bottle mint st", strict)).toBe(null);
  });

  // The weight is the share of the matched text the typing confirmed.
  it("weighs an attribute by how much of it was typed", () => {
    expect(weight("coffee", "coffee")).toBe(1);
    expect(weight("cof", "coffee")).toBe(0.5);
    expect(weight("night", "late night")).toBe(0.5);
    expect(weight("cofee", "coffee")).toBe(4 / 6);
    expect(weight("bbmint", "blue bottle mint st")).toBe(6 / 19);
  });

  it("weighs a name by the words the typing touched", () => {
    expect(weight("starbucks", "starbucks main st", false)).toBe(1);
    expect(weight("starb", "starbucks main st", false)).toBe(5 / 9);
    expect(weight("main st", "starbucks main st", false)).toBe(1);
  });

  // An emoji is two UTF-16 units, so a match walked by unit never lands.
  it("matches an emoji and a character outside the basic plane", () => {
    expect(tier(foldQuery("🍜"), foldQuery("🍜 ramen bar"))).toBe(TIER.exact);
    expect(tier(foldQuery("𠮷"), foldQuery("𠮷野家"))).toBe(TIER.prefix);
    expect(tier(foldQuery("🍣"), foldQuery("🍜 ramen bar"))).toBe(null);
  });
});

describe("bestSegmentation", () => {
  // Three words and a price list; a span is read when its text is on it.
  const words = ["late", "night", "coffee"];
  const segment = (prices: Record<string, number>, unread = 5) =>
    bestSegmentation(
      words.length,
      (start, end) => {
        const text = words.slice(start, end).join(" ");
        const cost = prices[text];
        return cost === undefined ? null : { cost, match: text };
      },
      () => unread,
    );

  it("reads two words as one term when that is cheaper", () => {
    const { segments, cost } = segment({
      "late night": 0,
      late: 1,
      night: 1,
      coffee: 0,
    });
    expect(segments.map((part) => part.match)).toEqual([
      "late night",
      "coffee",
    ]);
    expect(cost).toBe(0);
  });

  it("reads every word alone when that is cheaper", () => {
    const { segments } = segment({ "late night": 3, late: 1, night: 1 }, 5);
    expect(segments.map((part) => part.match)).toEqual(["late", "night", null]);
  });

  it("leaves a word unread when that is cheapest", () => {
    const { segments, cost } = segment({ late: 0, night: 9, coffee: 0 }, 5);
    expect(segments.map((part) => part.match)).toEqual([
      "late",
      null,
      "coffee",
    ]);
    expect(cost).toBe(5);
  });

  it("never leaves a word unread at an infinite price", () => {
    const { segments } = segment({ late: 0, night: 9, coffee: 0 }, Infinity);
    expect(segments.map((part) => part.match)).toEqual([
      "late",
      "night",
      "coffee",
    ]);
  });

  it("prefers the longer last segment on a tie", () => {
    const { segments } = segment({
      "late night coffee": 0,
      late: 0,
      night: 0,
      coffee: 0,
    });
    expect(segments.map((part) => part.match)).toEqual(["late night coffee"]);
  });

  it("asks about at most MAX_SEGMENT_WORDS spans per word", () => {
    let asked = 0;
    const count = 20;
    bestSegmentation(
      count,
      () => {
        asked += 1;
        return { cost: 0, match: null };
      },
      () => 1,
    );
    expect(asked).toBeLessThanOrEqual(count * MAX_SEGMENT_WORDS);
  });
});

describe("relationFrom", () => {
  // Quiet places are laptop friendly and not loud; `dance` carries nothing
  // about quiet at all.
  const things: ScoredThing[] = [
    { weight: 2, tags: { quiet: 0.8, "laptop friendly": 0.6, loud: -0.7 } },
    { weight: 2, tags: { quiet: 0.7, "laptop friendly": 0.5, loud: -0.6 } },
    { weight: 1, tags: { quiet: -0.6, loud: 0.8 } },
    { weight: 1, tags: { dance: 0.9, loud: 0.9 } },
  ];
  const relation = relationFrom(things);
  const similarity = (left: string, right: string) =>
    relation(left).find((related) => related.tag === right)?.similarity;

  it("finds what moves with an attribute and what moves against it", () => {
    expect(similarity("quiet", "laptop friendly")).toBeGreaterThan(0);
    expect(similarity("quiet", "loud")).toBeLessThan(0);
  });

  it("is symmetric", () => {
    expect(similarity("quiet", "loud")).toBeCloseTo(
      similarity("loud", "quiet") as number,
      12,
    );
  });

  it("lists the strongest first", () => {
    const tags = relation("quiet").map((related) => related.tag);
    expect(tags[0]).toBe("loud");
  });

  // κ_s keeps one co-occurrence from reading as a law.
  it("shrinks a pair seen together once", () => {
    const once = relationFrom([{ weight: 1, tags: { a: 0.5, b: 0.5 } }]);
    expect(once("a")[0]?.similarity).toBeCloseTo(0.2, 12);
  });

  it("knows nothing about an attribute nobody paired", () => {
    expect(relation("never seen")).toEqual([]);
    expect(similarity("quiet", "dance")).toBeUndefined();
  });

  it("keeps at most the asked-for number per attribute", () => {
    expect(relationFrom(things, 1)("quiet")).toHaveLength(1);
  });
});
