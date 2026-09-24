// The way in, for the four checks that drive a browser against the local stack.
//
// There is no door a headless browser can drive: Google's consent screen cannot
// be scripted and the local stack has no Google. So this mints a session
// against the stack's own JWT secret and writes it where supabase-js looks for
// one. The app is then signed in before its first render, which is what every
// check after the door was really about.
//
// Nothing here is a secret. `supabase start` prints the same URL, the same ports
// and the same JWT secret on every machine; they authorize nothing anywhere
// else, which is why `utils/project.ts` already carries the matching anon key in
// the source. It declares the two below itself rather than being imported from
// here — this file runs under plain `node` and imports `postgres` — and
// `tests/local-stack.test.ts` is what stops the two copies drifting.

import { createHash, createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";

export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

// Postgres itself, not PostgREST: a check reads back what an Edge Function
// wrote, and half of what it wants to see is in a schema the API does not serve
// at all.
export const LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const LOCAL_JWT_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

// What the browser sends as `apikey`; it authorizes nothing on its own, and
// every read behind it is decided by the policies.
export const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** GoTrue's own `jwt_expiry` (supabase/config.toml), in seconds. */
const TOKEN_LIFETIME_SECONDS = 3600;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/**
 * HS256 over the stack's secret, which is what GoTrue and PostgREST both verify
 * a bearer token with. `node:crypto` rather than a library, because a dependency
 * that exists only in a check is a dependency the app ships the risk of.
 */
export function signJwt(claims, secret = LOCAL_JWT_SECRET) {
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
 * renders the welcome screen, and the check reports "the signed-in app never
 * rendered" — which is true and says nothing about the key.
 */
export function storageKeyFor(url = LOCAL_SUPABASE_URL) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

/**
 * A session for a seeded account, in the shape supabase-js persists.
 *
 * `refresh_token` is a throwaway string and is named one: nothing issued it, so
 * GoTrue will not redeem it and the session simply ends when the access token
 * does. A check therefore has to finish inside the token's hour, which every one
 * of them does many times over — and the failure, if one ever ran that long,
 * would be a signed-out app rather than a wrong answer.
 */
export function mintSession(uid, email) {
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
        // is: `utils/store.tsx` reads the address off the session and nothing
        // reads the rest.
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    },
  };
}

const writeSession = (key, session) => `(() => {
  window.localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(session))});
  return true;
})()`;

/**
 * Signs the browser in as `uid`, and leaves it on the app with that session
 * restored.
 *
 * The origin is navigated to FIRST and then again. A tab on `about:blank` has an
 * opaque origin with a `localStorage` of its own that no page ever reads, so a
 * session written there is written somewhere the app cannot see it — and the
 * symptom is the welcome screen, which looks exactly like a session that was
 * refused.
 */
export async function signInAs(page, origin, uid, email, settle = 8000) {
  const { accessToken, session } = mintSession(uid, email);
  await page.go(origin, 2500);
  const stored = await page.evaluate(writeSession(storageKeyFor(), session));
  if (stored !== true) throw new Error("the session could not be stored");
  await page.go(origin, settle);
  return accessToken;
}

/** The other half of what `signin-check` asserts: a browser holding nothing. */
export async function signOutEverywhere(page, origin, settle = 6000) {
  await page.go(origin, 2500);
  await page.evaluate(
    "(() => { window.localStorage.clear(); return true; })()",
  );
  await page.go(origin, settle);
}

// A namespace of this project's own, so the mapping below is this repo's and
// collides with nothing.
const SEED_NAMESPACE = "b3f0a4d6-9c1e-4a77-9a0c-6d2f5e8b71c4";

/**
 * The uuid a seeded world's `u7` is loaded under.
 *
 * `profiles.id` is a uuid and the simulator names people `u0`, `u7`, … A
 * version-5 name uuid makes that mapping a pure function of the world's own id,
 * so a check can seed a world and then mint a session for a NAMED person without
 * reading the database back to find out who they became.
 */
export function uuidOf(worldUid) {
  const digest = createHash("sha1")
    .update(Buffer.from(SEED_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(worldUid)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * One `auth.users` row, in the shape GoTrue reads its own back in.
 *
 * `email_confirmed_at` is what `private.has_credential()` asks for, and claiming
 * a handle needs it — it is not a door: there is no email provider, nothing
 * sends mail, and the empty `encrypted_password` can match no bcrypt comparison.
 * The empty token columns are there because GoTrue scans this row into
 * non-nullable Go strings when it answers `/auth/v1/user`, which is the call
 * `refresh-recs` decides who is asking with.
 *
 * `full_name` is what `private.handle_new_user()` names the profile from, so an
 * empty one is the genuinely nameless account the name gate exists for.
 */
export function authUserRow(id, email, fullName) {
  const now = new Date();
  return {
    instance_id: "00000000-0000-0000-0000-000000000000",
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    encrypted_password: "",
    email_confirmed_at: now,
    raw_app_meta_data: JSON.stringify({
      provider: "google",
      providers: ["google"],
    }),
    raw_user_meta_data: JSON.stringify(fullName ? { full_name: fullName } : {}),
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
 * The database's owner, which is what a check writes `auth.users` with.
 *
 * That schema is GoTrue's and the service role holds nothing in it, so this is
 * the one connection that is not the service role — and it is used for that one
 * table, so that everything in `public` still lands under `0002_grants.sql`.
 */
export function ownerSql() {
  return postgres(LOCAL_DB_URL, {
    prepare: false,
    max: 2,
    idle_timeout: 5,
    connection: { application_name: "grapevine-checks" },
  });
}

/**
 * The service role, which no policy applies to.
 *
 * `role=service_role` is a startup parameter rather than a connection string
 * taken at its word — the same shape the Edge Functions use, so what a check
 * reads back is what `0002_grants.sql` actually allows rather than what the
 * owner of the database could see.
 */
export function serviceRoleSql() {
  return postgres(LOCAL_DB_URL, {
    prepare: false,
    max: 4,
    idle_timeout: 5,
    connection: { role: "service_role", application_name: "grapevine-checks" },
  });
}
