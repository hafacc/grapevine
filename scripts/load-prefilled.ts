// Turns the hand-written files under `prefilled/` into the statements that
// load them: one `private.load_prefilled` call per account.
//
//   bun scripts/load-prefilled.ts            # every account in accounts.csv
//   bun scripts/load-prefilled.ts ebert      # one, by handle
//
// It prints SQL and runs nothing: a prefilled account is written with the
// service role, which this script is never given. The owner runs what it
// prints against the project (CLAUDE.md, "Prefilled accounts").
//
// `prefilled/accounts.csv` names each account (`handle,name`), and
// `prefilled/<handle>.csv` holds its thumbs in the columns the app's own
// export writes: `name`, `attribute` (empty for the thing itself), `rating`
// (`yes` or `no`), and optionally `source` and `id` for the thing's link. So
// an account's file can start as somebody's export.
//
// Everything a client's own write is checked for is checked here first — the
// name rules, the link's shape, one thumb per thing and attribute — because
// the function refuses the whole load on the first bad row, and a line number
// is a better thing to be told than a JSON fragment.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeId, searchFold } from "../shared/src/index.ts";
import { column, readTable } from "../shared/src/import/csv.ts";
import { isReference } from "../shared/src/references.ts";

const ROOT = join(import.meta.dir, "..", "prefilled");

// The handle rule `profiles` holds as a CHECK.
const HANDLE = /^[a-z0-9][a-z0-9_.]{1,30}$/u;

// What quotes the JSON in the statement. A name cannot contain it: `$` is not
// on the allow-list, and the check below refuses a file that somehow does.
const QUOTE = "$prefilled$";

type Thumb = {
  item: string;
  search_id: string;
  tag: string;
  value: 1 | -1;
  source?: string;
  ref?: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readText(path: string): string {
  if (!existsSync(path)) fail(`no such file: ${path}`);
  // Without the BOM a spreadsheet writes, which would otherwise be part of
  // the first header.
  return readFileSync(path, "utf8").replace(/^﻿/u, "");
}

function thumbsOf(handle: string): Thumb[] {
  const path = join(ROOT, `${handle}.csv`);
  const table = readTable(readText(path));
  for (const needed of ["name", "rating"]) {
    if (!table.header.includes(needed))
      fail(`${path}: no "${needed}" column`);
  }
  const [name, attribute, rating, source, ref] = [
    "name",
    "attribute",
    "rating",
    "source",
    "id",
  ].map((header) => column(table, header));
  const seen = new Set<string>();
  const thumbs: Thumb[] = [];
  table.rows.forEach((row, index) => {
    // The header is line 1.
    const at = `${path}:${index + 2}`;
    const typed = name?.(row) ?? "";
    if (typed === "" && row.every((cell) => cell.trim() === "")) return;
    // A leading `'` is the export's guard against a cell read as a formula.
    const item = normalizeId(typed.replace(/^'/u, ""));
    if (item === null) fail(`${at}: "${typed}" is not a name`);
    const typedTag = (attribute?.(row) ?? "").replace(/^'/u, "");
    const tag = typedTag === "" ? "" : normalizeId(typedTag);
    if (tag === null) fail(`${at}: "${typedTag}" is not an attribute`);
    const said = (rating?.(row) ?? "").toLowerCase();
    if (said !== "yes" && said !== "no")
      fail(`${at}: the rating is "${said}", not yes or no`);
    const key = `${item}\0${tag}`;
    if (seen.has(key)) fail(`${at}: a second thumb for ${item} ${tag}`);
    seen.add(key);
    const thumb: Thumb = {
      item,
      search_id: searchFold(item),
      tag,
      value: said === "yes" ? 1 : -1,
    };
    const [linkSource, linkRef] = [source?.(row) ?? "", ref?.(row) ?? ""];
    if (linkSource !== "" || linkRef !== "") {
      if (!isReference(linkSource, linkRef))
        fail(`${at}: "${linkSource}" "${linkRef}" is not a link`);
      thumb.source = linkSource;
      thumb.ref = linkRef;
    }
    thumbs.push(thumb);
  });
  return thumbs;
}

function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

const accountsPath = join(ROOT, "accounts.csv");
const accounts = readTable(readText(accountsPath));
const [handleOf, nameOf] = ["handle", "name"].map((header) =>
  column(accounts, header),
);
const known = new Map<string, string>();
accounts.rows.forEach((row, index) => {
  const handle = handleOf?.(row) ?? "";
  const display = nameOf?.(row) ?? "";
  if (handle === "" && display === "") return;
  const at = `${accountsPath}:${index + 2}`;
  if (!HANDLE.test(handle)) fail(`${at}: "${handle}" is not a handle`);
  if (display === "") fail(`${at}: ${handle} has no name`);
  if (known.has(handle)) fail(`${at}: ${handle} is listed twice`);
  known.set(handle, display);
});

const asked = process.argv.slice(2);
for (const handle of asked) {
  if (!known.has(handle)) fail(`${handle} is not in ${accountsPath}`);
}

for (const handle of asked.length > 0 ? asked : [...known.keys()]) {
  const payload = JSON.stringify(thumbsOf(handle));
  if (payload.includes(QUOTE)) fail(`${handle}: a row contains ${QUOTE}`);
  console.log(
    `select private.load_prefilled(${literal(handle)}, ${literal(known.get(handle) ?? "")}, ${QUOTE}${payload}${QUOTE}::jsonb);`,
  );
}
