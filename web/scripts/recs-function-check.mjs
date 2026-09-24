// The Edge Function against the running local stack (the staleness contract):
// seed a simulated world, refresh five people, refresh them again, rate
// something for one of them, refresh once more, and then let one viewer's
// window run out with nothing left to find.
//
//   supabase start                        # shell 1, the whole backend.
//   cd web && bun run check:recs-function  # shell 2
//
// It does not bring its own backend up: `supabase start` is a daemon, so a
// check that started one would either leave it running or stop a stack the
// other checks are using. So this asks for the running stack, and seeds into it
// itself.
//
// Every verdict is read from the database rather than from the response: the
// response is the function's own account of what it did, and what this is
// checking is what it wrote.
//
// Deliberately not in CI: it wants Docker and a built wasm.

import {
  refreshAs as callRefreshRecs,
  expect,
  finish,
  seedWorld,
} from "./harness.mjs";
import { serviceRoleSql, uuidOf } from "./local-session.mjs";

/** Five of the seeded people, by the world's own names. */
const VIEWERS = ["u0", "u1", "u2", "u3", "u4"];

/** DESIGN §3.4's window, which `refresh-recs` keys on `checked_at`. */
const STALE_AFTER_MS = 10 * 60 * 1000;

seedWorld();

const sql = serviceRoleSql();

/**
 * The same call the screen makes.
 */
const refreshAs = (worldUid, body = {}) =>
  callRefreshRecs(uuidOf(worldUid), `${worldUid}@example.com`, body);

const millis = (value) => (value instanceof Date ? value.getTime() : 0);

/** The feed and the model row as the function wrote them: one row each. */
async function feedOf(worldUid) {
  const uid = uuidOf(worldUid);
  const [recs] = await sql`
    select computed_at, entries, feed_hash from public.user_recs
     where user_id = ${uid}::uuid`;
  const [model] = await sql`
    select * from public.user_model where user_id = ${uid}::uuid`;
  return {
    entries: Array.isArray(recs?.entries) ? recs.entries : [],
    feedHash: recs?.feed_hash ?? null,
    feedComputedAt: millis(recs?.computed_at),
    computedAt: millis(model?.computed_at),
    checkedAt: millis(model?.checked_at),
    model: model ?? null,
  };
}

console.log("\nfirst refresh");
const first = new Map();
for (const worldUid of VIEWERS) {
  const result = await refreshAs(worldUid);
  const feed = await feedOf(worldUid);
  first.set(worldUid, feed);
  expect(`${worldUid} recomputed`, result.recomputed === true);
  // The feed comes back inline AND is stored: the response is what the screen
  // paints, the row is the cold start and the offline open.
  expect(
    `${worldUid}'s feed came back with the answer`,
    Array.isArray(result.entries) &&
      result.entries.length === feed.entries.length,
    `${result.entries?.length} inline, ${feed.entries.length} stored`,
  );
  expect(`${worldUid} has one user_recs row`, feed.feedComputedAt > 0);
  expect(`${worldUid} has a user_model row`, feed.computedAt > 0);
  expect(`${worldUid}'s model was stamped as checked`, feed.checkedAt > 0);
  expect(
    `${worldUid}'s model carries the columns DESIGN §3.2 names`,
    feed.model !== null &&
      typeof feed.model.reach === "object" &&
      typeof feed.model.settle_movement === "number" &&
      typeof feed.model.nodes_touched === "number" &&
      typeof feed.model.rating_count === "number" &&
      typeof feed.model.truncation === "number" &&
      typeof feed.model.recomputed === "boolean",
    JSON.stringify(feed.model && Object.keys(feed.model)),
  );
  expect(
    `${worldUid}'s entries carry one row per item`,
    new Set(feed.entries.map((entry) => entry.itemId)).size ===
      feed.entries.length,
  );
  expect(
    `${worldUid}'s entries are sorted by item id`,
    feed.entries.every(
      (entry, at) => at === 0 || feed.entries[at - 1].itemId < entry.itemId,
    ),
  );
}

console.log("\nsecond refresh, straight away");
for (const worldUid of VIEWERS) {
  const result = await refreshAs(worldUid);
  const feed = await feedOf(worldUid);
  expect(`${worldUid} is answered from cache`, result.recomputed === false);
  expect(
    `${worldUid} is told nothing it already has`,
    result.entries === null,
    JSON.stringify(result.entries)?.slice(0, 80),
  );
  expect(
    `${worldUid}'s computed_at did not move`,
    feed.computedAt === first.get(worldUid).computedAt,
    `${first.get(worldUid).computedAt} -> ${feed.computedAt}`,
  );
  // Inside the window nothing is recomputed at all, so there is nothing to
  // record: `checked_at` buys the NEXT window, and this call did not walk.
  expect(
    `${worldUid}'s checked_at did not move either`,
    feed.checkedAt === first.get(worldUid).checkedAt,
    `${first.get(worldUid).checkedAt} -> ${feed.checkedAt}`,
  );
}

