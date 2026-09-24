import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The service worker is its own compile — `sw/sw.ts` to `public/sw.js` — and it
// happens HERE because this file is the one thing every Next command loads.
// Wired into the `dev` and `export` scripts instead, a bare `next build` ships
// a site whose sw.js 404s: no worker, no offline, and nothing says so.
//
// Anchored to this file rather than the working directory, which Next does NOT
// set to the project: otherwise `next build web` from the repo root dies with
// ENOENT before Next prints anything.
const here = dirname(fileURLToPath(import.meta.url));
execFileSync(
  join(here, "node_modules", ".bin", "tsc"),
  ["-p", "tsconfig.sw.json"],
  {
    cwd: here,
    stdio: "inherit",
  },
);

export default {
  output: "export",
  // The module graph reaches `../shared`, so the boundary Turbopack works
  // within has to be the repo rather than `web/`: without this it infers `web/`
  // and refuses the shared source as outside it ("Module not found").
  turbopack: { root: join(here, "..") },
  reactStrictMode: true,
  images: { unoptimized: true },
  trailingSlash: true,
};
