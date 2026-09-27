// Smoke test for the wasm-pack build. Run after
//   bash scripts/build-wasm.sh nodejs
// with: node rust/examples/smoke.mjs
import { createRequire } from "node:module";
const { computeUser } = createRequire(import.meta.url)("../core-wasm/grapevine_core.js");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The witness model on the three-user graph of `tests/mechanics.rs`, worked in plain JavaScript:
// two friends with no history, each read at the grid's prior mean, each their own region, each
// thumbing i0 up against a base rate of 2/3 (the other two people's thumbs, Beta(1,1)).
function priorReliability(rate, strength) {
  const grid = 16;
  const alpha = strength * rate;
  const beta = strength * (1 - rate);
  let total = 0;
  let weighted = 0;
  for (let index = 0; index < grid; index++) {
    const lambda = -1 + ((index + 0.5) * 2) / grid;
    const share = (1 + lambda) / 2;
    const weight = Math.exp((alpha - 1) * Math.log(share) + (beta - 1) * Math.log(1 - share));
    total += weight;
    weighted += weight * lambda;
  }
  return weighted / total;
}
function expectedScore(rate) {
  const lambda = priorReliability(rate, 8);
  const up = 2 / 3;
  const evidence = Math.min(2, Math.log((lambda + (1 - lambda) * up) / ((1 - lambda) * up)));
  const start = (1 + 2 * lambda) / (2 + 2 * lambda);
  return Math.tanh((Math.log(start / (1 - start)) + 2 * evidence) / 2);
}

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
const fields = Object.keys(result).sort().join(",");
if (fields !== "boundaryNodes,pairs,reached,scores,viewer") fail(`unexpected result shape: ${fields}`);
const expected = expectedScore(0.65);
if (Math.abs(result.scores.i0.score - expected) > 1e-9) {
  fail(`expected ${expected}, got ${result.scores.i0.score}`);
}
if (!(result.scores.i0.confidence > 0 && result.scores.i0.confidence < 2)) {
  fail(`W is the regions' thumbs as the viewer's own: ${result.scores.i0.confidence}`);
}
if (result.viewer !== "u0" || result.reached !== 2 || result.boundaryNodes.length !== 0) {
  fail(`a fully loaded snapshot has no boundary: ${JSON.stringify(result)}`);
}

// The same graph with u2's friend list unread: u2 is on the boundary at the prior's strength
// (the viewer counts as a chain of one), not reached.
const partial = computeUser({ ...snapshot, loaded: ["u0", "u1"] }, "u0", null, null);
if (
  partial.boundaryNodes.length !== 1 ||
  partial.boundaryNodes[0].id !== "u2" ||
  Math.abs(partial.boundaryNodes[0].strength - 0.3) > 1e-12 ||
  partial.reached !== 1
) {
  fail(`expected u2 on the boundary at 0.3: ${JSON.stringify(partial)}`);
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
  fail(`crafted ratings changed the result: ${JSON.stringify(crafted.scores)}`);
}

// A thumb marked as given after the viewer's own (±2, DESIGN 3.4) is the same thumb: here nobody
// shares anything with the viewer, so its order changes nothing.
const marked = computeUser({ ...snapshot, ratings: { u1: { i0: 2 }, u2: { i0: 1 } } }, "u0", null, null);
if (Math.abs(marked.scores.i0.score - expected) > 1e-9) {
  fail(`a thumb marked later was not read as a thumb: ${JSON.stringify(marked.scores)}`);
}

// And where the viewer did share things, the bit crosses the boundary: a friend who agreed on
// five things before the viewer rated them predicted, one who agreed after copied, so the first
// earns more reliability and carries i9, which only that friend rated, further.
const shared = ["a", "b", "c", "d", "e"];
const orderSnapshot = (value) => ({
  ...snapshot,
  ratings: {
    u0: Object.fromEntries(shared.map((item) => [item, 1])),
    u1: { ...Object.fromEntries(shared.map((item) => [item, value])), i9: 1 },
  },
});
const predicted = computeUser(orderSnapshot(1), "u0", null, null).scores.i9?.score;
const copied = computeUser(orderSnapshot(2), "u0", null, null).scores.i9?.score;
if (!(Number.isFinite(predicted) && Number.isFinite(copied) && predicted > copied)) {
  fail(`the order bit did not cross the boundary: before ${predicted}, after ${copied}`);
}

// DESIGN 2.9 across the boundary: every recompute reports the pair tallies a statement in the
// database pools into `private.params`, and a `priors` object moves the table field by field —
// `a0.d1` is the prior's mean, `kappa` its strength; `a0.d2` and `a0.d3plus` are read and ignored.
for (const moments of [result.pairs.d1, result.pairs.d2, result.pairs.d3plus]) {
  for (const field of ["pairs", "rateTotal", "rateSquares", "overlapTotal"]) {
    if (!Number.isFinite(moments?.[field])) fail(`no pair tallies on a result: ${JSON.stringify(result.pairs)}`);
  }
}
const withPrior = computeUser(snapshot, "u0", null, { kappa: 8, a0: { d1: 0.8, d2: 0.1, d3plus: 0.1 } });
const raised = expectedScore(0.8);
if (Math.abs(withPrior.scores.i0.score - raised) > 1e-9) {
  fail(`expected ${raised} under the estimated prior, got ${withPrior.scores.i0.score}`);
}
// Nulls, missing fields and a value the algorithm has no answer for all mean "keep the table".
for (const priors of [{ kappa: null, a0: {} }, { a0: { d1: 1.5 }, kappa: -3 }, {}, { a0: null }]) {
  const fallen = computeUser(snapshot, "u0", null, priors);
  if (Math.abs(fallen.scores.i0.score - expected) > 1e-9) {
    fail(`${JSON.stringify(priors)} should have fallen back to the table`);
  }
}
// It throws on what the caller can act on: an unknown viewer, or a parameter out of range.
for (const [what, call] of [
  ["an unknown viewer", () => computeUser(snapshot, "nobody", null, null)],
  ["a prior strength of zero", () => computeUser(snapshot, "u0", { priorStrength: 0 }, null)],
]) {
  let threw = false;
  try {
    call();
  } catch {
    threw = true;
  }
  if (!threw) fail(`${what} did not throw`);
}
console.log("smoke: ok");
