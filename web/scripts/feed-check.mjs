// The one list end to end: the feed as the ranking, a typed word filtering it by
// name and by attribute, the bar's fill against the error that feed reported,
// the add button, and what a first rating writes.
//
//   supabase start                  # shell 1, the whole backend.
//   cd web && bun run dev:local     # shell 2, serves on 3001 against it
//   bun run check:feed              # shell 3
//
// It seeds a simulated world into the running stack itself and signs in as one
// of the seeded people, because the whole point is a viewer with a network
// behind them. The way in is a minted session (`scripts/local-session.mjs`), not
// the door — `signin-check.mjs`'s header is where that is written down.
//
// Desktop width on purpose: the swipe and the two welded buttons are the same
// two sides (DESIGN §1.8), and a button is what a browser can be told to press.
// The gesture itself is covered by `tests/swipe.test.ts`, which is pure.
//
// GRAPEVINE_ORIGIN overrides the origin. Deliberately not in CI: it wants a
// browser and a dev server.

import {
  bodyText,
  refreshAs as callRefreshRecs,
  expect,
  fill,
  finish,
  openBrowser,
  seedWorld,
  tap,
} from "./harness.mjs";
import { serviceRoleSql, signInAs, uuidOf } from "./local-session.mjs";

const ORIGIN = process.env.GRAPEVINE_ORIGIN ?? "http://localhost:3001";
const PROFILE = "/tmp/grapevine-feed-check";

// One of the seeded people, and the uuid the seeding loads them under.
const VIEWER = "u0";
const VIEWER_UID = uuidOf(VIEWER);
const VIEWER_EMAIL = `${VIEWER}@example.com`;

// The seeded world's one non-ASCII name (`seed-local.ts`), and what somebody
// with no way to type the accent writes instead. Finding it is the case the
// stored `search_id` column exists for.
const ACCENTED = "café bleu";
const UNACCENTED = "cafe bleu";

// A name no seeded world holds. Typed and then abandoned, it must leave no row
// behind (DESIGN §1.2: a thing is written on its first rating, not on the tap).
const ABANDONED = "nobody has named this";

seedWorld();

const sql = serviceRoleSql();

/** The feed as the function wrote it: one row, and the error it was computed under. */
async function feedOf(uid) {
  const [row] = await sql`
    select entries, error from public.user_recs where user_id = ${uid}::uuid`;
  return {
    entries: Array.isArray(row?.entries) ? row.entries : [],
    error: typeof row?.error === "number" ? row.error : null,
  };
}

/** The viewer's own thumbs, item to tag to value — the shape the client holds. */
async function ratingsOf(uid) {
  const rows = await sql`
    select item_id, tag, value from public.ratings where user_id = ${uid}::uuid`;
  const mine = {};
  for (const row of rows) {
    mine[row.item_id] = mine[row.item_id] ?? {};
    mine[row.item_id][row.tag] = row.value;
  }
  return mine;
}

async function itemExists(id) {
  const [row] = await sql`select id from public.items where id = ${id}`;
  return Boolean(row);
}

async function ratingExists(uid, itemId, tag) {
  const [row] = await sql`
    select value from public.ratings
     where user_id = ${uid}::uuid and item_id = ${itemId} and tag = ${tag}`;
  return row?.value ?? null;
}

// The rows carry the item id they open, which is the one thing on the screen
// that names what is listed without naming anybody who rated it.
const SHOWN = `[...document.querySelectorAll("[data-item]")].map((row) => row.getAttribute("data-item"))`;

/**
 * Every row's fill, on the bar's own `0..1` scale, read off the widths the
 * component actually drew.
 *
 * Four segments, each an inner span whose style width is a percentage of its
 * own segment, so the fill is their mean. A row whose bar says nothing known
 * yet draws four empty segments and lands at 0, which is why the assertion
 * below is about multiples rather than about any particular width.
 */
const FILLS = `[...document.querySelectorAll("[data-item]")].map((row) => {
  const segments = [...row.querySelectorAll('[role="img"] > span > span')];
  if (segments.length !== 4) return null;
  const parts = segments.map((span) => parseFloat(span.style.width) / 100);
  return parts.reduce((total, part) => total + part, 0) / 4;
})`;

