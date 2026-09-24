// What every check in this directory is made of: the assertion, the seeding, the
// call to the Edge Function, and the headless Chrome. One copy, because copies
// of it in each check drift: a fix lands in whichever copy was open.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
  mintSession,
} from "./local-session.mjs";

const failures = [];

export function expect(what, ok, detail = "") {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ""}`);
    failures.push(what);
  }
}

/** The last line of a check, and its exit status. Close what you opened first. */
export function finish() {
  console.log(
    failures.length === 0
      ? "\nall good\n"
      : `\n${failures.length} failed: ${failures.join(", ")}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

/**
 * A simulated world into the running local stack.
 *
 * `supabase start` is a daemon shared with `dev:local` and every other check, so
 * nothing here brings a stack up or tears one down — it seeds into whatever is
 * listening and says which command is missing when nothing is.
 *
 * With `prefix`, the simulator's own world is written to a temporary file and its
 * path returned, which is how a check names a seeded person before reading the
 * database back.
 */
export function seedWorld({ prefix, args = [] } = {}) {
  const world = prefix
    ? join(mkdtempSync(join(tmpdir(), prefix)), "world.json")
    : null;
  console.log("seeding the running stack");
  const seeded = spawnSync(
    "bun",
    [
      "scripts/seed-local.ts",
      ...(world ? ["--world-out", world] : []),
      ...args,
    ],
    { stdio: "inherit" },
  );
  if (seeded.status !== 0) {
    console.error("could not seed — is `supabase start` running?");
    process.exit(1);
  }
  return world;
}

/**
 * The same call the screen makes, as somebody the seeding loaded.
 *
 * There is no uid parameter and there cannot be one: the function reads the
 * caller off the verified token, so holding a token minted for somebody is the
 * only way to refresh their feed.
 */
export async function refreshAs(uid, email, body = {}) {
  return callFunction("refresh-recs", uid, email, body);
}

/**
 * Taste search for one person, the same call the people screen makes.
 *
 * It is a second function rather than a database one because the deep walk is
 * the wasm core; everything else about the call — the minted token, no uid
 * parameter — is `refreshAs` above.
 */
export async function suggestAs(uid, email, body = {}) {
  return callFunction("refresh-suggestions", uid, email, body);
}

async function callFunction(name, uid, email, body) {
  const { accessToken } = mintSession(uid, email);
  const answer = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      apikey: LOCAL_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const result = await answer.json();
  if (!answer.ok)
    throw new Error(`${name} as ${email}: ${JSON.stringify(result)}`);
  return result;
}

/** How long any of the waits below will go on believing the answer is coming. */
export const PATIENCE_MS = 30_000;

/**
 * Waits for the page to answer something rather than for a number of seconds.
 *
 * A fixed sleep is a guess at how long a service worker takes to register, or a
 * screen to hydrate, and under load it is the wrong guess: a busy machine can
 * still be on the splash when the seconds are up.
 * Returns the last answer either way, so a timeout still reports what it saw.
 */
export async function until(probe, wanted, patience = PATIENCE_MS) {
  const deadline = Date.now() + patience;
  let seen = await probe();
  while (!wanted(seen) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 250));
    seen = await probe();
  }
  return seen;
}

/**
 * A headless Chrome on its own debug port and its own profile, driven over CDP.
 *
 * Each check picks its own `port` and `profile` so two of them can be running
 * without one driving the other's session, and its own `window` because width
 * decides the layout: side buttons at desktop width, swipes at phone width.
 */
export async function openBrowser({ port, profile, window = "430,932" }) {
  // A browser left behind holds the debug port and the profile, and the next run
  // then drives the previous run's session.
  spawnSync("pkill", ["-f", `user-data-dir=${profile}`]);
  await new Promise((done) => setTimeout(done, 1500));
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--disable-gpu",
      "--no-first-run",
      `--window-size=${window}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  // Reaped on any throw, not just the last line: a failed assertion must not
  // leave a Chrome holding the debug port and the profile.
  process.on("exit", () => chrome?.kill());

  // Polled rather than slept on: a cold launch can take well over five seconds,
  // and the failure then is a connection refused that reads like a missing
  // browser.
  let targets = null;
  for (let attempt = 0; attempt < 40 && targets === null; attempt += 1) {
    await new Promise((done) => setTimeout(done, 500));
    targets = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((answer) => answer.json())
      .catch(() => null);
  }
  if (targets === null)
    throw new Error("headless Chrome never opened its port");

  const socket = new WebSocket(
    targets.find((target) => target.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((done) => {
    socket.onopen = done;
  });
  let id = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message.result ?? message.error);
      waiting.delete(message.id);
    }
  };
  // Every round trip is bounded. A call that never comes back hangs the script
  // on a top-level await, and Node kills that without running the exit handler —
  // which left a headless Chrome holding the port. A rejection unwinds instead.
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const at = ++id;
      const timer = setTimeout(() => {
        waiting.delete(at);
        fail(new Error(`${method} never answered`));
      }, PATIENCE_MS);
      waiting.set(at, (result) => {
        clearTimeout(timer);
        done(result);
      });
      socket.send(JSON.stringify({ id: at, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");

  const evaluate = async (expression) =>
    (
      await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    )?.result?.value;

  return {
    send,
    evaluate,
    close: () => chrome.kill(),
    /**
     * Navigates and waits for THAT document, by path rather than by readyState
     * alone: the document being replaced is already complete, so a bare
     * readyState answers about the page just left.
     *
     * `settle` is time for the app on top of the document — a fetch, a
     * hydration, a write — and applies only after the document has landed, which
     * is what the copies that slept a flat four seconds could not promise.
     */
    go: async (url, settle = 0) => {
      // Either spelling: a directory asked for without its trailing slash
      // redirects to the one with it, so that is where the document lands.
      const here = new URL(url).pathname.replace(/\/$/, "");
      await send("Page.navigate", { url });
      await until(
        () =>
          evaluate(
            `[${JSON.stringify(here)}, ${JSON.stringify(`${here}/`)}].includes(location.pathname) && document.readyState === "complete"`,
          ),
        (there) => there === true,
      );
      if (settle > 0) await new Promise((done) => setTimeout(done, settle));
    },
  };
}

/** Everything on screen, whitespace flattened, for a regex to look through. */
export const bodyText = async (page) =>
  String((await page.evaluate("document.body.innerText")) ?? "").replace(
    /\s+/g,
    " ",
  );

// Taps the first element whose text matches, the way a person would — rather
// than by class, which is styling and changes without the flow changing.
export const click = (selector, text) => `(() => {
  const found = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => node.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (found) found.click();
  return Boolean(found);
})()`;

/** The one element a selector names, when its text is not what identifies it. */
export const tap = (selector) => `(() => {
  const found = document.querySelector(${JSON.stringify(selector)});
  if (found) found.click();
  return Boolean(found);
})()`;

// Through the prototype's own setter, so React sees the change: assigning
// `field.value` directly updates the DOM and leaves the component's state where
// it was, and the screen then behaves as though nothing was typed.
export const fill = (selector, value) => `(() => {
  const field = document.querySelector(${JSON.stringify(selector)});
  if (!field) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value").set;
  setter.call(field, ${JSON.stringify(value)});
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;
