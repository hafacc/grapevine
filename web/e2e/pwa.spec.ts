// The two claims installing grapevine makes: that a browser will offer to
// install it at all, and that it opens with no network.
//
// It builds the export and serves it itself, because both claims are about the
// PRODUCTION bundle: the dev server serves modules a cache would hand back
// stale, so the worker deliberately does not register there and none of this is
// reachable from the dev server the stack tests use. No stack either — nothing
// here signs in.
//
// What it does NOT cover is a signed-in app offline. There is no database
// persistence layer to exercise — supabase-js caches nothing — so what an
// offline viewer sees is the copy of their own feed the app keeps in
// `localStorage` (`src/lib/utils/recs.ts`), and seeing it needs a session and
// a seeded stack.

import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium, test } from "@playwright/test";

import { bodyText, check, until, WEB_DIR } from "./harness.ts";
import { LOCAL_ANON_KEY, LOCAL_SUPABASE_URL } from "./local-session.ts";

const ROOT = resolve(WEB_DIR, "out");

// Serving `out/` rather than pointing at Pages: the worker needs a secure
// context, and localhost is one. Served by this test rather than by
// `python3 -m http.server`, because whether `python3` on PATH is one that
// actually accepts connections is not something this test should depend on —
// one machine's interpreter bound the port and never listened, and every
// assertion below failed for it.
const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

type Answer = { readonly file: string } | { readonly redirect: string } | null;

