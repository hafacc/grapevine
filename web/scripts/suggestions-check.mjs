// The similar-taste rows of the people screen end to end: that the search runs
// for the person who asked and nobody else, that a row carries the attributes
// the two of you agree on against the grain, that the yes side sends an
// ordinary friend request, and that the no side hides somebody and keeps them
// hidden across a reload.
//
//   supabase start                              # shell 1, the whole backend
//   supabase functions serve refresh-suggestions # shell 2, the search itself
//   cd web && bun run dev:local                 # shell 3, serves on 3001
//   bun run check:suggestions                   # shell 4
//
// It seeds a world with real distance in it and then calls the search the way
// the people screen does — one person at a time, over HTTP, with that person's
// own token.
//
// The chips are read back through PostgREST as the viewer, because that is who
// calls `shared_attributes`: a check that asked the database as the service role
// would prove the query and none of the grants.
//
// The way in is a minted session (`scripts/local-session.mjs`), not the door —
// `signin-check.mjs`'s header is where that is written down. GRAPEVINE_ORIGIN
// overrides the origin. Deliberately not in CI: it wants a browser and a dev
// server.

import { readFileSync } from "node:fs";

import {
  expect,
  finish,
  openBrowser,
  seedWorld,
  suggestAs,
} from "./harness.mjs";
import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
  mintSession,
  serviceRoleSql,
  signInAs,
  uuidOf,
} from "./local-session.mjs";

const ORIGIN = process.env.GRAPEVINE_ORIGIN ?? "http://localhost:3001";
const PROFILE = "/tmp/grapevine-suggestions-check";

// Sparse enough that people are far apart and rated enough that two strangers
// can still share twenty items' worth of contested opinion. The default seeding
// produces nobody to suggest at all, which is why these numbers are here.
const WORLD = [
  "--users",
  "150",
  "--items",
  "500",
  "--rated-fraction",
  "0.45",
  "--p-same-cluster",
  "0.035",
  "--p-other-cluster",
  "0.002",
];

const worldPath = seedWorld({
  prefix: "grapevine-suggestions-",
  args: WORLD,
});

// The simulator's own names, so a uuid the search answered for can be named
// again — the token is minted per person and the email follows the name.
const world = JSON.parse(readFileSync(worldPath, "utf8"));
const worldUids = world.snapshot.users;

const sql = serviceRoleSql();

// Asks left behind by an earlier run: the seeding rewrites profiles, ratings and
// prefs, but a pending request is a row of its own, and somebody the viewer has
// already asked is somebody the screen rightly never shows again.
const [cleared] = await sql`
  with gone as (delete from public.connect_requests returning 1)
  select count(*)::int as count from gone`;
if (cleared.count > 0)
  console.log(`  cleared ${cleared.count} old connect requests`);

/** `public.shared_attributes`, called as the viewer and not as the server. */
async function chipsFor(viewerUid, viewerEmail, otherUid) {
  const { accessToken } = mintSession(viewerUid, viewerEmail);
  const answer = await fetch(
    `${LOCAL_SUPABASE_URL}/rest/v1/rpc/shared_attributes`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: JSON.stringify({ p_other: otherUid }),
    },
  );
  const result = await answer.json();
  if (!answer.ok)
    throw new Error(`shared_attributes: ${JSON.stringify(result)}`);
  return Array.isArray(result) ? result : [];
}

// A search per person, the way the people screen asks for one.
console.log("\nrunning the search for each seeded person");
const lists = new Map();
for (const worldUid of worldUids) {
  const uid = uuidOf(worldUid);
  const answer = await suggestAs(uid, `${worldUid}@example.com`);
  if (Array.isArray(answer.suggested) && answer.suggested.length > 0) {
    lists.set(uid, { worldUid, suggested: answer.suggested });
  }
}
expect(
  "the search found somebody for somebody",
  lists.size > 0,
  `${lists.size} of ${worldUids.length} people have a list`,
);

const stored = await sql`
  select s.user_id, s.rank, s.suggested_id, p.username, p.display_name
    from public.suggestions s
    join public.profiles p on p.id = s.suggested_id
   order by s.user_id, s.rank`;
