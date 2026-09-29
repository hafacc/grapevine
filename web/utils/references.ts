"use client";

import type {
  Candidate,
  Reference,
  SourceKey,
} from "grapevine-shared/references";
import { useEffect } from "react";
import { createCell, useCell } from "./cell";
import { errorCode, supabase } from "./supabase";

/**
 * What tapping one offered match does, decided against the catalog:
 *
 * - `existing`: some thing already holds this link, so it opens that thing.
 * - `free`: nothing is called this, so the thing opens provisionally under
 *   the index's name, holding the link until its first thumb.
 * - `plain`: a thing is called this and has no link, so the viewer is asked
 *   whether it is this one first.
 *
 * A match whose every name is held by a thing with a different link is not
 * offered: a place tries its longer names first, and a Wikipedia title has
 * only one.
 */
export type MatchRow = {
  readonly kind: "existing" | "free" | "plain";
  readonly candidate: Candidate;
  readonly itemId: string;
};

const linkKey = (reference: Reference) =>
  `${reference.source}\u0000${reference.ref}`;

export type CatalogView = {
  // Names the catalog holds.
  readonly names: ReadonlySet<string>;
  // The link each of those names holds, if any.
  readonly linkOfName: ReadonlyMap<string, Reference>;
  // The name each offered link is held by, if any, keyed by `linkKey`.
  readonly nameOfLink: ReadonlyMap<string, string>;
};

export function classifyMatches(
  candidates: readonly Candidate[],
  catalog: CatalogView,
): MatchRow[] {
  const rows: MatchRow[] = [];
  const taken = new Set<string>();
  for (const candidate of candidates) {
    const held = catalog.nameOfLink.get(linkKey(candidate));
    let row: MatchRow | null = null;
    if (held !== undefined) {
      row = { kind: "existing", candidate, itemId: held };
    } else {
      for (const name of candidate.names) {
        if (!catalog.names.has(name)) {
          row = { kind: "free", candidate, itemId: name };
          break;
        } else if (!catalog.linkOfName.has(name)) {
          row = { kind: "plain", candidate, itemId: name };
          break;
        }
      }
    }
    // Two matches landing on one name would be one thing offered twice.
    if (row !== null && !taken.has(row.itemId)) {
      taken.add(row.itemId);
      rows.push(row);
    }
  }
  return rows;
}

// PostgREST's list syntax: quoted, with `"` and `\` escaped, since a name may
// hold a comma, a bracket or a quote. postgrest-js's `in` escapes neither.
function listFilter(values: readonly string[]): string {
  const quoted = values.map(
    (value) => `"${value.replace(/[\\"]/g, (character) => `\\${character}`)}"`,
  );
  return `(${quoted.join(",")})`;
}

type RefRow = { item_id: string; source: SourceKey; ref: string };

async function readCatalogView(
  candidates: readonly Candidate[],
): Promise<CatalogView> {
  const names = [...new Set(candidates.flatMap((entry) => entry.names))];
  const refs = [...new Set(candidates.map((entry) => entry.ref))];
  const [items, linksOfNames, holders] = await Promise.all([
    supabase().from("items").select("id").filter("id", "in", listFilter(names)),
    supabase()
      .from("item_refs")
      .select("item_id,source,ref")
      .filter("item_id", "in", listFilter(names)),
    supabase()
      .from("item_refs")
      .select("item_id,source,ref")
      .filter("ref", "in", listFilter(refs)),
  ]);
  for (const answer of [items, linksOfNames, holders])
    if (answer.error) throw answer.error;
  const linkOfName = new Map<string, Reference>();
  for (const row of (linksOfNames.data ?? []) as RefRow[])
    linkOfName.set(row.item_id, { source: row.source, ref: row.ref });
  const nameOfLink = new Map<string, string>();
  for (const row of (holders.data ?? []) as RefRow[])
    nameOfLink.set(linkKey(row), row.item_id);
  return {
    names: new Set(
      ((items.data ?? []) as { id: string }[]).map((row) => row.id),
    ),
    linkOfName,
    nameOfLink,
  };
}

/** The offered matches as rows, against the catalog as it is now. */
export async function resolveMatches(
  candidates: readonly Candidate[],
): Promise<MatchRow[]> {
  if (candidates.length === 0) return [];
  return classifyMatches(candidates, await readCatalogView(candidates));
}

/**
 * Links chosen for a thing that has no thumb yet, by item id. Nothing is
 * written until the first thumb or attribute (DESIGN §1.2), and then the
 * thing first, the link after it.
 */
const pending = createCell<ReadonlyMap<string, Reference>>(new Map());

export function holdReference(itemId: string, reference: Reference): void {
  const next = new Map(pending.get());
  next.set(itemId, { source: reference.source, ref: reference.ref });
  pending.set(next);
}

export function heldReference(itemId: string): Reference | null {
  return pending.get().get(itemId) ?? null;
}

function release(itemId: string): void {
  if (!pending.get().has(itemId)) return;
  const next = new Map(pending.get());
  next.delete(itemId);
  pending.set(next);
}

type LinkWriter = (itemId: string, reference: Reference) => Promise<void>;

/**
 * Writes one link. Losing a race is not a failure: the thing another tab
 * linked first keeps its link, and this one stays as it is. Neither is a
 * refused link (an admin took it off): whatever brought this here still
 * happens.
 */
const writeReference: LinkWriter = async (itemId, reference) => {
  const { error } = await supabase()
    .from("item_refs")
    .insert({ item_id: itemId, source: reference.source, ref: reference.ref });
  if (error && errorCode(error) !== "23505") {
    console.error("link", error);
  }
  links.set(new Map(links.get()).set(itemId, error ? null : reference));
};

/** Writes the link held for a thing on its first write, if there is one. */
export async function attachHeldReference(itemId: string): Promise<void> {
  const reference = heldReference(itemId);
  if (reference === null) return;
  release(itemId);
  await writeReference(itemId, reference);
}

/**
 * What picking a match does before its thing opens. A thing already in the
 * catalog under that name is linked at once: it exists, and its viewer may
 * already have rated it, so waiting for a thumb could wait for ever. A new
 * name holds its link until the first thumb writes the thing. A thing that
 * already holds the link needs nothing.
 */
export async function chooseMatch(
  row: MatchRow,
  write: LinkWriter = writeReference,
): Promise<void> {
  if (row.kind === "plain") await write(row.itemId, row.candidate);
  else if (row.kind === "free") holdReference(row.itemId, row.candidate);
}

// What each opened thing's link was read as; undefined until read.
const links = createCell<ReadonlyMap<string, Reference | null>>(new Map());
const NO_LINKS: ReadonlyMap<string, Reference | null> = new Map();
const NO_HELD: ReadonlyMap<string, Reference> = new Map();

async function readLink(itemId: string): Promise<void> {
  const { data, error } = await supabase()
    .from("item_refs")
    .select("source,ref")
    .eq("item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  links.set(
    new Map(links.get()).set(itemId, (data as Reference | null) ?? null),
  );
}

/**
 * A thing's link: the one it holds, or the one held for it until its first
 * thumb. Null for none.
 */
export function useItemReference(itemId: string): Reference | null {
  const read = useCell(links, NO_LINKS);
  const held = useCell(pending, NO_HELD);
  useEffect(() => {
    readLink(itemId).catch((error) => console.error("link", error));
  }, [itemId]);
  return held.get(itemId) ?? read.get(itemId) ?? null;
}
