// What a browser can see of the door, since there is no door it can drive.
//
// THIS DOES NOT DRIVE A SIGN-IN FLOW. Google's consent screen cannot be
// scripted and the local stack has no Google. What is checked instead is the
// pair either side of the door: a session renders the signed-in app, and
// no session renders the welcome screen. The session is minted against the
// stack's own JWT secret and written where supabase-js looks for one
// (`local-session.ts`).
//
// So this is what is not covered, here or anywhere else in the repo:
//
//   - the OAuth round trip — `signInWithOAuth` building the authorize URL, the
//     provider's bounce back, and the redirect target matching `site_url` or one
//     of `additional_redirect_urls` exactly, which Supabase refuses rather than
//     redirects on;
//   - the PKCE exchange — the verifier stored before the redirect, the `?code=`
//     that comes back in the QUERY string, and `detectSessionInUrl` consuming
//     and stripping it;
//   - what the callback leaves in the URL — that no `access_token` lands in the
//     fragment and that what is left there is a route the router recognizes,
//     which is the failure that looks like a routing bug;
//   - GoTrue issuing a session at all — everything below runs on a token this
//     file signed, so a stack whose auth server never came up still passes
//     here, and `serve-local.sh`'s stack has none.
//
// A test that does not test what its name says is worse than a deleted one,
// which is why that list is in the file.
//
// Deliberately not in CI: it wants a browser and a stack, and a gate that
// needs both is a gate that gets disabled.

import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import { bodyText, check, press, stackTest as test, until } from "./harness.ts";
import {
  authUserRow,
  go,
  ownerSql,
  requireStack,
  signInAs,
  signOutEverywhere,
} from "./local-session.ts";

// Fresh per run: an account seeded once is an account whose profile already
// carries a name and a link, and the screens below are about the state before
// either exists.
const UID = randomUUID();
const EMAIL = `check-${Date.now()}@example.com`;
// Someone the first account follows, so that it is unlocked.
const ANCHOR = randomUUID();
// The second account, which opens the first one's link.
const FRIEND = randomUUID();
const FRIEND_EMAIL = `friend-${Date.now()}@example.com`;
// A prefilled account of this test's own, and the one thing it has rated:
// loaded by handle, so every run finds the same account.
const CRITIC = { handle: "checkcritic", displayName: "Check Critic" } as const;
const CRITIC_ITEM = "signin check pick";
// The attribute it puts on that thing, which it is then found by.
const CRITIC_TAG = "checkgenre";

const SEARCH = 'input[placeholder="search or add anything"]';
const PEOPLE_SEARCH = 'input[placeholder="find people and critics"]';

// Desktop width: the link row is driven through its side buttons, which a
// click can press, where a phone would need a swipe.
test.use({ viewport: { width: 1024, height: 800 } });

const shownItems = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-item]")].map(
      (row) => row.getAttribute("data-item") ?? "",
    ),
  );

