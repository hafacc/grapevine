// The pure half of what turns the core's answer into a list. Everything around
// it is the database, which the pgTAP suites exercise.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import {
  allFinite,
  foldScores,
  type RecsEntry,
  type ScoreData,
  sanitizeRatings,
} from "../src/entries";

const scored = (score: number, confidence: number, applies = 1): ScoreData => ({
  score,
  confidence,
  applies,
});

// The item and the tag are two columns in the database and two levels of this
// map; they meet as one key only on the far side of the wasm boundary, and the
// character that joins them there is one Postgres text cannot hold.
const JOIN = String.fromCodePoint(0);

describe("sanitizeRatings", () => {
  it("joins the two halves and keeps only thumbs under canonical ids", () => {
    assert.deepEqual(
      sanitizeRatings({
        "café bleu": { "": 1, cheap: -1, Loud: 1 },
        "late night": { "": 1 },
        "Café Bleu": { "": 1 },
        dune: { "": 0.5, film: 300, sequel: "yes", prequel: true },
      }),
      {
        "café bleu": 1,
        [`café bleu${JOIN}cheap`]: -1,
        "late night": 1,
      },
    );
  });

  it("drops a value that is not a thumb", () => {
    assert.deepEqual(
      sanitizeRatings({ "café bleu": { "": 2, cheap: -2, loud: -1 } }),
      { [`café bleu${JOIN}loud`]: -1 },
    );
  });

  it("drops a half that could not have come from the folding", () => {
    assert.deepEqual(
      sanitizeRatings({
        [`café${JOIN}bleu`]: { "": 1 },
        "café bleu": { [`cheap${JOIN}loud`]: 1, " cheap": 1, cheap: 1 },
      }),
      { [`café bleu${JOIN}cheap`]: 1 },
    );
  });

  it("answers null for a map with nothing usable in it", () => {
    assert.equal(sanitizeRatings({ "Café Bleu": { "": 1 } }), null);
    assert.equal(sanitizeRatings({ "café bleu": 1 }), null);
    assert.equal(sanitizeRatings({ "café bleu": {} }), null);
    assert.equal(sanitizeRatings(undefined), null);
    assert.equal(sanitizeRatings("r"), null);
    assert.equal(sanitizeRatings(null), null);
  });
});

describe("names a plain object would swallow", () => {
  it("keeps a thing and an attribute named __proto__", () => {
    const kept = sanitizeRatings(
      JSON.parse(
        '{"__proto__": {"": 1, "__proto__": -1}, "constructor": {"": 1}}',
      ),
    );
    assert.deepEqual(Object.keys(kept ?? {}).sort(), [
      "__proto__",
      `__proto__${JOIN}__proto__`,
      "constructor",
    ]);
    const [entry] = foldScores({
      dune: scored(0.1, 0),
      [`dune${JOIN}__proto__`]: scored(0.5, 1),
    });
    assert.deepEqual(Object.keys(entry?.tags ?? {}), ["__proto__"]);
  });
});

describe("foldScores", () => {
  it("puts an item and its tags in one entry", () => {
    const entries = foldScores({
      "café bleu": scored(0.4, 1.2),
      [`café bleu${JOIN}cheap`]: scored(0.9, 2.0, 0.8),
      [`café bleu${JOIN}loud`]: scored(-0.5, 1, 0.25),
    });
    assert.deepEqual(entries, [
      {
        itemId: "café bleu",
        score: 0.4,
        conf: 1.2,
        tags: {
          cheap: { score: 0.9, conf: 2.0, applies: 0.8 },
          loud: { score: -0.5, conf: 1, applies: 0.25 },
        },
      },
    ]);
  });

  // The core scores a thing whenever it scores a tag of it, at a count of
  // zero where nobody rated the thing itself.
  it("carries an item only its tags were spoken of at a count of zero", () => {
    const [entry] = foldScores({
      "café bleu": scored(0.1, 0),
      [`café bleu${JOIN}cheap`]: scored(0.9, 2, 0.95),
    });
    assert.deepEqual(entry, {
      itemId: "café bleu",
      score: 0.1,
      conf: 0,
      tags: { cheap: { score: 0.9, conf: 2, applies: 0.95 } },
    });
  });

  it("leaves out a tag whose thing the answer does not hold", () => {
    assert.deepEqual(
      foldScores({ [`café bleu${JOIN}cheap`]: scored(0.9, 2, 0.95) }),
      [],
    );
  });

  it("sorts by item id", () => {
    const entries = foldScores({
      zulu: scored(0.1, 1),
      alpha: scored(0.2, 1),
      mike: scored(0.3, 1),
    });
    assert.deepEqual(
      entries.map((entry) => entry.itemId),
      ["alpha", "mike", "zulu"],
    );
  });

  // An id nobody created renders as the same plain text as one somebody did.
  it("keeps an item the catalog has no row for", () => {
    const entries = foldScores({ "never named": scored(0.1, 1) });
    assert.deepEqual(
      entries.map((entry) => entry.itemId),
      ["never named"],
    );
  });

  it("drops a key with no item half", () => {
    assert.deepEqual(foldScores({ [`${JOIN}cheap`]: scored(1, 1) }), []);
  });
});

describe("allFinite", () => {
  const entry = (score: number, conf: number, tag: number): RecsEntry => ({
    itemId: "i",
    score,
    conf,
    tags: { t: { score: tag, conf: 1, applies: 0.9 } },
  });

  it("passes a whole result and fails any part of one", () => {
    assert.equal(allFinite([entry(0.5, 1, 0.2)]), true);
    assert.equal(allFinite([entry(Number.NaN, 1, 0.2)]), false);
    assert.equal(allFinite([entry(0.5, Number.POSITIVE_INFINITY, 0.2)]), false);
    assert.equal(allFinite([entry(0.5, 1, Number.NaN)]), false);
  });
});
