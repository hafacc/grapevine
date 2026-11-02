/**
 * RFC 4180. JavaScript has no standard reader and `shared/` has no
 * dependencies.
 */

/**
 * Every row of a CSV text as its cells. Takes a BOM, CRLF or LF, quoted cells,
 * doubled quotes and newlines inside quotes; a quote in the middle of a bare
 * cell is kept as it is, which is what a file re-saved by a spreadsheet holds.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = (): void => {
    row.push(cell);
    cell = "";
    // A blank line is not a row of one empty cell.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      endRow();
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") endRow();
    } else {
      cell += character;
    }
    index += 1;
  }
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

export type Table = {
  // Lower case, trimmed, as `column` is asked.
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

/** A CSV's first row as its header, and the rest. */
export function readTable(text: string): Table {
  const [header = [], ...rows] = parseCsv(text);
  return {
    header: header.map((name) => name.trim().toLowerCase()),
    rows,
  };
}

/** Reads one column of a row by its header's name, or "" when there is none. */
export function column(
  table: Table,
  name: string,
): (row: readonly string[]) => string {
  const at = table.header.indexOf(name.toLowerCase());
  return (row) => (at === -1 ? "" : (row[at] ?? "").trim());
}
