// The pure half of both Edge Functions. Everything around it is the database,
// which the pgTAP suites and the check scripts exercise.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import {
  allFinite,
  feedSignature,
  foldScores,
  NO_PRIORS,
  needsRecompute,
  nextBoundaryNodes,
  pairTallies,
  type RecsEntry,
  type ScoreData,
  sanitizeFriendIds,
  sanitizePriors,
  sanitizeRatings,
  storedPriors,
} from "../src/entries";

const scored = (score: number, confidence: number): ScoreData => ({
  score,
  confidence,
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

describe("sanitizeFriendIds", () => {
  it("keeps the strings and nothing else", () => {
    assert.deepEqual(sanitizeFriendIds(["a", "", 7, null, "b"]), ["a", "b"]);
    assert.deepEqual(sanitizeFriendIds("a"), []);
    assert.deepEqual(sanitizeFriendIds(undefined), []);
  });
});

describe("foldScores", () => {
  it("puts an item and its tags in one entry", () => {
    const entries = foldScores({
      "café bleu": scored(0.4, 1.2),
      [`café bleu${JOIN}cheap`]: scored(0.9, 2.0),
      [`café bleu${JOIN}loud`]: scored(-0.3, 1.1),
    });
    assert.deepEqual(entries, [
      {
        itemId: "café bleu",
        score: 0.4,
        conf: 1.2,
        tags: { cheap: 0.9, loud: -0.3 },
      },
    ]);
  });

  // DESIGN §3.4: the item page's chips come from this entry, so an item has to
  // be here for a displayable tag — but with no support of its own it must not
  // enter the ranking, and `conf: 0` is what keeps it out.
  it("carries an item shown only for its tags at conf 0", () => {
    const [entry] = foldScores({ [`café bleu${JOIN}cheap`]: scored(0.9, 2) });
    assert.deepEqual(entry, {
      itemId: "café bleu",
      score: 0,
      conf: 0,
      tags: { cheap: 0.9 },
    });
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
    tags: { t: tag },
  });

  it("passes a whole result and fails any part of one", () => {
    assert.equal(allFinite([entry(0.5, 1, 0.2)], [0.01, 0]), true);
    assert.equal(allFinite([entry(Number.NaN, 1, 0.2)], [0.01, 0]), false);
    assert.equal(
      allFinite([entry(0.5, Number.POSITIVE_INFINITY, 0.2)], [0.01, 0]),
      false,
    );
    assert.equal(allFinite([entry(0.5, 1, Number.NaN)], [0.01, 0]), false);
  });

  // They are stored rather than shown, so a non-finite one lands in the row as
  // a stored NaN instead of being refused — and `error` is drawn with.
  it("fails any non-finite figure beside the entries", () => {
    const fine = [entry(0.5, 1, 0.2)];
    assert.equal(allFinite(fine, [Number.NaN, 0, 0]), false);
    assert.equal(allFinite(fine, [0.01, Number.POSITIVE_INFINITY, 0]), false);
    assert.equal(allFinite(fine, [0.01, 0, Number.NaN]), false);
    assert.equal(allFinite([], [Number.NaN]), false);
  });
});

describe("needsRecompute", () => {
  const WINDOW = 10 * 60 * 1000;
  const NOW = 1_000_000_000;
  const stamps = (checkedAt: number, ratingsChangedAt: number) => ({
    checkedAt,
    ratingsChangedAt,
  });

  it("leaves a feed checked inside the window alone", () => {
    assert.equal(needsRecompute(stamps(NOW - 1_000, 0), NOW, WINDOW), false);
  });

  it("recomputes once the window since the last check has run out", () => {
    assert.equal(
      needsRecompute(stamps(NOW - WINDOW - 1, 0), NOW, WINDOW),
      true,
    );
  });

  it("recomputes when the viewer's thumbs changed after the last check", () => {
    assert.equal(
      needsRecompute(stamps(NOW - 500, NOW - 400), NOW, WINDOW),
      true,
    );
    assert.equal(
      needsRecompute(stamps(NOW - 500, NOW - 600), NOW, WINDOW),
      false,
    );
  });

  // A thumb that did not change the feed: the recompute it caused landed on the
  // same answer and moved only `checkedAt`. Compared against `computedAt`, that
  // thumb would stay "newer than the feed" forever and every open pay a walk.
  it("does not recompute again for a thumb a same-answer walk already read", () => {
    const ratedAt = NOW - 3_000;
    const checkedAt = NOW - 2_000;
    assert.equal(
      needsRecompute(stamps(checkedAt, ratedAt), NOW, WINDOW),
      false,
    );
  });

  // A walk that could not meet `ε_total` writes no feed and stamps only
  // `checkedAt`. Keyed on "is there a feed", that viewer would pay a full walk
  // on every open.
  it("waits out the window when the last check wrote no feed", () => {
    assert.equal(needsRecompute(stamps(NOW - 1_000, 0), NOW, WINDOW), false);
  });

  it("recomputes when nothing has ever been checked", () => {
    assert.equal(needsRecompute(stamps(0, 0), NOW, WINDOW), true);
  });
});

describe("nextBoundaryNodes", () => {
  const node = (id: string, residual: number) => ({ id, residual });

  it("takes the most residual first and skips what is loaded", () => {
    assert.deepEqual(
      nextBoundaryNodes(
        [node("a", 0.1), node("b", 0.9), node("c", 0.5), node("d", 0.7)],
        new Set(["b"]),
        1_000,
        2,
      ),
      ["d", "c"],
    );
  });

  // The cut comes after the loaded ones are dropped, so a round asking for two
  // reads two rather than however many of the top two were new.
  it("counts only the nodes it would actually read", () => {
    assert.deepEqual(
      nextBoundaryNodes(
        [node("a", 0.9), node("b", 0.8), node("c", 0.7)],
        new Set(["a"]),
        1_000,
        2,
      ),
      ["b", "c"],
    );
  });

  // DESIGN §3.4 step 1: `N_max` counts every node loaded, so a boundary round
  // gets what is left of the budget and not a fresh allowance.
  it("never spends more than the node budget has left", () => {
    const boundary = Array.from({ length: 50 }, (_, at) =>
      node(`n${at}`, 1 - at / 100),
    );
    const loaded = new Set(Array.from({ length: 990 }, (_, at) => `l${at}`));
    assert.equal(nextBoundaryNodes(boundary, loaded, 1_000, 200).length, 10);
    const full = new Set(Array.from({ length: 1_000 }, (_, at) => `l${at}`));
    assert.deepEqual(nextBoundaryNodes(boundary, full, 1_000, 200), []);
  });

  it("is nothing when every boundary node has already been read", () => {
    assert.deepEqual(
      nextBoundaryNodes([node("a", 0.9)], new Set(["a"]), 1_000, 200),
      [],
    );
  });
});

describe("feedSignature", () => {
  const feed: RecsEntry[] = [
    { itemId: "a", score: 0.5, conf: 1, tags: { cheap: 0.2 } },
  ];

  // Floats do not come back out of two runs bit for bit, and a rewrite moves
  // `computed_at`, which costs every open tab a reload of the same feed.
  it("calls a difference below the comparison floor unchanged", () => {
    const drifted: RecsEntry[] = [
      { ...(feed[0] as RecsEntry), score: 0.5 + 1e-12 },
    ];
    assert.equal(feedSignature(drifted), feedSignature(feed));
  });

  it("changes when a score moves", () => {
    const moved: RecsEntry[] = [{ ...(feed[0] as RecsEntry), score: -0.5 }];
    assert.notEqual(feedSignature(moved), feedSignature(feed));
  });

  it("changes when a tag appears", () => {
    const moved: RecsEntry[] = [
      { ...(feed[0] as RecsEntry), tags: { cheap: 0.2, loud: -0.1 } },
    ];
    assert.notEqual(feedSignature(moved), feedSignature(feed));
  });

  it("does not depend on the order the tags arrived in", () => {
    const one: RecsEntry[] = [
      { ...(feed[0] as RecsEntry), tags: { a: 1, b: -1 } },
    ];
    const other: RecsEntry[] = [
      { ...(feed[0] as RecsEntry), tags: { b: -1, a: 1 } },
    ];
    assert.equal(feedSignature(one), feedSignature(other));
  });

  it("is the same string for two empty feeds", () => {
    assert.equal(feedSignature([]), feedSignature([]));
  });
});

describe("pairTallies", () => {
  const moments = (
    pairs: number,
    rateTotal: number,
    rateSquares: number,
    overlapTotal: number,
  ) => ({ pairs, rateTotal, rateSquares, overlapTotal });

  it("flattens the three classes into the twelve columns that hold them", () => {
    assert.deepEqual(
      pairTallies({
        d1: moments(40, 24, 15, 800),
        d2: moments(12, 6.5, 3.75, 180),
        d3plus: moments(3, 1.5, 0.8, 45),
      }),
      {
        pair_n_d1: 40,
        pair_sum_d1: 24,
        pair_sumsq_d1: 15,
        pair_overlap_d1: 800,
        pair_n_d2: 12,
        pair_sum_d2: 6.5,
        pair_sumsq_d2: 3.75,
        pair_overlap_d2: 180,
        pair_n_d3: 3,
        pair_sum_d3: 1.5,
        pair_sumsq_d3: 0.8,
        pair_overlap_d3: 45,
      },
    );
  });

  // The pooling statement adds these across viewers, so a class that says
  // nothing is a row of zeros and a figure that is not a number is one too: a
  // viewer's own recompute must never be able to poison what everybody's priors
  // are estimated from.
  it("reads anything that is not a usable number as nothing said", () => {
    const empty = pairTallies(undefined);
    assert.equal(Object.keys(empty).length, 12);
    assert.equal(
      Object.values(empty).every((value) => value === 0),
      true,
    );
    assert.equal(
      pairTallies({ d1: moments(Number.NaN, 1, 1, 1) }).pair_n_d1,
      0,
    );
    assert.equal(pairTallies({ d1: moments(2, -1, 1, 1) }).pair_sum_d1, 0);
    assert.equal(pairTallies({ d1: { pairs: "2" } }).pair_n_d1, 0);
  });
});

// Both Edge Functions read `private.params` through these, so what a row MEANS
// is decided once.
describe("sanitizePriors", () => {
  it("reads a row the pooling statement wrote", () => {
    assert.deepEqual(
      sanitizePriors({
        computed_at: new Date(1),
        kappa: 11.5,
        a0_d1: 0.63,
        a0_d2: 0.6,
        a0_d3plus: 0.52,
        samples: { pairs: 19900 },
      }),
      { kappa: 11.5, a0: { d1: 0.63, d2: 0.6, d3plus: 0.52 } },
    );
  });

  // Every field waits on its own `N_min` sample, so a row with three estimated
  // fields and two nulls is the ordinary early state, not a fault.
  it("keeps the fields that were estimated and nulls the rest", () => {
    assert.deepEqual(sanitizePriors({ kappa: 9, a0_d1: 0.66, a0_d2: null }), {
      kappa: 9,
      a0: { d1: 0.66, d2: null, d3plus: null },
    });
  });

  it("reads a missing or empty row as no estimate at all", () => {
    assert.equal(sanitizePriors(undefined), null);
    assert.equal(sanitizePriors(null), null);
    assert.equal(sanitizePriors({}), null);
    assert.equal(sanitizePriors({ kappa: null, a0_d1: null }), null);
  });

  // A column of the wrong type is a field nobody estimated. It must not reach
  // the core as anything but null: a viewer's recompute is not the place to find
  // out that something wrote a string.
  it("drops anything that is not a finite number", () => {
    assert.equal(sanitizePriors({ kappa: "8", a0_d1: [0.5] }), null);
    assert.equal(sanitizePriors({ kappa: Number.NaN }), null);
    assert.deepEqual(sanitizePriors({ kappa: 8, a0_d1: true }), {
      kappa: 8,
      a0: { d1: null, d2: null, d3plus: null },
    });
  });
});

describe("storedPriors", () => {
  it("carries the stamp beside the numbers it names", () => {
    const at = new Date("2026-09-17T03:30:00Z");
    assert.deepEqual(storedPriors({ computed_at: at, kappa: 11.5 }), {
      computedAt: at,
      priors: { kappa: 11.5, a0: { d1: null, d2: null, d3plus: null } },
    });
  });

  // `user_model.priors_at` exists to say which estimate a feed was computed
  // under. A row whose every value was unusable is one the walk did not use, so
  // stamping the feed with its `computed_at` would name an estimate that never
  // reached the core.
  it("withholds the stamp when nothing in the row was usable", () => {
    const at = new Date("2026-09-17T03:30:00Z");
    assert.deepEqual(storedPriors({ computed_at: at }), NO_PRIORS);
    assert.deepEqual(
      storedPriors({ computed_at: at, kappa: "nonsense", a0_d1: [0.5] }),
      NO_PRIORS,
    );
    assert.deepEqual(storedPriors(undefined), NO_PRIORS);
  });

  // The stamp is a column like any other: a row half-written, or one with a
  // string stored there, may cost the stamp and never the estimate.
  it("keeps the estimate when only the stamp is unreadable", () => {
    assert.deepEqual(storedPriors({ computed_at: "a timestamp", kappa: 9 }), {
      computedAt: null,
      priors: { kappa: 9, a0: { d1: null, d2: null, d3plus: null } },
    });
  });
});
