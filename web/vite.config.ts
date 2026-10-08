import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Anchored to this file rather than the working directory, so `vite build web`
// from the repo root finds the same files.
function here(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

// The service worker is its own compile — `sw/sw.ts` to `static/sw.js` — and it
// happens HERE because this file is the one thing `dev` and `export` both load.
// Wired into the two scripts instead, a bare `vite build` ships a site whose
// sw.js 404s: no worker, no offline, and nothing says so.
function serviceWorker(): Plugin {
  let compiled = false;
  return {
    name: "grapevine:service-worker",
    buildStart() {
      // Once a process: a build starts once per environment.
      if (compiled) return;
      compiled = true;
      // By the runtime this process is, not through the bin file: its shebang
      // asks for `node`, and under bun there may be none on PATH.
      execFileSync(
        process.execPath,
        [here("./node_modules/typescript/bin/tsc"), "-p", "tsconfig.sw.json"],
        { cwd: here("."), stdio: "inherit" },
      );
    },
  };
}

// `shared/` has no build step: it is TypeScript source, imported here and by
// the Edge Function, so id normalization has exactly one definition. An alias
// rather than a `file:` dependency because bun installs one as a tree of
// symlinks. `tsconfig.json` carries the same names for the type checker and
// for `bun test`, and says what each entry is for.
const SHARED_ENTRIES: Readonly<Record<string, string>> = {
  "grapevine-shared": "index.ts",
  "grapevine-shared/entries": "entries.ts",
  "grapevine-shared/suggest-attributes": "suggest-attributes.ts",
  "grapevine-shared/search": "search.ts",
  "grapevine-shared/references": "references.ts",
};

export default defineConfig({
  plugins: [
    serviceWorker(),
    tailwindcss(),
    sveltekit({
      // `fallback` is what Pages serves for a path that is not a page: the
      // shell, which draws `+error.svelte`.
      adapter: adapter({ pages: "out", assets: "out", fallback: "404.html" }),
      compilerOptions: { runes: true },
      // The site has an origin of its own, so every address is from the root:
      // the worker keys its cache on them.
      paths: { relative: false },
      // Nothing links to the manifest but `src/app.html`, which is not a page
      // the crawl reads, so it is named.
      prerender: { entries: ["*", "/manifest.webmanifest"] },
      // `sw/sw.ts` is registered by `components/pwa.svelte`, in production only.
      serviceWorker: { register: false },
      // Nothing polls: a new deploy is picked up by the next load.
      version: { pollInterval: 0 },
    }),
  ],
  resolve: {
    // Exact names, so `grapevine-shared` does not also swallow
    // `grapevine-shared/search`.
    alias: Object.entries(SHARED_ENTRIES).map(([name, entry]) => ({
      find: new RegExp(`^${name}$`),
      replacement: here(`../shared/src/${entry}`),
    })),
  },
  server: {
    // The module graph reaches `../shared` and `../docs/mark.svg`, so what the
    // dev server may read has to be the repo rather than `web/`.
    fs: { allow: [here("..")] },
  },
});
