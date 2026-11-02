// The one list end to end: what the browser computed as the ranking, which
// attributes a row shows as chips, a typed word filtering it by name and by
// attribute, an attribute alone ranking by how far it counts as on the thing
// and how good an example of it the thing is, the bar's fill against the
// value it draws, the add button, what a first rating writes, and the eye.
//
// An entry's word on an attribute is `{ score, conf, applies }` (`TagEntry` in
// `shared/src/entries.ts`), and there is one only where an account the viewer
// follows put the attribute on the thing: nothing is inferred, and leaving an
// attribute off says nothing. `score` is the mean of those accounts' thumbs
// on it moved by the viewer's own fitted departure, `conf` how many of them
// there were, and `applies` is `(1 + score) / 2`: the attribute counts as on
// the thing, and is drawn as a chip, when their thumbs lean up. One they
// thumbed down is found by a search for it and shown on no chip. The viewer's
// own thumb on an attribute says it applies whichever way it points.
//
// It seeds a simulated world into the running stack itself and signs in as one
// of the seeded people, because the whole point is a viewer with accounts they
// follow. The way in is a minted session (`local-session.ts`), not the door;
// `signin.spec.ts`'s header is where that is written down.
//
// The list is computed in the page, from the viewer's thumbs and the thumbs of
// the accounts they follow, and nothing stores it but the page's own cache for
// first paint. That cache is what the expectations below are built from: this
// checks that the screen is the computed list, ranked, filtered and drawn as
// the design says, and that the list covers exactly what is in reach. It does
// NOT check the numbers themselves, which are the crate's (`cargo test`).
//
// Desktop width on purpose: the swipe and the two side buttons are the same
// two sides, and a button is what a browser can be told to press. The gesture
// itself is covered by `tests/swipe.test.ts`, which is pure.
//
// Deliberately not in CI: it wants a browser and a stack.

import type { Page } from "@playwright/test";
import { searchFold } from "grapevine-shared";
import type { RecsEntry, TagEntry } from "grapevine-shared/entries";
import {
  bodyText,
  check,
  press,
  seedWorld,
  stackTest as test,
  until,
} from "./harness.ts";
import { go, serviceRoleSql, signInAs, uuidOf } from "./local-session.ts";

// One of the seeded people, and the uuid the seeding loads them under.
const VIEWER = "u0";
const VIEWER_UID = uuidOf(VIEWER);
const VIEWER_EMAIL = `${VIEWER}@example.com`;

// The seeded world's one non-ASCII name (`seed-local.ts`), and what somebody
// with no way to type the accent writes instead. Finding it is the case the
// stored `search_id` column exists for.
const ACCENTED = "café bleu";
const UNACCENTED = "cafe bleu";

// A name no seeded world holds, and no earlier run of this test either: the
// catalog keeps every name ever rated. Typed and then abandoned, it must leave
// no row behind: a thing is written on its first rating, not on the tap.
const ABANDONED = `nobody named this ${Date.now().toString(36)}`;

// Where the page keeps the last list it computed (`CACHE_PREFIX` in
// `src/lib/utils/recs.ts`).
const CACHED_LIST = `grapevine.recs.${VIEWER_UID}`;

// Two words no seeded world uses, planted over it (`plantAttributes`) so that
// this viewer's list holds every case an attribute can be in. `said` is the
// one searched for.
const PLANTED = {
  said: "patio",
  other: "takeout",
  // Things every followed account puts `said` on with a thumb up.
  up: ["i10", "i12", "i14"],
  // Things every followed account puts `said` on with a thumb down.
  down: ["i11", "i13", "i15"],
  // `said` with a thumb up from one followed account and no other.
  once: "i17",
  // A thing of its own, on which every followed account puts `other` and
  // nobody puts `said`. Not one of the world's, so that it carries no word a
  // seeded thing shares with the ones above and nothing connects it to `said`.
  unsaid: "nobody said it here",
  // The viewer's own thumbs on `said`: up on a thing the followed accounts
  // thumbed it down on, and down on a thing nobody else put it on.
  ownGood: "i13",
  ownBad: "i16",
} as const;

// What a bar with nothing to draw is labeled (`ui/bar.svelte`). Its four
// empty segments are the widths of a score of −1 too, so the label is the only
// thing that tells "nothing known yet" from the bottom of the scale.
const NOTHING_KNOWN = "nothing known yet";

const SEARCH = 'input[placeholder="search or add anything"]';
const EYE = 'button[aria-label="hide things you have rated"]';

// The button the field offers for a name, `add “…”`.
const ADD_BUTTON = "button";
const ADD_PREFIX = "add “";

