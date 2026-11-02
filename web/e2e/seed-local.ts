// Loads a simulated world into the running local stack as accounts, follows
// and thumbs, so the list a browser computes can be exercised against
// something with a real graph in it.
//
//   supabase start                           # shell 1, the whole backend, or
//   bash supabase/tests/serve-local.sh       # the same without Docker
//   cd web && bun seed:local                 # shell 2
//
// The world comes from the crate (`cargo run --example dump-world`), which is
// where the graph, the ratings and the clustering that make a result worth
// looking at already live. `--world <path>` reuses a dump; otherwise this
// writes one at `--world-out` (or somewhere throwaway) and prints where.
//
// Everything in `public` is written as the service role, which no policy
// applies to, and only as rows the app's own calls could have left: a fixture
// the schema would refuse a person is a fixture that proves nothing.
//
// Seeding again puts the seeded people back as the world has them: their
// follows and thumbs are replaced, so what a test added is gone.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFold } from "grapevine-shared";
import {
  authUserRow,
  ownerSql,
  requireStack,
  type Sql,
  serviceRoleSql,
  uuidOf,
} from "./local-session.ts";
import {
  itemIdOf,
  RATABLE_JOIN,
  SEEDED_PREFILLED,
  tagOf,
} from "./seeded-names.ts";

type World = {
  readonly snapshot: {
    readonly users: readonly string[];
    /** Who each person follows. The simulator's graph has every pair both ways. */
    readonly follows: Readonly<Record<string, readonly string[]>>;
    readonly ratings: Readonly<
      Record<string, Readonly<Record<string, number>>>
    >;
  };
  readonly items: readonly string[];
  /** Per person, per item in `items`' order: what they would say of it. */
  readonly truePreference: readonly (readonly number[])[];
};

/**
 * How many rows go in one statement.
 *
 * What bounds a statement is Postgres' 65 535 parameters, and a row in the
 * widest table below is nineteen of them.
 */
const ROWS_PER_STATEMENT = 1_000;

// The prefilled account rates one thing in this many, so a person who follows
// it has a list that it shaped and did not wholly write.
const PREFILLED_RATES_ONE_IN = 4;

