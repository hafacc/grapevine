// The way in, for the tests that drive a browser against the local stack.
//
// There is no door a headless browser can drive: Google's consent screen cannot
// be scripted and the local stack has no Google. So this mints a session
// against the stack's own JWT secret and writes it where supabase-js looks for
// one. The app is then signed in before its first render, which is what every
// test after the door was really about.
//
// Nothing here is a secret. `supabase start` prints the same URL, the same ports
// and the same JWT secret on every machine, and `supabase/tests/serve-local.sh`
// serves a stack with no Docker at the same ones; they authorize nothing
// anywhere else, which is why `src/lib/utils/project.ts` carries the address
// and the anon key in the source. They are imported from there rather than
// copied, and `tests/local-stack.test.ts` pins the shell script's copies.

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import postgres from "postgres";

import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
} from "../src/lib/utils/project.ts";

export { LOCAL_ANON_KEY, LOCAL_SUPABASE_URL };

/** A connection to the local stack's database. */
export type Sql = ReturnType<typeof postgres>;

// Postgres itself, not PostgREST: a test reads back what the app wrote, and
// half of what it wants to see is in a schema the API does not serve at all.
/** The local stack's database. */
export const LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** The local stack's JWT secret. */
export const LOCAL_JWT_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

/** GoTrue's own `jwt_expiry` (supabase/config.toml), in seconds. */
const TOKEN_LIFETIME_SECONDS = 3600;

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Sign claims with HS256 over the stack's secret, which GoTrue and PostgREST
 * both verify a bearer token with.
 */
export function signJwt(
  claims: Readonly<Record<string, unknown>>,
  secret: string = LOCAL_JWT_SECRET,
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * The storage key supabase-js writes a session under.
 *
 * `sb-${new URL(url).hostname.split(".")[0]}-auth-token` is SupabaseClient's own
 * default (`defaultStorageKey` in its constructor), so for this stack it is
 * `sb-127-auth-token`. Computed from the URL with that same expression rather
 * than pasted, because a wrong key fails SILENTLY: the app finds no session,
 * renders the welcome screen, and the test reports "the signed-in app never
 * rendered" — which is true and says nothing about the key.
 */
export function storageKeyFor(url: string = LOCAL_SUPABASE_URL): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/** A minted session and its bearer token. */
export type MintedSession = {
  readonly accessToken: string;
  readonly session: Readonly<Record<string, unknown>>;
};

/**
 * A session for a seeded account, in the shape supabase-js persists.
 *
 * `refresh_token` is a throwaway string and is named one: nothing issued it, so
 * GoTrue will not redeem it and the session simply ends when the access token
 * does. A test therefore has to finish inside the token's hour, which every one
 * of them does many times over — and the failure, if one ever ran that long,
 * would be a signed-out app rather than a wrong answer.
 */
export function mintSession(uid: string, email: string): MintedSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TOKEN_LIFETIME_SECONDS;
  const accessToken = signJwt({
    iss: "supabase-demo",
    sub: uid,
    aud: "authenticated",
    role: "authenticated",
    email,
    exp: expiresAt,
    iat: issuedAt,
    session_id: randomUUID(),
    is_anonymous: false,
  });
  return {
    accessToken,
    session: {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: TOKEN_LIFETIME_SECONDS,
      expires_at: expiresAt,
      refresh_token: `not-redeemable-${randomUUID()}`,
      user: {
        id: uid,
        aud: "authenticated",
        role: "authenticated",
        email,
        // What a Google session carries, because that is the only provider there
        // is: `src/lib/utils/store.svelte.ts` reads the address off the session
        // and nothing reads the rest.
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    },
  };
}

/** Navigate, then give the app `settle` milliseconds on top of the document. */
export async function go(page: Page, url: string, settle = 0): Promise<void> {
  await page.goto(url);
  if (settle > 0) await page.waitForTimeout(settle);
}

/**
 * Sign the browser in as `uid`, and leave it on the app with that session
 * restored.
 *
 * The origin is navigated to FIRST and then again. A tab on `about:blank` has an
 * opaque origin with a `localStorage` of its own that no page ever reads, so a
 * session written there is written somewhere the app cannot see it — and the
 * symptom is the welcome screen, which looks exactly like a session that was
 * refused.
 */
export async function signInAs(
  page: Page,
  origin: string,
  uid: string,
  email: string,
  settle = 8000,
): Promise<string> {
  const { accessToken, session } = mintSession(uid, email);
  await go(page, origin, 2500);
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [storageKeyFor(), JSON.stringify(session)] as const,
  );
  await go(page, origin, settle);
  return accessToken;
}

