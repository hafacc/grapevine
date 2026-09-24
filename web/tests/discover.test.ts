import { describe, expect, it } from "bun:test";
import {
  attributeAllows,
  attributesOf,
  feedRows,
  foldQuery,
  hiddenByEye,
  lookAlike,
  matchesText,
  TAG_NO_EDGE,
} from "../utils/discover";
import type { Item, Ratings, RecsEntry } from "../utils/types";

const entry = (
  itemId: string,
  score: number,
  tags: Record<string, number> = {},
  conf = 1,
): RecsEntry => ({ itemId, score, conf, tags });

const item = (id: string): Item => ({ id, searchId: id });

const NOTHING_RATED: Ratings = {};
const ALL = { query: "", hideRated: false };

describe("foldQuery", () => {
  it("lower-cases, strips accents and punctuation, and trims", () => {
    expect(foldQuery("  Café,  BLEU ")).toBe("cafe bleu");
  });

  // A query is not on its way into a row, so nothing about it is refused: a
  // person halfway through typing still has to see the list narrow.
  it("keeps what an id could never be", () => {
    expect(foldQuery("x".repeat(200)).length).toBe(200);
  });
});

describe("matchesText", () => {
  it("matches every character in order, not a substring", () => {
    expect(matchesText("bbmint", "blue bottle, mint st")).toBe(true);
    expect(matchesText("mintbb", "blue bottle, mint st")).toBe(false);
  });

  it("matches through a dropped letter", () => {
    expect(matchesText("coffe", "coffee")).toBe(true);
  });

  it("folds the candidate as well as the query", () => {
    expect(matchesText(foldQuery("cafe"), "café bleu")).toBe(true);
  });

  // An emoji is two UTF-16 units, so a match walked by unit never lands.
  it("matches an emoji and a character outside the basic plane", () => {
    expect(matchesText(foldQuery("🍜"), "🍜 ramen bar")).toBe(true);
    expect(matchesText(foldQuery("🍜r"), "🍜 ramen bar")).toBe(true);
    expect(matchesText(foldQuery("𠮷"), "𠮷野家")).toBe(true);
    expect(matchesText(foldQuery("🍣"), "🍜 ramen bar")).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    expect(matchesText("", "anything")).toBe(true);
  });
});

describe("attributesOf", () => {
  // DESIGN §1: most uncertain first, which on §2.6's scale is `|s|` ascending,
  // and an attribute nothing in reach has weighed in on is the least certain of
  // all.
  it("orders the attributes most uncertain first", () => {
    const attributes = attributesOf(
      "café bleu",
      entry("café bleu", 0.5, { quiet: -0.9, coffee: 0.8, pastry: 0.1 }),
      { "café bleu": { "late night": 1 } },
    );
    expect(attributes.map((attribute) => attribute.tag)).toEqual([
      "late night",
      "pastry",
      "coffee",
      "quiet",
    ]);
    expect(attributes[0].score).toBe(null);
    expect(attributes[0].own).toBe(1);
  });

  it("breaks a tie alphabetically", () => {
    const attributes = attributesOf(
      "x",
      entry("x", 0, { zulu: 0.4, alpha: -0.4 }),
      NOTHING_RATED,
    );
    expect(attributes.map((attribute) => attribute.tag)).toEqual([
      "alpha",
      "zulu",
    ]);
  });
});

// DESIGN §2.6: "for every selected attribute, you rated it yes, or its score is
// not clearly no, or nothing is known". Unknown is not "no".
describe("attributeAllows", () => {
  it("refuses a clear no, and exactly at the edge", () => {
    expect(attributeAllows({ tag: "cheap", score: -0.6, own: null })).toBe(
      false,
    );
    expect(attributeAllows({ tag: "cheap", score: TAG_NO_EDGE, own: null })).toBe(
      false,
    );
  });

  it("allows one that is only leaning no", () => {
    expect(
      attributeAllows({ tag: "cheap", score: TAG_NO_EDGE + 0.01, own: null }),
    ).toBe(true);
  });

  it("allows one nothing is known about", () => {
    expect(attributeAllows({ tag: "cheap", score: null, own: null })).toBe(true);
  });

  it("allows one the viewer said yes to themselves", () => {
    expect(attributeAllows({ tag: "cheap", score: -0.6, own: 1 })).toBe(true);
  });

  // Their own no does not rescue it either — it agrees with the feed.
  it("refuses one the viewer said no to themselves", () => {
    expect(attributeAllows({ tag: "cheap", score: -0.6, own: -1 })).toBe(false);
  });
});

