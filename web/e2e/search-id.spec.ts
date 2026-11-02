// Every `items` row, against the one implementation of the stripping.
//
// `items.search_id` is written by the CLIENT, from `searchFold` in `shared/`,
// because computing it in a trigger would put the rule in SQL as well and the
// day the two disagree is a row nobody can find by its own name.
// What keeps a client honest is therefore this test and not a constraint: it
// reads every row and fails on the first one where the column is not what the
// id folds to. It imports `searchFold` itself, so there is no second copy of
// the folding to drift.
//
// It needs the local stack and no browser. Deliberately not in CI, which has
// no database.

import { test } from "@playwright/test";
import { searchFold } from "grapevine-shared";

import { check } from "./harness.ts";
import { requireStack, serviceRoleSql } from "./local-session.ts";

test("every search_id is searchFold(id)", async () => {
  const sql = serviceRoleSql();
  try {
    await requireStack(sql);
    const rows = await sql<{ id: string; search_id: string }[]>`
      select id, search_id from public.items order by id`;
    // The first row is the one worth reading; the rest of a broken catalog
    // says the same thing at length.
    const wrong = rows.find(
      ({ id, search_id }) => search_id !== searchFold(id),
    );
    check(
      `${rows.length} rows read, every one folds to its own column`,
      wrong === undefined,
      wrong === undefined
        ? `${rows.length} rows`
        : `${JSON.stringify(wrong.id)}: search_id is ${JSON.stringify(wrong.search_id)}, searchFold says ${JSON.stringify(searchFold(wrong.id))}`,
    );
  } finally {
    await sql.end();
  }
});
