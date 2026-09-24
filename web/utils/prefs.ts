"use client";

import { type Prefs, sanitizePrefs } from "grapevine-shared/entries";
import { supabase } from "./supabase";

export { DEFAULT_PREFS } from "grapevine-shared/entries";

export async function fetchPrefs(uid: string): Promise<Prefs> {
  const { data, error } = await supabase()
    .from("user_prefs")
    .select("discoverable_by_taste,dismissed_suggestions")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  // The same reading `refresh-suggestions` takes of the same row, so a missing
  // one and a row with a surprise in it mean here what they mean there.
  return sanitizePrefs(data);
}

// An upsert rather than an update: the trigger writes this row with the account,
// but a missing row reads as the defaults, and an update of it would silently
// change nothing.
export async function setDiscoverableByTaste(
  uid: string,
  discoverable: boolean,
): Promise<void> {
  const { error } = await supabase()
    .from("user_prefs")
    .upsert(
      { user_id: uid, discoverable_by_taste: discoverable },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

// Waving one away is permanent and the list is only ever added to: a suggestion
// that came back a week later because the walk found the same person again is
// the one thing DESIGN §5.1 says must not happen. Through a function because
// appending to an array has no PostgREST equivalent, and reading the list to
// rewrite it would lose a dismissal made in another tab.
export async function dismissSuggestion(suggestedUid: string): Promise<void> {
  const { error } = await supabase().rpc("dismiss_suggestion", {
    p_suggested: suggestedUid,
  });
  if (error) throw error;
}
