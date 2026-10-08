import {
  type Candidate,
  type LookupRequest,
  type Position,
  pickShown,
  roundPosition,
  SOURCES,
  type SourceKey,
  toCheck,
} from "grapevine-shared/references";

// Per device, not per account: they are about what this browser sends.
const LOOKUP_KEY = "grapevine:lookup";
const LOCATION_KEY = "grapevine:lookup-location";

// Everything a lookup waits for once it is sent. Past it, add works as it did
// before there were lookups.
export const LOOKUP_BUDGET_MS = 1500;
// How long a place search waits for a position the browser already allows.
// A question on screen is waited for instead: the person is answering it.
const POSITION_WAIT_MS = 800;
const POSITION_QUESTION_WAIT_MS = 15_000;
const POSITION_MAX_AGE_MS = 60 * 60 * 1000;

export type LookupSettings = {
  readonly lookUp: boolean;
  readonly useLocation: boolean;
};

type Readable = Pick<Storage, "getItem">;

/** Both on unless turned off here; unreadable storage reads as on. */
export function readLookupSettings(storage: Readable | null): LookupSettings {
  const on = (key: string) => {
    try {
      return storage?.getItem(key) !== "off";
    } catch {
      return true;
    }
  };
  return { lookUp: on(LOOKUP_KEY), useLocation: on(LOCATION_KEY) };
}

export function lookupSettings(): LookupSettings {
  try {
    return readLookupSettings(window.localStorage);
  } catch {
    return readLookupSettings(null);
  }
}

export function saveLookupSetting(
  which: keyof LookupSettings,
  on: boolean,
): void {
  try {
    const key = which === "lookUp" ? LOOKUP_KEY : LOCATION_KEY;
    if (on) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, "off");
  } catch {
    // Back to on next time, which is the default anyway.
  }
}

/**
 * The viewer's rough position, or null: refused, unavailable, or slower than
 * the wait. The browser asks the first time; its answer is remembered by the
 * browser, so this asks once.
 */
async function roughPosition(): Promise<Position | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator))
    return null;
  let state: PermissionState | "unknown" = "unknown";
  try {
    state = (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    // Safari before 16 has no permissions query; asked for as if granted.
  }
  if (state === "denied") return null;
  const wait =
    state === "prompt" ? POSITION_QUESTION_WAIT_MS : POSITION_WAIT_MS;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), wait);
    navigator.geolocation.getCurrentPosition(
      (found) => {
        window.clearTimeout(timer);
        resolve(
          roundPosition({
            lat: found.coords.latitude,
            lon: found.coords.longitude,
          }),
        );
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        maximumAge: POSITION_MAX_AGE_MS,
        timeout: wait,
      },
    );
  });
}

// One JSON answer, or null for anything else. No cookie, and the page's
// origin as the only referrer.
async function fetchJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers,
      signal,
      credentials: "omit",
      referrerPolicy: "origin",
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function askSource(
  typed: string,
  key: SourceKey,
  near: Promise<Position | null>,
): Promise<readonly Candidate[]> {
  const source = SOURCES.find((entry) => entry.key === key);
  if (source === undefined) return [];
  const position = source.usesPosition ? await near : null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOOKUP_BUDGET_MS);
  try {
    const ask = (requests: readonly LookupRequest[]) =>
      Promise.all(
        requests.map(({ url, headers }) =>
          fetchJson(url, headers, controller.signal),
        ),
      );
    const found = source.parse(await ask(source.requests(typed, position)));
    if (source.check === undefined) return found;
    // Inside the same budget: a kind that could not be read is not offered.
    const checked = toCheck(typed, found);
    if (checked.length === 0) return [];
    return source.check.keep(
      checked,
      await ask(source.check.requests(checked)),
    );
  } finally {
    window.clearTimeout(timer);
  }
}

const remembered = new Map<string, readonly Candidate[]>();

/**
 * What the indices offer for a name about to be added, at most five good
 * matches, or none: switched off, offline, every request failed or ran out of
 * time, or nothing matched every word. Only ever on a tap of add, never while
 * typing; the same words twice in a session are asked once.
 */
export async function lookUp(typed: string): Promise<readonly Candidate[]> {
  const settings = lookupSettings();
  if (!settings.lookUp) return [];
  if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
  const key = `${settings.useLocation ? "near" : "far"}\u0000${typed}`;
  const known = remembered.get(key);
  if (known !== undefined) return known;
  // Asked only when a source uses it, and only once for all of them.
  let near: Promise<Position | null> | null = null;
  const position = () => {
    near ??= settings.useLocation ? roughPosition() : Promise.resolve(null);
    return near;
  };
  const answered = await Promise.all(
    SOURCES.map(
      async (source) =>
        [
          source.key,
          await askSource(
            typed,
            source.key,
            source.usesPosition ? position() : Promise.resolve(null),
          ),
        ] as const,
    ),
  );
  const shown = pickShown(typed, new Map(answered));
  // Nothing is not remembered: it may have been a failed request.
  if (shown.length > 0) remembered.set(key, shown);
  return shown;
}
