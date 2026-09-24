// Taste search for whoever is calling, and for nobody else (DESIGN §5.1, §3.7).
//
// It runs for one caller rather than as a sweep of every account: one viewer's
// deep search is about 14 ms (`docs/algorithm-notes.md` §9) against an
// invocation metered on the order of two seconds, and a sweep would pay for
// everyone who never opens the app. So the search runs when a person opens the
// screen that shows it, behind the same ten-minute window the feed uses.
//
// **It is a function here and not in the database** because the deep walk is the
// wasm core and a `security definer` SQL function cannot host one. The chips a
// row is drawn with are the other half of §5.1 and that half IS one statement:
// `public.shared_attributes`, which the client calls itself.
//
// The two identities of `refresh-recs` apply unchanged: the **caller** is
// whoever the auth server says the bearer token belongs to, and the **database
// connection** is the service role, which every policy ignores and which is the
// only thing that may read other people's ratings at all.

import postgres from "npm:postgres@3.4.7";

import {
  NO_PRIORS,
  type Priors,
  sanitizeFriendIds,
  sanitizeRatings,
  type StoredPriors,
  type SuggestionsResult,
  storedPriors,
} from "../../../shared/src/entries.ts";
import init, { suggestFor } from "./core-wasm/grapevine_core.js";

/** How long a list stays current, the same window `refresh-recs` uses. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * How many people the search may read.
 *
 * NOT the deep walk's `N_max`, which is 50 000 and is a bound on the walk. This
 * bounds the query, and the query is what costs egress: the bytes are linear in
 * the nodes loaded, and at the 320 KB a two-thousand-node neighbourhood already
 * returns, the free tier's five gigabytes a month is the thing that binds long
 * before the CPU is (`docs/algorithm-notes.md` §9). It is deliberately the same
 * number `refresh-recs` uses, so that a search opened after a refresh reads what
 * the refresh already read and adds no egress of its own.
 */
const MAX_LOADED_NODES = 2_000;

/** The depth backstop, as in `refresh-recs`: the node cap is the real bound. */
const MAX_DEPTH = 6;

/** At most five, rank 1 strongest — the core caps it too, and this is the belt. */
const MAX_SUGGESTIONS = 5;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

await init({
  module_or_path: await Deno.readFile(
    new URL("./core-wasm/grapevine_core_bg.wasm", import.meta.url),
  ),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", {
  prepare: false,
  max: 3,
  idle_timeout: 30,
  connect_timeout: 10,
});

/** Every query this function makes, as the service role and nothing else. */
async function asServiceRole<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`set local role service_role`;
    const [row] = await tx`select current_user as role`;
    if (row?.role !== "service_role") {
      throw new Error(`queries run as ${String(row?.role)}, not service_role`);
    }
    return work(tx);
  });
  return result as T;
}

type Snapshot = {
  readonly users: readonly string[];
  readonly friendIds: Readonly<Record<string, readonly string[]>>;
  readonly loaded: readonly string[];
  /**
   * Per person, one key per rated thing: the item, or the item and one of its
   * attributes joined by the NUL `sanitizeRatings` puts between them. The
   * database returns these NESTED and keyed by columns; the join belongs to
   * this boundary and to the core (DESIGN §3.2).
   */
  readonly ratings: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

type SuggestionData = { readonly uid: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Who is calling, decided by the auth server and by nothing else. */
async function callerUid(request: Request): Promise<string | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: ANON_KEY },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: unknown };
  return typeof user.id === "string" && user.id.length > 0 ? user.id : null;
}

/**
 * The caller's own stamp, their own switch, and the database's clock.
 *
 * `suggestions_at` and not the `suggestions` rows: a viewer the search found
 * nobody for writes no row at all, so the rows cannot tell "there is nobody" from
 * "this has never run".
 */
async function readStamps(uid: string) {
  const [row] = await asServiceRole(
    (tx) => tx`
      select now() as now, m.suggestions_at,
             coalesce(p.discoverable_by_taste, false) as discoverable,
             coalesce(p.dismissed_suggestions, '{}'::uuid[]) as dismissed
      from (select ${uid}::uuid as id) v
      left join public.user_model m on m.user_id = v.id
      left join public.user_prefs p on p.user_id = v.id`,
  );
  if (!(row?.now instanceof Date)) {
    throw new Error("the database did not report its clock");
  }
  return {
    now: row.now,
    suggestedAt: row.suggestions_at instanceof Date ? row.suggestions_at.getTime() : 0,
    discoverable: row.discoverable === true,
    dismissed: Array.isArray(row.dismissed) ? (row.dismissed as string[]) : [],
  };
}

type Stamps = Awaited<ReturnType<typeof readStamps>>;

/** The population's estimate of `κ` and `a₀(d)`, or DESIGN §2.8's table. */
async function readPriors(): Promise<StoredPriors> {
  try {
    const [row] = await asServiceRole(
      (tx) => tx`
        select computed_at, kappa, a0_d1, a0_d2, a0_d3plus from private.params limit 1`,
    );
    return storedPriors(row);
  } catch (error) {
    console.error(
      JSON.stringify({ fn: "refresh-suggestions", at: "readPriors", error: String(error) }),
    );
    return NO_PRIORS;
  }
}

