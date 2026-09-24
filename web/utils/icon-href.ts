import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Build time only: this reads the disk. Nothing marked "use client" may import
// it.

/**
 * An icon's address with its content in the query string.
 *
 * A browser keeps a favicon per URL for as long as it likes and does not
 * revalidate it on reload, so a changed icon at the same URL goes undrawn in
 * every browser that saw the old one. The hash moves whenever `make-icons.mjs`
 * writes a different file, and only then.
 */
export function iconHref(published: string, source: string): string {
  const version = createHash("sha256")
    .update(readFileSync(join(process.cwd(), source)))
    .digest("hex")
    .slice(0, 10);
  return `/${published}?v=${version}`;
}
