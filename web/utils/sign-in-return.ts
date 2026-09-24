"use client";

// What survives the trip to Google and back.
//
// The provider's redirect lands on `redirectTo` with a `?code=` or an error in
// the query and nothing else, so two things a signed-out visitor had are lost
// on arrival: the fragment of the link they opened (a friend's `#/item/...`),
// and — when Google refused or they cancelled — any sign that something went
// wrong, since supabase-js only logs a failed callback.

const FRAGMENT_KEY = "grapevine:sign-in-fragment";

// GoTrue's names. It has put them in the query for PKCE and in the fragment for
// the implicit flow, so both are read.
const ERROR_PARAMS = ["error", "error_code", "error_description"] as const;

export type SignInReturn = {
  // The URL to show instead, or null when nothing about it changes.
  readonly cleanedUrl: string | null;
  // The provider's error code, when the round trip came back refused.
  readonly errorCode: string | null;
};

const NOTHING: SignInReturn = { cleanedUrl: null, errorCode: null };

function errorIn(params: URLSearchParams): string | null {
  if (!ERROR_PARAMS.some((name) => params.has(name))) return null;
  return params.get("error_code") || params.get("error") || "unknown";
}

/**
 * The pure half: given where the page landed and the fragment saved before
 * leaving, the URL to show and the error to say.
 *
 * The saved fragment is put back only on an actual return — a `code` or an
 * error in the URL — and only where the URL has no screen of its own, so a
 * fragment saved by an abandoned attempt cannot redirect a later, unrelated
 * visit.
 */
export function readSignInReturn(
  href: string,
  savedFragment: string | null,
): SignInReturn {
  const url = new URL(href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const errorCode = errorIn(url.searchParams) ?? errorIn(hashParams);
  const returned = url.searchParams.has("code") || errorCode !== null;

  let changed = false;
  for (const name of ERROR_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (errorIn(hashParams) !== null) {
    url.hash = "";
    changed = true;
  }
  if (
    returned &&
    savedFragment?.startsWith("#/") &&
    (url.hash === "" || url.hash === "#")
  ) {
    url.hash = savedFragment;
    changed = true;
  }
  return { cleanedUrl: changed ? url.toString() : null, errorCode };
}

// Before the redirect. Only a screen is worth keeping: Home is where a return
// lands anyway.
export function rememberFragmentForSignIn(fragment: string): void {
  try {
    if (fragment.startsWith("#/") && fragment !== "#/") {
      window.sessionStorage.setItem(FRAGMENT_KEY, fragment);
    } else {
      window.sessionStorage.removeItem(FRAGMENT_KEY);
    }
  } catch {
    // Storage refused (a private window, a blocked origin): the return lands
    // on Home.
  }
}

let taken: SignInReturn | null = null;

/**
 * The impure half, once per page load, and first: the Supabase client calls it
 * before it is constructed, so GoTrue never sees an error callback it would
 * only log, and the router calls it before reading the fragment.
 */
export function takeSignInReturn(): SignInReturn {
  if (typeof window === "undefined") return NOTHING;
  if (taken) return taken;
  let saved: string | null = null;
  try {
    saved = window.sessionStorage.getItem(FRAGMENT_KEY);
    window.sessionStorage.removeItem(FRAGMENT_KEY);
  } catch {
    saved = null;
  }
  taken = readSignInReturn(window.location.href, saved);
  if (taken.cleanedUrl !== null) {
    window.history.replaceState(window.history.state, "", taken.cleanedUrl);
  }
  return taken;
}

// Not GoTrue's: what the store reports when the exchange never answered.
export const SIGN_IN_TIMED_OUT = "sign_in_timeout";

/**
 * The code a failed exchange of `?code=` is reported under.
 *
 * supabase-js does not throw it or pass it to a listener: `initialize()`
 * resolves with it and nothing else, so it is read there. GoTrue's own code
 * where there is one (`flow_state_expired`, `bad_code_verifier`); anything
 * else — a request that never arrived — is one generic failure.
 */
export function exchangeFailure(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code } = error as { code?: unknown };
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "unknown";
}

/**
 * The URL without the `?code=` a failed exchange left in it, or null when there
 * was none. Left there, a reload tries the same dead code again.
 */
export function withoutCode(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has("code")) return null;
  url.searchParams.delete("code");
  return url.toString();
}
