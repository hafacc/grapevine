// PostgREST caps every response at `max_rows` (supabase/config.toml), and a
// capped response is not an error: it is the first page, silently. So a read
// that must see every row asks for pages until one comes back short.
export const PAGE_ROWS = 1000;

/**
 * Every row, one page at a time. `page(from, to)` is inclusive at both ends, as
 * PostgREST's `range` is, and has to read in a stable order or a row can land
 * on two pages or on none.
 */
export async function readAllPages<Row>(
  page: (from: number, to: number) => Promise<readonly Row[]>,
  size: number = PAGE_ROWS,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += size) {
    const chunk = await page(from, from + size - 1);
    rows.push(...chunk);
    // Longer than asked for is a server that ignored the range and sent
    // everything, which is also the end.
    if (chunk.length !== size) return rows;
  }
}