const rows = new Map();
for (const row of stored) {
  const list = rows.get(row.user_id) ?? [];
  list.push({
    uid: row.suggested_id,
    username: row.username ?? "",
    displayName: row.display_name ?? "",
  });
  rows.set(row.user_id, list);
}
expect(
  "and what it answered with is what it wrote",
  [...lists].every(
    ([uid, { suggested }]) =>
      JSON.stringify((rows.get(uid) ?? []).map((row) => row.uid)) ===
      JSON.stringify(suggested),
  ),
);

const longest = [...rows.entries()]
  .filter(([, list]) => list.length >= 2)
  .sort((left, right) => right[1].length - left[1].length)[0];
expect("somebody was given at least two suggestions", Boolean(longest));
if (!longest) {
  await sql.end();
  process.exit(1);
}
const [VIEWER, suggested] = longest;
const VIEWER_EMAIL = `${lists.get(VIEWER)?.worldUid ?? "u0"}@example.com`;
console.log(
  `  ${VIEWER} was given ${suggested.map((item) => item.username).join(", ")}`,
);

// A stranger nobody suggested and who sent nothing is not askable about: an
// empty list rather than an error, because an error would separate "nothing in
// common" from "not allowed to ask".
const outsider = worldUids
  .map((name) => uuidOf(name))
  .find((uid) => uid !== VIEWER && !suggested.some((item) => item.uid === uid));
expect(
  "somebody neither suggested nor asking yields no attributes at all",
  (await chipsFor(VIEWER, VIEWER_EMAIL, outsider)).length === 0,
);

const chips = new Map();
for (const item of suggested) {
  chips.set(item.uid, await chipsFor(VIEWER, VIEWER_EMAIL, item.uid));
}
expect(
  "a suggested person's attributes are at most three, and never a count",
  [...chips.values()].every(
    (list) => list.length <= 3 && list.every((tag) => typeof tag === "string"),
  ),
  JSON.stringify([...chips.values()]),
);

// Every person on the screen, in the order it draws them. The similar-taste
// rows are the tail of it: the viewer's own row carries no uid.
const SHOWN = `[...document.querySelectorAll("[data-person]")].map((row) => row.getAttribute("data-person"))`;

const rowText = (uid) => `(() => {
  const row = document.querySelector(${JSON.stringify(`[data-person="${uid}"]`)});
  return row ? row.innerText.replace(/\\s+/g, " ").trim() : null;
})()`;

// One side of one row, by its accessible name. The buttons are welded to the
// row rather than inside it (DESIGN §1.8), so they are found by what they say —
// which is the subject the row was given — and not by descending into it.
const rowSide = (label) => `(() => {
  const found = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
  if (found) found.click();
  return Boolean(found);
})()`;

// Desktop width, because the rows are answered by their side buttons and the
// switch by its button, and at phone width there are neither — only swipes.
const page = await openBrowser({
  port: 9395,
  profile: PROFILE,
  window: "1280,900",
});

console.log("\nsigning in as the person the search answered for");
await signInAs(page, ORIGIN, VIEWER, VIEWER_EMAIL);

console.log("\nthe similar-taste rows on the people screen");
await page.go(`${ORIGIN}/#/people`, 9000);
const shown = await page.evaluate(SHOWN);
const wanted = suggested.map((item) => item.uid);
expect(
  "it shows exactly what the search wrote, in that order",
  JSON.stringify((shown ?? []).filter((uid) => wanted.includes(uid))) ===
    JSON.stringify(wanted),
  `${JSON.stringify(shown)} vs ${JSON.stringify(wanted)}`,
);
expect("it offers at most five", wanted.length <= 5, `${wanted.length}`);

for (const item of suggested) {
  const text = await page.evaluate(rowText(item.uid));
  // The whole row: an avatar's initial, a name, a handle, the attributes the two
  // of you went against the grain on, and one button. Nothing counted, nothing
  // ranked, no number anywhere. (The two sides are welded outside the row, so
  // neither is in its text.) A person with a great deal in common in the
  // ordinary way shows no
  // attribute at all, and the row is drawn without them rather than with filler.
  const name = item.displayName;
  const expected = [
    `${name[0]} ${name} @${item.username}`,
    ...(chips.get(item.uid) ?? []),
  ].join(" ");
  expect(
    `${item.username}'s row carries a name, a handle, the shared attributes and nothing else`,
    text === expected,
    `${text} vs ${expected}`,
  );
}

