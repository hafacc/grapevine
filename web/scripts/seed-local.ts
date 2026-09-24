// Loads a simulated world into the running local stack, in exactly the shapes
// the schema and the policies expect, so both Edge Functions and the list can
// be exercised against something with a real graph in it.
//
//   supabase start                 # shell 1, the whole backend
//   cd web && bun run seed:local   # shell 2
//
// The world comes from the crate (`cargo run --example dump-world`), which is
// where the graph, the ratings and the clustering that make a result worth
// looking at already live. `--world <path>` reuses a dump; otherwise this writes
// one at `--world-out` (or somewhere throwaway) and prints where, so the stack
// and `compute-user` can be handed the same file (`check:recs-parity`).
//
// Everything in `public` is written as the service role, which no policy applies
// to — but only rows a client could have written itself, because a fixture the
// policies would refuse is a fixture that proves nothing.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFold } from "grapevine-shared";
import type postgres from "postgres";
import {
  authUserRow,
  ownerSql,
  serviceRoleSql,
  uuidOf,
} from "./local-session.mjs";

type Sql = ReturnType<typeof postgres>;

type World = {
  readonly snapshot: {
    readonly users: readonly string[];
    readonly friendIds: Readonly<Record<string, readonly string[]>>;
    readonly ratings: Readonly<
      Record<string, Readonly<Record<string, number>>>
    >;
  };
  readonly items: readonly string[];
};

/**
 * How many rows go in one statement.
 *
 * What bounds a statement is Postgres' 65 535 parameters, and a row in the
 * widest table below is nineteen of them.
 */
const ROWS_PER_STATEMENT = 1_000;

/** What the crate joins an item to one of its attributes with. */
const RATABLE_JOIN = String.fromCodePoint(0);

