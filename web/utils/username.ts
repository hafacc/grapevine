"use client";

import { supabase } from "./supabase";

// The same pattern as the CHECK on `profiles.username`, so a handle the database
// would refuse is refused in the field instead of at the write.
const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

// Also a CHECK on the column, for the same reason.
const RESERVED = new Set([
  "admin",
  "grapevine",
  "support",
  "help",
  "root",
  "system",
  "about",
  "settings",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

// Null when valid, or a human-readable reason.
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (username.length < 3) return "at least 3 characters.";
  if (username.length > 20) return "at most 20 characters.";
  if (!USERNAME_RE.test(username))
    return "letters, numbers and _ only, starting with a letter.";
  if (RESERVED.has(username)) return "that username is reserved.";
  return null;
}

export function validateDisplayName(raw: string): string | null {
  if (raw.trim().length < 2) return "at least 2 characters.";
  if (raw.trim().length > 50) return "at most 50 characters.";
  return null;
}

/**
 * Claims a permanent handle, and turns searchability on with it.
 *
 * One statement over a unique index. A handle somebody else holds raises the
 * unique violation; a second claim by the same account raises too, because
 * there is no verb anywhere that changes or releases one.
 *
 * There is deliberately no availability check to go with it. Nobody may read
 * another account's row by handle unless that account is searchable, and a
 * lookup that answered for the rest would be the enumeration of every claimed
 * name that `find_by_username` exists to prevent — so the claim IS the check,
 * and a collision is an error to report rather than a race to lose.
 *
 * The two 23505s are not distinguishable here and are not meant to be: the
 * caller in `store.tsx` re-reads the profile and lets the row say which it was.
 */
export async function claimUsername(username: string): Promise<void> {
  const { error } = await supabase().rpc("claim_username", {
    p_handle: normalizeUsername(username),
  });
  if (error) throw error;
}
