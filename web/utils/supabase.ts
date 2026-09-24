"use client";

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { anonKey, projectUrl } from "./project";
import { takeSignInReturn } from "./sign-in-return";

// No project wired up yet: sign-in is refused with an explanation rather than a
// failure, and the app still builds and renders.
export function supabaseConfigured(): boolean {
  return projectUrl() !== "" && anonKey() !== "";
}

let cached: SupabaseClient | null = null;

// How long a request to the auth server may take. supabase-js sets no timeout,
// and the code exchange on the way back from Google runs under the SDK's own
// lock: one request that never answers leaves the lock held and the app on its
// splash for good.
export const AUTH_DEADLINE_MS = 10_000;

function withAuthDeadline(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.includes("/auth/v1/")) return fetch(input, init);
  const deadline = AbortSignal.timeout(AUTH_DEADLINE_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;
  return fetch(input, { ...init, signal });
}

export function supabase(): SupabaseClient {
  if (cached) return cached;
  // Before the client exists, because constructing it reads the callback out of
  // the URL: an error left there is logged by supabase-js and shown to nobody.
  takeSignInReturn();
  cached = createClient(
    // A client constructed with a blank URL throws, and `supabaseConfigured()`
    // is false long before anything asks for one — but a prerender pass reaches
    // this file, so the placeholder keeps the export building.
    projectUrl() || "http://127.0.0.1:1",
    anonKey() || "unconfigured",
    {
      auth: {
        // NOT the implicit flow, and this is a correctness requirement rather
        // than a preference (DESIGN §3.6). Implicit returns the session as
        // `#access_token=…&refresh_token=…`, and every screen in grapevine has
        // its URL in the fragment — so the router would be handed a fragment it
        // cannot parse as a screen, and an access token would sit in browser
        // history. PKCE returns `?code=…` in the QUERY string, which
        // `detectSessionInUrl` consumes and strips, leaving the fragment alone.
        // The failure it prevents looks like a routing bug: a blank screen on
        // first sign-in.
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
      // Cast only for `@types/bun`, whose `fetch` carries a `preconnect` no
      // browser has.
      global: { fetch: withAuthDeadline as typeof fetch },
    },
  );
  return cached;
}

// Postgres and GoTrue both carry one, and it is the only part of an error worth
// branching on — the message is prose that changes between releases.
export function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const shape = error as { code?: unknown; status?: unknown };
  if (typeof shape.code === "string") return shape.code;
  return typeof shape.status === "number" ? String(shape.status) : "";
}

// The database refuses a write past the account's daily budget with this code
// (`private.count_write` in 0001). Thumbs, new items, asks to connect and
// diagnostics all draw on it, so every write path reads the refusal the same way.
export function isDailyLimit(error: unknown): boolean {
  return errorCode(error) === "PT429";
}

/**
 * A read worth making again in a moment rather than reporting.
 *
 * PGRST303 ("JWT issued at future") is the first read after sign-in: GoTrue
 * stamps `iat` by its own clock, PostgREST checks it against a different one,
 * and a token minted a second ago can be refused by the second. The other case
 * is a request that never reached the server — postgrest-js returns it as an
 * error with no code and the fetch failure's name in the message, and
 * functions-js as a `FunctionsFetchError`.
 */
export function isTransient(error: unknown): boolean {
  if (errorCode(error) === "PGRST303") return true;
  if (error instanceof TypeError) return true;
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "FunctionsFetchError") return true;
  return (
    typeof message === "string" && /^(TypeError|FetchError): /.test(message)
  );
}

const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/**
 * `read`, made again after each delay while it fails transiently. Nothing else
 * re-reads until the tab is refocused, so a single refusal on the first load
 * after sign-in would otherwise leave the screen empty.
 */
export async function retryTransient<T>(
  read: () => Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (const delay of delays) {
    try {
      return await read();
    } catch (error) {
      if (!isTransient(error)) throw error;
    }
    await wait(delay);
  }
  return read();
}

// No number: how much somebody wrote is not a figure the app shows, and the
// budget is sized so a person rating things by hand never meets it.
export const DAILY_LIMIT_MESSAGE =
  "you've reached today's limit. try again tomorrow.";

// A Realtime channel that errors is DEAD: the client rejoins a dropped socket by
// itself, but a channel refused at the far end — a token that expired, a policy
// that now says no — stays refused, and the screen goes on looking live. So the
// subscription status is reported here and whoever attached it attaches a new
// one. It carries no name because the store re-attaches all of them together.
const channelLosses = new Set<() => void>();
const channelJoins = new Set<() => void>();

export function onChannelLost(handler: () => void): () => void {
  channelLosses.add(handler);
  return () => {
    channelLosses.delete(handler);
  };
}

export function onChannelJoined(handler: () => void): () => void {
  channelJoins.add(handler);
  return () => {
    channelJoins.delete(handler);
  };
}

/**
 * Wires a channel's status into those registries.
 *
 * `CLOSED` follows every deliberate `removeChannel`, so it is neither; a join
 * is `SUBSCRIBED`, and the other two are losses.
 */
export function subscribeChannel(
  channel: RealtimeChannel,
  context: string,
): void {
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      for (const handler of channelJoins) handler();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn(`channel(${context}): ${status}`);
      for (const handler of channelLosses) handler();
    }
  });
}

const SOCKET_POLL_MS = 1_000;

/**
 * Runs `then` once the Realtime socket is open, which is at once when it
 * already is.
 *
 * A channel created while the socket is down is not refused, it is queued: its
 * join waits in the socket's send buffer and goes out on reconnection, after
 * the channel itself has been removed and replaced. Re-attaching only onto an
 * open socket is what stops one outage becoming a burst of joins for channels
 * nobody holds. The socket reconnects by itself; this only waits.
 */
export function whenSocketOpen(then: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = (): void => {
    if (supabase().realtime.isConnected()) {
      timer = null;
      then();
    } else {
      timer = setTimeout(check, SOCKET_POLL_MS);
    }
  };
  check();
  return () => {
    if (timer !== null) clearTimeout(timer);
  };
}
