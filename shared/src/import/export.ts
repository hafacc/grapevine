/**
 * The file out: a person's own ratings as CSV (DESIGN §1 "Importing"). No
 * dates, since nothing on a screen shows when a thumb was given.
 */

import { type Reference, referenceUrl } from "../references.ts";

export type ExportedRating = {
  readonly itemId: string;
  // Empty for the thing itself.
  readonly tag: string;
  readonly value: 1 | -1;
  readonly reference: Reference | null;
};

export const EXPORT_HEADER: readonly string[] = [
  "name",
  "attribute",
  "rating",
  "source",
  "id",
  "link",
];

// A cell a spreadsheet would run as a formula.
const FORMULA = /^[=+\-@\t\r]/u;

function cell(value: string): string {
  const guarded = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

/**
 * RFC 4180, with a BOM so a spreadsheet reads it as UTF-8. A cell that starts
 * as a formula does is prefixed with `'`, so a name cannot run as one.
 */
export function ratingsCsv(ratings: readonly ExportedRating[]): string {
  const rows = [
    EXPORT_HEADER,
    ...ratings.map(({ itemId, tag, value, reference }) => [
      itemId,
      tag,
      value === 1 ? "yes" : "no",
      reference?.source ?? "",
      reference?.ref ?? "",
      (reference === null ? null : referenceUrl(reference)) ?? "",
    ]),
  ];
  return `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