/** A bar's fill on its own `0..1` scale, or `"empty"` for the empty track. */
type Fill = number | "empty";

/** The viewer's own thumbs, item to tag to value: the shape the client holds. */
type Thumbs = Record<string, Record<string, number>>;

// The rows carry the item id they open, which is the one thing on the screen
// that names what is listed without naming anybody who rated it.
const shownItems = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-item]")].map(
      (row) => row.getAttribute("data-item") ?? "",
    ),
  );

/**
 * Every row's fill, on the bar's own `0..1` scale, read off the widths the
 * component actually drew, or `"empty"` for a bar that says nothing is known
 * yet. Null is a row with no bar to read.
 *
 * Four segments, each an inner span whose style width is a percentage of its
 * own segment, so the fill is their mean.
 */
const shownFills = (page: Page): Promise<(Fill | null)[]> =>
  page.evaluate(
    (nothingKnown) =>
      [...document.querySelectorAll("[data-item]")].map((row) => {
        const bar = row.querySelector('[role="img"]');
        const segments = [
          ...(bar?.querySelectorAll<HTMLElement>(":scope > span > span") ?? []),
        ];
        if (segments.length !== 4) return null;
        else if (bar?.getAttribute("aria-label") === nothingKnown)
          return "empty";
        else {
          const parts = segments.map(
            (span) => Number.parseFloat(span.style.width) / 100,
          );
          return parts.reduce((total, part) => total + part, 0) / 4;
        }
      }),
    NOTHING_KNOWN,
  );

// Every row's chips, in the order drawn. A chip's label sits in a span of its
// own for the ellipsis (`ui/chip.svelte`), which nothing else in a row has.
const shownChips = (page: Page): Promise<string[][]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-item]")].map((row) =>
      [...row.querySelectorAll("span.truncate")].map(
        (chip) => chip.textContent ?? "",
      ),
    ),
  );

const addButton = (page: Page) =>
  page
    .locator(ADD_BUTTON)
    .filter({ hasText: new RegExp(`^\\s*${ADD_PREFIX}`) })
    .first();

const type = async (page: Page, value: string, wait = 900) => {
  await page.locator(SEARCH).fill(value);
  await page.waitForTimeout(wait);
};

test.use({ viewport: { width: 1280, height: 900 } });