async function fileFor(pathname: string): Promise<Answer> {
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

function serveExport(): Server {
  return createServer((request, response) => {
    const { pathname, search } = new URL(request.url ?? "/", "http://export");
    fileFor(decodeURIComponent(pathname))
      .then(async (answer) => {
        if (answer === null) {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("not found");
        } else if ("redirect" in answer) {
          response.writeHead(301, { location: `${answer.redirect}${search}` });
          response.end();
        } else {
          response.writeHead(200, {
            "content-type":
              TYPES[extname(answer.file)] ?? "application/octet-stream",
            // The worker is what caches here; a 304 from the browser's own
            // cache would tell us nothing about it.
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
}

test("installable, offline, and each written page's own text", async () => {
  test.setTimeout(300_000);

  await test.step("build the export", () => {
    const built = spawnSync("bun", ["export"], {
      cwd: WEB_DIR,
      stdio: "inherit",
    });
    if (built.status !== 0) throw new Error("export failed");
  });

  // The written pages are static routes so that their text sits in the
  // exported HTML for a reader — or a reviewer — with JavaScript off. A
  // fragment screen would serve the app shell and pass any test that only
  // asked for a 200, so each one is asserted by a sentence that is actually
  // on it.
  await test.step("the written pages are in the exported HTML", async () => {
    // THREE pages. A page list that shrinks silently is how a page goes
    // missing with nothing going red, so the number is stated rather than left
    // to be noticed.
    //
    // The `privacy` needle is load-bearing beyond "this page still has its
    // text": that sentence is the one place grapevine says in plain words who
    // else can read a person's ratings, and a rewrite that drops it fails here
    // rather than shipping a softer page.
    for (const [route, sentence] of [
      ["privacy", "anyone who follows you can read your ratings"],
      ["help", "Thumb it down"],
      ["about", "Swipe a row right for yes, left for no."],
    ] as const) {
      const html = await readFile(resolve(ROOT, route, "index.html"), "utf8");
      // A sentence may be broken across lines in the source, and is in the
      // HTML where it is; a reader sees one space either way.
      check(
        `/${route}/ carries its own text`,
        html.replace(/\s+/g, " ").includes(sentence),
        sentence,
      );
    }
  });

  // The local stack's address and key are folded out of a production bundle
  // by `usingLocalStack` and its two siblings in `src/lib/utils/project.ts`,
  // and that folding is the bundler's to do. So the export is read for them: a
  // build that carries either is one variable away from pointing at somebody's
  // laptop.
  await test.step("the export does not know the local stack", async () => {
    const shipped: string[] = [];
    for (const entry of await readdir(ROOT, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.(js|html|json|webmanifest)$/.test(entry.name))
        continue;
      const text = await readFile(join(entry.parentPath, entry.name), "utf8");
      if (text.includes(LOCAL_SUPABASE_URL) || text.includes(LOCAL_ANON_KEY))
        shipped.push(entry.name);
    }
    check(
      "no exported file carries the local stack's address or key",
      shipped.length === 0,
      shipped.join(" "),
    );
  });

  // A profile on disk rather than the runner's own context: that one is off
  // the record, like a private window, and Chrome offers to install nothing
  // from a private window.
  const profile = await mkdtemp(join(tmpdir(), "grapevine-pwa-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    viewport: { width: 430, height: 932 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const server = serveExport();
  try {
    await new Promise<void>((listening) =>
      server.listen(0, "127.0.0.1", listening),
    );
    // At the root, because that is what production is: the site has an origin
    // of its own, so manifest scope, the worker's registration path and the
    // offline key are all `/`.
    const app = `http://localhost:${(server.address() as AddressInfo).port}`;

    // Before the document runs, or the event has already fired by the time
    // anything here could listen for it.
    await page.addInitScript(() => {
      window.addEventListener("beforeinstallprompt", () => {
        (window as { __installOffered?: boolean }).__installOffered = true;
      });
    });
    await page.goto(app);

    await test.step("a browser is willing to install it", async () => {
      // Chrome's own parse, not a read of the JSON: a manifest this file
      // agrees with and Chrome rejects would pass a hand-rolled check and
      // install nowhere.
      const devtools = await context.newCDPSession(page);
      const manifest = await devtools.send("Page.getAppManifest");
      check(
        "the manifest parses with no errors",
        manifest.errors.length === 0,
        JSON.stringify(manifest.errors),
      );
      const parsed = JSON.parse(manifest.data ?? "{}") as {
        display?: string;
        start_url?: string;
        theme_color?: string;
        background_color?: string;
        icons?: readonly { sizes?: string; purpose?: string }[];
      };
      check(
        "it is standalone, with a start_url",
        parsed.display === "standalone" && Boolean(parsed.start_url),
        JSON.stringify({
          display: parsed.display,
          start_url: parsed.start_url,
        }),
      );
      // The maskable one is separate on purpose: without it Android crops the
      // disc.
      const icons = parsed.icons ?? [];
      check(
        "it names a 512 and a maskable icon",
        icons.some((icon) => icon.sizes === "512x512" && !icon.purpose) &&
          icons.some((icon) => icon.purpose === "maskable"),
        JSON.stringify(icons),
      );

      // `--color-bg` (web/DESIGN-UI.md), which is also what `src/app.html`
      // gives the light theme color. The launcher paints this behind the app
      // before a pixel of it has run, so a restyle that missed the manifest
      // would show as a flash of the previous palette on every cold start —
      // and nothing else would catch it.
      const canvas = "#e8eced";
      check(
        "it opens on the canvas color",
        parsed.theme_color === canvas && parsed.background_color === canvas,
        JSON.stringify({
          theme_color: parsed.theme_color,
          background_color: parsed.background_color,
        }),
      );

      // Chrome's own verdict, and the strongest one available: it fires this
      // only for a page it is actually willing to install. Armed before the
      // load above, and waited for here because Chrome withholds it until the
      // worker is in place.
      const offered = await until(
        () =>
          page.evaluate(
            () =>
              (window as { __installOffered?: boolean }).__installOffered ===
              true,
          ),
        (seen) => seen,
      );
      check("Chrome offers to install it", offered, String(offered));

      const worker = await until(
        () =>
          page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration();
            if (!registration) return "none";
            else if (registration.active) return "active";
            else return "registered, not active";
          }),
        (state) => state === "active",
      );
      check("the worker registers and activates", worker === "active", worker);
    });

    await test.step("and it writes no query or fragment into the cache", async () => {
      // A navigation's `request.url` carries the query AND the fragment —
      // measured in Chrome, not assumed — so caching the request as it comes
      // stores whatever a link happened to carry somewhere with no expiry that
      // any same-origin script can read. Nothing sensitive rides a grapevine
      // URL today; what keeps that true is the worker never writing one down.
      await page.goto(`${app}/about/?token=QUERYSECRET456#FRAGMENTSECRET789`);
      // Until the worker has cached this navigation there is nothing to look
      // for a secret in, and an empty cache would pass both assertions below
      // by holding nothing at all.
      const keys = await until(
        () =>
          page.evaluate(async () => {
            const held: string[] = [];
            for (const name of await caches.keys()) {
              const cache = await caches.open(name);
              for (const request of await cache.keys()) held.push(request.url);
            }
            return held;
          }),
        (seen) => seen.some((key) => key.includes("/about/")),
      );
      for (const [what, secret] of [
        ["a query string", "QUERYSECRET456"],
        ["a fragment", "FRAGMENTSECRET789"],
      ] as const) {
        check(
          `${what} never reaches the cache`,
          !keys.some((key) => key.includes(secret)),
          keys.filter((key) => key.includes(secret)).join(" "),
        );
      }
      // And the pages themselves are still cached, under their own paths —
      // otherwise the assertions above would pass by caching nothing at all.
      check(
        "the pages are cached, keyed on the path alone",
        keys.some((key) => key.endsWith("/about/")),
        keys.filter((key) => !key.includes("/_app/")).join(" "),
      );
    });

    await test.step("and it opens with the network pulled", async () => {
      // Back to the entry point, and note it is a NAVIGATION rather than a
      // reload: the assertions above left the page on /about/, and reloading
      // there proved only that /about/ was cached while the thing about to be
      // opened offline was the root.
      await page.goto(app);
      const held = await until(
        () =>
          page.evaluate(async () => {
            const names = await caches.keys();
            const first = names[0];
            if (first === undefined) return 0;
            else return (await (await caches.open(first)).keys()).length;
          }),
        (count) => count > 0,
      );
      check("the shell is cached", held > 0, `${held} entries`);

      // Both layers, because they fail independently. Stopping the server is
      // what makes the DOCUMENT come from the cache: emulated offline alone,
      // a version of this watched the shell render over a live network and
      // credited the cache — it passed with the offline fallback deleted.
      // Emulated offline is what stops the PAGE reaching Supabase, which is a
      // different host and still up.
      // `close()` alone only stops new connections; the browser is holding
      // keep-alive ones that would go on being served.
      server.closeAllConnections();
      server.close();
      await context.setOffline(true);
      await page.goto(app);
      await until(
        () => bodyText(page),
        (text) => /from the people you trust/.test(text),
      );
      const screen = (await bodyText(page)).trim();
      check(
        "grapevine renders with no network at all",
        // The app's own words, not the absence of an error: a blank page and a
        // browser error page both pass a blacklist. Nothing has signed in, so
        // what renders is the welcome screen.
        /from the people you trust/.test(screen),
        screen.slice(0, 100),
      );
    });
  } finally {
    server.closeAllConnections();
    server.close();
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
