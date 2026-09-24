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
// carries a name and a handle, and both of the screens below are about the state
// before either exists.
const UID = randomUUID();
const EMAIL = `check-${Date.now()}@example.com`;
// A handle is permanent and never released, so a fixed one works exactly once
// against a database that has not been reset.
const HANDLE = `check_${Date.now().toString(36).slice(-6)}`;

const sql = ownerSql();

// The one row a check writes with the owner's rights: `auth.users` is GoTrue's
// schema and the service role holds nothing in it. Nameless on purpose — the
// trigger names a profile from Google's metadata, and an account that carries no
// name is the single case the name gate is left for.
await sql`insert into auth.users ${sql(authUserRow(UID, EMAIL, ""))}`;

const page = await openBrowser({ port: 9392, profile: PROFILE });

console.log("\nno session");
await page.go(ORIGIN, 6000);
const welcome = await bodyText(page);
expect(
  "a cold visitor lands on the welcome screen",
  /from the people you already know/.test(welcome),
  welcome.slice(0, 120),
);
expect(
  "the badge says which backend is behind it",
  /local stack/i.test(welcome),
  welcome.slice(0, 160),
);

console.log("\na session");
await signInAs(page, ORIGIN, UID, EMAIL);
let screen = await bodyText(page);
expect(
  "the signed-in app renders rather than the welcome screen",
  !/from the people you already know/.test(screen),
  screen.slice(0, 160),
);
// The gate this account exists for: a Google account with no name at all is the
// one thing left that has to be asked, since the profile arrives named from the
// identity's metadata in every other case.
expect(
  "an account with no name at all opens the name gate",
  /what should we call you/i.test(screen),
  screen.slice(0, 160),
);
await page.evaluate(fill("input", "Check Person"));
await page.evaluate(click("button", "continue"));
await new Promise((done) => setTimeout(done, 3000));

screen = await bodyText(page);
expect(
  "the one list is what a named session lands on",
  /search or add anything/i.test(screen),
  screen.slice(0, 200),
);
expect(
  "and a brand-new account is told what to do rather than shown nothing",
  /search for and tag things you like/i.test(screen),
  screen.slice(0, 200),
);

console.log("\nthe people screen behind the avatar");
await page.go(`${ORIGIN}/#/people`, 6000);
const people = await bodyText(page);
expect(
  "it carries the viewer's own row",
  /check person/i.test(people) && /sign out/i.test(people),
  people.slice(0, 200),
);
expect(
  "and the discoverability line as one sentence",
  /swipe to show up in friend suggestions|suggested to people with similar taste/i.test(
    people,
  ),
  people.slice(0, 200),
);

console.log("\nclaiming a handle");
expect(
  "a profile with no handle is offered the claim line",
  /a handle is how a friend asks for you/i.test(people),
  people.slice(0, 300),
);
await page.evaluate(fill("#claim-handle", HANDLE));
await page.evaluate(tap('form:has(#claim-handle) button[type="submit"]'));
await new Promise((done) => setTimeout(done, 3000));
// Read back as the owner: the claim is `claim_username`, one statement that sets
// the handle and turns searchability on together, and the screen is only half of
// what it promises.
const [claimed] = await sql`select username, searchable from public.profiles
                             where id = ${UID}::uuid`;
expect(
  "the claim writes the handle and turns findable on with it",
  claimed?.username === HANDLE && claimed?.searchable === true,
  JSON.stringify(claimed),
);
await page.go(`${ORIGIN}/#/people`, 6000);
const withHandle = await bodyText(page);
expect(
  "the handle is on the viewer's own row",
  withHandle.includes(`@${HANDLE}`),
  withHandle.slice(0, 200),
);
expect(
  "the claim line is gone, since a handle is permanent",
  !(await page.evaluate('Boolean(document.getElementById("claim-handle"))')),
);
expect(
  "and beneath the row the line that turns being findable by it off",
  withHandle.includes(`findable as @${HANDLE}`),
  withHandle.slice(0, 300),
);

console.log("\nthe session taken away again");
await signOutEverywhere(page, ORIGIN);
const signedOut = await bodyText(page);
expect(
  "a browser holding no session is back at the welcome screen",
  /from the people you already know/.test(signedOut),
  signedOut.slice(0, 160),
);

await sql.end();
page.close();
finish();
