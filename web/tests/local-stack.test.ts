import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCAL_DB_URL,
  LOCAL_JWT_SECRET,
  LOCAL_SUPABASE_URL,
} from "../e2e/local-session.ts";

// `supabase/tests/serve-local.sh` serves a stack with no Docker at the real
// one's addresses, and is a shell script: it cannot import them. A drifted
// secret there is every signed-in request refused, which a test reports as a
// screen that never rendered.
describe("the stack with no Docker is the same stack", () => {
  const script = readFileSync(
    join(import.meta.dir, "..", "..", "supabase", "tests", "serve-local.sh"),
    "utf8",
  );
  const assigned = (name: string): string | undefined =>
    script.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, "m"))?.[1];

  it("signs with the secret the tests sign with", () => {
    expect(assigned("JWT_SECRET")).toBe(LOCAL_JWT_SECRET);
  });

  it("serves the API where the app looks for it", () => {
    expect(assigned("API_PORT")).toBe(new URL(LOCAL_SUPABASE_URL).port);
  });

  it("serves the database the tests connect to", () => {
    const database = new URL(LOCAL_DB_URL);
    expect(assigned("DB_PORT")).toBe(database.port);
    expect(assigned("PGDATABASE")).toBe(database.pathname.slice(1));
    expect(script).toContain(
      `alter role ${database.username} password '${database.password}'`,
    );
  });
});
