import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");
const migration = readFileSync(
  join(repo, "supabase", "migrations", "0006_realtime.sql"),
  "utf8",
);

/**
 * Every table the client opens a `postgres_changes` channel on.
 *
 * Read out of the source rather than listed here, because a list is the thing
 * that goes stale: the defect this suite exists for is a channel that
 * subscribes successfully and receives nothing, which looks like a feed that is
 * a little stale and survives a release. The migration and the client have to
 * be checked against each other, not each against a copy.
 */
function subscribedTables(): string[] {
  const found = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const source = readFileSync(path, "utf8");
        // A `table:` key inside a `.on("postgres_changes", …)` argument. The
        // two are matched together rather than by grepping for `table:` alone,
        // which would also catch anything else spelled that way.
        for (const match of source.matchAll(
          /postgres_changes[\s\S]{0,400}?table:\s*"([a-z_]+)"/g,
        )) {
          const table = match[1];
          if (table !== undefined) found.add(table);
        }
      }
    }
  };
  walk(join(import.meta.dir, "..", "utils"));
  walk(join(import.meta.dir, "..", "components"));
  return [...found].sort();
}

/** The tables `0006_realtime.sql` puts in the publication. */
function publishedTables(): string[] {
  const list = migration.match(/array\[([^\]]+)\]/);
  if (list === null) return [];
  return [...(list[1] ?? "").matchAll(/'([a-z_]+)'/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

describe("the Realtime publication", () => {
  const subscribed = subscribedTables();
  const published = publishedTables();

  it("finds the channels at all", () => {
    expect(subscribed.length).toBeGreaterThan(0);
    expect(published.length).toBeGreaterThan(0);
  });

  it.each(subscribed)(
    "publishes %p, which the client subscribes to",
    (table) => {
      expect(published).toContain(table);
    },
  );

  // Realtime applies the subscriber's own SELECT policy to each changed row —
  // except on a DELETE, where there is no row left to apply it to and every
  // matching subscriber is sent the primary key. `connect_requests`' key is
  // both uuids, so a client subscribing with no filter would receive a pair for
  // every accept, decline and withdrawal in the instance. The publication is
  // therefore inserts and updates only, and that is load-bearing rather than
  // tidy.
  it("publishes no delete events", () => {
    expect(migration).toMatch(/publish\s*=\s*'insert,\s*update'/);
  });
});