const ADD_BUTTON = `(() => {
  const found = [...document.querySelectorAll("button")]
    .find((node) => node.textContent.trim().startsWith("add \\u201c"));
  return found ? found.textContent.trim() : "";
})()`;

const SEARCH = 'input[placeholder="search or add anything"]';
const EYE = 'button[aria-label="hide things you have rated"]';

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

const type = async (page, value, wait = 900) => {
  const typed = await page.evaluate(fill(SEARCH, value));
  await settle(wait);
  return typed;
};

console.log("\nasking for this viewer's feed");
await callRefreshRecs(VIEWER_UID, VIEWER_EMAIL);
const { entries, error } = await feedOf(VIEWER_UID);
const ratings = await ratingsOf(VIEWER_UID);
expect(
  "the function wrote this viewer a feed",
  entries.length > 0,
  `entries: ${entries.length}`,
);
expect(
  "and said what error it computed it under",
  error !== null && error > 0,
  `error: ${error}`,
);

const page = await openBrowser({
  port: 9394,
  profile: PROFILE,
  window: "1280,900",
});

console.log("\nsigning in as a seeded person");
await signInAs(page, ORIGIN, VIEWER_UID, VIEWER_EMAIL);

console.log("\nthe list is the feed");
await page.go(`${ORIGIN}/#/`, 12000);
await settle(1500);

// Every entry with support of its own plus everything the viewer has rated, best
// first, ties by id — `feedRows` with an empty field, where a rated thing the
// feed does not score sorts as zero. Computed from what the function wrote
// rather than from a number typed into this file.
const scoreOf = new Map(entries.map((entry) => [entry.itemId, entry.score]));
const ranked = [
  ...new Set([
    ...entries.filter((entry) => entry.conf > 0).map((entry) => entry.itemId),
    ...Object.keys(ratings),
  ]),
].sort((left, right) => {
  const leftScore = scoreOf.get(left) ?? 0;
  const rightScore = scoreOf.get(right) ?? 0;
  return rightScore !== leftScore
    ? rightScore - leftScore
    : left.localeCompare(right);
});

const shown = await page.evaluate(SHOWN);
expect(
  "it shows the entries with support of their own and everything the viewer rated, in score order",
  JSON.stringify(shown) === JSON.stringify(ranked),
  `screen ${shown?.length} rows, expected ${ranked.length}`,
);
const screen = await bodyText(page);
expect(
  "nothing on it counts anybody",
  !/\b\d+\s+(friend|people|person|rating|rated)/i.test(screen),
  screen.slice(0, 200),
);
expect(
  "and no word stands in for a score anywhere on it",
  !/strong yes|strong no|leaning|in common/i.test(screen),
  screen.slice(0, 200),
);

console.log("\nthe fill is a multiple of the error this feed reported");
// `q = ε · L / 2` as `utils/bar.ts` computes it: the error already carries `L`
// and is on the score's own scale, so half of it is the step.
const quantum = error / 2;
const fills = (await page.evaluate(FILLS)) ?? [];
expect(
  "every row drew a bar",
  fills.every((fill) => fill !== null),
  `${fills}`,
);
const offBy = fills
  .map((fill) => Math.abs(fill / quantum - Math.round(fill / quantum)))
  // A percentage that went through the style attribute and back is not exact,
  // so the tolerance is the round trip's and not the step's.
  .filter((remainder) => remainder > 0.02);
expect(
  `no fill is finer than the step ${quantum} the feed allows`,
  offBy.length === 0,
  `${offBy.length} of ${fills.length} rows land between steps`,
);

console.log("\na typed word filters by name");
const byName = ranked[0] ?? "";
const needle = byName.slice(0, 3);
await type(page, needle);
const searched = (await page.evaluate(SHOWN)) ?? [];
expect(
  `"${needle}" still shows the thing it names`,
  searched.includes(byName),
  `${searched.length} rows`,
);
expect(
  "and nothing it does not",
  searched.every((itemId) => {
    const entry = entries.find((row) => row.itemId === itemId);
    const tags = Object.keys(entry?.tags ?? {});
    return (
      itemId.includes(needle) ||
      tags.some((tag) => tag.includes(needle)) ||
      // A catalog row the field turned up has no entry of its own.
      entry === undefined
    );
  }),
  JSON.stringify(searched.slice(0, 5)),
);

