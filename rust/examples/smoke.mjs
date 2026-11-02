// Smoke test for the wasm-pack build. Run after
//   bash scripts/build-wasm.sh nodejs
// with: node rust/examples/smoke.mjs
import { createRequire } from "node:module";
const { computeUserTensor, layOut } = createRequire(import.meta.url)(
  "../core-wasm/grapevine_core.js",
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The input form the browser produces: whom the viewer follows, and ratings exactly as the
// `ratings` rows carry them.
const snapshot = {
  users: ["u0", "u1", "u2"],
  follows: { u0: ["u1", "u2"] },
  ratings: { u1: { i0: 1 }, u2: { i0: 1 } },
};
// The viewer has rated nothing and follows two accounts that both thumb i0 up. The numbers are
// `cargo test`'s to pin; what is checked here is that they cross the boundary and lean the way two
// thumbs up must.
const result = computeUserTensor(snapshot, "u0");
console.log(JSON.stringify(result));
const fields = Object.keys(result).sort().join(",");
if (fields !== "plot,scores,viewer") fail(`unexpected result shape: ${fields}`);
const plain = result.scores.i0.score;
if (!(plain > 0 && plain < 1)) {
  fail(`two thumbs up are above the middle and short of the end: ${plain}`);
}
if (result.scores.i0.confidence !== 2) {
  fail(`two accounts stand behind two thumbs: ${result.scores.i0.confidence}`);
}
if (result.viewer !== "u0") fail(`the wrong viewer: ${JSON.stringify(result)}`);
// The plot carries a point per thing and per attribute, liking under the empty name.
const point = result.plot.things.i0;
if (!(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) {
  fail(`the plot has no point for the thing: ${JSON.stringify(result.plot)}`);
}
if (!Array.isArray(result.plot.attributes[""])) {
  fail(`the plot has no point for liking: ${JSON.stringify(result.plot)}`);
}

// The rank is the caller's to pick among the ones that are built, and a point has as many
// numbers as the rank.
if (computeUserTensor(snapshot, "u0", 2).plot.things.i0.length !== 2) {
  fail("a result of rank two has points of some other size");
}
let refused = false;
try {
  computeUserTensor(snapshot, "u0", 7);
} catch {
  refused = true;
}
if (!refused) fail("a rank that is not built did not throw");

// A plot's points are laid out in the plane by name, each inside the square.
const places = layOut({ a: [0, 0, 1], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 1] });
for (const name of ["a", "b", "c", "d"]) {
  const place = places[name];
  if (!(Array.isArray(place) && place.length === 2 && place.every((value) => Math.abs(value) <= 1))) {
    fail(`the layout left ${name} unplaced: ${JSON.stringify(places)}`);
  }
}

// Following is one way: an account the viewer does not follow is not heard, whoever it follows.
const unfollowed = computeUserTensor({ ...snapshot, follows: { u0: ["u1"], u2: ["u0"] } }, "u0");
if (!(unfollowed.scores.i0.score > 0 && unfollowed.scores.i0.score < plain)) {
  fail(`an account nobody follows was heard: ${JSON.stringify(unfollowed.scores)}`);
}

// A crafted ratings map must not fail the viewer's list: values that are not thumbs and keys
// whose halves are not usable ids are dropped, and the rest still computes. Every bad key carries
// a real thumb, so it is the key that gets it dropped: a control character, and a second join
// inside the tag half.
const crafted = computeUserTensor(
  { ...snapshot, ratings: { ...snapshot.ratings, u1: { i0: 1, i1: 1.5, i2: 2, "caf\u0007e": 1, "a\u0000b\u0000c": 1 } } },
  "u0",
);
if (Math.abs(crafted.scores.i0.score - plain) > 1e-9 || Object.keys(crafted.scores).length !== 1) {
  fail(`crafted ratings changed the result: ${JSON.stringify(crafted.scores)}`);
}

// An attribute crosses the boundary as the thing's id and the attribute joined by a NUL, and
// comes back so, with the thing it is on.
const tagged = computeUserTensor({ ...snapshot, ratings: { u1: { "i0\u0000quiet": 1 } } }, "u0");
if (!(tagged.scores["i0\u0000quiet"]?.applies > 0.5 && "i0" in tagged.scores)) {
  fail(`a thumb on an attribute did not come back as an entry: ${JSON.stringify(tagged.scores)}`);
}

// Every rank from one to six is built.
for (const rank of [1, 4, 5, 6]) {
  if (computeUserTensor(snapshot, "u0", rank).plot.things.i0.length !== rank) {
    fail(`a result of rank ${rank} has points of some other size`);
  }
}

// It throws on what the caller can act on: a viewer the snapshot does not name.
let threw = false;
try {
  computeUserTensor(snapshot, "nobody");
} catch {
  threw = true;
}
if (!threw) fail("an unknown viewer did not throw");
console.log("smoke: ok");