console.log("\nthe yes side sends an ordinary request");
const [connecting, dismissing] = suggested;
expect(
  "the yes side is there",
  await page.evaluate(
    rowSide(`yes to connecting with ${connecting.displayName || "someone"}`),
  ),
);
await new Promise((done) => setTimeout(done, 3000));
const requests = await sql`
  select from_id, to_id from public.connect_requests
   where from_id = ${VIEWER}::uuid and to_id = ${connecting.uid}::uuid`;
expect(
  "a connect request was written, the same shape as any other",
  requests.length === 1,
  JSON.stringify(requests),
);
expect(
  "the row is gone now that the ask is pending",
  !((await page.evaluate(SHOWN)) ?? []).includes(connecting.uid),
  JSON.stringify(await page.evaluate(SHOWN)),
);
const friendship = await sql`
  select 1 from public.friendships
   where user_id = ${VIEWER}::uuid and friend_id = ${connecting.uid}::uuid`;
expect(
  "and the person is not in the friends list — nothing was accepted for them",
  friendship.length === 0,
);

console.log("\nthe no side hides somebody, and keeps them hidden");
expect(
  "the no side is there",
  await page.evaluate(
    rowSide(`no to connecting with ${dismissing.displayName || "someone"}`),
  ),
);
await new Promise((done) => setTimeout(done, 3000));
expect(
  "the row goes",
  !((await page.evaluate(SHOWN)) ?? []).includes(dismissing.uid),
  JSON.stringify(await page.evaluate(SHOWN)),
);
const [prefs] = await sql`
  select dismissed_suggestions, discoverable_by_taste
    from public.user_prefs where user_id = ${VIEWER}::uuid`;
expect(
  "it was written to the viewer's own prefs, not to the list",
  (prefs?.dismissed_suggestions ?? []).includes(dismissing.uid),
  JSON.stringify(prefs ?? null),
);
const stillListed = await sql`
  select 1 from public.suggestions
   where user_id = ${VIEWER}::uuid and suggested_id = ${dismissing.uid}::uuid`;
expect(
  "the suggestions rows themselves are untouched — no client may write them",
  stillListed.length === 1,
);

await page.go(`${ORIGIN}/#/people`, 9000);
const afterReload = (await page.evaluate(SHOWN)) ?? [];
expect(
  "and they are still gone after a reload",
  !afterReload.includes(dismissing.uid) &&
    !afterReload.includes(connecting.uid),
  JSON.stringify(afterReload),
);

console.log("\nand the line that turns the whole thing off");
// One button with switch semantics at desktop width, not a row's two sides: a
// switch has two states, and a no side on an off switch did nothing.
expect(
  "the people screen carries it, on the viewer's own line",
  await page.evaluate(`(() => {
    const found = document.querySelector('button[role=switch][aria-label="showing up in friend suggestions"]');
    if (found?.getAttribute("aria-checked") !== "true") return false;
    found.click();
    return true;
  })()`),
);
await new Promise((done) => setTimeout(done, 2500));
const [afterToggle] = await sql`
  select discoverable_by_taste from public.user_prefs where user_id = ${VIEWER}::uuid`;
expect(
  "turning it off writes the preference the search reads",
  afterToggle?.discoverable_by_taste === false,
  JSON.stringify(afterToggle ?? null),
);

// Reciprocal, and that is the whole of the switch: off means you are named to
// nobody AND your own list is written empty. A search run after the toggle has
// to say so, which is what a client filtering the rows on screen would not —
// and it runs rather than answering from its window, because moving the switch
// forgot when the last one ran.
const [forgotten] = await sql`
  select suggestions_at from public.user_model where user_id = ${VIEWER}::uuid`;
expect(
  "moving the switch forgets when the last search ran",
  forgotten?.suggestions_at === null,
  JSON.stringify(forgotten ?? null),
);
const afterOff = await suggestAs(VIEWER, VIEWER_EMAIL);
expect(
  "and a search run with it off writes an empty list",
  Array.isArray(afterOff.suggested) && afterOff.suggested.length === 0,
  JSON.stringify(afterOff),
);
const leftOver = await sql`
  select 1 from public.suggestions where user_id = ${VIEWER}::uuid`;
expect("with nothing left behind in the table", leftOver.length === 0);

await sql.end();
page.close();
finish();
