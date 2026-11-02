import { describe, expect, it } from "bun:test";
import {
  attributesOf,
  carries,
  feedRows,
  foldQuery,
  hiddenByEye,
  lookAlike,
  matchesText,
  searchFeed,
} from "../src/lib/utils/discover";
import type { TagEntry } from "grapevine-shared/entries";
import type { TagRelation } from "grapevine-shared/search";
import type { Item, Ratings, RecsEntry } from "../src/lib/utils/types";

// How surely a tag applies, as the fixtures below write it: a number on
// `(−1, 1)` whose `(1 + s) / 2` is the chance. The core scores every tag
// somebody put on a thing, so the fixture has to say how good an example the
// thing is: as good as the thing itself, which keeps a row's arithmetic in
// the two numbers written beside it.
const applying = (lean: number, score: number): TagEntry => ({
  score,
  conf: 1,
  applies: (1 + lean) / 2,
});

const entry = (
  itemId: string,
  score: number,
  tags: Record<string, number | TagEntry> = {},
  conf = 1,
): RecsEntry => ({
  itemId,
  score,
  conf,
  tags: Object.fromEntries(
    Object.entries(tags).map(([tag, said]) => [
      tag,
      typeof said === "number" ? applying(said, score) : said,
    ]),
  ),
});

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
  // DESIGN §1: most uncertain first, which is how good an example it is with
  // the least behind it, and an attribute nobody followed has weighed in on
  // is the least certain of all.
  it("orders the attributes most uncertain first", () => {
    const said = (score: number): TagEntry => ({
      score,
      conf: 9,
      applies: 0.9,
    });
    const attributes = attributesOf(
      "café bleu",
      entry("café bleu", 0.5, {
        quiet: said(-0.9),
        coffee: said(0.8),
        pastry: said(0.1),
      }),
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

  // The score is the chance already, whatever stands behind it.
  it("draws the thing's score on the bar, as it is", () => {
    const [top] = feedRows(entries, NOTHING_RATED, ALL);
    expect(top.barScore).toBe(0.9);
    expect(top.matchedTag).toBe(null);
  });

  // A thing known only through the viewer's own record: a real score that no
  // followed account's thumb stands behind.
  it("draws a score nothing stands behind", () => {
    const [row] = feedRows([entry("echo", 0.3, {}, 0)], NOTHING_RATED, ALL);
    expect(row?.barScore).toBe(0.3);
  });

  // The score already holds how little stands behind it, so that is not
  // counted against it a second time.
  it("ranks by the score, and by how much stands behind it only between equals", () => {
    const weighed = [
      entry("thin", 0.6, {}, 0.2),
      entry("sure", 0.6, {}, 9),
      entry("high", 0.9, {}, 0),
    ];
    expect(
      feedRows(weighed, NOTHING_RATED, ALL).map((row) => row.itemId),
    ).toEqual(["high", "sure", "thin"]);
  });

  it("hides exactly the things the viewer has rated", () => {
    const ratings: Ratings = { bravo: { "": 1 }, alpha: { cheap: -1 } };
    const shown = feedRows(entries, ratings, { ...ALL, hideRated: true });
    // An attribute's thumb is not an opinion of the thing, so `alpha` stays.
    expect(shown.map((row) => row.itemId)).toEqual(["alpha", "charlie"]);
  });

  // Following nobody, the feed is empty and never mentions what the viewer rated,
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
    const carried = [...entries, entry("delta", 0.1, { cheap: 0.8 }, 0)];
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
    entry("café bleu", 0.06, { coffee: 0.9, quiet: 0.3 }, 0.5),
    entry("blue bottle, mint st", 0.6, { coffee: 0.7 }, 3),
    entry("mel's diner", 0.2, { coffee: -0.8, "late night": 0.9 }, 1),
  ];
  const ids = (query: string, ratings: Ratings = NOTHING_RATED) =>
    feedRows(entries, ratings, { ...ALL, query }).map((row) => row.itemId);

  it("matches a thing by its id, however it was spelled", () => {
    expect(ids("cafe")).toEqual(["café bleu"]);
  });

  // Presence is (1 + s) / 2: 0.95, 0.85 and 0.1, each with how good the thing
  // would be to the viewer, (1 + s) / 2: 0.53, 0.8 and 0.6. So the place that
  // is surely coffee and barely liked is under the one that is probably
  // coffee and liked. A clear no is still shown, last, since a thing that
  // lacks a word is lower rather than gone.
  it("ranks by how strongly each thing has the attribute and how good it is", () => {
    expect(ids("coffee")).toEqual([
      "blue bottle, mint st",
      "café bleu",
      "mel's diner",
    ]);
  });

  // The bar under a matched attribute is how good an example of it the thing
  // is, drawn as it is, like a thing's own bar.
  it("draws how good an example of the matched attribute on the bar", () => {
    const rated = [
      entry("café bleu", 0.2, {
        coffee: { score: 0.9, conf: 9, applies: 0.95 },
      }),
    ];
    const [bleu] = feedRows(rated, NOTHING_RATED, { ...ALL, query: "coffee" });
    expect(bleu?.matchedTag).toBe("coffee");
    expect(bleu?.barScore).toBe(0.9);
  });

  // Their own thumb up on the attribute says it applies and that the thing is
  // a good example: from last to first.
  it("lets the viewer's own thumb decide", () => {
    expect(ids("coffee", { "mel's diner": { coffee: 1 } })).toEqual([
      "mel's diner",
      "blue bottle, mint st",
      "café bleu",
    ]);
  });

  // A thumb down on an attribute is a bad example of it, not a thing without
  // it: still found, and last.
  it("reads a thumb down as a bad example", () => {
    expect(ids("coffee", { "blue bottle, mint st": { coffee: -1 } })).toEqual([
      "café bleu",
      "mel's diner",
      "blue bottle, mint st",
    ]);
  });

  // How good an example outranks how good the thing is: the book they would
  // not like much that is a good fantasy, over the liked one that is a bad one.
  it("ranks by how good an example over how good the thing is", () => {
    const example = (score: number): TagEntry => ({
      score,
      conf: 9,
      applies: 0.95,
    });
    const books = [
      entry("liked, bad fantasy", 0.8, { fantasy: example(-0.8) }, 9),
      entry("disliked, good fantasy", -0.4, { fantasy: example(0.8) }, 9),
    ];
    expect(
      feedRows(books, NOTHING_RATED, { ...ALL, query: "fantasy" }).map(
        (row) => row.itemId,
      ),
    ).toEqual(["disliked, good fantasy", "liked, bad fantasy"]);
  });

  // The followed accounts put it on with a thumb down. Found by the search,
  // and not among what the thing is shown as having.
  it("finds an attribute thumbed down and does not show it", () => {
    const thumbedDown = [
      entry("corner spot", 0.5, {
        cafe: { score: -0.5, conf: 2, applies: 0.25 },
      }),
    ];
    const [row] = feedRows(thumbedDown, NOTHING_RATED, {
      ...ALL,
      query: "cafe",
    });
    expect(row?.itemId).toBe("corner spot");
    expect(row?.attributes.filter(carries)).toEqual([]);
  });

  // A catalog row with no entry reads as unknown, 0.5: above a clear no,
  // below any yes.
  it("merges a catalog row nobody followed has rated", () => {
    const shown = feedRows(entries, NOTHING_RATED, {
      ...ALL,
      query: "coffee",
      catalog: [item("coffee cart, ferry building"), item("café bleu")],
    });
    expect(shown.map((row) => row.itemId)).toEqual([
      "blue bottle, mint st",
      "café bleu",
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
    const carried = [...entries, entry("delta", 0.1, { coffee: 0.5 }, 0)];
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
// strength is the per-word geometric mean of what the pieces contribute, with
// how good the thing is counted once more where no piece read as its name.
describe("searchFeed, with several words", () => {
  const entries = [
    entry("the annex", 0.05, { "hip work": 0.8, coffee: 0.8 }, 1),
    entry("the mill", 0.05, { hip: 0.6, work: 0.6, coffee: 0.6 }, 1),
    entry("hip work coffee", 0.5, {}, 5),
    entry("kiosk", 0.05, { coffee: 0.9 }, 1),
    entry("hilltop pizza", 0.5, {}, 5),
  ];
  const search = (query: string) =>
    searchFeed(entries, NOTHING_RATED, { ...ALL, query });
  const ids = (query: string) => search(query).rows.map((row) => row.itemId);

  // The owner's example: two attributes `hip work` and `coffee` (0.9 each),
  // three (0.8 each), the name (the thing's own 0.75), or only `coffee` with
  // two words unknown. The three read by attribute are each barely liked
  // (0.525), which counts once: 0.79, 0.72 and 0.59 around the name's 0.75.
  it("reads each row under its own best split", () => {
    const shown = search("hip work coffee").rows;
    expect(shown.map((row) => row.itemId)).toEqual([
      "the annex",
      "hip work coffee",
      "the mill",
      "kiosk",
    ]);
    expect(shown[0]?.matchedTags).toEqual(["hip work", "coffee"]);
    expect(shown[1]?.matchedTags).toEqual([]);
    expect([...(shown[2]?.matchedTags ?? [])].sort()).toEqual([
      "coffee",
      "hip",
      "work",
    ]);
  });

  it("bars the matched attribute that fits least", () => {
    const [annex] = search("hip work coffee").rows;
    expect(annex?.matchedTag).toBe("coffee");
    // How good an example of it the annex is, which the fixture makes how
    // good the annex is.
    expect(annex?.barScore).toBe(0.05);
  });

  it("drops a word nothing matches, and says so", () => {
    const result = search("hip xyzzy");
    expect(result.unmatched).toEqual(["xyzzy"]);
    // hip is 0.8 on the mill, the name's 0.75 on its namesake, and a part
    // of `hip work` on the annex; the unknown word halves each alike, and the
    // two read by attribute are barely liked.
    expect(result.rows.map((row) => row.itemId)).toEqual([
      "hip work coffee",
      "the mill",
      "the annex",
    ]);
  });
});

// The owner's other example: a name piece and an attribute piece, the name
// contributing how good the thing is and the attribute how quiet.
describe("searchFeed, with a name and an attribute", () => {
  const entries = [
    entry("starbucks main st", 0.6, { quiet: 0.8 }, 5),
    entry("starbucks 5th ave", 0.6, { quiet: -0.6 }, 5),
    entry("starbucks pike", 0.2, { quiet: 0.8 }, 5),
    entry("reading room", 0.15, { quiet: 0.9 }, 1),
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
    entry("dune (novel)", 0.53, { classic: 0.9 }, 2),
    entry("dune messiah", 0.1, { classic: 0.1 }, 1),
    entry("dunes cafe", 0.25, { quiet: 0.1 }, 1),
    entry("beach walk", 0.3, { dune: 0.9, quiet: 0.7 }, 1),
    entry("quiet corner", 0.2, { cheap: 0.5 }, 1),
    entry("reading room", 0.15, { quiet: 0.9 }, 1),
    entry("club", 0.15, { quiet: -0.8 }, 1),
    entry("project hail mary", 0.45, {}, 1),
    entry("mary's diner", 0.2, { "hail storm": 0.2 }, 1),
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

  // Accounts are the people screen's: `@` here is dropped, and finds things.
  it("reads @dune as dune", () => {
    expect(ids("@dune")).toEqual(ids("dune"));
  });

  // Quiet at 0.95 and liked at 0.575, against quiet at 0.85 and liked at 0.65.
  it("finds attributes only with #", () => {
    expect(ids("#quiet")).toEqual([
      "beach walk",
      "reading room",
      "dunes cafe",
      "club",
    ]);
  });

  // `!` excludes nothing: the things least quiet first.
  it("puts the low-rated first with !", () => {
    expect(ids("!#quiet")).toEqual([
      "club",
      "dunes cafe",
      "beach walk",
      "reading room",
    ]);
    expect(ids("!quiet")).toContain("quiet corner");
  });

  // Their own thumb on `quiet`, either way, says it is a quiet place.
  it("reads the viewer's own thumb as applying under !", () => {
    expect(ids("!#quiet", { club: { quiet: -1 } }).at(-1)).toBe("club");
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
    expect(ids("#hail storm")).toEqual(["mary's diner"]);
  });

  it("reports a word nothing matches, operators and all", () => {
    expect(search("!#hipp dune").unmatched).toEqual(["!#hipp"]);
  });
});

describe("searchFeed, with a learned relation", () => {
  const entries = [
    entry("reading room", 0.15, { "laptop friendly": 0.7 }, 1),
    entry("dance hall", 0.15, { "laptop friendly": -0.6 }, 1),
    entry("library bar", 0.15, { loud: -0.5 }, 1),
    entry("workshop", 0.05, { quiet: 0.2 }, 1),
    entry("club", 0.15, { loud: 0.8, cheap: 0.8 }, 1),
    entry("diner", 0.15, { cheap: 0.8 }, 1),
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
