// Every `items` row, against the one implementation of the stripping.
//
//   supabase start                    # shell 1, the whole backend
//   cd web && bun run check:search-id  # shell 2
//
// `items.search_id` is written by the CLIENT, from `searchFold` in `shared/`,
// because computing it in a trigger would put the rule in SQL as well and the
// day the two disagree is a row nobody can find by its own name (DESIGN §3.2).
// What keeps a client honest is therefore this script and not a constraint: it
// reads every row and fails on the first one where the column is not what the
// id folds to.
//
// A `.ts` run by bun rather than a `.mjs` run by node, for one reason: it
// imports `searchFold` from `shared/`, which is TypeScript source, and the
// whole point is that there is no second copy of the folding to import instead.
// `seed-local.ts` is a `.ts` for the same reason.
//
// It needs the local stack. Deliberately not in CI, which has no database.

import { searchFold } from "grapevine-shared";
import { serviceRoleSql } from "./local-session.mjs";

const sql = serviceRoleSql();

const rows = await sql<{ id: string; search_id: string }[]>`
  select id, search_id from public.items order by id`;

let wrong = 0;
for (const { id, search_id } of rows) {
  const expected = searchFold(id);
  if (search_id !== expected) {
    wrong += 1;
    console.error(
      `  ${JSON.stringify(id)}: search_id is ${JSON.stringify(search_id)}, ` +
        `searchFold says ${JSON.stringify(expected)}`,
    );
    // The first row is the one worth reading; the rest of a broken catalog says
    // the same thing at length.
    break;
  }
}

await sql.end();

if (wrong > 0) {
  console.error(
    `\nFAIL — ${rows.length} rows read, one does not fold to its own column`,
  );
  process.exit(1);
} else {
  console.log(`ok — ${rows.length} rows, every search_id is searchFold(id)`);
}
