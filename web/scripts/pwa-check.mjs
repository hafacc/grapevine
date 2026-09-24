// Checks the two claims installing grapevine makes: that a browser will offer to
// install it at all, and that it opens with no network.
//
//   cd web && bun run check:pwa
//
// It builds the export and serves it itself, because both claims are about the
// PRODUCTION bundle: `next dev` serves modules a cache would hand back stale, so
// the worker deliberately does not register there and none of this is reachable
// from the dev server the other checks use. No stack either — nothing here signs
// in.
//
// What it does NOT cover is a signed-in app offline. There is no database
// persistence layer to exercise — supabase-js caches nothing — so what an
// offline viewer sees is the copy of their own feed the app keeps in
// `localStorage` (`utils/recs.ts`). `check:discover` is what asserts that copy,
// because seeing it needs a session and a seeded stack.

import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { bodyText, expect, finish, openBrowser, until } from "./harness.mjs";

const PORT = 4173;
// At the root, because that is what production is: the site has an origin of
// its own, so manifest scope, the worker's registration path and the offline
// key are all `/`.
const APP = `http://localhost:${PORT}`;
const PROFILE = "/tmp/grapevine-pwa-check";

function runExport() {
  const done = spawnSync("bun", ["run", "export"], { stdio: "inherit" });
  if (done.status !== 0) throw new Error("export failed");
}

console.log("building the export");
runExport();
// The written pages are static routes so that their text sits in the exported
// HTML for a reader — or a reviewer — with JavaScript off. A fragment screen
// would serve the app shell and pass any check that only asked for a 200, so
// each one is asserted by a sentence that is actually on it.
console.log("\nthe written pages are in the exported HTML");
// FOUR pages. A page list that shrinks silently is how a page goes missing with
// nothing going red, so the number is stated rather than left to be noticed.
//
// The `privacy` needle is load-bearing beyond "this page still has its text":
// that sentence is the one place grapevine admits in plain words what a feed
// gives away when you have a single friend, and a rewrite that drops it fails
// here rather than shipping a softer page.
for (const [route, sentence] of [
  ["how", "everything that lies beyond any one friend weighs"],
  ["privacy", "your feed is that friend's ratings"],
  ["help", "Thumb it down"],
  ["about", "Nothing ever shows who rated what"],
]) {
  const html = await readFile(resolve("out", route, "index.html"), "utf8");
  // Next escapes an apostrophe in text as `&#x27;`, so the needle is compared
  // against the same folding rather than the raw source.
  expect(
    `/${route}/ carries its own text`,
    html.replaceAll("&#x27;", "'").includes(sentence),
    sentence,
  );
}

// Serving `out/` rather than pointing at Pages: the worker needs a secure
// context, and localhost is one. Served by this script rather than by
// `python3 -m http.server`, because whether `python3` on PATH is one that
// actually accepts connections is not something this check should depend on —
// one machine's interpreter bound the port and never listened, and every
// assertion below failed for it.
const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
const ROOT = resolve("out");

async function fileFor(pathname) {
  const asked = resolve(ROOT, `.${pathname}`);
  // A request is allowed to name a file under `out/` and nothing else.
  if (asked !== ROOT && !asked.startsWith(ROOT + sep)) return null;
  const found = await stat(asked).catch(() => null);
  if (found?.isDirectory()) {
    const index = join(asked, "index.html");
    // A directory asked for without the trailing slash is REDIRECTED, the way
    // Pages answers it, not served in place, so the URLs the worker keys its
    // offline copies on are the deployed ones.
    if (!pathname.endsWith("/")) return { redirect: `${pathname}/` };
    return (await stat(index).catch(() => null))?.isFile()
      ? { file: index }
      : null;
  }
  return found?.isFile() ? { file: asked } : null;
}

const server = createServer((request, response) => {
  const { pathname, search } = new URL(request.url, `http://localhost:${PORT}`);
  fileFor(decodeURIComponent(pathname))
    .then(async (answer) => {
      if (!answer) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
      } else if (answer.redirect) {
        response.writeHead(301, { location: `${answer.redirect}${search}` });
        response.end();
      } else {
        response.writeHead(200, {
          "content-type":
            TYPES[extname(answer.file)] ?? "application/octet-stream",
          // The worker is what caches here; a 304 from the browser's own cache
          // would tell us nothing about it.
          "cache-control": "no-store",
        });
        response.end(await readFile(answer.file));
      }
    })
    .catch(() => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("failed");
    });
});
process.on("exit", () => server.close());
await new Promise((listening) => server.listen(PORT, "127.0.0.1", listening));

const page = await openBrowser({ port: 9391, profile: PROFILE });
await page.send("Network.enable");
// Before the document runs, or the event has already fired by the time anything
// here could listen for it.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source:
    "window.addEventListener('beforeinstallprompt', () => { window.__installOffered = true; });",
});
await page.go(APP);

