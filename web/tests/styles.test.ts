import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(import.meta.dir, "..");
const css = readFileSync(join(here, "app", "globals.css"), "utf8");

/** Every directory under `web/` that holds a `.tsx`, and so a class name. */
function directoriesWithComponents(from: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    const entries = readdirSync(join(here, relative), { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".tsx"))) {
      found.push(relative);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(`${relative}/${entry.name}`);
    }
  };
  walk(from);
  return found;
}

/** The directory each `@source` covers, as a regular expression over segments. */
function declaredSources(): RegExp[] {
  return [...css.matchAll(/@source\s+"\.\.\/([^"]+)"/g)].map((match) => {
    const directory = (match[1] ?? "").replace(/\/[^/]*$/, "");
    const pattern = directory
      .split("/")
      .map((segment) => (segment === "*" ? "[^/]+" : segment))
      .join("/");
    return new RegExp(`^${pattern}$`);
  });
}

/**
 * Tailwind only emits a utility it has SEEN, and one it never emitted fails
 * silently: the class is on the element, the rule is not in the stylesheet, and
 * the screen just looks a little wrong. A recursive glob does not recurse in
 * this build, so `globals.css` lists the levels one at a time, and this is what
 * notices a new one.
 */
describe("globals.css sources", () => {
  const directories = [
    ...directoriesWithComponents("app"),
    ...directoriesWithComponents("components"),
  ];
  const sources = declaredSources();

  it("has somewhere to look at all", () => {
    expect(directories).toContain("components/ui");
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(directories)("covers %p", (directory) => {
    expect(sources.some((source) => source.test(directory))).toBe(true);
  });
});
