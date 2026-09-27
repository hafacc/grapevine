// What a browser can see of the door, since there is no door it can drive.
//
//   supabase start                  # shell 1, the whole backend.
//   cd web && bun run dev:local     # shell 2, serves on 3001 against it
//   bun run check:signin            # shell 3
//
// THIS DOES NOT DRIVE A SIGN-IN FLOW. Google's consent screen cannot be
// scripted and the local stack has no Google. What is checked instead is the
// pair either side of the door: a session renders the signed-in app, and
// no session renders the welcome screen. The session is minted against the
// stack's own JWT secret and written where supabase-js looks for one
// (`scripts/local-session.mjs`).
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
//     fragment and that what is left there is a route the router recognises,
//     which is the failure that looks like a routing bug;
//   - GoTrue issuing a session at all — everything below runs on a token this
//     file signed, so a stack whose auth server never came up still passes here.
//
// A check that does not check what its name says is worse than a deleted one,
// which is why that list is in the file.
//
// GRAPEVINE_ORIGIN overrides the origin. Deliberately not in CI: it wants a
// browser and a dev server, and a gate that needs both is a gate that gets
// disabled.

import { randomUUID } from "node:crypto";

import {
  bodyText,
  click,
  expect,
  fill,
  finish,
  openBrowser,
  tap,
} from "./harness.mjs";
import {
  authUserRow,
  ownerSql,
  signInAs,
  signOutEverywhere,
} from "./local-session.mjs";

const ORIGIN = process.env.GRAPEVINE_ORIGIN ?? "http://localhost:3001";
const PROFILE = "/tmp/grapevine-signin-check";

// Fresh per run: an account seeded once is an account whose profile already
// carries a name and a link, and the screens below are about the state before
// either exists.
const UID = randomUUID();
const EMAIL = `check-${Date.now()}@example.com`;
// Someone the first account trusts, so that it is unlocked (0010).
const ANCHOR = randomUUID();
// The second account, which opens the first one's link.
const FRIEND = randomUUID();
const FRIEND_EMAIL = `friend-${Date.now()}@example.com`;

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

const sql = ownerSql();

// The one row a check writes with the owner's rights: `auth.users` is GoTrue's
// schema and the service role holds nothing in it. Nameless on purpose: an
// account Google shares no name for is called "unknown".
await sql`insert into auth.users ${sql(authUserRow(UID, EMAIL, ""))}`;
// Unlocked, as if by a link: an account with no connection is locked (0010),
// and the lock has its own section below.
await sql`insert into auth.users ${sql(authUserRow(ANCHOR, `anchor-${Date.now()}@example.com`, "Anchor"))}`;
await sql`insert into public.friendships (user_id, friend_id)
  values (${UID}::uuid, ${ANCHOR}::uuid), (${ANCHOR}::uuid, ${UID}::uuid)`;

// Desktop width: the link row is driven through its side buttons, which a
// click can press, where a phone would need a swipe.
const page = await openBrowser({
  port: 9392,
  profile: PROFILE,
  window: "1024,800",
});

console.log("\nno session");
await page.go(ORIGIN, 6000);
const welcome = await bodyText(page);
expect(
  "a cold visitor lands on the welcome screen",
  /from the people you trust/.test(welcome),
  welcome.slice(0, 120),
);
expect(
  "with no link, the door says sign in and nothing is said about a vine",
  /sign in/.test(welcome) &&
    !/continue with google/.test(welcome) &&
    !/people you trust to recommend/.test(welcome),
  welcome.slice(0, 200),
);
expect(
  "the badge says which backend is behind it",
  /local stack/i.test(welcome),
  welcome.slice(0, 160),
);

console.log("\na session");
await signInAs(page, ORIGIN, UID, EMAIL);
const screen = await bodyText(page);
expect(
  "the signed-in app renders rather than the welcome screen",
  !/from the people you trust/.test(screen),
  screen.slice(0, 160),
);
expect(
  "an account with no name at all is not asked for one",
  !/what should we call you/i.test(screen),
  screen.slice(0, 160),
);
expect(
  "the one list is what a session lands on",
  /search or add anything/i.test(screen),
  screen.slice(0, 200),
);
expect(
  "and a list with nothing in it says so rather than showing nothing",
  /nothing here yet/i.test(screen),
  screen.slice(0, 200),
);

console.log("\nthe people screen behind the avatar");
await page.go(`${ORIGIN}/#/people`, 6000);
const people = await bodyText(page);
expect(
  "it carries the viewer's own row, called unknown",
  /unknown/i.test(people) && /sign out/i.test(people),
  people.slice(0, 200),
);
expect(
  "and the link row, off",
  /your link is off/i.test(people),
  people.slice(0, 200),
);

console.log("\nrenaming");
await page.evaluate(tap('button[aria-label^="change your name"]'));
await settle(800);
await page.evaluate(fill('[role="dialog"] input', "Checked"));
await page.evaluate(click('[role="dialog"] button', "save"));
await settle(2500);
const [renamed] = await sql`select display_name from public.profiles
                            where id = ${UID}::uuid`;
