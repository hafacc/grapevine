// Opens the installed Chrome on the local dev server, signed in as one of the
// seeded people, and leaves it open: the way to look at the app by hand.
//
//   bash supabase/tests/serve-local.sh       # shell 1
//   cd web && bun seed:local                 # once, shell 2
//   cd web && bun dev:local                  # shell 2
//   cd web && bun open:local [u0]            # shell 3
//
// Signing in through the screen cannot work locally (`CLAUDE.md`, "The local
// stack"), so the session is minted, as the browser tests' is. It ends with
// its token, an hour after it was made; run this again for another.

import { chromium } from "@playwright/test";
import { signInAs, uuidOf } from "./local-session.ts";

const origin = process.env.GRAPEVINE_ORIGIN ?? "http://localhost:3001";
const who = process.argv[2] ?? "u0";

const browser = await chromium.launch({ channel: "chrome", headless: false });
// No fixed viewport: the window is the person's to resize.
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await signInAs(page, origin, uuidOf(who), `${who}@example.com`, 0);
console.log(`signed in as ${who} at ${origin}. close the window to end.`);
await new Promise<void>((resolve) => {
  browser.on("disconnected", () => resolve());
});