test("the one list, ranked, filtered and drawn as computed", async ({
  page,
  origin,
}) => {
  test.setTimeout(900_000);

  await test.step("seed the running stack", () => seedWorld());

  const sql = serviceRoleSql();

  /**
   * Plants `PLANTED` over the seeded world, as rows the app's own calls could
   * have left. The simulator's people put a category on a thing with the thumb
   * they gave the thing, so in its worlds a word is never a better example
   * than the thing is good, and a test over the world alone could not tell an
   * attribute's score from its thing's.
   *
   * Nothing here needs taking out: the next seed replaces every seeded
   * person's thumbs.
   */
  const plantAttributes = async (viewer: string): Promise<number> => {
    const followed = (
      await sql<{ followed_id: string }[]>`
        select followed_id from public.follows
         where follower_id = ${viewer}::uuid order by followed_id`
    ).map((row) => row.followed_id);
    const rows: {
      user_id: string;
      item_id: string;
      tag: string;
      value: number;
    }[] = [];
    const put = (user: string, item: string, tag: string, value: number) =>
      rows.push({ user_id: user, item_id: item, tag, value });
    followed.forEach((user, who) => {
      for (const item of PLANTED.up) put(user, item, PLANTED.said, 1);
      for (const item of PLANTED.down) put(user, item, PLANTED.said, -1);
      put(user, PLANTED.unsaid, PLANTED.other, 1);
      if (who === 0) put(user, PLANTED.once, PLANTED.said, 1);
    });
    put(viewer, PLANTED.ownGood, PLANTED.said, 1);
    put(viewer, PLANTED.ownBad, PLANTED.said, -1);
    await sql`
      insert into public.items ${sql([
        {
          id: PLANTED.unsaid,
          search_id: searchFold(PLANTED.unsaid),
          created_by: viewer,
        },
      ])} on conflict (id) do nothing`;
    await sql`insert into public.ratings ${sql(rows)}`;
    return followed.length;
  };

  const ratingsOf = async (uid: string): Promise<Thumbs> => {
    const rows = await sql<{ item_id: string; tag: string; value: number }[]>`
      select item_id, tag, value from public.ratings where user_id = ${uid}::uuid`;
    const mine: Thumbs = {};
    for (const row of rows) {
      mine[row.item_id] = mine[row.item_id] ?? {};
      (mine[row.item_id] as Record<string, number>)[row.tag] = row.value;
    }
    return mine;
  };

  /** Every attribute an account this viewer follows put on a thing, as `[thing, attribute]`. */
  const saidInReachOf = async (uid: string): Promise<[string, string][]> => {
    const rows = await sql<{ item_id: string; tag: string }[]>`
      select distinct r.item_id, r.tag
        from public.ratings r
        join public.follows f on f.followed_id = r.user_id
       where f.follower_id = ${uid}::uuid and r.tag <> ''`;
    return rows.map((row) => [row.item_id, row.tag]);
  };

  /** Every thing an account this viewer follows has a thumb on, or on an attribute of. */
  const inReachOf = async (uid: string): Promise<string[]> => {
    const rows = await sql<{ item_id: string }[]>`
      select distinct r.item_id
        from public.ratings r
        join public.follows f on f.followed_id = r.user_id
       where f.follower_id = ${uid}::uuid`;
    return rows.map((row) => row.item_id);
  };

  const itemExists = async (id: string): Promise<boolean> => {
    const [row] = await sql`select id from public.items where id = ${id}`;
    return Boolean(row);
  };

  const ratingExists = async (
    uid: string,
    itemId: string,
    tag: string,
  ): Promise<number | null> => {
    const [row] = await sql<{ value: number }[]>`
      select value from public.ratings
       where user_id = ${uid}::uuid and item_id = ${itemId} and tag = ${tag}`;
    return row?.value ?? null;
  };

  try {
    let planters = 0;
    await test.step("planting attributes over the seeded world", async () => {
      planters = await plantAttributes(VIEWER_UID);
      check(
        "the viewer follows more than one account, so one account is not all of them",
        planters >= 2,
        `follows ${planters}`,
      );
    });

    await test.step("signing in as a seeded person", () =>
      signInAs(page, origin, VIEWER_UID, VIEWER_EMAIL));

    // Written once a computation has finished, which is what there is to wait
    // for: the profile is new, so nothing older can be in it.
    await go(page, `${origin}/#/`);
    const cached = await until(
      () =>
        page.evaluate((key) => window.localStorage.getItem(key), CACHED_LIST),
      (raw) => typeof raw === "string" && raw.length > 0,
    );
    const entries: readonly RecsEntry[] =
      (JSON.parse(cached ?? "{}") as { entries?: RecsEntry[] }).entries ?? [];
    const ratings = await ratingsOf(VIEWER_UID);
    const inReach = await inReachOf(VIEWER_UID);
    const saidInReach = await saidInReachOf(VIEWER_UID);

    // By its own keys only: a thing or an attribute may be named
    // `constructor`.
    const own = <Value>(
      record: Readonly<Record<string, Value>> | undefined,
      key: string,
    ): Value | undefined =>
      record !== undefined && Object.hasOwn(record, key)
        ? record[key]
        : undefined;
    const entryOf: Readonly<Record<string, RecsEntry>> = Object.fromEntries(
      entries.map((entry) => [entry.itemId, entry]),
    );

    await test.step("the list the browser computed", () => {
      check(
        "the page computed this viewer a list",
        entries.length > 0,
        `entries: ${entries.length}`,
      );
      const listed = new Set(entries.map((entry) => entry.itemId));
      const missing = inReach.filter((itemId) => !listed.has(itemId));
      check(
        "with an entry for every thing an account they follow rated",
        inReach.length > 0 && missing.length === 0,
        `${missing.length} of ${inReach.length} missing: ${missing.slice(0, 5)}`,
      );
      const reachable = new Set([...inReach, ...Object.keys(ratings)]);
      const strays = [...listed].filter((itemId) => !reachable.has(itemId));
      check(
        "and for nothing that only somebody they do not follow rated",
        strays.length === 0,
        JSON.stringify(strays.slice(0, 5)),
      );
      // A thing only its attributes were spoken of is scored too, at a count
      // of nobody.
      const scored = (known: { score: number; conf: number }) =>
        typeof known.score === "number" &&
        known.score > -1 &&
        known.score < 1 &&
        Number.isInteger(known.conf) &&
        known.conf >= 0;
      check(
        "every score is strictly inside its scale, with a count of accounts behind it",
        entries.every(
          (entry) =>
            scored(entry) && Object.values(entry.tags ?? {}).every(scored),
        ),
      );
      const keyOf = (itemId: string, tag: string) =>
        JSON.stringify([itemId, tag]);
      const saidKeys = new Set(
        saidInReach.map(([itemId, tag]) => keyOf(itemId, tag)),
      );
      const entryKeys = new Set(
        entries.flatMap((entry) =>
          Object.keys(entry.tags ?? {}).map((tag) => keyOf(entry.itemId, tag)),
        ),
      );
      const unsaidKeys = [...entryKeys].filter((key) => !saidKeys.has(key));
      const lostKeys = [...saidKeys].filter((key) => !entryKeys.has(key));
      check(
        "an attribute has an entry exactly where an account they follow put it on the thing: nothing is inferred",
        saidKeys.size > 0 && unsaidKeys.length === 0 && lostKeys.length === 0,
        `${unsaidKeys.length} nobody said: ${unsaidKeys.slice(0, 3)}; ${lostKeys.length} missing: ${lostKeys.slice(0, 3)}`,
      );
      const said: TagEntry[] = entries.flatMap((entry) =>
        Object.values(entry.tags ?? {}),
      );
      const offScale = said.filter(
        (tag) => Math.abs(tag.applies - (1 + tag.score) / 2) > 1e-12,
      );
      check(
        "how far an attribute applies is its score on the scale from zero to one",
        offScale.length === 0,
        JSON.stringify(offScale[0]),
      );
      const plantedOn = (itemId: string) =>
        own(own(entryOf, itemId)?.tags, PLANTED.said);
      check(
        "and its count is how many followed accounts put it on, each of them or one",
        planters > 0 &&
          [...PLANTED.up, ...PLANTED.down].every(
            (itemId) => plantedOn(itemId)?.conf === planters,
          ) &&
          plantedOn(PLANTED.once)?.conf === 1,
        JSON.stringify(
          [...PLANTED.up, ...PLANTED.down, PLANTED.once].map(
            (itemId) => plantedOn(itemId)?.conf,
          ),
        ),
      );
      check(
        "one they all thumbed up leans toward applying, and one they all thumbed down away from it",
        PLANTED.up.every((itemId) => (plantedOn(itemId)?.applies ?? 0) > 0.5) &&
          PLANTED.down.every(
            (itemId) => (plantedOn(itemId)?.applies ?? 1) < 0.5,
          ),
        JSON.stringify(
          [...PLANTED.up, ...PLANTED.down].map(
            (itemId) => plantedOn(itemId)?.applies,
          ),
        ),
      );
      const unsaidEntry = own(entryOf, PLANTED.unsaid);
      check(
        "a thing nobody put the word on is on the list with no entry for it",
        unsaidEntry !== undefined &&
          own(unsaidEntry.tags, PLANTED.other) !== undefined &&
          own(unsaidEntry.tags, PLANTED.said) === undefined &&
          own(own(ratings, PLANTED.unsaid), PLANTED.said) === undefined,
        JSON.stringify(unsaidEntry),
      );
    });

    await page.waitForTimeout(1500);

    // `barValue` in `src/lib/utils/bar.ts`, restated rather than imported so
    // a mistake there is not also the expectation: the score itself, whatever
    // stands behind it. A thing and an attribute of it are read the same way.
    const barValueOf = (known: { score: number }): number => known.score;

    // What a bar draws for a value: `fillFor` there, and the empty track for
    // none.
    const fillOf = (value: number | null): Fill =>
      value === null ? "empty" : (value + 1) / 2;

    // A percentage that went through the style attribute and back is not
    // exact.
    const sameFill = (drew: Fill | null | undefined, expected: Fill) =>
      expected === "empty"
        ? drew === "empty"
        : typeof drew === "number" && Math.abs(drew - expected) <= 0.01;

    type Attribute = {
      readonly tag: string;
      readonly score: number | null;
      readonly applies: number;
      readonly own: number | null;
    };

    /**
     * `attributesOf` in `src/lib/utils/discover.ts`, restated: every attribute
     * the entry scores plus every one the viewer rated, least sure first.
     * `score` is how good an example, null where no followed account has
     * said; `applies` is one where the viewer rated it, whichever way.
     */
    const attributesOf = (itemId: string): Attribute[] => {
      const tags = own(entryOf, itemId)?.tags ?? {};
      const mine = own(ratings, itemId) ?? {};
      const names = new Set([
        ...Object.keys(tags),
        ...Object.keys(mine).filter((tag) => tag !== ""),
      ]);
      return [...names]
        .map((tag) => {
          const theirs = own(tags, tag);
          const thumb = own(mine, tag) ?? null;
          return {
            tag,
            score: theirs === undefined ? null : barValueOf(theirs),
            applies: thumb !== null ? 1 : (theirs?.applies ?? 0.5),
            own: thumb,
          };
        })
        .sort((left, right) => {
          const leftSure = left.score === null ? -1 : Math.abs(left.score);
          const rightSure = right.score === null ? -1 : Math.abs(right.score);
          return leftSure !== rightSure
            ? leftSure - rightSure
            : left.tag.localeCompare(right.tag);
        });
    };

    // `carries` there: the viewer rated it, or the accounts they follow put it
    // on and their thumbs on it lean up.
    const carries = (attribute: Attribute) =>
      attribute.own !== null || attribute.applies > 0.5;

    // `CHIPS_PER_ROW` in `src/lib/components/item-row.svelte`.
    const chipsPerRow = 3;

    // Every entry plus everything the viewer has rated, by score, then by
    // how much stands behind it, then by id: `searchFeed` with an
    // empty field, where a thing only the viewer rated has nothing to draw
    // and sorts as zero.
    const scoreOf = new Map(
      entries.map((entry) => [entry.itemId, barValueOf(entry)]),
    );
    const confOf = new Map(entries.map((entry) => [entry.itemId, entry.conf]));
    const ranked = [
      ...new Set([
        ...entries.map((entry) => entry.itemId),
        ...Object.keys(ratings),
      ]),
    ].sort((left, right) => {
      const leftScore = scoreOf.get(left) ?? 0;
      const rightScore = scoreOf.get(right) ?? 0;
      if (rightScore !== leftScore) return rightScore - leftScore;
      const leftConf = confOf.get(left) ?? 0;
      const rightConf = confOf.get(right) ?? 0;
      return rightConf !== leftConf
        ? rightConf - leftConf
        : left.localeCompare(right);
    });

    const shown = await shownItems(page);
    let screen = "";
    await test.step("the list is that, in the bar's order", async () => {
      check(
        "it shows every entry and everything the viewer rated, in score order",
        JSON.stringify(shown) === JSON.stringify(ranked),
        `screen ${shown.length} rows, expected ${ranked.length}`,
      );
      screen = await bodyText(page);
      check(
        "nothing on it counts anybody",
        !/\b\d+\s+(friend|people|person|follower|rating|rated)/i.test(screen),
        screen.slice(0, 200),
      );
      check(
        "and no word stands in for a score anywhere on it",
        !/strong yes|strong no|leaning|in common/i.test(screen),
        screen.slice(0, 200),
      );
    });

    await test.step("the first-run hint", async () => {
      check(
        "a first list says where it comes from",
        /this list comes from your vine/i.test(screen),
        screen.slice(0, 200),
      );
      check("and closes", await press(page, 'button[aria-label="got it"]'));
      await page.waitForTimeout(300);
      check(
        "and is gone once closed",
        !/this list comes from your vine/i.test(await bodyText(page)),
      );
    });

    await test.step("the fill is the score, drawn as it is", async () => {
      const fills = await shownFills(page);
      const drawn = shown.map((itemId) => fillOf(scoreOf.get(itemId) ?? null));
      const offBy = shown.filter(
        (_itemId, index) => !sameFill(fills[index], drawn[index] ?? "empty"),
      );
      check(
        "every row's fill is its score on the bar's own scale, and empty where there is none",
        fills.length === shown.length && offBy.length === 0,
        `${offBy.length} of ${fills.length} rows drew something else: ${offBy.slice(0, 5)}`,
      );
    });

    await test.step("a chip is an attribute the thing is shown as having", async () => {
      const chips = await shownChips(page);
      const everyAttribute = shown.flatMap((itemId) =>
        attributesOf(itemId).map((attribute) => ({ itemId, ...attribute })),
      );
      const thumbedDown = everyAttribute.filter(
        (attribute) => attribute.own === null && attribute.applies <= 0.5,
      );
      const wrongChips = shown.filter(
        (itemId, index) =>
          JSON.stringify(chips[index]) !==
          JSON.stringify(
            attributesOf(itemId)
              .filter(carries)
              .slice(0, chipsPerRow)
              .map((attribute) => attribute.tag),
          ),
      );
      check(
        "every row's chips are the attributes it carries, least sure first",
        chips.length === shown.length &&
          chips.some((row) => row.length > 0) &&
          wrongChips.length === 0,
        `${wrongChips.length} of ${chips.length} rows: ${wrongChips.slice(0, 5)}`,
      );
      const chipOn = (itemId: string, tag: string) =>
        (chips[shown.indexOf(itemId)] ?? []).includes(tag);
      check(
        "none for an attribute the followed accounts' thumbs lean down on",
        thumbedDown.some((attribute) => attribute.tag === PLANTED.said) &&
          thumbedDown.every(
            (attribute) => !chipOn(attribute.itemId, attribute.tag),
          ),
        `${thumbedDown.length} at one half or under on this list`,
      );
      check(
        "one for the viewer's own, though the followed accounts thumbed it down or never said it",
        chipOn(PLANTED.ownGood, PLANTED.said) &&
          chipOn(PLANTED.ownBad, PLANTED.said),
        JSON.stringify([
          chips[shown.indexOf(PLANTED.ownGood)],
          chips[shown.indexOf(PLANTED.ownBad)],
        ]),
      );
    });

    await test.step("a typed word filters by name", async () => {
      const byName = ranked[0] ?? "";
      const needle = byName.slice(0, 3);
      await type(page, needle);
      const searched = await shownItems(page);
      check(
        `"${needle}" still shows the thing it names`,
        searched.includes(byName),
        `${searched.length} rows`,
      );
      check(
        "and nothing it does not",
        searched.every((itemId) => {
          const entry = entries.find((row) => row.itemId === itemId);
          const tags = [
            ...Object.keys(entry?.tags ?? {}),
            ...Object.keys(ratings[itemId] ?? {}),
          ];
          return (
            itemId.includes(needle) ||
            tags.some((tag) => tag.includes(needle)) ||
            // A catalog row the field turned up has no entry of its own.
            entry === undefined
          );
        }),
        JSON.stringify(searched.slice(0, 5)),
      );
    });

    // `presence` and `goodness` in `src/lib/utils/discover.ts`, restated for
    // one word spelled as an attribute, with the arithmetic in the order the
    // list does it so that two things it ties are tied here.
    const unknown = 0.5;
    const present = (attribute: Attribute) =>
      unknown + (attribute.applies - unknown);
    const goodness = (thumb: number | null, score: number | null) => {
      if (thumb !== null) return (1 + thumb) / 2;
      else if (score !== null) return (1 + score) / 2;
      else return unknown;
    };
    // How good an example: the viewer's own thumb on the attribute, else what
    // the accounts they follow said of it, else, where nobody said, how good
    // the thing itself is.
    const exampleOf = (itemId: string, attribute: Attribute) =>
      attribute.own !== null || attribute.score !== null
        ? goodness(attribute.own, attribute.score)
        : goodness(
            own(ratings[itemId], "") ?? null,
            scoreOf.get(itemId) ?? null,
          );
    // The geometric mean over the one typed word and one more slot.
    const strengthOf = (itemId: string, attribute: Attribute) =>
      Math.exp(
        (Math.log(Math.max(present(attribute), Number.MIN_VALUE)) +
          Math.log(Math.max(exampleOf(itemId, attribute), Number.MIN_VALUE))) /
          2,
      );
    const sortedDown = (values: readonly number[]) =>
      values.every(
        (value, index) => index === 0 || value <= (values[index - 1] ?? 0),
      );

    type Answering = {
      readonly itemId: string;
      readonly attribute: Attribute;
      readonly strength: number;
    };

    // Every thing the list knows anything about `tag` on, as the list would
    // rank them: by strength, then by what stands behind the thing, then by
    // id.
    const answering = (tag: string): Answering[] =>
      ranked
        .flatMap((itemId) => {
          const attribute = attributesOf(itemId).find(
            (candidate) => candidate.tag === tag,
          );
          return attribute === undefined
            ? []
            : [{ itemId, attribute, strength: strengthOf(itemId, attribute) }];
        })
        .sort((left, right) => {
          if (left.strength !== right.strength)
            return right.strength - left.strength;
          const leftConf = confOf.get(left.itemId) ?? Number.NEGATIVE_INFINITY;
          const rightConf =
            confOf.get(right.itemId) ?? Number.NEGATIVE_INFINITY;
          return rightConf !== leftConf
            ? rightConf - leftConf
            : left.itemId.localeCompare(right.itemId);
        });

    const asked = PLANTED.said;
    const expected = answering(asked);
    const rowFor = (itemId: string) =>
      expected.find((row) => row.itemId === itemId);
    let byTag: string[] = [];
    let tagFills: (Fill | null)[] = [];
    let tagChips: string[][] = [];
    const at = (itemId: string) => byTag.indexOf(itemId);

    // The things the followed accounts put the word on and the viewer did not,
    // by which way their thumbs lean.
    const leaning = (up: boolean) =>
      expected.filter(
        (row) =>
          row.attribute.own === null && row.attribute.applies > 0.5 === up,
      );

    await test.step("an attribute alone ranks by how far it applies and how good an example the thing is", async () => {
      await type(page, asked, 1500);
      byTag = await shownItems(page);
      tagFills = await shownFills(page);
      tagChips = await shownChips(page);
      const absent = expected.filter((row) => !byTag.includes(row.itemId));
      check(
        `"${asked}" lists every thing it was put on, thumbed up or down`,
        leaning(true).length > 0 &&
          leaning(false).length > 0 &&
          absent.length === 0,
        `${expected.length} answer it, ${byTag.length} rows, missing ${absent.map((row) => row.itemId).slice(0, 5)}`,
      );
      check(
        "and not a thing nobody put it on",
        !byTag.includes(PLANTED.unsaid),
        `row ${byTag.indexOf(PLANTED.unsaid)} of ${byTag.length}`,
      );
      const lowestUp = Math.max(...leaning(true).map((row) => at(row.itemId)));
      const highestDown = Math.min(
        ...leaning(false).map((row) => at(row.itemId)),
      );
      check(
        "a thing the followed accounts thumbed it down on is under every thing they thumbed it up on",
        lowestUp >= 0 && lowestUp < highestDown,
        `last thumbed up at row ${lowestUp}, first thumbed down at row ${highestDown}`,
      );
      // The rows that answer the word itself; a row reached through an
      // attribute that goes with it, or out of the catalog, is ranked by
      // another rule and is not held to this one.
      const expectedIds = expected.map((row) => row.itemId);
      const answered = byTag.filter((itemId) => expectedIds.includes(itemId));
      const answeredRows = answered.flatMap((itemId) => {
        const row = rowFor(itemId);
        return row === undefined ? [] : [row];
      });
      const strengthShown = answeredRows.map((row) => row.strength);
      check(
        "strongest first: the geometric mean of how far it applies and how good an example the thing is",
        // A tolerance, so a difference in the last bit of a restated sum is
        // not an inversion.
        strengthShown.every(
          (strength, index) =>
            index === 0 || strength <= (strengthShown[index - 1] ?? 0) + 1e-9,
        ),
        JSON.stringify(strengthShown.map((strength) => strength.toFixed(3))),
      );
      check(
        "with ties going to what stands behind the thing, then to its name",
        JSON.stringify(answered) === JSON.stringify(expectedIds),
        `screen ${JSON.stringify(answered.slice(0, 6))}, expected ${JSON.stringify(expectedIds.slice(0, 6))}`,
      );
      // A thumb down is a zero in the mean, so the only things under it are
      // others with a zero of their own.
      const underBad = answered.slice(answered.indexOf(PLANTED.ownBad) + 1);
      check(
        "a thing the viewer called a bad example of it is still found, under everything that is any good",
        rowFor(PLANTED.ownBad)?.attribute.own === -1 &&
          answered.includes(PLANTED.ownBad) &&
          underBad.every((itemId) => {
            const row = rowFor(itemId);
            return row !== undefined && exampleOf(itemId, row.attribute) === 0;
          }),
        `under it: ${underBad}`,
      );
      // How good the thing is decides only where nobody said how good an
      // example it is: among the rest, a rule that multiplied by the thing's
      // own score instead would order them differently.
      const byThing = (row: Answering) =>
        Math.sqrt(
          present(row.attribute) *
            goodness(
              own(ratings[row.itemId], "") ?? null,
              scoreOf.get(row.itemId) ?? null,
            ),
        );
      const saidRows = expected.filter(
        (row) => row.attribute.own !== null || row.attribute.score !== null,
      );
      check(
        "and not the order of how good each thing is",
        !sortedDown(saidRows.map(byThing)),
        JSON.stringify(saidRows.map((row) => byThing(row).toFixed(3))),
      );
    });

    await test.step("and the matched attribute carries the bar", () => {
      const wrongBars = expected.filter(
        (row) =>
          !sameFill(tagFills[at(row.itemId)], fillOf(row.attribute.score)),
      );
      check(
        "every such row's bar is how good an example of it the thing is, on the bar's own scale",
        expected.some((row) => row.attribute.score !== null) &&
          wrongBars.length === 0,
        `${wrongBars.length} of ${expected.length}: ${wrongBars
          .slice(0, 3)
          .map(
            (row) =>
              `${row.itemId} drew ${tagFills[at(row.itemId)]}, expected ${fillOf(row.attribute.score)}`,
          )}`,
      );
      const unlike = expected.filter(
        (row) =>
          row.attribute.score !== null &&
          Math.abs(row.attribute.score - (scoreOf.get(row.itemId) ?? 2)) > 0.04,
      );
      check(
        "which is not the thing's own score",
        unlike.length > 0,
        `${unlike.length} rows where the two differ enough to tell`,
      );
      const unsaid = expected.filter((row) => row.attribute.score === null);
      check(
        "and empty where only the viewer put it on, and nobody they follow has said how good an example it is",
        unsaid.some((row) => row.itemId === PLANTED.ownBad) &&
          unsaid.every((row) => tagFills[at(row.itemId)] === "empty"),
        `${unsaid.length} rows`,
      );
      // `chipsFor` in `src/lib/components/item-row.svelte`: the matched
      // attribute first, to show how the word was read, and only where the
      // thing carries it.
      const chipsOf = (itemId: string) => {
        const carried = attributesOf(itemId).filter(carries);
        return [
          ...carried.filter((attribute) => attribute.tag === asked),
          ...carried.filter((attribute) => attribute.tag !== asked),
        ]
          .slice(0, chipsPerRow)
          .map((attribute) => attribute.tag);
      };
      const wrongChips = expected.filter(
        (row) =>
          JSON.stringify(tagChips[at(row.itemId)]) !==
          JSON.stringify(chipsOf(row.itemId)),
      );
      check(
        "every such row's chips are the matched attribute, where the thing carries it, and then the rest it carries",
        wrongChips.length === 0,
        JSON.stringify(wrongChips.map((row) => row.itemId).slice(0, 5)),
      );
      const downChips = leaning(false).filter((row) =>
        (tagChips[at(row.itemId)] ?? []).includes(asked),
      );
      check(
        "so a thing found for a word the followed accounts thumbed down on it shows no chip for it",
        leaning(false).length > 0 && downChips.length === 0,
        JSON.stringify(downChips.map((row) => row.itemId)),
      );
    });

    await test.step("the unaccented spelling finds the accented thing", async () => {
      await type(page, UNACCENTED, 1500);
      const folded = await shownItems(page);
      check(
        `"${UNACCENTED}" finds "${ACCENTED}"`,
        folded.includes(ACCENTED),
        JSON.stringify(folded.slice(0, 5)),
      );
      check(
        "even though nothing on the list is spelled that way",
        entries.every((entry) => entry.itemId !== UNACCENTED),
      );
    });

    await test.step("the add button is offered on every keystroke", async () => {
      for (const partial of [
        ABANDONED.slice(0, 1),
        ABANDONED.slice(0, 2),
        ABANDONED.slice(0, 3),
        ABANDONED,
      ]) {
        await type(page, partial, 500);
        const offered =
          (await addButton(page).count()) > 0
            ? ((await addButton(page).textContent())?.trim() ?? "")
            : "";
        check(`"${partial}" offers to add it`, offered.length > 0, offered);
      }
    });

    await test.step("opening a typed name and backing out writes nothing", async () => {
      const offered = (await addButton(page).count()) > 0;
      if (offered) await addButton(page).click();
      check("the add button opens it", offered);
      await page.waitForTimeout(2000);
      const opened = await page.evaluate(() => window.location.hash);
      check(
        "the URL is the thing, spelled as it was typed",
        decodeURIComponent(opened) === `#/item/${ABANDONED}`,
        opened,
      );
      check(
        "nothing has been written to the catalog",
        (await itemExists(ABANDONED)) === false,
      );
      check("backing out is offered", await press(page, '[aria-label="back"]'));
      await page.waitForTimeout(1500);
    });

    await test.step("one rating writes both the thing and the rating", async () => {
      await type(page, ABANDONED, 1200);
      if ((await addButton(page).count()) > 0) await addButton(page).click();
      await page.waitForTimeout(2000);
      check(
        "the yes side is there",
        await press(page, `button[aria-label="yes to ${ABANDONED}"]`),
      );
      await page.waitForTimeout(2500);
      check("the thing is in the catalog now", await itemExists(ABANDONED));
      const value = await ratingExists(VIEWER_UID, ABANDONED, "");
      check(
        "and the rating is the viewer's own, keyed by columns",
        value === 1,
        String(value),
      );
    });

    await test.step("hiding things already rated", async () => {
      await go(page, `${origin}/#/`, 8000);
      await page.waitForTimeout(1500);
      check(
        "the hint stays gone on the next open",
        !/this list comes from your vine/i.test(await bodyText(page)),
      );
      // Read again: the rating above is one of them now. So is the order: the
      // viewer's own thumb is in the fit, and one more of them moves every
      // score a little, so the list is read as it stands now.
      const rated = await ratingsOf(VIEWER_UID);
      const listed = await shownItems(page);
      const unrated = listed.filter(
        (itemId) => rated[itemId]?.[""] === undefined,
      );
      check(
        "the viewer has rated some of what is on screen",
        unrated.length < listed.length,
        `${listed.length - unrated.length} rated`,
      );
      check("the eye is there", await press(page, EYE));
      await page.waitForTimeout(900);
      const hidden = await shownItems(page);
      check(
        "it removes exactly the ones the viewer has answered",
        JSON.stringify(hidden) === JSON.stringify(unrated),
        `${hidden.length} rows left, ${unrated.length} unrated of ${listed.length}`,
      );
    });
  } finally {
    await sql.end();
  }
});
