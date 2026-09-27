"use client";

import { supabase } from "./supabase";

// A link is `https://<origin>/#/invite/<token>`. In the fragment and not the
// query, because a fragment never leaves the browser: not to GitHub Pages' logs
// and not in a Referer.
//
// It is not a screen. The token is taken out of the address on arrival, kept in
// sessionStorage — which is what survives the trip to Google, the same way
// `sign-in-return.ts` keeps a screen — and the address becomes `#/`, so a bearer
// secret does not sit in history or get copied along with a shared screen.
const INVITE_KEY = "grapevine:invite";

// Said where somebody first meets the word: the welcome screen a link opens,
// and the question it asks.
export const TRUST_MEANS =
  "your vine is a collection of people you trust to recommend honestly.";

// What `set_invite_link` mints: 32 bytes as unpadded base64url. A little
// slack either way costs nothing and the server is the one that decides.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

// Longer than any token, short enough that a pasted essay is not kept.
const MAX_KEPT = 256;

/**
 * Whether a kept token is worth asking the server about. One that is not is
 * answered as a dead link without a request: the person opened a link, and is
 * told it is invalid rather than shown nothing.
 */
export function isInviteToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

const PREFIX = "#/invite/";

export type InviteArrival = {
  readonly token: string | null;
  // The address to show instead, or null when it carried no link.
  readonly cleanedUrl: string | null;
};

/**
 * The pure half: the token in an address, and the address without it.
 *
 * Anything under `#/invite/` is taken out of the address, even a token that
 * cannot be one, so a mangled link lands on the list rather than sitting in the
 * bar. A mangled one is kept all the same, so the screen can say the link is
 * invalid (`isInviteToken` keeps it from the server); only an empty one is not.
 */
export function readInviteArrival(href: string): InviteArrival {
  const url = new URL(href);
  if (!url.hash.startsWith(PREFIX)) return { token: null, cleanedUrl: null };
  const raw = url.hash.slice(PREFIX.length);
  let candidate: string;
  try {
    candidate = decodeURIComponent(raw);
  } catch {
    candidate = raw;
  }
  candidate = candidate.replace(/\/+$/, "").slice(0, MAX_KEPT);
  url.hash = "#/";
  return {
    token: candidate.length > 0 ? candidate : null,
    cleanedUrl: url.toString(),
  };
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/${PREFIX}${token}`;
}

/**
 * The impure half: moves a token out of the address into sessionStorage, and
 * answers with whichever token is now waiting — the one just taken, or one kept
 * from before the trip to Google.
 */
export function takeInvite(): string | null {
  if (typeof window === "undefined") return null;
  const arrival = readInviteArrival(window.location.href);
  if (arrival.cleanedUrl !== null) {
    window.history.replaceState(window.history.state, "", arrival.cleanedUrl);
  }
  try {
    if (arrival.token !== null) {
      window.sessionStorage.setItem(INVITE_KEY, arrival.token);
      return arrival.token;
    } else {
      return window.sessionStorage.getItem(INVITE_KEY);
    }
  } catch {
    // Storage refused: the link still works in this page load, and is lost to
    // the trip to Google. The welcome screen cannot say so, and the person can
    // open the link again once signed in.
    return arrival.token;
  }
}

export function forgetInvite(): void {
  try {
    window.sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // Nothing was kept, so there is nothing to forget.
  }
}

// Who a link is from: what its owner handed over along with it, and all a
// holder learns — no id, so nothing to look the owner up by elsewhere.
export type InviteOwner = {
  readonly displayName: string;
  readonly photoURL: string | null;
};

// The caller's own link, or null when it is off. The select policy admits the
// owner's own row only, so this is at most one token and it is theirs.
export async function fetchMyLink(): Promise<string | null> {
  const { data, error } = await supabase()
    .from("invite_links")
    .select("token")
    .maybeSingle<{ token: string }>();
  if (error) throw error;
  return data?.token ?? null;
}

// Turns the link on, or replaces it: either way the answer is the one token
// that now works, and any token before it has stopped working.
export async function setInviteLink(): Promise<string> {
  const { data, error } = await supabase().rpc("set_invite_link");
  if (error) throw error;
  if (typeof data !== "string" || data.length === 0)
    throw new Error("no link came back");
  return data;
}

// Off is a delete. Filtered on the token rather than the owner, because the
// owner column is in no select grant and a filter needs one; the policy is what
// keeps it to the caller's row. Friendships the link already made stay.
export async function turnOffLink(token: string): Promise<void> {
  const { error } = await supabase()
    .from("invite_links")
    .delete()
    .eq("token", token);
  if (error) throw error;
}

/**
 * Whose link this is. Answered signed out as well as in — the link is the
 * authority to see its owner's name and photo — so the welcome screen can say
 * who it is from, and the question after sign-in can show the face to check
 * against. Null for a link that was turned off, replaced or never existed; the
 * three are not told apart.
 */
export async function inviteOwner(token: string): Promise<InviteOwner | null> {
  const { data, error } = await supabase()
    .rpc("invite_owner", { p_token: token })
    .maybeSingle<{ display_name: string | null; photo_url: string | null }>();
  if (error) throw error;
  if (!data) return null;
  return {
    displayName: data.display_name ?? "",
    photoURL: data.photo_url ?? null,
  };
}

// The owner's id; null when the link stopped working in between.
export async function redeemInvite(token: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("redeem_invite", {
    p_token: token,
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

// What the locked screen says about a link this device holds: none, one whose
// owner is still being asked, one the lookup failed on, or a dead one.
export type HeldLink = "none" | "checking" | "unchecked" | "dead";

export function heldLink(
  token: string | null,
  owner: InviteOwner | null | undefined,
  lookupFailed: boolean,
): HeldLink {
  if (token === null) return "none";
  else if (owner === null) return "dead";
  else if (owner === undefined && lookupFailed) return "unchecked";
  else return "checking";
}

/**
 * Whether a held link is asked about in place of the screen. A locked account
 * is always asked. Otherwise only once the viewer's own link is known, since
 * their own is not asked (`invite-gate` says so) and, until it is read, any
 * link could be it.
 */
export function asksAboutLink(
  token: string | null,
  owner: InviteOwner | null | undefined,
  locked: boolean,
  myLink: string | null | undefined,
): boolean {
  if (token === null || !owner) return false;
  else if (locked) return true;
  else return myLink !== undefined && token !== myLink;
}
