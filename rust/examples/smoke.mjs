// Smoke test for the wasm-pack build. Run after
//   bash scripts/build-wasm.sh nodejs
// with: node rust/examples/smoke.mjs
import { createRequire } from "node:module";
const { computeUser, rescoreUser, suggestFor } = createRequire(import.meta.url)("../core-wasm/grapevine_core.js");

// The input form the loader of DESIGN 3.4 produces: directed `friendIds`, the set of nodes whose
// lists were read, and ratings exactly as the `ratings` rows carry them.
const snapshot = {
  users: ["u0", "u1", "u2"],
  friendIds: { u0: ["u1", "u2"], u1: ["u0"], u2: ["u0"] },
  loaded: ["u0", "u1", "u2"],
  ratings: { u1: { i0: 1 }, u2: { i0: 1 } },
};
const result = computeUser(snapshot, "u0", null, null);
console.log(JSON.stringify(result));
// Two fresh friends, π̃ = 1 each, ℓ = logit(0.65): s = 2ℓ/(1 + 2ℓ). Same number as the
// hand_computed_three_user_graph test.
const expected = (2 * Math.log(0.65 / 0.35)) / (1 + 2 * Math.log(0.65 / 0.35));
if (Math.abs(result.scores.i0.score - expected) > 1e-9) {
  console.error(`expected ${expected}, got ${result.scores.i0.score}`);
  process.exit(1);
}
if (result.boundaryResidual !== 0 || result.boundaryNodes.length !== 0) {
  console.error(`a fully loaded snapshot has no boundary: ${JSON.stringify(result.boundaryNodes)}`);
  process.exit(1);
}
// The settling loop's own report, which is half of what the bar quantizes to: a movement, a
// pass count, and whether the loop stopped on the tolerance or on the cap.
if (!Number.isFinite(result.settleMovement) || !(result.passes >= 1) || result.settled !== true) {
  console.error(`the loop did not report a settled answer: ${JSON.stringify(result)}`);
  process.exit(1);
}

// The masses the walk produced, handed back with no walk at all (DESIGN 3.4). The caller
// established the graph had not moved; the scores must land where the walk left them, and the
// two errors must be the ones that walk reported rather than numbers invented here.
const walk = {
  truncation: result.truncation,
  boundaryResidual: result.boundaryResidual,
  settleMovement: result.settleMovement,
  passes: result.passes,
  settled: result.settled,
};
const rescored = rescoreUser(snapshot, "u0", result.reachMasses, walk, null, null);
if (Math.abs(rescored.scores.i0.score - result.scores.i0.score) > 1e-12) {
  console.error(`a rescore moved the answer: ${JSON.stringify(rescored.scores)}`);
  process.exit(1);
}
for (const [field, value] of Object.entries(walk)) {
  if (rescored[field] !== value) {
    console.error(`a rescore reported ${field} ${rescored[field]}, not the walk's ${value}`);
    process.exit(1);
  }
}

// The same graph with u2's friend list unread: u2 is a boundary node, not a leaf, and the mass
// that stopped there is reported rather than lost.
const partial = computeUser({ ...snapshot, loaded: ["u0", "u1"] }, "u0", null, null);
if (partial.boundaryNodes.length !== 1 || partial.boundaryNodes[0].id !== "u2") {
  console.error(`expected u2 at the boundary, got ${JSON.stringify(partial.boundaryNodes)}`);
  process.exit(1);
}

// A crafted ratings map must not fail the viewer's recompute: values that are not thumbs and
// keys whose halves are not usable ids are dropped, and the rest still computes. Every bad key
// carries a real thumb, so it is the key that gets it dropped: a control character, and a second
// join inside the tag half.
const crafted = computeUser(
  { ...snapshot, ratings: { ...snapshot.ratings, u1: { i0: 1, i1: 1.5, "caf\u0007e": 1, "a\u0000b\u0000c": 1 } } },
  "u0",
  null,
  null,
);
if (Math.abs(crafted.scores.i0.score - expected) > 1e-9 || Object.keys(crafted.scores).length !== 1) {
  console.error(`crafted ratings changed the result: ${JSON.stringify(crafted.scores)}`);
  process.exit(1);
}

