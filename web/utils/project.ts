// Which backend this build talks to, and the only place it is configured
// (CLAUDE.md, "Supabase setup", step 1).
//
// Two literals, and deliberately no environment variable beside them: two ways
// to configure one thing, one of which nothing sets, is worse than either.
//
// No `"use client"`: `app/layout.tsx` is a server component and reads the origin
// at build time. A module marked client-only hands it a client reference rather
// than a string.

/**
 * The project's URL — `https://<project-ref>.supabase.co`.
 *
 * Left blank, `supabaseConfigured()` is false and sign-in is refused with an
 * explanation rather than a failure — the state of a fork before it has a
 * project of its own.
 */
export const PROJECT_URL = "https://sasczikxbkuoxrsumapn.supabase.co";

/**
 * The project's **publishable** key (`sb_publishable_…`), not the secret one.
 *
 * Public by design — it authorizes nothing on its own, and every read and write
 * behind it is decided by the policies in `supabase/migrations`. The name is
 * `anon` because that is what supabase-js calls the argument; a publishable key
 * goes in the same place and, unlike an anon JWT, can be revoked without
 * re-issuing every key the project has.
 */
export const PROJECT_ANON_KEY =
  "sb_publishable_7uzMLony3HuV_WnLVV4Y5A_MWjujZ7M";

// The local stack's fixed address and its fixed anon key, which `supabase start`
// prints and which are the same on every machine — a development secret is not
// one. They are only ever read when `usingLocalStack()` is true, so a production
// bundle carries whatever is above and nothing else.
//
// `scripts/local-session.mjs` declares the same two under the same names and
// cannot import them: it runs under plain `node`, which does not read
// TypeScript, and importing the script here would pull `postgres` into the app's
// bundle. `tests/local-stack.test.ts` is what stops the two drifting.
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// True when this build talks to a local `supabase start` rather than the real
// project. Exposed so the UI can SAY so: a local stack is empty, which makes
// every friend, request and recommendation vanish — a symptom with no visible
// cause unless something on screen admits which backend is behind it.
//
// The NODE_ENV half is what keeps localhost out of a production bundle. Next
// inlines that one as a literal, so the whole condition folds to false and the
// branch is eliminated; the public flag alone compiles to a RUNTIME read, which
// ships the local stack's address and leaves a build one variable away from
// pointing at it.
export function usingLocalStack(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_LOCAL_SUPABASE === "1"
  );
}

/** The origin every request of this build goes to, or "" when there is none. */
export function projectUrl(): string {
  return usingLocalStack() ? LOCAL_SUPABASE_URL : PROJECT_URL;
}

/** The key that goes with it. */
export function anonKey(): string {
  return usingLocalStack() ? LOCAL_ANON_KEY : PROJECT_ANON_KEY;
}
