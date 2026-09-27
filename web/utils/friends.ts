"use client";

import { supabase } from "./supabase";
import type { Friend, Party, Profile } from "./types";

// The columns `authenticated` is granted on `profiles`. There is no email to
// leave out: it is not a column of this table at all.
const PROFILE_COLUMNS = "id,display_name,photo_url,created_at";

// What one person may know about another: a name and a face. The same three
// whether they come from a friend edge, a pending request or a suggestion, so
// every one of those reads the same list.
export const PARTY_COLUMNS = "id,display_name,photo_url";

export type PartyRow = {
  id: string;
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
    displayName: row.display_name ?? "",
    photoURL: row.photo_url ?? null,
  };
}

function toProfile(
  row: PartyRow & { created_at: string },
  locked: boolean,
): Profile {
  return { ...toParty(row), createdAt: epoch(row.created_at), locked };
}

// Whether the caller has no connection (0010). Asked of the server rather than
// read off the friend list, which loads separately and can lag a change.
export async function fetchLocked(): Promise<boolean> {
  const { data, error } = await supabase().rpc("account_locked");
  if (error) throw error;
  return data === true;
}

/**
 * The signed-in user's own profile row.
 *
 * It cannot be missing: the trigger on `auth.users` creates it in the same
 * transaction that creates the account. So `null` here means the row is gone
 * rather than never written, and a REJECTED or failed read throws instead.
 */
export async function fetchOwnProfile(uid: string): Promise<Profile | null> {
  const [{ data, error }, locked] = await Promise.all([
    supabase()
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", uid)
      .maybeSingle(),
    fetchLocked(),
  ]);
  if (error) throw error;
  return data ? toProfile(data, locked) : null;
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
