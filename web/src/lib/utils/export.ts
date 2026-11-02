import { type ExportedRating, ratingsCsv } from "grapevine-shared/import";
import type { Reference, SourceKey } from "grapevine-shared/references";
import { reloadMyRatings } from "./ratings";
import { supabase } from "./supabase";
import type { Ratings } from "./types";

export const EXPORT_FILE_NAME = "grapevine-ratings.csv";

// Few enough names that the read's address stays short.
const LINK_CHUNK = 40;

// PostgREST's list syntax: quoted, with `"` and `\` escaped, since a name may
// hold a comma, a bracket or a quote.
function listFilter(values: readonly string[]): string {
  const quoted = values.map(
    (value) => `"${value.replace(/[\\"]/g, (character) => `\\${character}`)}"`,
  );
  return `(${quoted.join(",")})`;
}

async function readLinks(
  names: readonly string[],
): Promise<Map<string, Reference>> {
  const links = new Map<string, Reference>();
  for (let from = 0; from < names.length; from += LINK_CHUNK) {
    const { data, error } = await supabase()
      .from("item_refs")
      .select("item_id,source,ref")
      .filter(
        "item_id",
        "in",
        listFilter(names.slice(from, from + LINK_CHUNK)),
      );
    if (error) throw error;
    for (const row of (data ?? []) as {
      item_id: string;
      source: SourceKey;
      ref: string;
    }[])
      links.set(row.item_id, { source: row.source, ref: row.ref });
  }
  return links;
}

/** The viewer's thumbs as the file's rows: by name, the thing before its attributes. */
export function exportRows(
  ratings: Ratings,
  links: ReadonlyMap<string, Reference>,
): ExportedRating[] {
  return Object.keys(ratings)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((itemId) =>
      Object.entries(ratings[itemId] ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tag, value]) => ({
          itemId,
          tag,
          value,
          reference: links.get(itemId) ?? null,
        })),
    );
}

/**
 * Downloads the viewer's own ratings as a file, built here from what they
 * may already read: their thumbs, and the links of the things in them.
 * Nothing is sent anywhere but those two reads.
 */
export async function saveRatingsFile(): Promise<void> {
  const ratings = await reloadMyRatings();
  const links = await readLinks(Object.keys(ratings));
  const file = new Blob([ratingsCsv(exportRows(ratings, links))], {
    type: "text/csv;charset=utf-8",
  });
  const address = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = address;
  anchor.download = EXPORT_FILE_NAME;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // After the click has been taken up, or the download has nothing to read.
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}
