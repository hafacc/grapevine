import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(import.meta.dir, "..", "src");

/**
 * A signal that exists and that nothing reads is the defect this suite is for.
 *
 * A screen that ignores `useMyRecs`' failure tells a viewer whose feed could
 * not be READ that they have nothing yet, which is a claim about them rather
 * than about the network; one that ignores `useMyRatings`' draws their own
 * thumbs un-pressed.
 *
 * So the rule is checked against the source rather than kept as a convention: a
 * screen that reads one of these may not read it without its failure flag.
 *
 * A reader is kept whole — `const recs = useMyRecs()` — and its fields read off
 * it, because copying them out would stop them following a change. So what is
 * looked for is the name each call is given, and that name's `.failed`.
 */
function sources(directory: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(here, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".svelte") || entry.name.endsWith(".ts")) {
        found.push({ path, text: readFileSync(join(here, path), "utf8") });
      }
    }
  };
  walk(directory);
  return found;
}

const SCREENS = [...sources("lib/components"), ...sources("routes")];

/**
 * Whether each call site reads the failure of the reader it made.
 *
 * Per call and not per file: a name taken from another reader in the same file
 * must not satisfy the check for this one, which is the vacuous pass that
 * makes a source scan worse than nothing.
 */
function callers(hook: string): { path: string; readsFailure: boolean }[] {
  return SCREENS.flatMap(({ path, text }) =>
    [...text.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${hook}\\(`, "g"))].map(
      (match) => ({
        path,
        readsFailure: new RegExp(`\\b${match[1]}\\.failed\\b`).test(text),
      }),
    ),
  );
}

describe("a failed read is never drawn as an empty one", () => {
  // Without this the two below pass vacuously when the flag is gone
  // altogether.
  it("both readers report one", () => {
    for (const file of [
      "lib/utils/recs.svelte.ts",
      "lib/utils/ratings.svelte.ts",
    ]) {
      expect(readFileSync(join(here, file), "utf8")).toContain(
        "failed: mine && state.failed",
      );
    }
  });

  for (const hook of ["useMyRecs", "useMyRatings"]) {
    it(`every screen reading ${hook} reads its failure`, () => {
      const reading = callers(hook);
      expect(reading.length).toBeGreaterThan(0);
      expect(
        reading
          .filter(({ readsFailure }) => !readsFailure)
          .map(({ path }) => path),
      ).toEqual([]);
    });
  }
});