console.log("\nthe function refreshes nobody but its caller");
const before = await feedOf("u1");
// A uid in the body is not a request this API can express: there is no
// parameter, so this is u0 refreshing u0.
await refreshAs("u0", { uid: uuidOf("u1") });
const after = await feedOf("u1");
expect(
  "u0 asking for u1 leaves u1's feed alone",
  after.computedAt === before.computedAt,
  `${before.computedAt} -> ${after.computedAt}`,
);

console.log("\na call carrying no session");
const anonymous = await fetch(
  `${LOCAL_SUPABASE_URL}/functions/v1/refresh-recs`,
  {
    method: "POST",
    headers: { "content-type": "application/json", apikey: LOCAL_ANON_KEY },
    body: "{}",
  },
);
expect(
  "is refused, and the anon key alone is not a session",
  anonymous.status === 401,
  `${anonymous.status}`,
);

console.log("\nafter a rating by one of them");
const RATER = "u0";
const raterUid = uuidOf(RATER);
// Something they have NOT said anything about: re-stating a thumb they already
// gave changes no snapshot, so the function would rightly answer that nothing
// moved.
const rated = new Set(
  (
    await sql`select item_id from public.ratings
              where user_id = ${raterUid}::uuid and tag = ''`
  ).map((row) => row.item_id),
);
const fresh = first
  .get(RATER)
  .entries.find((entry) => !rated.has(entry.itemId));
expect("that user has something unrated in their feed", Boolean(fresh));
await sql`
  insert into public.ratings (user_id, item_id, tag, value)
  values (${raterUid}::uuid, ${fresh.itemId}, '', 1)
  on conflict (user_id, item_id, tag) do update set value = excluded.value`;

for (const worldUid of VIEWERS) {
  const result = await refreshAs(worldUid);
  const feed = await feedOf(worldUid);
  if (worldUid === RATER) {
    // "Have the viewer's thumbs changed since the last check?" is one read of
    // `private.ratings_changed`, which only their own ratings move — so their
    // own thumb makes them stale inside the ten-minute window while nobody else
    // moves.
    expect(
      `${worldUid} recomputed after their own rating`,
      result.recomputed === true,
    );
    expect(
      `${worldUid}'s computed_at moved`,
      feed.computedAt > first.get(worldUid).computedAt,
      `${first.get(worldUid).computedAt} -> ${feed.computedAt}`,
    );
    expect(
      `${worldUid}'s rating_count followed the new thumb`,
      feed.model.rating_count === first.get(worldUid).model.rating_count + 1,
      `${first.get(worldUid).model.rating_count} -> ${feed.model.rating_count}`,
    );
  } else {
    expect(
      `${worldUid} is still answered from cache`,
      result.recomputed === false,
    );
    expect(
      `${worldUid}'s feed row did not move`,
      feed.feedComputedAt === first.get(worldUid).feedComputedAt,
      `${first.get(worldUid).feedComputedAt} -> ${feed.feedComputedAt}`,
    );
  }
}

// DESIGN §3.4: staleness keys on `checked_at`, so a viewer whose window has run
// out walks again — and a walk that finds nothing new records the check without
// moving `computed_at`, which is what stops an idle viewer paying a full walk on
// every open past the ten-minute mark. Backdating the stamp is the only way to
// get there without waiting ten minutes; the rater is the viewer to do it to,
// because their last recompute already carries their own new thumb, so this walk
// has nothing left to find.
console.log("\nwhen the staleness window has run out and nothing has changed");
const stale = await feedOf(RATER);
await sql`
  update public.user_model
     set checked_at = checked_at - ${`${STALE_AFTER_MS + 60_000} milliseconds`}::interval
   where user_id = ${raterUid}::uuid`;
const rechecked = await refreshAs(RATER);
const afterRecheck = await feedOf(RATER);
expect("the walk finds nothing new", rechecked.recomputed === false);
expect(
  "computed_at stays where it was",
  afterRecheck.computedAt === stale.computedAt,
  `${stale.computedAt} -> ${afterRecheck.computedAt}`,
);
expect(
  "checked_at is stamped afresh",
  afterRecheck.checkedAt > stale.checkedAt - STALE_AFTER_MS,
  `${stale.checkedAt} -> ${afterRecheck.checkedAt}`,
);
expect(
  "and the feed row is untouched",
  afterRecheck.feedComputedAt === stale.feedComputedAt &&
    afterRecheck.feedHash === stale.feedHash,
  `${stale.feedComputedAt} -> ${afterRecheck.feedComputedAt}`,
);

await sql.end();
finish();
