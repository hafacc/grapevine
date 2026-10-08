import { describe, expect, it } from "bun:test";
import {
  attributesOf,
  feedRows,
  foldQuery,
  hiddenByEye,
  lookAlike,
  matchesText,
  searchFeed,
} from "../src/lib/utils/discover";
import type { TagRelation } from "grapevine-shared/search";
import type { Item, Ratings, RecsEntry } from "../src/lib/utils/types";

const entry = (
  itemId: string,
  score: number,
  tags: Record<string, number> = {},
  conf = 1,
): RecsEntry => ({ itemId, score, conf, tags });

const item = (id: string): Item => ({ id, searchId: id });

const NOTHING_RATED: Ratings = {};
const ALL = { query: "", hideRated: false };

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

  // One thumb of evidence against the prior's one: half the score.
  it("draws the thing's cautious score on the bar", () => {
    const [top] = feedRows(entries, NOTHING_RATED, ALL);
    expect(top.barScore).toBeCloseTo(0.45, 10);
    expect(top.matchedTag).toBe(null);
  });

  // Every rated thing shows (DESIGN §2.6), a thing carried only by an
  // attribute of it included: nothing known, ranked as the middle.
  it("shows a thing with no support of its own, as nothing known", () => {
    const carried = [...entries, entry("delta", 0.3, { cheap: 0.8 }, 0)];
    const rows = feedRows(carried, NOTHING_RATED, ALL);
    expect(rows.map((row) => row.itemId)).toEqual([
      "bravo",
      "alpha",
      "delta",
      "charlie",
    ]);
    expect(rows[2]?.barScore).toBe(null);
  });

  it("ranks by the score and how much stands behind it together", () => {
    const weighed = [entry("sure", 0.6, {}, 9), entry("thin", 0.9, {}, 0.2)];
    expect(
      feedRows(weighed, NOTHING_RATED, ALL).map((row) => row.itemId),
    ).toEqual(["sure", "thin"]);
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

describe("feedRows, with one word typed", () => {
  const entries = [
    entry("café bleu", 0.2, { coffee: 0.9, quiet: 0.3 }, 0.5),
    entry("blue bottle, mint st", 0.8, { coffee: 0.7 }, 3),
    entry("mel's diner", 0.4, { coffee: -0.8, "late night": 0.9 }, 1),
  ];
  const ids = (query: string, ratings: Ratings = NOTHING_RATED) =>
    feedRows(entries, ratings, { ...ALL, query }).map((row) => row.itemId);

  it("matches a thing by its id, however it was spelled", () => {
    expect(ids("cafe")).toEqual(["café bleu"]);
  });

  // Presence is (1 + s) / 2: 0.95, 0.85 and 0.1. A clear no is still shown,
  // last, since a thing that lacks a word is lower rather than gone.
  it("ranks by how strongly each thing has the attribute", () => {
    expect(ids("coffee")).toEqual([
      "café bleu",
      "blue bottle, mint st",
      "mel's diner",
    ]);
  });

  it("draws the matched attribute's score on the bar", () => {
    const [first] = feedRows(entries, NOTHING_RATED, { ...ALL, query: "coffee" });
    expect(first?.matchedTag).toBe("coffee");
    expect(first?.barScore).toBe(0.9);
  });

  it("lets the viewer's own thumb decide", () => {
    expect(ids("coffee", { "mel's diner": { coffee: 1 } })[0]).toBe(
      "mel's diner",
    );
  });

  // A catalog row with no entry reads as unknown, 0.5: above a clear no,
  // below any yes.
  it("merges a catalog row nobody in reach has rated", () => {
    const shown = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query: "coffee",
      catalog: [item("coffee cart, ferry building"), item("café bleu")],
    });
    expect(shown.map((row) => row.itemId)).toEqual([
      "café bleu",
      "blue bottle, mint st",
      "coffee cart, ferry building",
      "mel's diner",
    ]);
    expect(shown[2]?.barScore).toBe(null);
    expect(shown[2]?.attributes).toEqual([]);
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

  it("forgives a typo in a longer word, and not in a short one", () => {
    expect(ids("cofee")).toContain("blue bottle, mint st");
    expect(ids("qiet")).toEqual(["café bleu"]);
    expect(ids("qit")).toEqual([]);
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

  // Which is why it is handed the feed's ids and not the rows on screen. A
  // name this short takes no typo, so the look-alike matches nothing.
  it("finds a thing the typed query has filtered off the list", () => {
    const short = [entry("cat", 0.2)];
    const shortLookAlike = "cаt";
    const shown = feedRows(short, NOTHING_RATED, {
      ...ALL,
      query: shortLookAlike,
    });
    expect(shown).toEqual([]);
    expect(lookAlike(shortLookAlike, ["cat"])).toBe("cat");
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

// DESIGN §1 "Search": every piece of the query reads as the name or an
// attribute, under the split that scores each row highest, and a row's
// strength is the per-word geometric mean of what the pieces contribute.
describe("searchFeed, with several words", () => {
  const entries = [
    entry("the annex", 0.1, { "hip work": 0.8, coffee: 0.8 }, 1),
    entry("the mill", 0.1, { hip: 0.6, work: 0.6, coffee: 0.6 }, 1),
    // Five thumbs behind 0.6: a cautious 0.5.
    entry("hip work coffee", 0.6, {}, 5),
    entry("kiosk", 0.1, { coffee: 0.9 }, 1),
    entry("hilltop pizza", 0.6, {}, 5),
  ];
  const search = (query: string) =>
    searchFeed(entries, NOTHING_RATED, { ...ALL, query });
  const ids = (query: string) => search(query).rows.map((row) => row.itemId);

  // The owner's example: two attributes `hip work` and `coffee` (0.9 each),
  // three (0.8 each), the name (the thing's own 0.75), or only `coffee` with
  // two words unknown ((0.5 · 0.5 · 0.95)^(1/3) ≈ 0.62).
  it("reads each row under its own best split", () => {
    const shown = search("hip work coffee").rows;
    expect(shown.map((row) => row.itemId)).toEqual([
      "the annex",
      "the mill",
      "hip work coffee",
      "kiosk",
    ]);
    expect(shown[0]?.matchedTags).toEqual(["hip work", "coffee"]);
    expect([...(shown[1]?.matchedTags ?? [])].sort()).toEqual([
      "coffee",
      "hip",
      "work",
    ]);
    expect(shown[2]?.matchedTags).toEqual([]);
  });

  it("bars the matched attribute that fits least", () => {
    const [annex] = search("hip work coffee").rows;
    expect(annex?.matchedTag).toBe("coffee");
    expect(annex?.barScore).toBe(0.8);
  });

  it("drops a word nothing matches, and says so", () => {
    const result = search("hip xyzzy");
    expect(result.unmatched).toEqual(["xyzzy"]);
    // hip is 0.8 on the mill, the name's 0.75 on its namesake, and a part
    // of `hip work` on the annex; the unknown word halves each alike.
    expect(result.rows.map((row) => row.itemId)).toEqual([
      "the mill",
      "hip work coffee",
      "the annex",
    ]);
  });
});

// The owner's other example: a name piece and an attribute piece, the name
// contributing how good the thing is and the attribute how quiet.
describe("searchFeed, with a name and an attribute", () => {
  const entries = [
    // Five thumbs each, so cautious scores of 0.6, 0.6 and 0.2.
    entry("starbucks main st", 0.72, { quiet: 0.8 }, 5),
    entry("starbucks 5th ave", 0.72, { quiet: -0.6 }, 5),
    entry("starbucks pike", 0.24, { quiet: 0.8 }, 5),
    entry("reading room", 0.3, { quiet: 0.9 }, 1),
  ];
  const ids = (query: string) =>
    feedRows(entries, NOTHING_RATED, { ...ALL, query }).map(
      (row) => row.itemId,
    );

  // sqrt(0.8·0.9) ≈ 0.85, sqrt(0.6·0.9) ≈ 0.73, sqrt(0.5·0.95) ≈ 0.69,
  // sqrt(0.8·0.2) = 0.4.
  it("ranks the things of that name by how good and how quiet", () => {
    expect(ids("starbucks quiet")).toEqual([
      "starbucks main st",
      "starbucks pike",
      "reading room",
      "starbucks 5th ave",
    ]);
  });

  it("takes part of a name", () => {
    const shown = ids("starb quiet");
    expect(shown[0]).toBe("starbucks main st");
    expect(shown).toContain("starbucks 5th ave");
  });
});

describe("searchFeed, with operators", () => {
  const entries = [
    entry("dune (novel)", 0.8, { classic: 0.9 }, 2),
    entry("dune messiah", 0.2, { classic: 0.1 }, 1),
    entry("dunes cafe", 0.5, { quiet: 0.1 }, 1),
    entry("beach walk", 0.6, { dune: 0.9, quiet: 0.7 }, 1),
    entry("quiet corner", 0.4, { cheap: 0.5 }, 1),
    entry("reading room", 0.3, { quiet: 0.9 }, 1),
    entry("club", 0.3, { quiet: -0.8 }, 1),
    entry("project hail mary", 0.9, {}, 1),
    entry("mary's diner", 0.4, { "hail storm": 0.2 }, 1),
  ];
  const search = (query: string, ratings: Ratings = NOTHING_RATED) =>
    searchFeed(entries, ratings, { ...ALL, query });
  const ids = (query: string, ratings: Ratings = NOTHING_RATED) =>
    search(query, ratings).rows.map((row) => row.itemId);

  it("finds by name or attribute, high-rated first, with no operator", () => {
    expect(ids("dune").slice(0, 3)).toEqual([
      "beach walk",
      "dune (novel)",
      "dunes cafe",
    ]);
    expect(ids("dune")).toContain("dune messiah");
  });

  // The whole name is one piece of two words: a better reading than either
  // word alone, on `mary's diner` or on an attribute.
  it("reads two words as one name", () => {
    expect(ids("hail mary")[0]).toBe("project hail mary");
  });

  it("finds names only with @", () => {
    const shown = ids("@dune");
    expect(shown[0]).toBe("dune (novel)");
    expect(shown).toContain("dune messiah");
    expect(shown).not.toContain("beach walk");
  });

  it("finds attributes only with #", () => {
    expect(ids("#quiet")).toEqual([
      "reading room",
      "beach walk",
      "dunes cafe",
      "club",
    ]);
  });

  // `!` excludes nothing: the same things, the other way up.
  it("puts the low-rated first with !", () => {
    expect(ids("!#quiet")).toEqual([
      "club",
      "dunes cafe",
      "beach walk",
      "reading room",
    ]);
    const dunes = ids("!@dune");
    expect(dunes[0]).toBe("dune messiah");
    expect(dunes.at(-1)).toBe("dune (novel)");
    expect(ids("!quiet")).toContain("quiet corner");
  });

  it("lets the viewer's own thumb decide under !", () => {
    expect(ids("!#quiet", { "reading room": { quiet: -1 } })[0]).toBe(
      "reading room",
    );
  });

  // Unknown is 0.5 either way: a thing that says nothing about the word sits
  // between a yes and a no whichever is first.
  it("keeps unknown in the middle under !", () => {
    const shown = ids("dune !#quiet");
    expect(shown.indexOf("dune (novel)")).toBeLessThan(
      shown.indexOf("beach walk"),
    );
  });

  it("lets an operator's term run on over plain words", () => {
    expect(ids("!@dune messiah")[0]).toBe("dune messiah");
  });

  it("reports a word nothing matches, operators and all", () => {
    expect(search("!#hipp dune").unmatched).toEqual(["!#hipp"]);
  });
});

describe("searchFeed, with a learned relation", () => {
  const entries = [
    entry("reading room", 0.3, { "laptop friendly": 0.7 }, 1),
    entry("dance hall", 0.3, { "laptop friendly": -0.6 }, 1),
    entry("library bar", 0.3, { loud: -0.5 }, 1),
    entry("workshop", 0.1, { quiet: 0.2 }, 1),
    entry("club", 0.3, { loud: 0.8, cheap: 0.8 }, 1),
    entry("diner", 0.3, { cheap: 0.8 }, 1),
  ];
  const relation: TagRelation = (tag) =>
    tag === "quiet"
      ? [
          { tag: "laptop friendly", similarity: 0.8 },
          { tag: "loud", similarity: -0.9 },
        ]
      : [];
  const ids = (query: string, withRelation?: TagRelation) =>
    feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query,
      relation: withRelation,
    }).map((row) => row.itemId);

  // What a relation implies is `0.5 + ρ·(presence − 0.5)`: reading room
  // 0.78, library bar (not loud) 0.73, against workshop's own quiet 0.6.
  // Dance hall is implied not quiet and was not found otherwise, so it is
  // not added.
  it("finds a thing by what goes with the word", () => {
    expect(ids("quiet", relation)).toEqual([
      "reading room",
      "library bar",
      "workshop",
    ]);
  });

  // The club is as cheap as the diner but loud, so `quiet` reads 0.14 for
  // it where the diner's is unknown: lower, not gone.
  it("lowers a thing the network says is the opposite", () => {
    expect(ids("cheap quiet", relation)).toEqual([
      "diner",
      "reading room",
      "library bar",
      "workshop",
      "club",
    ]);
  });

  it("finds nothing by nearness without a relation", () => {
    expect(ids("quiet")).toEqual(["workshop"]);
  });
});