console.log("\na browser is willing to install it");
// Chrome's own parse, not a read of the JSON: a manifest this file agrees with
// and Chrome rejects would pass a hand-rolled check and install nowhere.
const manifest = await page.send("Page.getAppManifest");
expect(
  "the manifest parses with no errors",
  (manifest.errors ?? []).length === 0,
  JSON.stringify(manifest.errors ?? []),
);
const parsed = JSON.parse(manifest.data ?? "{}");
expect(
  "it is standalone, with a start_url",
  parsed.display === "standalone" && Boolean(parsed.start_url),
  JSON.stringify({ display: parsed.display, start_url: parsed.start_url }),
);
// The maskable one is separate on purpose: without it Android crops the disc.
expect(
  "it names a 512 and a maskable icon",
  (parsed.icons ?? []).some((i) => i.sizes === "512x512" && !i.purpose) &&
    (parsed.icons ?? []).some((i) => i.purpose === "maskable"),
  JSON.stringify(parsed.icons ?? []),
);

// `--color-bg` (web/DESIGN-UI.md), which is also what `layout.tsx` gives the
// light theme colour. The launcher paints this behind the app before a pixel of
// it has run, so a restyle that missed the manifest would show as a flash of the
// previous palette on every cold start — and nothing else would catch it.
const CANVAS = "#e8eced";
expect(
  "it opens on the canvas colour",
  parsed.theme_color === CANVAS && parsed.background_color === CANVAS,
  JSON.stringify({
    theme_color: parsed.theme_color,
    background_color: parsed.background_color,
  }),
);

// Chrome's own verdict, and the strongest one available: it fires this only for
// a page it is actually willing to install. Armed before the load above, and
// waited for here because Chrome withholds it until the worker is in place.
const offered = await until(
  () => page.evaluate("window.__installOffered === true"),
  (seen) => seen === true,
);
expect("Chrome offers to install it", offered === true, String(offered));

const worker = await until(
  () =>
    page.evaluate(`(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "none";
  return reg.active ? "active" : "registered, not active";
})()`),
  (state) => state === "active",
);
expect(
  "the worker registers and activates",
  worker === "active",
  String(worker),
);

console.log("\nand it writes no query or fragment into the cache");
// A navigation's `request.url` carries the query AND the fragment — measured in
// Chrome, not assumed — so caching the request as it comes stores whatever a
// link happened to carry somewhere with no expiry that any same-origin script
// can read. Nothing sensitive rides a grapevine URL today; what keeps that true
// is the worker never writing one down.
await page.go(`${APP}/how/?token=QUERYSECRET456#FRAGMENTSECRET789`);
const cached = `(async () => {
  const out = [];
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) out.push(request.url);
  }
  return JSON.stringify(out);
})()`;
// Until the worker has cached this navigation there is nothing to look for a
// secret in, and an empty cache would pass both assertions below by holding
// nothing at all.
const keys = JSON.parse(
  (await until(
    () => page.evaluate(cached),
    (seen) => String(seen).includes("/how/"),
  )) ?? "[]",
);
for (const [what, secret] of [
  ["a query string", "QUERYSECRET456"],
  ["a fragment", "FRAGMENTSECRET789"],
]) {
  expect(
    `${what} never reaches the cache`,
    !keys.some((key) => key.includes(secret)),
    keys.filter((key) => key.includes(secret)).join(" "),
  );
}
// And the pages themselves are still cached, under their own paths — otherwise
// the assertions above would pass by caching nothing at all.
expect(
  "the pages are cached, keyed on the path alone",
  keys.some((key) => key.endsWith("/how/")),
  keys.filter((key) => !key.includes("/_next/")).join(" "),
);

console.log(
  "  documents held:",
  keys.filter((key) => !key.includes("/_next/")).join(" ") || "(none)",
);

console.log("\nand it opens with the network pulled");
// Back to the entry point, and note it is a NAVIGATION rather than a reload:
// the assertions above left the page on /how/, and reloading there proved only
// that /how/ was cached while the thing about to be opened offline was the
// root.
await page.go(APP);
const held = await until(
  () =>
    page.evaluate(`(async () => {
  const names = await caches.keys();
  if (!names.length) return 0;
  const cache = await caches.open(names[0]);
  return (await cache.keys()).length;
})()`),
  (count) => Number(count) > 0,
);
expect("the shell is cached", Number(held) > 0, `${held} entries`);

// Both layers, because they fail independently. Killing the server is what
// makes the DOCUMENT come from the cache: CDP's offline emulation does not
// reach a service worker's fetches, so the version of this that used it alone
// watched the shell render over a live network and credited the cache — it
// passed with the offline fallback deleted. CDP is what stops the PAGE reaching
// Supabase, which is a different host and still up.
// `close()` alone only stops new connections; the browser is holding keep-alive
// ones that would go on being served.
server.closeAllConnections();
server.close();
await page.send("Network.emulateNetworkConditions", {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});
await page.go(APP);
await until(
  () => bodyText(page),
  (text) => /from the people you already know/.test(text),
);
const screen = (await bodyText(page)).trim();
expect(
  "grapevine renders with no network at all",
  // The app's own words, not the absence of an error: a blank page and a
  // browser error page both pass a blacklist. Nothing has signed in, so what
  // renders is the welcome screen.
  /from the people you already know/.test(screen),
  screen.slice(0, 100),
);

page.close();
server.close();
finish();
