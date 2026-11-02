import { supabase } from "./supabase";
import type { Account, Profile } from "./types";

// The columns `authenticated` is granted on `profiles`. There is no email to
// leave out: it is not a column of this table at all.
const PROFILE_COLUMNS = "id,display_name,photo_url,created_at";

// What one person may know about another account: a name, a face, and for a
// prefilled account its handle and the attributes its thumbs use.
export const ACCOUNT_COLUMNS =
  "id,display_name,photo_url,prefilled,handle,tags";

export type AccountRow = {
  id: string;
  display_name: string | null;
  photo_url: string | null;
  prefilled: boolean | null;
  handle: string | null;
  tags: unknown;
};

function epoch(value: unknown): number {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : 0;
}

export function toAccount(row: AccountRow): Account {
  return {
    uid: row.id,
    displayName: row.display_name ?? "",
    photoURL: row.photo_url ?? null,
    prefilled: row.prefilled === true,
    handle: row.handle ?? null,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

// Whether the caller follows no other person. Asked of the server rather than
// read off the list of follows, which loads separately and can lag a change.
export async function fetchLocked(): Promise<boolean> {
  const { data, error } = await supabase().rpc("account_locked");
  if (error) throw error;
  return data === true;
}

async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase().rpc("account_is_admin");
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
  const [{ data, error }, locked, admin] = await Promise.all([
    supabase()
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", uid)
      .maybeSingle(),
    fetchLocked(),
    fetchIsAdmin(),
  ]);
  if (error) throw error;
  if (!data) return null;
  return {
    uid: data.id,
    displayName: data.display_name ?? "",
    photoURL: data.photo_url ?? null,
    createdAt: epoch(data.created_at),
    locked,
    admin,
  };
}

// One row, and the rename is done: anyone who may see your profile reads it
// itself, so there is no copy of the name anywhere to rewrite.
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

type FollowRow = { account: AccountRow | null };

function accountsOf(rows: readonly FollowRow[] | null): Account[] {
  return (rows ?? [])
    .filter((row): row is { account: AccountRow } => row.account !== null)
    .map((row) => toAccount(row.account));
}

/** The accounts `uid` follows, each joined to its profile in the one request. */
export async function fetchFollowing(uid: string): Promise<Account[]> {
  const { data, error } = await supabase()
    .from("follows")
    .select(`account:profiles!follows_followed_id_fkey(${ACCOUNT_COLUMNS})`)
    .eq("follower_id", uid)
    .overrideTypes<FollowRow[]>();
  if (error) throw error;
  return accountsOf(data);
}

/** The people who follow `uid`. */
export async function fetchFollowers(uid: string): Promise<Account[]> {
  const { data, error } = await supabase()
    .from("follows")
    .select(`account:profiles!follows_follower_id_fkey(${ACCOUNT_COLUMNS})`)
    .eq("followed_id", uid)
    .overrideTypes<FollowRow[]>();
  if (error) throw error;
  return accountsOf(data);
}

/**
 * Every prefilled account. All of them rather than a search per keystroke:
 * they are made by hand, so there are few, and any signed-in person may read
 * every one.
 */
export async function fetchPrefilled(): Promise<Account[]> {
  const { data, error } = await supabase()
    .from("profiles")
    .select(ACCOUNT_COLUMNS)
    .eq("prefilled", true)
    .order("handle")
    .overrideTypes<AccountRow[]>();
  if (error) throw error;
  return (data ?? []).map(toAccount);
}

/**
 * Follows an account with no link: a prefilled one, or a person who already
 * follows the caller. The server refuses anybody else with one answer, so a
 * guessed id learns nothing.
 */
export async function follow(account: Account): Promise<void> {
  const { error } = await supabase().rpc(
    account.prefilled ? "follow_prefilled" : "follow_back",
    { p_user: account.uid },
  );
  if (error) throw error;
}

/** Stops `uid` following `followed`. */
export async function unfollow(uid: string, followed: string): Promise<void> {
  const { error } = await supabase()
    .from("follows")
    .delete()
    .eq("follower_id", uid)
    .eq("followed_id", followed);
  if (error) throw error;
}

/** Stops `follower` following `uid`: the followed side of the same row. */
export async function removeFollower(
  uid: string,
  follower: string,
): Promise<void> {
  const { error } = await supabase()
    .from("follows")
    .delete()
    .eq("follower_id", follower)
    .eq("followed_id", uid);
  if (error) throw error;
}
