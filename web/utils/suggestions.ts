"use client";

// What `refresh-suggestions` answers with, declared in `shared/` because the
// Edge Function that writes the response and this file that reads it are the two
// ends of one call.
import type { SuggestionsResult } from "grapevine-shared/entries";
import { supabase } from "./supabase";
import type { ConnectRequest, Friend, Prefs, Suggestion } from "./types";

export type { SuggestionsResult };

// No photo. DESIGN §5.1 gives a suggestion a uid, a handle and a name; the face
// of somebody you have no edge to is one more thing the list would hand out, so
// it is not even read.
const SUGGESTED_COLUMNS = "id,username,display_name";

const NO_SUGGESTIONS: readonly Suggestion[] = [];

const NO_ATTRIBUTES: readonly string[] = [];

type SuggestionRow = {
  suggested: {
    id: string;
    username: string | null;
    display_name: string | null;
  } | null;
};

/**
 * The people taste search found, in the order it ranked them.
 *
 * At most five rows, written by `refresh-suggestions` as the service role; there
 * is no client write verb at all, so nothing here has to reconcile a local edit
 * with what the server said. The name and handle are joined rather than stored —
 * being in your own suggestions list is what lets you read that profile, and
 * reading it reveals strictly less than the suggestion already puts on screen.
 *
 * A row carries no word about alignment: no level, no score, no overlap, no count
 * (DESIGN §4). What a row IS drawn with is `sharedAttributes` below, asked for
 * per person and stored nowhere.
 */
export async function fetchSuggestions(
  uid: string,
): Promise<readonly Suggestion[]> {
  const { data, error } = await supabase()
    .from("suggestions")
    .select(
      `suggested:profiles!suggestions_suggested_id_fkey(${SUGGESTED_COLUMNS})`,
    )
    .eq("user_id", uid)
    .order("rank")
    .overrideTypes<SuggestionRow[]>();
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return NO_SUGGESTIONS;
  return rows.flatMap((row) =>
    row.suggested
      ? [
          {
            uid: row.suggested.id,
            username: row.suggested.username ?? "",
            displayName: row.suggested.display_name ?? "",
          },
        ]
      : [],
  );
}

/**
 * Runs the caller's own taste search, and nobody else's.
 *
 * There is no uid parameter and there cannot be one: the function reads the
 * caller from the verified token, so the only list it can write is the caller's.
 * It keeps the same ten-minute window the feed uses and answers
 * `recomputed: false` with `suggested: null` when the list it already wrote is
 * current, so opening the people screen twice costs one search.
 */
export async function refreshMySuggestions(): Promise<SuggestionsResult> {
  const { data, error } = await supabase().functions.invoke<SuggestionsResult>(
    "refresh-suggestions",
    { method: "POST" },
  );
  if (error) throw error;
  if (!data) throw new Error("the search returned nothing");
  return data;
}

/**
 * The attributes you and one other person agree on against the grain — at most
 * three, and the only thing about alignment that ever leaves the server
 * (DESIGN §5.1).
 *
 * Empty is a normal answer and carries two cases the function deliberately does
 * not separate: nobody who agrees with you the way your own network already does
 * earns a chip, and somebody you may not ask about gets the same empty list
 * rather than an error — an error would say which of the two it was. So a row
 * with nothing here is drawn without chips rather than with filler.
 *
 * The caller does not choose who: the function answers only about a person who
 * sent them an ask or who was suggested to them, both of which are that person's
 * own act.
 */
export async function sharedAttributes(
  otherUserId: string,
): Promise<readonly string[]> {
  const { data, error } = await supabase().rpc("shared_attributes", {
    p_other: otherUserId,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return NO_ATTRIBUTES;
  return data.filter((tag): tag is string => typeof tag === "string");
}

/**
 * What the people screen actually shows.
 *
 * The stored list is as old as the last search, so three things can have
 * happened since: the viewer dismissed somebody (which the next search will
 * honour), they became friends, or a request is already pending. None of those
 * is worth showing as a suggestion, and all of them are known locally — so they
 * are filtered here rather than waited on.
 */
export function visibleSuggestions(
  suggestions: readonly Suggestion[],
  prefs: Prefs,
  friends: readonly Friend[],
  outgoingRequests: readonly ConnectRequest[],
): readonly Suggestion[] {
  const settled = new Set<string>([
    ...prefs.dismissedSuggestions,
    ...friends.map((friend) => friend.uid),
    ...outgoingRequests.map((request) => request.to),
  ]);
  return suggestions.filter((suggestion) => !settled.has(suggestion.uid));
}
