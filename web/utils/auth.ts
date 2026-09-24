"use client";

import { rememberFragmentForSignIn, SIGN_IN_TIMED_OUT } from "./sign-in-return";
import { errorCode, supabase } from "./supabase";

// Where the provider's bounce lands. Supabase checks this against `site_url` and
// the `additional_redirect_urls` globs in supabase/config.toml, and a mismatch is
// not refused: it silently sends the person to `site_url` instead, which from a
// dev server looks like sign-in working and landing on the production site.
//
// No fragment: GoTrue appends `?code=` to whatever it is given, and a fragment
// would put the screen ahead of the code. The screen travels in sessionStorage
// instead (`sign-in-return.ts`).
function redirectTo(): string {
  return `${window.location.origin}/`;
}

// The only door, and a redirect rather than a popup: a popup is blocked by
// default on iOS and is what an installed PWA has no window for. Nothing is
// linked onto anything — a session can only have come from here, so there is no
// second credential to attach and no uid that can change under a signed-in
// person.
export async function googleSignIn(): Promise<void> {
  rememberFragmentForSignIn(window.location.hash);
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo() },
  });
  if (error) throw error;
}

// Anything unmapped falls back to a generic line, so no raw SDK string is shown.
export function authErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    // Loss register: the plain word earns its place at the moment of loss.
    case "user_banned":
      return "this account has been disabled.";
    case "over_request_rate_limit":
    case "429":
      return "too many attempts. try again later.";
    case "provider_disabled":
      return "google sign-in isn't available here.";
    // The code came back and could not be exchanged: too late, or in a
    // browser that did not start the sign-in.
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "that took too long. try again.";
    case SIGN_IN_TIMED_OUT:
      return "couldn't finish signing you in. try again.";
    default:
      return "something went wrong. try again.";
  }
}