console.log("\nand by attribute, with the matched attribute carrying the bar");
const tagged = entries.find(
  (entry) => Object.keys(entry.tags ?? {}).length > 0,
);
if (tagged) {
  const tag = Object.keys(tagged.tags)[0];
  await type(page, tag);
  const byTag = (await page.evaluate(SHOWN)) ?? [];
  expect(
    `"${tag}" finds the thing carrying it`,
    byTag.includes(tagged.itemId),
    JSON.stringify(byTag.slice(0, 5)),
  );
  const at = byTag.indexOf(tagged.itemId);
  const tagFills = (await page.evaluate(FILLS)) ?? [];
  const expectedFill =
    Math.round((tagged.tags[tag] + 1) / 2 / quantum) * quantum;
  expect(
    "and the row's bar is that attribute's score, not the thing's own",
    Math.abs((tagFills[at] ?? -1) - expectedFill) < 0.02,
    `drew ${tagFills[at]}, expected ${expectedFill}`,
  );
} else {
  expect("the seeded world gave this viewer an attribute to search", false);
}

console.log("\nthe unaccented spelling finds the accented thing");
await type(page, UNACCENTED, 1500);
const folded = (await page.evaluate(SHOWN)) ?? [];
expect(
  `"${UNACCENTED}" finds "${ACCENTED}"`,
  folded.includes(ACCENTED),
  JSON.stringify(folded.slice(0, 5)),
);
expect(
  "even though it is not in this viewer's feed under that spelling",
  entries.every((entry) => entry.itemId !== UNACCENTED),
);

console.log("\nthe add button is offered on every keystroke");
for (const partial of ["n", "no", "nob", ABANDONED]) {
  await type(page, partial, 500);
  const offered = await page.evaluate(ADD_BUTTON);
  expect(`"${partial}" offers to add it`, offered.length > 0, offered);
}

console.log("\nopening a typed name and backing out writes nothing");
expect(
  "the add button opens it",
  await page.evaluate(
    `(() => {
      const found = [...document.querySelectorAll("button")]
        .find((node) => node.textContent.trim().startsWith("add \\u201c"));
      if (found) found.click();
      return Boolean(found);
    })()`,
  ),
);
await settle(2000);
expect(
  "the URL is the thing, spelled as it was typed",
  (await page.evaluate("location.hash")) === `#/item/${ABANDONED}`,
  String(await page.evaluate("location.hash")),
);
expect(
  "nothing has been written to the catalog",
  (await itemExists(ABANDONED)) === false,
);
expect(
  "backing out is offered",
  await page.evaluate(tap('[aria-label="back"]')),
);
await settle(1500);

console.log("\none rating writes both the thing and the rating");
await type(page, ABANDONED, 1200);
await page.evaluate(
  `(() => {
    const found = [...document.querySelectorAll("button")]
      .find((node) => node.textContent.trim().startsWith("add \\u201c"));
    if (found) found.click();
    return Boolean(found);
  })()`,
);
await settle(2000);
expect(
  "the yes side is there",
  await page.evaluate(tap(`button[aria-label="yes to ${ABANDONED}"]`)),
);
await settle(2500);
expect("the thing is in the catalog now", await itemExists(ABANDONED));
expect(
  "and the rating is the viewer's own, keyed by columns",
  (await ratingExists(VIEWER_UID, ABANDONED, "")) === 1,
  String(await ratingExists(VIEWER_UID, ABANDONED, "")),
);

console.log("\nhiding things already rated");
await page.go(`${ORIGIN}/#/`, 8000);
await settle(1500);
const unrated = ranked.filter((itemId) => ratings[itemId]?.[""] === undefined);
expect(
  "the viewer has rated some of what is on screen",
  unrated.length < ranked.length,
  `${ranked.length - unrated.length} rated`,
);
expect("the eye is there", await page.evaluate(tap(EYE)));
await settle(900);
const hidden = (await page.evaluate(SHOWN)) ?? [];
expect(
  "it removes exactly the ones the viewer has answered",
  hidden.every((itemId) => ratings[itemId]?.[""] === undefined),
  `${hidden.length} rows left of ${ranked.length}`,
);

await sql.end();
page.close();
finish();
