"use client";

import { PARTY_COLUMNS, type PartyRow, toParty } from "./friends";
import { supabase } from "./supabase";
import type { ConnectRequest, Party } from "./types";

export type RequestRow = {
  from_id: string;
  to_id: string;
  created_at: string;
  other: PartyRow | null;
};

/**
 * The rows as the two lists hold them, including the ones the join could not
 * name.
 *
 * A null embed is not a reason to drop the row. `profiles_select`
 * (`0003_policies.sql`) narrows the sender's read of the target to while the
 * target is still `searchable`, so a target turning findable off empties the
 * join on an ask that is still pending — and the ask is still there, still
 * addressed by uid, and still what hides its target from the sender's sections.
 *
 * What the gate took away is the NAME, so that is the only thing missing from
 * the row: a blank party, which says nothing about why — a sentence about their
 * privacy switch would be the one thing the gate is there to withhold.
 */
export function toRequests(
  rows: readonly RequestRow[],
  theirs: "from_id" | "to_id",
): ConnectRequest[] {
  return rows.map((row) => ({
    from: row.from_id,
    to: row.to_id,
    createdAt: Date.parse(row.created_at) || 0,
    other: row.other
      ? toParty(row.other)
      : { uid: row[theirs], username: "", displayName: "", photoURL: null },
  }));
}

// Whichever end of the ask the viewer is not, joined rather than stored: a
// pending request in either direction is itself a clause in the read policy on
// `profiles`, so each party reads the other's real row and a rename is visible
// at once.
async function fetchRequests(
  uid: string,
  mine: "from_id" | "to_id",
  theirs: "from_id" | "to_id",
): Promise<ConnectRequest[]> {
  const { data, error } = await supabase()
    .from("connect_requests")
    .select(
      `from_id,to_id,created_at,other:profiles!connect_requests_${theirs}_fkey(${PARTY_COLUMNS})`,
    )
    .eq(mine, uid)
    .order("created_at", { ascending: false })
    .overrideTypes<RequestRow[]>();
  if (error) throw error;
  return toRequests(data ?? [], theirs);
}

export function fetchIncomingRequests(uid: string): Promise<ConnectRequest[]> {
  return fetchRequests(uid, "to_id", "from_id");
}

export function fetchOutgoingRequests(uid: string): Promise<ConnectRequest[]> {
  return fetchRequests(uid, "from_id", "to_id");
}

// Ask someone found by their handle to be friends. Asking twice is the same
// pending ask, not a second one — `(from_id, to_id)` is the primary key — so a
// duplicate is ignored rather than refused.
export async function sendRequest(me: Party, target: Party): Promise<void> {
  const { error } = await supabase()
    .from("connect_requests")
    .upsert({ from_id: me.uid, to_id: target.uid }, { ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Accepts one, as a single statement.
 *
 * `accept_connect_request` is SECURITY INVOKER: it runs with the caller's own
 * rights and every policy still applies, so this is not a server in the request
 * path — it is the same client writes with a commit boundary around them. The
 * boundary is load bearing twice over: the two friendship rows cannot commit one at a time, and
 * the clause that authorizes writing the SENDER's edge is true only while their
 * request is still there.
 */
export async function acceptRequest(request: ConnectRequest): Promise<void> {
  const { error } = await supabase().rpc("accept_connect_request", {
    p_from: request.from,
  });
  if (error) throw error;
}

// Decline (recipient) or withdraw (sender) — the same delete either way, and the
// policy admits the row from either end.
export async function declineRequest(request: ConnectRequest): Promise<void> {
  const { error } = await supabase()
    .from("connect_requests")
    .delete()
    .eq("from_id", request.from)
    .eq("to_id", request.to);
  if (error) throw error;
}