type NodeRow = { id: string; friend_ids: unknown; ratings: unknown };

/** The neighbourhood, in the shape the wasm boundary takes. */
async function loadSnapshot(viewer: string): Promise<{
  snapshot: Snapshot;
  loaded: string[];
}> {
  const rows = (await asServiceRole(
    (tx) => tx`
      select id, friend_ids, ratings
      from private.neighbourhood(${viewer}::uuid, ${MAX_LOADED_NODES}, ${MAX_DEPTH})`,
  )) as unknown as NodeRow[];

  const friendIds: Record<string, string[]> = {};
  const ratings: Record<string, Record<string, number>> = {};
  const loaded: string[] = [];
  const seen = new Set<string>([viewer]);
  for (const row of rows) {
    loaded.push(row.id);
    seen.add(row.id);
    const friends = sanitizeFriendIds(row.friend_ids);
    friendIds[row.id] = friends;
    for (const friend of friends) seen.add(friend);
    const kept = sanitizeRatings(row.ratings);
    if (kept) ratings[row.id] = kept;
  }
  return { snapshot: { users: [...seen], friendIds, loaded, ratings }, loaded };
}

/**
 * Everyone in reach who may be NAMED to this caller.
 *
 * Two switches and not one. `discoverable_by_taste` is the one DESIGN §5.1
 * names; `searchable` is there because the `connect_requests` insert policy
 * refuses a request to someone who is not findable, so naming them would put a
 * Connect button on the screen that fails every time it is pressed. Everyone
 * else still carries mass through the walk; they are just never named.
 */
async function discoverableAmong(
  loaded: readonly string[],
  viewer: string,
): Promise<string[]> {
  if (loaded.length === 0) return [];
  const rows = await asServiceRole(
    (tx) => tx`
      select p.id
      from public.profiles p
      join public.user_prefs f on f.user_id = p.id
      where p.id = any(${[...loaded]}::uuid[])
        and p.id <> ${viewer}::uuid
        and p.searchable
        and f.discoverable_by_taste`,
  );
  return rows.map((row) => String(row.id));
}

/**
 * The caller's five rows, replaced whole.
 *
 * Delete-then-insert rather than an upsert per rank: the list is an answer about
 * a moment, and a fourth row left behind from a longer previous list would be a
 * person the search no longer suggests still sitting on the screen. `rank` is
 * the primary key, so the two statements cannot interleave into a mixture.
 */
async function writeList(
  uid: string,
  suggested: readonly string[],
  at: Date,
): Promise<void> {
  await asServiceRole(async (tx) => {
    await tx`delete from public.suggestions where user_id = ${uid}::uuid`;
    if (suggested.length > 0) {
      await tx`
        insert into public.suggestions ${
        tx(
          suggested.map((id, index) => ({
            user_id: uid,
            rank: index + 1,
            suggested_id: id,
          })),
        )
      }`;
    }
    await tx`
      insert into public.user_model (user_id, suggestions_at)
      values (${uid}::uuid, ${at})
      on conflict (user_id) do update set suggestions_at = excluded.suggestions_at`;
  });
}

/** DESIGN §5.1 for the one caller. */
async function refreshSuggestions(uid: string): Promise<SuggestionsResult> {
  const stamps: Stamps = await readStamps(uid);
  if (stamps.now.getTime() - stamps.suggestedAt < STALE_AFTER_MS) {
    return { suggestedAt: stamps.suggestedAt, recomputed: false, suggested: null };
  }

  // Discoverability is reciprocal (DESIGN §5.1): off means you are named to
  // nobody AND your own list is written empty. One channel, both ways — which is
  // the only version of the switch that is one sentence on the screen.
  if (!stamps.discoverable) {
    await writeList(uid, [], stamps.now);
    return { suggestedAt: stamps.now.getTime(), recomputed: true, suggested: [] };
  }

  const priors = await readPriors();
  const { snapshot, loaded } = await loadSnapshot(uid);
  const discoverable = await discoverableAmong(loaded, uid);
  // `null` for the parameters: the core pairs its own deep table with the
  // on-demand one, which is the pairing §5.1 asks for — rank by the deep walk,
  // then drop whoever the viewer's live feed already carries.
  const found = suggestFor(
    snapshot,
    uid,
    discoverable,
    stamps.dismissed,
    null,
    priors.priors as Priors | null,
  ) as SuggestionData[];
  const suggested = found.slice(0, MAX_SUGGESTIONS).map((one) => one.uid);

  await writeList(uid, suggested, stamps.now);
  console.log(
    JSON.stringify({
      fn: "refresh-suggestions",
      loaded: loaded.length,
      discoverable: discoverable.length,
      suggested: suggested.length,
    }),
  );
  return { suggestedAt: stamps.now.getTime(), recomputed: true, suggested };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  const uid = await callerUid(request);
  if (!uid) return json(401, { error: "sign in to refresh your suggestions" });

  try {
    return json(200, await refreshSuggestions(uid));
  } catch (error) {
    // The list the caller already has stands: nothing above writes until the
    // search has produced an answer, so a failure here leaves the previous five
    // rows and their stamp alone rather than emptying the screen.
    console.error(JSON.stringify({ fn: "refresh-suggestions", uid, error: String(error) }));
    return json(500, { error: "the search did not finish" });
  }
});