describe("feedRows, with nothing typed", () => {
  const entries = [
    entry("alpha", 0.1),
    entry("bravo", 0.9),
    entry("charlie", -0.4),
  ];

  it("is the feed, ranked by the viewer's own score", () => {
    expect(
      feedRows(entries, NOTHING_RATED, ALL).map((row) => row.itemId),
    ).toEqual(["bravo", "alpha", "charlie"]);
  });

  it("breaks a tie by id, so the order is the same twice running", () => {
    const tied = [entry("zulu", 0.5), entry("alpha", 0.5)];
    expect(feedRows(tied, NOTHING_RATED, ALL).map((row) => row.itemId)).toEqual([
      "alpha",
      "zulu",
    ]);
  });

  it("draws the thing's own score on the bar", () => {
    const [top] = feedRows(entries, NOTHING_RATED, ALL);
    expect(top.barScore).toBe(0.9);
    expect(top.matchedTag).toBe(null);
  });

  // `conf: 0` is the recompute's mark for a thing carried only by an attribute
  // of it (DESIGN §3.4): its screen shows the chips, the ranking leaves it out.
  it("leaves out a thing with no support of its own", () => {
    const carried = [...entries, entry("delta", 0, { cheap: 0.8 }, 0)];
    expect(
      feedRows(carried, NOTHING_RATED, ALL).map((row) => row.itemId),
    ).not.toContain("delta");
  });

  it("hides exactly the things the viewer has rated", () => {
    const ratings: Ratings = { bravo: { "": 1 }, alpha: { cheap: -1 } };
    const shown = feedRows(entries, ratings, { ...ALL, hideRated: true });
    // An attribute's thumb is not an opinion of the thing, so `alpha` stays.
    expect(shown.map((row) => row.itemId)).toEqual(["alpha", "charlie"]);
  });

  // With no friends the feed is empty and never mentions what the viewer rated,
  // so their own thumbs are the only trace of it.
  it("lists what the viewer rated when the feed has no entry for it", () => {
    const ratings: Ratings = { claude: { "": 1 } };
    const shown = feedRows([], ratings, ALL);
    expect(shown.map((row) => row.itemId)).toEqual(["claude"]);
    expect(shown[0].own).toBe(1);
    expect(shown[0].score).toBe(null);
    expect(feedRows([], ratings, { ...ALL, hideRated: true })).toEqual([]);
  });

  it("knows when the eye, and not an empty feed, emptied the list", () => {
    const ratings: Ratings = { alpha: { "": 1 }, bravo: { "": -1 } };
    const rated = [entries[0], entries[1]];
    expect(hiddenByEye(rated, ratings, { ...ALL, hideRated: true })).toBe(true);
    expect(hiddenByEye(rated, ratings, ALL)).toBe(false);
    expect(hiddenByEye(entries, ratings, { ...ALL, hideRated: true })).toBe(
      false,
    );
    expect(hiddenByEye([], NOTHING_RATED, { ...ALL, hideRated: true })).toBe(
      false,
    );
  });

  it("lists a thing the viewer rated only on an attribute", () => {
    const ratings: Ratings = { claude: { helpful: 1 } };
    expect(feedRows([], ratings, ALL).map((row) => row.itemId)).toEqual([
      "claude",
    ]);
  });

  it("keeps a rated thing the feed carries only by an attribute", () => {
    const carried = [...entries, entry("delta", 0, { cheap: 0.8 }, 0)];
    const ratings: Ratings = { delta: { "": -1 } };
    expect(
      feedRows(carried, ratings, ALL).map((row) => row.itemId),
    ).toContain("delta");
  });

  it("ignores the catalog, which is not the feed", () => {
    const shown = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      catalog: [item("delta")],
    });
    expect(shown.map((row) => row.itemId)).not.toContain("delta");
  });
});