function argument(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

/** Handles have to match `profiles.username`'s CHECK: a letter, then 2–19 more. */
export function handleOf(uid: string): string {
  return `person${uid.replace(/\D/g, "")}`;
}

/**
 * The address on the seeded account's `auth.users` row.
 *
 * Not a door: there is no email provider, nothing sends mail, and no password
 * exists. A Google account always carries an address, so a seeded one does
 * too, and a check minting a session for a seeded person has one to put in the
 * claim.
 */
export function emailOf(uid: string): string {
  return `${uid}@example.com`;
}

/**
 * A few of the simulator's `i0`… ids under names a person would actually type,
 * so that every check runs over an accent, a script with no Latin in it and a
 * space between two words rather than over ASCII alone.
 *
 * `café bleu` is the one the written checks name: its `search_id` is
 * `cafe bleu`, so typing the unaccented spelling has to find it.
 */
const NAMED_ITEMS: Readonly<Record<string, string>> = {
  i0: "café bleu",
  i1: "日本",
  i2: "late night diner",
  i3: "o'brien's",
};

/**
 * The id this thing is stored and drawn under — there is no second field for a
 * name (DESIGN §3.2), so this IS the display text and it has to be something
 * `normalizeId` would have emitted.
 */
export function itemIdOf(simulated: string): string {
  return NAMED_ITEMS[simulated] ?? simulated;
}

function dumpWorld(): string {
  // `--world-out` so a checker can hand the same file to `compute-user`
  // afterwards; without it the dump goes somewhere throwaway.
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
      // How far apart people are, which is the whole subject of a world seeded
      // for taste search: at the default density everyone is two hops from
      // everyone and nobody is far enough away to be a suggestion.
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

/** Both endpoints of an edge name each other, or it is not an edge. */
function mutualFriends(world: World): Map<string, string[]> {
  const listed = new Map<string, Set<string>>();
  for (const [uid, names] of Object.entries(world.snapshot.friendIds)) {
    listed.set(uid, new Set(names));
  }
  const mutual = new Map<string, string[]>();
  for (const uid of world.snapshot.users) {
    const theirs = listed.get(uid) ?? new Set<string>();
    mutual.set(
      uid,
      [...theirs].filter((friend) => listed.get(friend)?.has(uid) === true),
    );
  }
  return mutual;
}

const worldPath = argument("--world", "") || dumpWorld();
const world: World = JSON.parse(readFileSync(worldPath, "utf8"));
const friends = mutualFriends(world);
const creator = uuidOf(world.snapshot.users[0] ?? "u0");

// Two connections, because they are two rights. Everything in `public` goes
// through the service role, so that `0002_grants.sql` is what decides whether a
// fixture lands rather than a superuser connection string; `auth.users` belongs
// to GoTrue, which grants the service role nothing there, so the owner writes
// that one table and nothing else.
const owner: Sql = ownerSql();
const sql: Sql = serviceRoleSql();

console.log(`seeding the local stack from ${worldPath}`);

// `public.profiles.id` references `auth.users`, and `private.handle_new_user()`
// fires on this insert to create the profile and the prefs row — so this is not
// a fixture for a door, it is the row the rest of the schema hangs off. What
// each column is for is in `authUserRow`, which the signed-in checks share.
const accounts = world.snapshot.users.map((uid) =>
  authUserRow(uuidOf(uid), emailOf(uid), `Person ${uid}`),
);
for (let start = 0; start < accounts.length; start += ROWS_PER_STATEMENT) {
  const slice = accounts.slice(start, start + ROWS_PER_STATEMENT);
  await owner`insert into auth.users ${owner(slice)} on conflict (id) do nothing`;
}
console.log(`  ${accounts.length} auth accounts`);

// An UPDATE rather than an insert: the trigger has already created these rows,
// named from the metadata above. What is added here is the handle — which
// `claim_username` would otherwise be the only way to set, since there is no
// UPDATE privilege on the column — and `searchable`, without which a seeded
// person can be neither found by handle nor suggested to anybody.
const profileIds: string[] = world.snapshot.users.map((uid) => uuidOf(uid));
const handles: string[] = world.snapshot.users.map((uid) => handleOf(uid));
const displayNames: string[] = world.snapshot.users.map(
  (uid) => `Person ${uid}`,
);
await sql`
  update public.profiles as p
     set username = named.username,
         display_name = named.display_name,
         searchable = true
    from unnest(${profileIds}::uuid[], ${handles}::text[], ${displayNames}::text[])
           as named(id, username, display_name)
   where p.id = named.id`;
console.log(`  ${profileIds.length} profiles and handles`);

// Both directions, and in one transaction. `friendships_symmetric` is deferred
// to commit, so a chunk boundary between the two halves of an edge would be a
// one-sided friendship at the moment the statement committed — which is exactly
// what the trigger exists to refuse.
const edges: { user_id: string; friend_id: string }[] = [];
for (const uid of world.snapshot.users) {
  for (const friend of friends.get(uid) ?? []) {
    edges.push({ user_id: uuidOf(uid), friend_id: uuidOf(friend) });
  }
}
await sql.begin(async (tx) => {
  for (let start = 0; start < edges.length; start += ROWS_PER_STATEMENT) {
    const slice = edges.slice(start, start + ROWS_PER_STATEMENT);
    await tx`insert into public.friendships ${tx(slice)} on conflict do nothing`;
  }
});
console.log(`  ${edges.length} friend edges`);

// `created_by` is supplied rather than left to its `auth.uid()` default, which
// is null outside a request. The column is nullable — null is what a deleted
// account leaves behind, since it is `on delete set null` — so forgetting this
// would seed an
// unattributed catalog instead of failing, which is why it is named here.
// `search_id` comes from `searchFold` and from nowhere else: the client writes
// it, no SQL strips anything, and a second implementation that disagreed would
// be a row nobody can find by its own name (DESIGN §3.2). Seeding is a client
// here like any other.
const items = world.items.map((simulated) => {
  const id = itemIdOf(simulated);
  return { id, search_id: searchFold(id), created_by: creator };
});
for (let start = 0; start < items.length; start += ROWS_PER_STATEMENT) {
  const slice = items.slice(start, start + ROWS_PER_STATEMENT);
  await sql`insert into public.items ${sql(slice)} on conflict (id) do nothing`;
}
console.log(`  ${items.length} items`);

// Every account opted in to taste search. The switch ships off, so a seeded
// world without this would have nobody to suggest and nobody to suggest them to
// — the checks that exercise the feature need everyone in the channel, and one
// of them turns a single account back off to see the difference.
await sql`
  update public.user_prefs
     set discoverable_by_taste = true
   where user_id = any(${profileIds}::uuid[])`;
console.log(`  ${profileIds.length} prefs rows in the channel`);

// One row per thumb, keyed by columns. The crate hands its ratings back under
// one key per rated thing, the item and the attribute joined by a NUL — the
// join belongs to the core and to the wasm boundary, and nothing stores it, so
// it is split here (DESIGN §3.2).
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
      tag,
      value,
    });
  }
}
for (let start = 0; start < ratings.length; start += ROWS_PER_STATEMENT) {
  const slice = ratings.slice(start, start + ROWS_PER_STATEMENT);
  await sql`
    insert into public.ratings ${sql(slice)}
    on conflict (user_id, item_id, tag) do update set value = excluded.value`;
}
console.log(`  ${ratings.length} ratings`);

await owner.end();
await sql.end();
console.log(`done — world at ${worldPath}`);