/** Clear every session the browser holds, and reload the app. */
export async function signOutEverywhere(
  page: Page,
  origin: string,
  settle = 6000,
): Promise<void> {
  await go(page, origin, 2500);
  await page.evaluate(() => window.localStorage.clear());
  await go(page, origin, settle);
}

// A namespace of this project's own, so the mapping below is this repo's and
// collides with nothing.
const SEED_NAMESPACE = "b3f0a4d6-9c1e-4a77-9a0c-6d2f5e8b71c4";

/**
 * The uuid a seeded world's `u7` is loaded under.
 *
 * `profiles.id` is a uuid and the simulator names people `u0`, `u7`, … A
 * version-5 name uuid makes that mapping a pure function of the world's own id,
 * so a test can seed a world and then mint a session for a NAMED person without
 * reading the database back to find out who they became.
 */
export function uuidOf(worldUid: string): string {
  const digest = createHash("sha1")
    .update(Buffer.from(SEED_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(worldUid)
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * One `auth.users` row, in the shape GoTrue reads its own back in.
 *
 * `email_confirmed_at` is what `private.has_credential()` asks for, and making
 * or answering a link needs it. It is not a door: there is no email provider,
 * nothing sends mail, and the empty `encrypted_password` can match no bcrypt
 * comparison. The empty token columns are there because GoTrue scans this row
 * into non-nullable Go strings when it answers `/auth/v1/user`;
 * `serve-local.sh` gives its stand-in table the same columns so one row serves
 * both stacks.
 *
 * `full_name` is what `private.handle_new_user()` names the profile from, so an
 * empty one is the account Google shares no name for, called `unknown`.
 */
export function authUserRow(id: string, email: string, fullName: string) {
  const now = new Date();
  return {
    instance_id: "00000000-0000-0000-0000-000000000000",
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    encrypted_password: "",
    email_confirmed_at: now,
    // Objects, not JSON text: the driver encodes a value for a `jsonb` column
    // itself, and text handed to it is stored as one JSON string, which names
    // nobody.
    raw_app_meta_data: { provider: "google", providers: ["google"] },
    raw_user_meta_data: fullName ? { full_name: fullName } : {},
    created_at: now,
    updated_at: now,
    confirmation_token: "",
    recovery_token: "",
    email_change_token_new: "",
    email_change: "",
    email_change_token_current: "",
    phone_change: "",
    phone_change_token: "",
    reauthentication_token: "",
  };
}

/**
 * The database's owner, which is what a test writes `auth.users` with.
 *
 * That schema is GoTrue's and the service role holds nothing in it, so this is
 * the one connection that is not the service role, and the seeding uses it for
 * that one table, so that everything in `public` still lands under the
 * schema's grants.
 */
export function ownerSql(): Sql {
  return postgres(LOCAL_DB_URL, {
    prepare: false,
    max: 2,
    idle_timeout: 5,
    connection: { application_name: "grapevine-e2e" },
  });
}

/**
 * The two ways to have a local stack, for a message about not finding one:
 * the real one, and the one that needs no Docker.
 */
export const START_THE_STACK =
  "`supabase start`, or `bash supabase/tests/serve-local.sh`";

/**
 * Throw a sentence when no database is listening, which is the one failure
 * every stack test shares and a refused connection's stack trace does not name.
 */
export async function requireStack(sql: Sql): Promise<void> {
  try {
    await sql`select 1`;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "ECONNREFUSED")
      throw error;
    throw new Error(
      `nothing is listening at ${LOCAL_DB_URL}. start the local stack: ${START_THE_STACK}`,
    );
  }
}

/**
 * The service role, which no policy applies to.
 *
 * `role=service_role` is a startup parameter rather than a connection string
 * taken at its word, so what a test reads back is what the schema's grants
 * allow that role rather than what the owner of the database could see.
 */
export function serviceRoleSql(): Sql {
  return postgres(LOCAL_DB_URL, {
    prepare: false,
    max: 4,
    idle_timeout: 5,
    connection: { role: "service_role", application_name: "grapevine-e2e" },
  });
}