function argument(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

/**
 * The address on the seeded account's `auth.users` row.
 *
 * Not a door: there is no email provider, nothing sends mail, and no password
 * exists. A Google account always carries an address, so a seeded one does
 * too, and a test minting a session for a seeded person has one to put in the
 * claim.
 */
export function emailOf(uid: string): string {
  return `${uid}@example.com`;
}

function dumpWorld(): string {
  const out =
    argument("--world-out", "") ||
    join(mkdtempSync(join(tmpdir(), "grapevine-world-")), "world.json");
  const run = spawnSync(
    "cargo",
    [
      "run",
      "--release",
      "--features",
      "serde",
      "--example",
      "dump-world",
      "--",
      "--seed",
      argument("--seed", "7"),
      "--users",
      argument("--users", "40"),
      "--items",
      argument("--items", "60"),
      "--rated-fraction",
      argument("--rated-fraction", "0.35"),
      // How far apart people are: at the simulator's default density everyone
      // follows nearly everyone.
      "--p-same-cluster",
      argument("--p-same-cluster", "0.18"),
      "--p-other-cluster",
      argument("--p-other-cluster", "0.02"),
      // Attributes, which the simulator leaves out unless asked.
      "--tag-rated-fraction",
      argument("--tag-rated-fraction", "0.25"),
      "--out",
      out,
    ],
    { cwd: join(import.meta.dir, "..", "..", "rust"), stdio: "inherit" },
  );
  if (run.status !== 0) throw new Error("dump-world failed");
  return out;
}

/**
 * What the prefilled account says: of every few things, what most of the
 * world's people would. A critic the world mostly agrees with, so following
 * one moves a list in a direction a reader can predict.
 */
type PrefilledThumb = {
  readonly item: string;
  readonly search_id: string;
  readonly value: number;
};

function prefilledThumbs(world: World): PrefilledThumb[] {
  const thumbs: PrefilledThumb[] = [];
  world.items.forEach((simulated, index) => {
    if (index % PREFILLED_RATES_ONE_IN !== 0) return;
    const leaning = world.truePreference.reduce(
      (total, theirs) => total + (theirs[index] ?? 0),
      0,
    );
    const id = itemIdOf(simulated);
    thumbs.push({
      item: id,
      search_id: searchFold(id),
      value: leaning >= 0 ? 1 : -1,
    });
  });
  thumbs.push({
    item: SEEDED_PREFILLED.ownItem,
    search_id: searchFold(SEEDED_PREFILLED.ownItem),
    value: 1,
  });
  return thumbs;
}

const worldPath = argument("--world", "") || dumpWorld();
const world: World = JSON.parse(readFileSync(worldPath, "utf8"));
const creator = uuidOf(world.snapshot.users[0] ?? "u0");

// Two connections, because they are two rights. Everything in `public` goes
// through the service role, so that the schema's grants decide whether a
// fixture lands rather than a superuser connection string; `auth.users` belongs
// to GoTrue, which grants the service role nothing there, so the owner writes
// that one table and nothing else.
const owner: Sql = ownerSql();
const sql: Sql = serviceRoleSql();
await requireStack(owner);

console.log(`seeding the local stack from ${worldPath}`);

// `private.handle_new_user()` fires on this insert to create the profile, so
// this is not a fixture for a door: it is the row the rest of the schema hangs
// off. What each column is for is in `authUserRow`, which the signed-in tests
// share.
const accounts = world.snapshot.users.map((uid) =>
  authUserRow(uuidOf(uid), emailOf(uid), `Person ${uid}`),
);
for (let start = 0; start < accounts.length; start += ROWS_PER_STATEMENT) {
  const slice = accounts.slice(start, start + ROWS_PER_STATEMENT);
  await owner`insert into auth.users ${owner(slice)} on conflict (id) do nothing`;
}
console.log(`  ${accounts.length} auth accounts`);

// An UPDATE rather than an insert: the trigger has already created these rows,
// from the metadata above, which names them by the first word, `Person`, as it
// would a Google account. The whole name is put back so that a test can tell
// one seeded person from another on screen.
const profileIds: string[] = world.snapshot.users.map((uid) => uuidOf(uid));
const displayNames: string[] = world.snapshot.users.map(
  (uid) => `Person ${uid}`,
);
await sql`
  update public.profiles as p
     set display_name = named.display_name
    from unnest(${profileIds}::uuid[], ${displayNames}::text[])
           as named(id, display_name)
   where p.id = named.id`;
console.log(`  ${profileIds.length} profiles`);

// One row per direction, as the world lists them: a follow is one-way, and the
// simulator's graph is mutual only because it wrote every pair twice. No
// client inserts a follow; each of these is the row `redeem_invite` leaves
// when one person accepts another's link. Replaced rather than added to, so a
// follow a test made is not still there on the next seed.
const follows: { follower_id: string; followed_id: string }[] = [];
for (const [uid, followed] of Object.entries(world.snapshot.follows)) {
  for (const other of followed) {
    follows.push({ follower_id: uuidOf(uid), followed_id: uuidOf(other) });
  }
}
await sql.begin(async (tx) => {
  await tx`delete from public.follows where follower_id = any(${profileIds}::uuid[])`;
  for (let start = 0; start < follows.length; start += ROWS_PER_STATEMENT) {
    const slice = follows.slice(start, start + ROWS_PER_STATEMENT);
    await tx`insert into public.follows ${tx(slice)}`;
  }
});
console.log(`  ${follows.length} follows`);

// `created_by` is supplied rather than left to its `auth.uid()` default, which
// is null outside a request. The column is nullable, since null is what a
// deleted account leaves behind, so forgetting this would seed an unattributed
// catalog instead of failing.
// `search_id` comes from `searchFold` and from nowhere else: the client writes
// it, no SQL strips anything, and a second implementation that disagreed would
// be a row nobody can find by its own name. Seeding is a client here like any
// other.
const items = world.items.map((simulated) => {
  const id = itemIdOf(simulated);
  return { id, search_id: searchFold(id), created_by: creator };
});
for (let start = 0; start < items.length; start += ROWS_PER_STATEMENT) {
  const slice = items.slice(start, start + ROWS_PER_STATEMENT);
  await sql`insert into public.items ${sql(slice)} on conflict (id) do nothing`;
}
console.log(`  ${items.length} items`);

// One row per thumb, keyed by columns. The crate hands its ratings back under
// one key per rated thing, the item and the attribute joined by a NUL. The
// join belongs to the core and to the wasm boundary, and nothing stores it, so
// it is split here.
const ratings: {
  user_id: string;
  item_id: string;
  tag: string;
  value: number;
}[] = [];
for (const [uid, theirs] of Object.entries(world.snapshot.ratings)) {
  for (const [ratable, value] of Object.entries(theirs)) {
    const [simulated, tag = ""] = ratable.split(RATABLE_JOIN);
    ratings.push({
      user_id: uuidOf(uid),
      item_id: itemIdOf(simulated as string),
      tag: tag === "" ? "" : tagOf(tag),
      value,
    });
  }
}
// Replaced, not upserted: a thumb an earlier seed or a test left behind is
// not in the dump.
await sql.begin(async (tx) => {
  await tx`delete from public.ratings where user_id = any(${profileIds}::uuid[])`;
  for (let start = 0; start < ratings.length; start += ROWS_PER_STATEMENT) {
    const slice = ratings.slice(start, start + ROWS_PER_STATEMENT);
    await tx`insert into public.ratings ${tx(slice)}`;
  }
});
console.log(`  ${ratings.length} ratings`);

// The way a prefilled account is loaded anywhere: one call, which makes the
// account by its handle and replaces what it says, so a second seed is the same
// account.
const [loaded] = await sql<{ report: { saved: number } }[]>`
  select private.load_prefilled(
    ${SEEDED_PREFILLED.handle},
    ${SEEDED_PREFILLED.displayName},
    ${sql.json(prefilledThumbs(world))}::jsonb) as report`;
console.log(
  `  1 prefilled account, @${SEEDED_PREFILLED.handle} (${JSON.stringify(loaded?.report)})`,
);

await owner.end();
await sql.end();
console.log(`done: world at ${worldPath}`);
