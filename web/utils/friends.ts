"use client";

import { supabase } from "./supabase";
import type { Friend, Party, Profile } from "./types";
import { normalizeUsername } from "./username";

// The columns `authenticated` is granted on `profiles`. There is no email to
// leave out: it is not a column of this table at all.
const PROFILE_COLUMNS =
  "id,username,display_name,photo_url,searchable,created_at";

// What one person may know about another: a name, a handle and a face. The same
// four whether they come from a friend edge, a pending request, a suggestion or
// a handle search, so every one of those reads the same list.
export const PARTY_COLUMNS = "id,username,display_name,photo_url";

export type PartyRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  photo_url: string | null;
};

function epoch(value: unknown): number {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : 0;
}

export function toParty(row: PartyRow): Party {
  return {
    uid: row.id,
    username: row.username ?? "",
    displayName: row.display_name ?? "",
    photoURL: row.photo_url ?? null,
  };
}

function toProfile(
  row: PartyRow & { searchable: boolean; created_at: string },
): Profile {
  return {
    ...toParty(row),
    searchable: row.searchable === true,
    createdAt: epoch(row.created_at),
  };
}

/**
 * The signed-in user's own profile row.
 *
 * It cannot be missing: the trigger on `auth.users` creates it in the same
 * transaction that creates the account. So `null` here means the row is gone
 * rather than never written, and a REJECTED or failed read throws instead —
 * which is the distinction the onboarding sheet rests on.
 */
export async function fetchOwnProfile(uid: string): Promise<Profile | null> {
  const { data, error } = await supabase()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  return data ? toProfile(data) : null;
}

// A function rather than a select: `searchable` is not a read clause on
// `profiles`, so a lookup by handle has to be an exact-key call that refuses a
// non-searchable target.
export async function findUserByUsername(
  username: string,
): Promise<Party | null> {
  const { data, error } = await supabase()
    .rpc("find_by_username", { p_handle: normalizeUsername(username) })
    .maybeSingle();
  if (error) throw error;
  return data ? toParty(data as PartyRow) : null;
}

// Freely reversible, because the handle stays claimed either way.
export async function setSearchable(
  uid: string,
  searchable: boolean,
): Promise<void> {
  const { error } = await supabase()
    .from("profiles")
    .update({ searchable })
    .eq("id", uid);
  if (error) throw error;
}

// One row, and the rename is done: a friend reads your profile itself, so there
// is no copy of the name anywhere to rewrite.
export async function updateProfileIdentity(
  uid: string,
  identity: { displayName: string; photoURL: string | null },
): Promise<void> {
  const { error } = await supabase()
    .from("profiles")
    .update({
      display_name: identity.displayName,
      photo_url: identity.photoURL,
    })
    .eq("id", uid);
  if (error) throw error;
}

type FriendRow = {
  since: string;
  friend: PartyRow | null;
};

// Both directions are stored, so a viewer's own edges are one index probe, and
// the profile at the far end of each is joined in the same request.
export async function fetchFriends(uid: string): Promise<Friend[]> {
  const { data, error } = await supabase()
    .from("friendships")
    .select(
      `since,friend:profiles!friendships_friend_id_fkey(${PARTY_COLUMNS})`,
    )
    .eq("user_id", uid)
    .overrideTypes<FriendRow[]>();
  if (error) throw error;
  return (data ?? [])
    .filter(
      (row): row is FriendRow & { friend: PartyRow } => row.friend !== null,
    )
    .map((row) => ({ ...toParty(row.friend), since: epoch(row.since) }));
}

/**
 * Ends a friendship, both halves at once.
 *
 * One statement rather than two deletes, and that is not tidiness: symmetry is a
 * deferred constraint on `friendships`, so a request that removed one side alone
 * would be refused at its own commit. Either party may do this — the policy
 * admits a row you are named in from either column.
 */
export async function unfriend(uid: string, friendUid: string): Promise<void> {
  const { error } = await supabase()
    .from("friendships")
    .delete()
    .or(
      `and(user_id.eq.${uid},friend_id.eq.${friendUid}),` +
        `and(user_id.eq.${friendUid},friend_id.eq.${uid})`,
    );
  if (error) throw error;
}
