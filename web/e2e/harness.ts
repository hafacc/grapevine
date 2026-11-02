// What every test in this directory is made of: the assertion, the seeding and
// the dev server the stack tests drive. One copy, because copies of it in each
// test drift: a fix lands in whichever copy was open.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Page } from "@playwright/test";

import { LOCAL_SUPABASE_URL, START_THE_STACK } from "./local-session.ts";

/** The `web/` directory, whatever the runner's working directory is. */
export const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * Soft-assert one claim, so a failure is reported and the rest still run.
 *
 * `detail` is what was seen, and goes into the message only, so a boolean
 * claim still says what it was looking at when it fails.
 */
export function check(what: string, ok: boolean, detail = ""): void {
  expect.soft(ok, detail ? `${what} — ${detail}` : what).toBe(true);
}

/**
 * Seed a simulated world into the running local stack.
 *
 * The stack is a daemon shared with `dev:local` and every other test, so
 * nothing here brings one up or tears one down: it seeds into whatever is
 * listening and says which command is missing when nothing is.
 */
export function seedWorld(args: readonly string[] = []): void {
  const seeded = spawnSync("bun", ["e2e/seed-local.ts", ...args], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });
  if (seeded.status !== 0)
    throw new Error(
      `could not seed. is the local stack up? (${START_THE_STACK})`,
    );
}

/** How long any of the waits below will go on believing the answer is coming. */
export const PATIENCE_MS = 30_000;

/**
 * Wait for the page to answer something rather than for a number of seconds.
 *
 * A fixed sleep is a guess at how long a service worker takes to register, or a
 * screen to hydrate, and under load it is the wrong guess: a busy machine can
 * still be on the splash when the seconds are up.
 * Returns the last answer either way, so a timeout still reports what it saw.
 */
export async function until<Value>(
  probe: () => Promise<Value>,
  wanted: (seen: Value) => boolean,
  patience: number = PATIENCE_MS,
): Promise<Value> {
  const deadline = Date.now() + patience;
  let seen = await probe();
  while (!wanted(seen) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 250));
    seen = await probe();
  }
  return seen;
}

/** Everything on screen, whitespace flattened, for a regex to look through. */
export async function bodyText(page: Page): Promise<string> {
  // biome-ignore lint/performance/useDomNodeTextContent: textContent includes text that is not drawn
  const text = await page.evaluate(() => document.body.innerText);
  return String(text ?? "").replace(/\s+/g, " ");
}

/**
 * Click the first element `selector` names, and say whether there was one.
 *
 * `text` narrows it to the one whose text holds those words, the way a person
 * picks a button, rather than by class, which is styling and changes without
 * the flow changing.
 */
export async function press(
  page: Page,
  selector: string,
  text?: string,
): Promise<boolean> {
  const all = page.locator(selector);
  const found = (
    text === undefined ? all : all.filter({ hasText: text })
  ).first();
  if ((await found.count()) === 0) return false;
  else {
    await found.click();
    return true;
  }
}

// The dev server a stack test starts when GRAPEVINE_ORIGIN names none. Not 3001,
// so it can run beside a `dev:local` somebody already has open.
const DEV_PORT = Number(process.env.GRAPEVINE_E2E_PORT ?? 3002);

// Any answer at all, since the real stack's gateway refuses a request with no
// key.
async function listening(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/** The fixtures the stack tests take. */
type StackFixtures = {
  /** Where the app under test is served, against the local stack. */
  origin: string;
};

/**
 * The test function for everything that drives the app against the local
 * stack.
 *
 * Its `origin` is `GRAPEVINE_ORIGIN` when that is set, or else a `dev:local`
 * server of its own on `GRAPEVINE_E2E_PORT` (3002), started once a worker and
 * stopped with it. It refuses to start when nothing answers at the stack's
 * address, with the sentence that says how to start one.
 */
export const stackTest = base.extend<object, StackFixtures>({
  origin: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixture's dependencies from this pattern.
    async ({}, use) => {
      const given = process.env.GRAPEVINE_ORIGIN;
      if (!(await listening(`${LOCAL_SUPABASE_URL}/rest/v1/`)))
        throw new Error(
          `nothing is listening at ${LOCAL_SUPABASE_URL}. start the local stack: ${START_THE_STACK}`,
        );
      if (given) {
        await use(given);
      } else {
        const origin = `http://localhost:${DEV_PORT}`;
        const server: ChildProcess = spawn(
          "bun",
          ["--bun", "vite", "dev", "--port", String(DEV_PORT), "--strictPort"],
          {
            cwd: WEB_DIR,
            env: { ...process.env, VITE_LOCAL_SUPABASE: "1" },
            stdio: "ignore",
          },
        );
        try {
          const up = await until(
            () => listening(origin),
            (there) => there,
            60_000,
          );
          if (!up)
            throw new Error(`the dev server never answered at ${origin}`);
          await use(origin);
        } finally {
          server.kill();
        }
      }
    },
    { scope: "worker", timeout: 90_000 },
  ],
});

export { expect };
