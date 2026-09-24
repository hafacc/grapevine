// "The Edge Function uses the core unchanged": seed a world, let
// `refresh-recs` write one viewer's feed, then compute the same viewer straight
// out of the crate on the same dump and compare every stored number.
//
//   supabase start                      # shell 1, the whole backend.
//   cd web && bun run check:recs-parity  # shell 2. Needs a Rust toolchain.
//
// It seeds into the running stack rather than bringing one up: `supabase start`
// is a daemon, and a check that started one would either leave it running or
// stop the stack every other check is using.
//
// The two sides run the same code on the same snapshot, but one of them runs it
// in WebAssembly under Deno: `exp`, `ln` and `atanh` come from a different libm
// there, so the last bits of a score can differ. 1e-9 is the tolerance asked
// for, and the largest disagreement is printed either way.
//
// The world is the seeding default — 40 people — because the
// node cap must not bind, or a boundary term could explain a difference that is
// really a change in the core.

import { spawnSync } from "node:child_process";

import { expect, finish, refreshAs, seedWorld } from "./harness.mjs";
import { serviceRoleSql, uuidOf } from "./local-session.mjs";

const TOLERANCE = 1e-9;

// Not one of the five `check:recs-function` rates something extra for: this
// one's ratings have to be exactly what the dump says.
const VIEWER = "u7";

const world = seedWorld({ prefix: "grapevine-parity-" });

const sql = serviceRoleSql();

console.log(`\nthe function's feed for ${VIEWER}`);
const result = await refreshAs(uuidOf(VIEWER), `${VIEWER}@example.com`);
expect("the function recomputed it", result.recomputed === true);

// Read back from the row rather than from the response. The two are the same
// feed and that is exactly the claim: what a cold start loads has to be what the
// call that computed it returned.
const [stored] = await sql`
  select entries from public.user_recs where user_id = ${uuidOf(VIEWER)}::uuid`;
const entries = Array.isArray(stored?.entries) ? stored.entries : [];
expect("it wrote one user_recs row", Boolean(stored));
expect("with entries in it", entries.length > 0, `entries: ${entries.length}`);
expect(
  "and the inline answer is the row",
  JSON.stringify(result.entries) === JSON.stringify(entries),
  `${result.entries?.length} inline, ${entries.length} stored`,
);

console.log("\nthe same viewer, straight out of the crate");
const crate = spawnSync(
  "cargo",
  [
    "run",
    "--release",
    "--quiet",
    "--features",
    "serde",
    "--example",
    "compute-user",
    "--",
    world,
    VIEWER,
  ],
  {
    cwd: join(import.meta.dirname, "..", "..", "rust"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);
if (crate.status !== 0) {
  console.error(crate.stderr);
  process.exit(1);
}
const native = JSON.parse(crate.stdout);

// The function folds `scores` (keyed by ratable) into one entry per item, so the
// comparison unfolds it again rather than trusting the fold to be its own check.
let worst = 0;
let worstAt = "";
function compare(name, stored, expected) {
  const gap = Math.abs(stored - expected);
  if (gap > worst) {
    worst = gap;
    worstAt = name;
  }
  return gap <= TOLERANCE;
}

const seen = new Set();
let itemMismatches = 0;
let tagMismatches = 0;
for (const entry of entries) {
  const own = native.scores[entry.itemId];
  if (own) {
    seen.add(entry.itemId);
    if (
      !compare(`${entry.itemId}.score`, entry.score, own.score) ||
      !compare(`${entry.itemId}.conf`, entry.conf, own.confidence)
    ) {
      itemMismatches += 1;
    }
  } else if (entry.conf !== 0 || entry.score !== 0) {
    // An item with no ratable of its own is the `conf: 0` carrier of its tags
    // (DESIGN §3.4); anything else there is a number the crate never produced.
    itemMismatches += 1;
  }
  for (const [tag, score] of Object.entries(entry.tags)) {
    const ratable = `${entry.itemId}~${tag}`;
    const theirs = native.scores[ratable];
    seen.add(ratable);
    if (!theirs || !compare(`${ratable}.score`, score, theirs.score)) {
      tagMismatches += 1;
    }
  }
}

expect(
  `every stored item score matches the crate to ${TOLERANCE}`,
  itemMismatches === 0,
  `${itemMismatches} of ${entries.length} entries`,
);
expect(
  `every stored tag score matches the crate to ${TOLERANCE}`,
  tagMismatches === 0,
  `${tagMismatches} tags`,
);
expect(
  "the stored feed covers exactly the ratables above the display floor",
  seen.size === Object.keys(native.scores).length,
  `stored ${seen.size}, crate ${Object.keys(native.scores).length}`,
);

await sql.end();
console.log(
  `\nlargest disagreement: ${worst.toExponential(3)}${worstAt ? ` at ${worstAt}` : ""}`,
);
finish();