describe("feedRows, with something typed", () => {
  const entries = [
    entry("café bleu", 0.2, { coffee: 0.9, quiet: 0.3 }, 0.5),
    entry("blue bottle, mint st", 0.8, { coffee: 0.7 }, 3),
    entry("mel's diner", 0.4, { coffee: -0.8, "late night": 0.9 }, 1),
  ];

  it("matches a thing by its id, however it was spelled", () => {
    expect(
      feedRows(entries, NOTHING_RATED, { ...ALL, query: "cafe" }).map(
        (row) => row.itemId,
      ),
    ).toEqual(["café bleu"]);
  });

  it("matches a thing by one of its attributes", () => {
    const shown = feedRows(entries, NOTHING_RATED, { ...ALL, query: "coffee" });
    // Ranked by what the viewer's own network has most to say about, and
    // mel's diner is out: its network says plainly that it is not coffee.
    expect(shown.map((row) => row.itemId)).toEqual([
      "blue bottle, mint st",
      "café bleu",
    ]);
  });

  it("draws the matched attribute's score on the bar", () => {
    const [, second] = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query: "coffee",
    });
    expect(second.itemId).toBe("café bleu");
    expect(second.matchedTag).toBe("coffee");
    expect(second.barScore).toBe(0.9);
  });

  // §2.6's rule is what a typed attribute applies.
  it("keeps a thing the viewer said yes to themselves", () => {
    const ratings: Ratings = { "mel's diner": { coffee: 1 } };
    expect(
      feedRows(entries, ratings, { ...ALL, query: "coffee" }).map(
        (row) => row.itemId,
      ),
    ).toContain("mel's diner");
  });

  it("merges a catalog row nobody in reach has rated, after the feed", () => {
    const shown = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query: "coffee",
      catalog: [item("coffee cart, ferry building"), item("café bleu")],
    });
    expect(shown.map((row) => row.itemId)).toEqual([
      "blue bottle, mint st",
      "café bleu",
      "coffee cart, ferry building",
    ]);
    const merged = shown[2];
    expect(merged.barScore).toBe(null);
    expect(merged.attributes).toEqual([]);
  });

  it("finds a thing the viewer rated that the feed does not carry", () => {
    const ratings: Ratings = { claude: { "": 1 } };
    expect(
      feedRows([], ratings, { ...ALL, query: "cla" }).map((row) => row.itemId),
    ).toEqual(["claude"]);
    expect(feedRows([], ratings, { ...ALL, query: "coffee" })).toEqual([]);
  });

  it("shows a thing carried only by an attribute when that attribute is typed", () => {
    const carried = [...entries, entry("delta", 0, { coffee: 0.5 }, 0)];
    expect(
      feedRows(carried, NOTHING_RATED, { ...ALL, query: "coffee" }).map(
        (row) => row.itemId,
      ),
    ).toContain("delta");
  });
});

describe("lookAlike", () => {
  const entries = [entry("café bleu", 0.2, { coffee: 0.9 })];
  const ids = entries.map((known) => known.itemId);
  const lookAlikeName = "cаfé bleu";

  // A Cyrillic `а` is a character NFKC leaves alone and no reader can tell from
  // the Latin one, so the second spelling is offered the first thing rather than
  // an *add* (DESIGN §3.2).
  it("finds the thing a typed look-alike could not be told from", () => {
    expect(lookAlike(lookAlikeName, ids)).toBe("café bleu");
  });

  // Which is why it is handed the feed's ids and not the rows on screen.
  it("finds a thing the typed query has filtered off the list", () => {
    const shown = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query: lookAlikeName,
    });
    expect(shown).toEqual([]);
    expect(lookAlike(lookAlikeName, ids)).toBe("café bleu");
  });

  it("finds it in the catalog as well as the feed", () => {
    expect(lookAlike(lookAlikeName, [item("café bleu").id])).toBe("café bleu");
  });

  it("says nothing when the typed name IS one of the ids", () => {
    expect(lookAlike("Café  Bleu", ids)).toBe(null);
  });

  it("says nothing about a name that is simply new", () => {
    expect(lookAlike("tartine", ids)).toBe(null);
  });
});
