// The client and the column CHECK hold one allow-list (DESIGN §3.2), built by
// `name-rules.ts` in two escapings. This is what keeps the database's copy the
// same as the one `isNormalizedId` compiles: the newest migration that defines
// `private.is_normalized_id` must carry every pattern, escaped for Postgres.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { nameRules, pgEscape } from "../src/name-rules";

const MIGRATIONS = join(import.meta.dir, "..", "..", "supabase", "migrations");

function newestDefinition(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .filter((sql) => sql.includes("function private.is_normalized_id("));
  const newest = defining.at(-1);
  if (newest === undefined) throw new Error("no migration defines it");
  return newest;
}

describe("the column CHECK's copy of the allow-list", () => {
  const sql = newestDefinition();
  const quoted = (pattern: string) => `'${pattern.replaceAll("'", "''")}'`;
  const rules = nameRules(pgEscape);

  it("carries every pattern the client compiles", () => {
    for (const pattern of [
      rules.whole,
      ...rules.refused,
      ...rules.singleScriptWords,
      rules.latinOrCommon,
      rules.latinPlusOne,
    ]) {
      expect(sql.includes(quoted(pattern))).toBe(true);
    }
  });
});
