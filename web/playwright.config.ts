import { defineConfig } from "@playwright/test";

// One worker, in order: the stack tests share one database and one dev server,
// and the PWA test builds `out/`, which nothing else may be reading meanwhile.
export default defineConfig({
  testDir: "e2e",
  // `grapevine-shared` resolves through this file's `paths`; `web/tsconfig.json`
  // extends SvelteKit's generated one, which the runner cannot follow.
  tsconfig: "e2e/tsconfig.json",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: "list",
  use: {
    // The installed Chrome, so nothing is downloaded.
    channel: "chrome",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "pwa", testMatch: "pwa.spec.ts" },
    {
      name: "stack",
      testMatch: [
        "signin.spec.ts",
        "feed.spec.ts",
        "search-id.spec.ts",
        "taste-map.spec.ts",
      ],
    },
  ],
});
