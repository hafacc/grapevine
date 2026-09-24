import { describe, expect, it } from "bun:test";
import {
  LOCAL_ANON_KEY as SCRIPT_ANON_KEY,
  LOCAL_SUPABASE_URL as SCRIPT_URL,
} from "../scripts/local-session.mjs";
import { LOCAL_ANON_KEY, LOCAL_SUPABASE_URL } from "../utils/project.ts";

// The app and the check scripts talk to one local stack, and neither can import
// the other's copy of its address: `project.ts` must not pull `postgres` into
// the browser bundle, and `local-session.mjs` runs under plain `node`, which
// does not read TypeScript. So the two literals are pinned to each other here
// instead — a mismatch is a check that signs a session for one origin and drives
// a browser pointed at another, which fails as "the signed-in app never
// rendered" and says nothing about why.
describe("the local stack has one address", () => {
  it("agrees on the URL", () => {
    expect(SCRIPT_URL).toBe(LOCAL_SUPABASE_URL);
  });

  it("agrees on the anon key", () => {
    expect(SCRIPT_ANON_KEY).toBe(LOCAL_ANON_KEY);
  });
});