test("either side of the door, links, following back and a prefilled account", async ({
  page,
  origin,
}) => {
  test.setTimeout(300_000);
  const sql = ownerSql();
  await requireStack(sql);

  /** Whether one account follows another, as the table has it. */
  const follows = async (follower: string, followed: string) => {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from public.follows
       where follower_id = ${follower}::uuid and followed_id = ${followed}::uuid`;
    return row?.count === 1;
  };

  try {
    // The one row a test writes with the owner's rights: `auth.users` is
    // GoTrue's schema and the service role holds nothing in it. Nameless on
    // purpose: an account Google shares no name for is called "unknown".
    await sql`insert into auth.users ${sql(authUserRow(UID, EMAIL, ""))}`;
    // Unlocked, as if by a link: an account that follows no person is locked,
    // and the lock has its own section below. Both ways, because Anchor owns a
    // link further down and a link's owner is never locked.
    await sql`insert into auth.users ${sql(authUserRow(ANCHOR, `anchor-${Date.now()}@example.com`, "Anchor"))}`;
    await sql`insert into public.follows (follower_id, followed_id)
      values (${UID}::uuid, ${ANCHOR}::uuid), (${ANCHOR}::uuid, ${UID}::uuid)`;
    // `search_id` is the id itself: plain letters and single spaces fold to
    // themselves, which `search-id.spec.ts` holds this row to like any other.
    const [loaded] = await sql<{ critic: string }[]>`
      select private.load_prefilled(${CRITIC.handle}, ${CRITIC.displayName},
        ${sql.json([
          { item: CRITIC_ITEM, search_id: CRITIC_ITEM, value: 1 },
          { item: CRITIC_ITEM, tag: CRITIC_TAG, value: 1 },
        ])}::jsonb
      ) ->> 'id' as critic`;
    const critic = loaded?.critic ?? "";

    await test.step("no session", async () => {
      await go(page, origin, 6000);
      const welcome = await bodyText(page);
      check(
        "a cold visitor lands on the welcome screen",
        /from the people you trust/.test(welcome),
        welcome.slice(0, 120),
      );
      check(
        "with no link, the door says sign in and nothing is said about a vine",
        /sign in/.test(welcome) &&
          !/continue with google/.test(welcome) &&
          !/people you trust to recommend/.test(welcome),
        welcome.slice(0, 200),
      );
      check(
        "the badge says which backend is behind it",
        /local stack/i.test(welcome),
        welcome.slice(0, 160),
      );
    });

    await test.step("a session", async () => {
      await signInAs(page, origin, UID, EMAIL);
      const screen = await bodyText(page);
      check(
        "the signed-in app renders rather than the welcome screen",
        !/from the people you trust/.test(screen),
        screen.slice(0, 160),
      );
      check(
        "an account with no name at all is not asked for one",
        !/what should we call you/i.test(screen),
        screen.slice(0, 160),
      );
      check(
        "the one list is what a session lands on",
        /search or add anything/i.test(screen),
        screen.slice(0, 200),
      );
      check(
        "and a list with nothing in it says so rather than showing nothing",
        /nothing here yet/i.test(screen),
        screen.slice(0, 200),
      );
    });

    await test.step("the people screen behind the avatar", async () => {
      await go(page, `${origin}/#/people`, 6000);
      const people = await bodyText(page);
      check(
        "it carries the viewer's own row, called unknown",
        /unknown/i.test(people) && /sign out/i.test(people),
        people.slice(0, 200),
      );
      check(
        "and the link row, off",
        /your link is off/i.test(people),
        people.slice(0, 200),
      );
    });

    await test.step("renaming", async () => {
      await press(page, 'button[aria-label^="change your name"]');
      await page.waitForTimeout(800);
      await page.locator('[role="dialog"] input').first().fill("Checked");
      await press(page, '[role="dialog"] button', "save");
      await page.waitForTimeout(2500);
      const [renamed] = await sql<{ display_name: string }[]>`
        select display_name from public.profiles where id = ${UID}::uuid`;
      check(
        "a tap on your own name renames you",
        renamed?.display_name === "Checked",
        JSON.stringify(renamed),
      );
    });

    let link = "";
    await test.step("a link, made", async () => {
      await press(page, 'button[aria-label="turn on, your link"]');
      await page.waitForTimeout(2500);
      // Read back as the owner: the link is never drawn, so the database is
      // where its token is read from.
      const stored = await sql<{ token: string }[]>`
        select token from public.invite_links where owner_id = ${UID}::uuid`;
      const token = stored[0]?.token ?? "";
      check(
        "turn on makes one link for its owner",
        stored.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(token),
        JSON.stringify(stored),
      );
      link = `${origin}/#/invite/${token}`;
      const madeScreen = await bodyText(page);
      check(
        "and the row says the link is on, with copy, and never shows it",
        /your link is on/i.test(madeScreen) &&
          (await page.locator('button[aria-label="copy your link"]').count()) >
            0 &&
          !madeScreen.includes(token || "-"),
        madeScreen.slice(0, 300),
      );
    });

    await test.step("a link, opened by an account with a vine", async () => {
      // Anchor's, made with the owner's rights: this test has no session for
      // Anchor.
      const anchorToken = randomUUID().replaceAll("-", "").padEnd(43, "A");
      await sql`insert into public.invite_links (owner_id, token)
        values (${ANCHOR}::uuid, ${anchorToken})`;
      await go(page, `${origin}/#/invite/${anchorToken}`, 6000);
      const joinedAsk = await bodyText(page);
      check(
        "it asks the same question",
        /add anchor to your vine\?/i.test(joinedAsk) &&
          /your vine is a collection of people you trust/i.test(joinedAsk),
        joinedAsk.slice(0, 200),
      );
      check(
        "without the line about staying locked",
        !/stays locked/i.test(joinedAsk),
        joinedAsk.slice(0, 200),
      );
      await press(page, "button", "not now");
      await page.waitForTimeout(800);
      check(
        "and not now goes back to the list",
        /search or add anything/i.test(await bodyText(page)),
      );
    });

    await test.step("a link, opened signed out", async () => {
      await signOutEverywhere(page, origin);
      await go(page, link, 6000);
      const outside = await bodyText(page);
      check(
        "signed out, the link names whose it is",
        /sign in to add checked to your vine/i.test(outside),
        outside.slice(0, 200),
      );
      check(
        "with the line on the vine and the door that makes an account",
        /your vine is a collection of people you trust/i.test(outside) &&
          /continue with google/i.test(outside),
        outside.slice(0, 300),
      );
      check(
        "and the address no longer carries the token",
        !(await page.evaluate(() => window.location.href)).includes("invite"),
      );
    });

    await test.step("a new account with no link", async () => {
      const stray = randomUUID();
      const strayEmail = `stray-${Date.now()}@example.com`;
      await sql`insert into auth.users ${sql(authUserRow(stray, strayEmail, "Stray"))}`;
      // The link above is waiting in this tab; this account arrives without
      // one.
      await page.evaluate(() => window.sessionStorage.clear());
      await signInAs(page, origin, stray, strayEmail);
      await page.waitForTimeout(3000);
      const turnedAway = await bodyText(page);
      check(
        "is shown that it is locked",
        /your account is locked/i.test(turnedAway),
        turnedAway.slice(0, 200),
      );
      const [kept] = await sql<{ count: number }[]>`
        select count(*)::int as count from auth.users where id = ${stray}::uuid`;
      check("and the account stays", kept?.count === 1, JSON.stringify(kept));
    });

    await test.step("a link, answered by a new account", async () => {
      await sql`insert into auth.users ${sql(authUserRow(FRIEND, FRIEND_EMAIL, "Link Friend"))}`;
      // Opened before signing in, as a new person does.
      await go(page, link, 6000);
      await signInAs(page, origin, FRIEND, FRIEND_EMAIL);
      const asked = await bodyText(page);
      check(
        "signed in, the link asks before it writes, by the owner's name",
        /add checked to your vine\?/i.test(asked),
        asked.slice(0, 200),
      );
      check(
        "and, the vine being empty, says declining keeps it locked",
        /stays locked until you accept/i.test(asked),
        asked.slice(0, 300),
      );
      await press(page, "button", "add");
      await page.waitForTimeout(3000);
      const answered = await bodyText(page);
      check(
        "yes unlocks the account, which is offered the critics first",
        !/your account is locked/i.test(answered) &&
          /add some critics\?/i.test(answered) &&
          answered.includes(CRITIC.displayName) &&
          answered.includes(`@${CRITIC.handle}`),
        answered.slice(0, 300),
      );
      check(
        "where nothing has been added, the way on is not now",
        (await page
          .locator("button", { hasText: /^\s*not now\s*$/ })
          .count()) === 1,
      );
      check(
        "a critic's row adds it",
        await press(page, `button[aria-label="add, ${CRITIC.displayName}"]`),
      );
      check(
        "and the account follows it",
        await until(
          () => follows(FRIEND, critic),
          (there) => there,
          10_000,
        ),
      );
      const done = page.locator("button", { hasText: /^\s*done\s*$/ });
      await until(
        () => done.count(),
        (count) => count > 0,
        10_000,
      );
      check("which turns not now into done", (await done.count()) === 1);
      await done.click();
      await page.waitForTimeout(1500);
      const offered = await bodyText(page);
      check(
        "then the import is offered before its list",
        /rated things somewhere else\?/i.test(offered),
        offered.slice(0, 200),
      );
      await press(page, "button", "not now");
      await page.waitForTimeout(800);
      check(
        "and not now is the list",
        /search or add anything/i.test(await bodyText(page)),
      );
      check(
        "yes makes the new account follow the link's owner",
        await follows(FRIEND, UID),
      );
      check(
        "and nothing else: the owner does not follow back",
        !(await follows(UID, FRIEND)),
      );
      const [unlocked] = await sql<{ yes: boolean }[]>`
        select private.is_unlocked(${FRIEND}::uuid) as yes`;
      check(
        "which is what unlocks it in the database",
        unlocked?.yes === true,
        JSON.stringify(unlocked),
      );
    });

    await test.step("following back, from the people screen", async () => {
      await signInAs(page, origin, UID, EMAIL);
      await go(page, `${origin}/#/people`, 6000);
      const followed = await bodyText(page);
      check(
        "the link's owner sees the new account under following you",
        /following you.*\bLink\b/i.test(followed),
        followed.slice(0, 300),
      );
      check(
        "with add on its row",
        await press(page, 'button[aria-label="add, Link"]'),
      );
      check(
        "add makes the owner follow back",
        await until(
          () => follows(UID, FRIEND),
          (there) => there,
          10_000,
        ),
      );
      const afterBack = await bodyText(page);
      check(
        "and the account is in their vine",
        /your vine.*\bLink\b.*following you/i.test(afterBack),
        afterBack.slice(0, 300),
      );
    });

    await test.step("a prefilled account, from the people screen's search", async () => {
      await go(page, `${origin}/#/`, 6000);
      await page.locator(SEARCH).fill(CRITIC_TAG);
      await page.waitForTimeout(800);
      check(
        "the list's search finds no account",
        (await page.locator("[data-account]").count()) === 0,
      );
      await go(page, `${origin}/#/people`, 6000);
      const field = page.locator(PEOPLE_SEARCH);
      await field.fill(CRITIC_TAG);
      const byTag = await until(
        () => page.locator(`[data-account="${critic}"]`).count(),
        (count) => count === 1,
        10_000,
      );
      check(
        "an attribute its thumbs use finds it, that attribute on its row",
        byTag === 1 &&
          (await page
            .locator(`[data-account="${critic}"]`)
            .getByText(CRITIC_TAG, { exact: true })
            .count()) === 1,
      );
      check(
        "and nothing else: no sections while searching",
        (await page.locator("h2.label").count()) === 0,
      );
      await field.fill(CRITIC.displayName.toLowerCase());
      const found = await until(
        () => bodyText(page),
        (text) => text.includes(`@${CRITIC.handle}`),
        10_000,
      );
      check(
        "its name finds it",
        found.includes(CRITIC.displayName) &&
          found.includes(`@${CRITIC.handle}`),
        found.slice(0, 200),
      );
      check(
        "with add on its row",
        await press(page, `button[aria-label="add, ${CRITIC.displayName}"]`),
      );
      check(
        "add follows it",
        await until(
          () => follows(UID, critic),
          (there) => there,
          10_000,
        ),
      );
      await field.fill("");
      await go(page, `${origin}/#/`, 6000);
      const shaped = await until(
        () => shownItems(page),
        (rows) => rows.includes(CRITIC_ITEM),
        15_000,
      );
      check(
        "and what it rated is on the list",
        shaped.includes(CRITIC_ITEM),
        JSON.stringify(shaped),
      );
    });

    await test.step("every critic, on the people screen", async () => {
      await go(page, `${origin}/#/people`, 6000);
      const listed = await bodyText(page);
      check(
        "the people screen lists the critics after the vine",
        /your vine.*\bcritics\b.*Check Critic/is.test(listed),
        listed.slice(0, 400),
      );
      check(
        "one followed from search offers remove there",
        await press(page, `button[aria-label="remove, ${CRITIC.displayName}"]`),
      );
      await page.waitForTimeout(800);
      check(
        "asking first",
        await press(page, '[role="dialog"] button', "remove"),
      );
      check(
        "which unfollows it",
        !(await until(
          () => follows(UID, critic),
          (there) => !there,
          10_000,
        )),
      );
      const addAgain = `button[aria-label="add, ${CRITIC.displayName}"]`;
      await until(
        () => page.locator(addAgain).count(),
        (count) => count > 0,
        10_000,
      );
      check("and its row offers add again", await press(page, addAgain));
      check(
        "which follows it from the list of critics",
        await until(
          () => follows(UID, critic),
          (there) => there,
          10_000,
        ),
      );
      await page.locator(PEOPLE_SEARCH).fill("zzzz");
      check(
        "a search that finds nobody says so",
        /nobody here by that name/i.test(await bodyText(page)),
      );
    });

    await test.step("the session taken away again", async () => {
      await signOutEverywhere(page, origin);
      const signedOut = await bodyText(page);
      check(
        "a browser holding no session is back at the welcome screen",
        /from the people you trust/.test(signedOut),
        signedOut.slice(0, 160),
      );
    });
  } finally {
    await sql.end();
  }
});
