"use client";

import { errorCode, supabase } from "./supabase";

/**
 * Reports a thing's name for an admin to look at (0013, 0014).
 *
 * The name and nothing else: the row's author is the caller by default, and
 * nobody reads a report back through the API. Reporting a name twice is the
 * primary key refusing a second row, which is the same outcome as the first.
 */
export async function reportName(itemId: string): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .insert({ item_id: itemId });
  if (reportFailed(error)) throw error;
}

export function reportFailed(error: unknown): boolean {
  return error !== null && error !== undefined && errorCode(error) !== "23505";
}

// A reported name as the review queue shows it (0014).
export type ReportedName = { itemId: string; reports: number };

// Empty for anyone but an admin: the server answers nobody else.
export async function fetchReportedNames(): Promise<ReportedName[]> {
  const { data, error } = await supabase().rpc("reported_names");
  if (error) throw error;
  return ((data ?? []) as { item_id: string; reports: number }[]).map(
    (row) => ({ itemId: row.item_id, reports: row.reports }),
  );
}

// Blocks it for good and takes it off every screen; its thumbs are deleted
// in the background (`private.remove_name`, 0017).
export async function removeReportedName(itemId: string): Promise<void> {
  const { error } = await supabase().rpc("remove_reported_name", {
    p_id: itemId,
  });
  if (error) throw error;
}

// Keeps the name and deletes its reports.
export async function dismissReports(itemId: string): Promise<void> {
  const { error } = await supabase().rpc("dismiss_reports", { p_id: itemId });
  if (error) throw error;
}
