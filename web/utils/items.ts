"use client";

import { MAX_ID_LENGTH, normalizeId, searchFold } from "grapevine-shared";
import { supabase } from "./supabase";
import type { Item } from "./types";

// A search box is a prefix, not a catalog dump: enough rows to choose from or
// to see that the thing is not there yet, which is when "add it" is offered.
const SEARCH_LIMIT = 20;

const COLUMNS = "id,search_id";

type ItemRow = { id: string; search_id: string };

function toItem(row: ItemRow): Item {
  return { id: row.id, searchId: row.search_id };
}

/**
 * Null when the text names something, or a sentence saying why it does not.
 *
 * The refusals are `normalizeId`'s, which are the column `CHECK`'s: over 128
 * code points, a control or format character, an unassigned or private-use one.
 */
export function validateItemId(typed: string): string | null {
  if (normalizeId(typed) !== null) return null;
  if (typed.trim().length === 0) return "type a name.";
  // Length is the refusal somebody reaches by typing; the rest arrive by paste,
  // and one sentence covers every one of them.
  return `at most ${MAX_ID_LENGTH} characters, and nothing a font cannot draw.`;
}

/**
 * Adds a thing to the shared catalog, or returns the id that text already
 * names.
 *
 * The id IS what was typed, folded (`normalizeId`), so "Café  BLEU" and
 * "café bleu" are one thing without anyone searching first — de-duplication is
 * structural rather than a screen people have to read. Two clients racing cannot
 * both win and neither loses anything: `on conflict do nothing` lets the second
 * one read the winner's row instead of collecting a permission error.
 *
 * `search_id` is written HERE, by the client, from the one implementation of the
 * stripping in `shared/` (DESIGN §3.2). A trigger would put the rule in SQL too,
 * and the day the two disagree is a row nobody can find by its own name.
 *
 * `created_by` is not named and could not be: it is absent from the insert
 * grant and defaults to `auth.uid()`, so a client cannot attribute a creation to
 * anyone but itself — and it is absent from the select grant too, so creation
 * stays unattributed everywhere a reader can look.
 */
export async function createItem(typed: string): Promise<string> {
  const id = normalizeId(typed);
  if (id === null) {
    // The same refusal as a sentence. It cannot answer null on this branch; the
    // fallback is here only because its type says it might.
    throw new Error(validateItemId(typed) ?? "type a name.");
  }
  const { error } = await supabase()
    .from("items")
    .upsert({ id, search_id: searchFold(id) }, { ignoreDuplicates: true });
  if (error) throw error;
  return id;
}

export async function getItem(id: string): Promise<Item | null> {
  const { data, error } = await supabase()
    .from("items")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toItem(data as ItemRow) : null;
}

/**
 * `%`, `_` and the backslash are ordinary punctuation in an id, which is
 * arbitrary Unicode, so a query carrying one has to reach `LIKE` as a literal
 * rather than as a wildcard.
 *
 * `*` is the one that cannot be escaped: PostgREST turns every `*` in a `like`
 * value into `%` before Postgres is handed the pattern. It only ever widens the
 * match, and everything it can widen to is a catalog row the search would show
 * anyway.
 */
function escapeLike(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function prefixRows(
  column: "id" | "search_id",
  prefix: string,
): Promise<ItemRow[]> {
  const { data, error } = await supabase()
    .from("items")
    .select(COLUMNS)
    .like(column, `${escapeLike(prefix)}%`)
    .order(column)
    .limit(SEARCH_LIMIT);
  if (error) throw error;
  return (data ?? []) as ItemRow[];
}

type SearchRange = { column: "id" | "search_id"; prefix: string };

/**
 * The two prefix ranges a query reads: the id as typed, and the stripped id.
 *
 * The stripped range runs even when the query has nothing to strip, because
 * that is the case it is for: `cafe` strips to itself, and it is the
 * `search_id` range that finds `café bleu` for it. Only a query that strips to
 * nothing (`!!!`) skips it, since an empty prefix is the whole catalog.
 */
export function searchRanges(typed: string): SearchRange[] {
  const id = normalizeId(typed);
  // An empty box is not a query for the whole catalog, and a query longer than
  // an id may be matches no id.
  if (id === null) return [];
  const folded = searchFold(id);
  const literal: SearchRange = { column: "id", prefix: id };
  return folded.length === 0
    ? [literal]
    : [literal, { column: "search_id", prefix: folded }];
}

/**
 * Catalog rows whose id starts with what was typed, or whose stripped id starts
 * with the stripped form of it.
 *
 * Two queries and two indexes, not one (DESIGN §3.2). The primary key's range is
 * literal, so it finds `café bleu` for somebody who typed the accent; the
 * `search_id` range is what finds it for somebody who typed `cafe`. Without it
 * that viewer finds nothing and adds a second copy, splitting the catalog in a
 * way v1 never merges.
 *
 * Two statements rather than one `or(...)`: an `or` filter is a grammar the
 * query text is spliced into, and an id may contain a comma, a bracket or a
 * dot.
 */
export async function searchItems(typed: string): Promise<Item[]> {
  const batches = await Promise.all(
    searchRanges(typed).map(({ column, prefix }) => prefixRows(column, prefix)),
  );
  const found = new Map<string, Item>();
  for (const row of batches.flat()) found.set(row.id, toItem(row));
  return [...found.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, SEARCH_LIMIT);
}