expect(
  "a tap on your own name renames you",
  renamed?.display_name === "Checked",
  JSON.stringify(renamed),
);

console.log("\na link, made");
await page.evaluate(tap('button[aria-label="turn on, your link"]'));
await settle(2500);
// Read back as the owner: the link is never drawn, so the database is where
// its token is read from.
const stored = await sql`select token from public.invite_links
                          where owner_id = ${UID}::uuid`;
expect(
  "turn on makes one link for its owner",
  stored.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(stored[0].token),
  JSON.stringify(stored),
);
const link = `${ORIGIN}/#/invite/${stored[0]?.token ?? ""}`;
const madeScreen = await bodyText(page);
expect(
  "and the row says the link is on, with copy, and never shows it",
  /your link is on/i.test(madeScreen) &&
    /copy/i.test(madeScreen) &&
    !madeScreen.includes(stored[0]?.token ?? "-"),
  madeScreen.slice(0, 300),
);

console.log("\na link, opened by an account with a vine");
// Anchor's, made with the owner's rights: this check has no session for Anchor.
const ANCHOR_TOKEN = randomUUID().replaceAll("-", "").padEnd(43, "A");
await sql`insert into public.invite_links (owner_id, token)
  values (${ANCHOR}::uuid, ${ANCHOR_TOKEN})`;
await page.go(`${ORIGIN}/#/invite/${ANCHOR_TOKEN}`, 6000);
const joinedAsk = await bodyText(page);
expect(
  "it asks the same question",
  /add anchor to your vine\?/i.test(joinedAsk) &&
    /your vine is a collection of people you trust/i.test(joinedAsk),
  joinedAsk.slice(0, 200),
);
expect(
  "without the line about staying locked",
  !/stays locked/i.test(joinedAsk),
  joinedAsk.slice(0, 200),
);
await page.evaluate(click("button", "not now"));
await settle(800);
expect(
  "and not now goes back to the list",
  /search or add anything/i.test(await bodyText(page)),
);

console.log("\na link, opened signed out");
await signOutEverywhere(page, ORIGIN);
await page.go(link, 6000);
const outside = await bodyText(page);
expect(
  "signed out, the link names whose it is",
  /sign in to add checked to your vine/i.test(outside),
  outside.slice(0, 200),
);
expect(
  "with the line on the vine and the door that makes an account",
  /your vine is a collection of people you trust/i.test(outside) &&
    /continue with google/i.test(outside),
  outside.slice(0, 300),
);
expect(
  "and the address no longer carries the token",
  !String(await page.evaluate("location.href")).includes("invite"),
);

console.log("\na new account with no link");
const STRAY = randomUUID();
const STRAY_EMAIL = `stray-${Date.now()}@example.com`;
await sql`insert into auth.users ${sql(authUserRow(STRAY, STRAY_EMAIL, "Stray"))}`;
// The link above is waiting in this tab; this account arrives without one.
await page.evaluate(
  "(() => { window.sessionStorage.clear(); return true; })()",
);
await signInAs(page, ORIGIN, STRAY, STRAY_EMAIL);
await settle(3000);
const turnedAway = await bodyText(page);
expect(
  "is shown that it is locked",
  /your account is locked/i.test(turnedAway),
  turnedAway.slice(0, 200),
);
const [stray] = await sql`select count(*)::int as n from auth.users
  where id = ${STRAY}::uuid`;
expect("and the account stays", stray?.n === 1, JSON.stringify(stray));

console.log("\na link, answered by a new account");
await sql`insert into auth.users ${sql(authUserRow(FRIEND, FRIEND_EMAIL, "Link Friend"))}`;
// Opened before signing in, as a new person does.
await page.go(link, 6000);
await signInAs(page, ORIGIN, FRIEND, FRIEND_EMAIL);
const asked = await bodyText(page);
expect(
  "signed in, the link asks before it writes, by the owner's name",
  /add checked to your vine\?/i.test(asked),
  asked.slice(0, 200),
);
expect(
  "and, the vine being empty, says declining keeps it locked",
  /stays locked until you accept/i.test(asked),
  asked.slice(0, 300),
);
await page.evaluate(click("button", "add"));
await settle(3000);
expect(
  "yes unlocks the account",
  /search or add anything/i.test(await bodyText(page)),
);
const [edges] = await sql`select count(*)::int as n from public.friendships
  where (user_id = ${UID}::uuid and friend_id = ${FRIEND}::uuid)
     or (user_id = ${FRIEND}::uuid and friend_id = ${UID}::uuid)`;
expect(
  "yes makes the friendship, both halves",
  edges?.n === 2,
  JSON.stringify(edges),
);

console.log("\nthe session taken away again");
await signOutEverywhere(page, ORIGIN);
const signedOut = await bodyText(page);
expect(
  "a browser holding no session is back at the welcome screen",
  /from the people you trust/.test(signedOut),
  signedOut.slice(0, 160),
);

await sql.end();
page.close();
finish();
