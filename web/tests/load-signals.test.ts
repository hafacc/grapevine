import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(import.meta.dir, "..");

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
 */
function sources(directory: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(here, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        found.push({ path, text: readFileSync(join(here, path), "utf8") });
      }
    }
  };
  walk(directory);
  return found;
}

const SCREENS = [...sources("components"), ...sources("app")];

/**
 * The names one call destructures, per call site.
 *
 * `[^}]*` and not `[\s\S]*?`: an outer brace would let a name taken from the
 * call ABOVE satisfy the check for this one, which is the vacuous pass that
 * makes a source scan worse than nothing.
 */
function destructured(text: string, hook: string): string[][] {
  return [
    ...text.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${hook}\\(`, "g")),
  ].map((match) =>
    (match[1] ?? "")
      .split(",")
      .map((name) => (name.split(":")[0] ?? "").trim())
      .filter(Boolean),
  );
}

function callers(hook: string): { path: string; names: string[] }[] {
  return SCREENS.flatMap(({ path, text }) =>
    destructured(text, hook).map((names) => ({ path, names })),
  );
}

describe("a failed read is never drawn as an empty one", () => {
  // Without this the two below pass vacuously when the flag is gone
  // altogether.
  it("both hooks report one", () => {
    for (const file of ["utils/recs.ts", "utils/ratings.ts"]) {
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
          .filter(({ names }) => !names.includes("failed"))
          .map(({ path }) => path),
      ).toEqual([]);
    });
  }
});

describe("a switch is never drawn at its default before the row answers", () => {
  it("the store reports whether the preferences have been read", () => {
    const store = readFileSync(join(here, "utils/store.tsx"), "utf8");
    expect(store).toContain("prefsReady,");
    expect(store).toContain("prefsUnreachable,");
  });

  // `DEFAULT_PREFS` is "off", and off is a claim about a privacy switch.
  it("every screen reading prefs reads prefsReady", () => {
    expect(
      callers("useGrapevine")
        .filter(
          ({ names }) =>
            names.includes("prefs") && !names.includes("prefsReady"),
        )
        .map(({ path }) => path),
    ).toEqual([]);
  });
});