// `suggestFor` across the same boundary (DESIGN 5.1). One lane six hops long: the walk halves
// its mass at every hop, so `h` holds 2^-5 friend-units — enough for the deep search to rank
// them and far too little for the on-demand budget to call them influential already.
const lane = ["a", "c1", "c2", "c3", "c4", "h"];
const contested = Array.from({ length: 40 }, (_, index) => `item${index}`);
const thumbs = (sign) =>
  Object.fromEntries(contested.map((item, index) => [item, (index % 2 === 0 ? 1 : -1) * sign]));
const tasteSnapshot = {
  users: ["u", "b", ...lane],
  friendIds: {
    u: ["a", "b"],
    b: ["u"],
    a: ["u", "c1"],
    c1: ["a", "c2"],
    c2: ["c1", "c3"],
    c3: ["c2", "c4"],
    c4: ["c3", "h"],
    h: ["c4"],
  },
  loaded: ["u", "b", ...lane],
  // `b` disagrees with everything, which is what makes the items contested and the overlap
  // worth anything at all; the chain rates nothing and is reach rather than evidence.
  ratings: { u: thumbs(1), a: thumbs(1), h: thumbs(1), b: thumbs(-1) },
};
const discoverable = ["a", "b", ...lane];
const suggestions = suggestFor(tasteSnapshot, "u", discoverable, [], null, null);
console.log(JSON.stringify(suggestions));
if (suggestions.length !== 1 || suggestions[0].uid !== "h") {
  console.error(`expected h to be the one suggestion, got ${JSON.stringify(suggestions)}`);
  process.exit(1);
}
if (suggestions[0].overlap < 20) {
  console.error(`a suggestion under the overlap floor: ${JSON.stringify(suggestions[0])}`);
  process.exit(1);
}
// Dismissed, and not discoverable: the same absence by two different routes.
if (suggestFor(tasteSnapshot, "u", discoverable, ["h"], null, null).length !== 0) {
  console.error("a dismissed person was suggested again");
  process.exit(1);
}
if (suggestFor(tasteSnapshot, "u", ["a", "b"], [], null, null).length !== 0) {
  console.error("somebody who turned discoverability off was suggested");
  process.exit(1);
}

// DESIGN 2.10 across the boundary: every recompute reports the pair tallies a statement in the
// database pools into `private.params`, and a `priors` object moves the table field by field —
// a friend prior of 0.8 is a bigger `a-hat` and so a bigger score on the very same snapshot.
if (!result.pairs || !Number.isFinite(result.pairs.d1.rateTotal)) {
  console.error(`no pair tallies on a result: ${JSON.stringify(result.pairs)}`);
  process.exit(1);
}
const withPrior = computeUser(snapshot, "u0", null, { a0: { d1: 0.8 } });
const raised = (2 * Math.log(0.8 / 0.2)) / (1 + 2 * Math.log(0.8 / 0.2));
if (Math.abs(withPrior.scores.i0.score - raised) > 1e-9) {
  console.error(`expected ${raised} under the estimated prior, got ${withPrior.scores.i0.score}`);
  process.exit(1);
}
// Nulls, missing fields and a value the algorithm has no answer for all mean "keep the table".
for (const priors of [{ kappa: null, a0: {} }, { a0: { d1: 1.5 }, kappa: -3 }, {}]) {
  const fallen = computeUser(snapshot, "u0", null, priors);
  if (Math.abs(fallen.scores.i0.score - expected) > 1e-9) {
    console.error(`${JSON.stringify(priors)} should have fallen back to the table`);
    process.exit(1);
  }
}
