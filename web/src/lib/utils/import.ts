import { searchFold } from "grapevine-shared";
import {
  type Ask,
  type ImportRow,
  type ImportSource,
  isWantedEntry,
  type MatchRequest,
  type Outcome,
  type Reading,
  type Refusal,
  readExport,
} from "grapevine-shared/import";
import type { Candidate, Reference } from "grapevine-shared/references";
import {
  type CatalogView,
  classifyMatches,
  readCatalogView,
} from "./references";
import { supabase } from "./supabase";
import type { Ratings, RatingValue } from "./types";
import { canInflate, listZip, MAX_ENTRY_BYTES, readZipEntry } from "./zip";

/** What a source is called on screen. */
export const SOURCE_NAMES: Readonly<Record<ImportSource, string>> = {
  imdb: "imdb",
  letterboxd: "letterboxd",
  goodreads: "goodreads",
  "google-maps": "google maps",
  storygraph: "storygraph",
  netflix: "netflix",
  trakt: "trakt",
  spotify: "spotify",
};

// The most things a call takes. The server is what holds an import to
// its numbers.
export const IMPORT_CHUNK = 500;

/** A file that was not read, and why. */
export type FileRefusal = Refusal | "tgz" | "cannot-unzip";

const startsWith = (head: Uint8Array, ...magic: number[]): boolean =>
  magic.every((byte, index) => head[index] === byte);

/**
 * What the chosen file holds. Recognised by its content, never by its name or
 * by which source's row was tapped. Read on this device: nothing of the file
 * is sent anywhere.
 */
export async function readImportFile(
  file: Blob,
): Promise<Reading | FileRefusal> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (startsWith(head, 0x1f, 0x8b)) return "tgz";
  if (!startsWith(head, 0x50, 0x4b)) {
    if (file.size > MAX_ENTRY_BYTES) return "unreadable";
    return readExport([{ path: "", text: await file.text() }]);
  }
  if (!canInflate()) return "cannot-unzip";
  try {
    const entries = await listZip(file);
    const wanted = entries.filter(
      (entry) => isWantedEntry(entry.path) && entry.size <= MAX_ENTRY_BYTES,
    );
    const files = await Promise.all(
      wanted.map(async (entry) => ({
        path: entry.path,
        text: await readZipEntry(file, entry),
      })),
    );
    return readExport(
      files,
      entries.map((entry) => entry.path),
    );
  } catch (error) {
    console.error("import: zip", error);
    return "unreadable";
  }
}

// How long one answer may take. The query service's own limit is a minute.
const ANSWER_MS = 30_000;
// Photon asks for fair use and publishes no number.
const PHOTON_GAP_MS = 1_100;
// A refusal from Photon is waited out, longer each time, and the pace is
// halved from then on: a long history of places is hours of requests, and one
// throttled answer must not end it. Past the last wait the matching stops
// with what it has, to be taken up again.
const PHOTON_BACKOFF_MS: readonly number[] = [10_000, 60_000, 300_000];
const PHOTON_SLOWEST_GAP_MS = 10_000;
// The longest a `Retry-After` is honoured for.
const MAX_RETRY_AFTER_MS = 300_000;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends a matcher's requests, one at a time: no cookie, and the page's origin
 * as the only referrer. For Wikipedia and Wikidata a 429 waits for
 * `Retry-After` once, and a request that never answered is made once more.
 * Photon is paced, and backs off on a refusal. Anything past that throws,
 * which stops the matching with what it has.
 */
export function createAsk(
  fetcher: Fetcher = (url, init) => fetch(url, init),
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = () => Date.now(),
): Ask {
  let photonFreeAt = 0;
  let photonGap = PHOTON_GAP_MS;
  const retryAfter = (response: Response): number => {
    const seconds = Number(response.headers.get("Retry-After") ?? "5");
    return (Number.isFinite(seconds) ? seconds : 5) * 1000;
  };
  const send = async (request: MatchRequest): Promise<Response> =>
    fetcher(request.url, {
      method: request.body === undefined ? "GET" : "POST",
      headers:
        request.body === undefined
          ? request.headers
          : {
              ...request.headers,
              "Content-Type": "application/x-www-form-urlencoded",
            },
      body: request.body,
      credentials: "omit",
      referrerPolicy: "origin",
      signal: AbortSignal.timeout(ANSWER_MS),
    });
  const askPhoton = async (request: MatchRequest): Promise<unknown> => {
    for (const backoff of [...PHOTON_BACKOFF_MS, null]) {
      const early = photonFreeAt - now();
      if (early > 0) await wait(early);
      photonFreeAt = now() + photonGap;
      let response: Response | null = null;
      try {
        response = await send(request);
      } catch {
        // Unanswered: waited out as a refusal is.
      }
      if (response?.ok) return response.json();
      if (backoff === null) break;
      photonGap = Math.min(photonGap * 2, PHOTON_SLOWEST_GAP_MS);
      const asked = response?.status === 429 ? retryAfter(response) : 0;
      await wait(Math.min(Math.max(backoff, asked), MAX_RETRY_AFTER_MS));
    }
    throw new Error("photon stopped answering");
  };
  return async (request) => {
    if (request.url.startsWith("https://photon.komoot.io/"))
      return askPhoton(request);
    let response: Response;
    try {
      response = await send(request);
    } catch {
      response = await send(request);
    }
    if (response.status === 429) {
      const pause = retryAfter(response);
      if (pause > MAX_RETRY_AFTER_MS) throw new Error("throttled");
      await wait(pause);
      response = await send(request);
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.json();
  };
}

/** One thing an import would rate, resolved against the catalog. */
export type ImportThing = {
  // The thing the thumb goes on: one that holds the link, or the name the
  // add button would give it.
  readonly itemId: string;
  readonly reference: Reference;
  readonly value: RatingValue;
  // Already in the catalog, which sorts before a new name.
  readonly known: boolean;
};

/**
 * Each matched row as the thing it would rate (DESIGN §1 "Importing"), by the
 * rule a hand-add follows: a thing that holds the link whatever it is called,
 * else the candidate's first name that is free or holds no link. A candidate
 * whose every name another link holds is left out, as is a thing the viewer
 * has rated: a rating given here is never changed by an import.
 */
export function resolveImport(
  rows: readonly ImportRow[],
  outcomes: readonly (Outcome | null)[],
  catalog: CatalogView,
  ratings: Ratings,
): ImportThing[] {
  const things: ImportThing[] = [];
  const taken = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const outcome = outcomes[index];
    if (outcome?.kind !== "found") continue;
    const [match] = classifyMatches([outcome.candidate], catalog);
    if (match === undefined) continue;
    if (ratings[match.itemId]?.[""] !== undefined) continue;
    // Two rows of one file landing on one thing are one thumb: the first.
    if (taken.has(match.itemId)) continue;
    taken.add(match.itemId);
    things.push({
      itemId: match.itemId,
      reference: {
        source: outcome.candidate.source,
        ref: outcome.candidate.ref,
      },
      value: row.value,
      known: match.kind !== "free",
    });
  }
  return things;
}

/**
 * The order things are sent in, most useful first: things already
 * in the viewer's list, since the fit learns the viewer only from things a
 * followed account also rated;
 * then things already in the catalog; then new names. Inside each, a no
 * before a yes, being rarer, and otherwise the file's order. The order is
 * what an import past its allowance keeps the front of.
 */
export function orderThings(
  things: readonly ImportThing[],
  inList: ReadonlySet<string>,
): ImportThing[] {
  const rank = (thing: ImportThing): number =>
    (inList.has(thing.itemId) ? 0 : thing.known ? 2 : 4) +
    (thing.value === -1 ? 0 : 1);
  return things
    .map((thing, index) => ({ thing, index }))
    .sort(
      (left, right) =>
        rank(left.thing) - rank(right.thing) || left.index - right.index,
    )
    .map(({ thing }) => thing);
}

// Few enough names that the three reads' addresses stay short.
const CATALOG_CHUNK = 40;

/** The catalog under every candidate of an import, a chunk at a time. */
export async function readImportCatalog(
  outcomes: readonly (Outcome | null)[],
  read: (
    candidates: readonly Candidate[],
  ) => Promise<CatalogView> = readCatalogView,
): Promise<CatalogView> {
  const candidates = outcomes.flatMap((outcome) =>
    outcome?.kind === "found" ? [outcome.candidate] : [],
  );
  const names = new Set<string>();
  const linkOfName = new Map<string, Reference>();
  const nameOfLink = new Map<string, string>();
  for (let from = 0; from < candidates.length; from += CATALOG_CHUNK) {
    const view = await read(candidates.slice(from, from + CATALOG_CHUNK));
    for (const name of view.names) names.add(name);
    for (const [name, link] of view.linkOfName) linkOfName.set(name, link);
    for (const [link, name] of view.nameOfLink) nameOfLink.set(link, name);
  }
  return { names, linkOfName, nameOfLink };
}

/** What the server did with an import, as the caller's own counts. */
export type Saved = {
  readonly saved: number;
  // Already rated, so left as it was.
  readonly kept: number;
  readonly refused: number;
  // Past the import's allowance.
  readonly over: number;
};

const NOTHING_SAVED: Saved = { saved: 0, kept: 0, refused: 0, over: 0 };

/** A save that stopped part-way: what went through, and what is left. */
export class ImportStopped extends Error {
  constructor(
    readonly cause: unknown,
    readonly done: Saved,
    readonly left: readonly ImportThing[],
  ) {
    super("import stopped");
  }
}

// This source was imported already and its 30 days are not up.
export function isImportClosed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "GV429"
  );
}

type Chunk = {
  id: string;
  search_id: string;
  source: string;
  ref: string;
  value: RatingValue;
}[];

type SendChunk = (source: ImportSource, things: Chunk) => Promise<Saved>;

const sendChunk: SendChunk = async (source, things) => {
  const { data, error } = await supabase().rpc("import_thumbs", {
    p_source: source,
    p_things: things,
  });
  if (error) throw error;
  const counts = (data ?? {}) as Partial<Saved>;
  return {
    saved: Number(counts.saved ?? 0),
    kept: Number(counts.kept ?? 0),
    refused: Number(counts.refused ?? 0),
    over: Number(counts.over ?? 0),
  };
};

/**
 * Writes an import, a chunk a call: names, links and thumbs, by one
 * function on the server that never overwrites a thumb and stamps each with
 * its own clock. `search_id` comes from `searchFold`, as for every name a
 * client writes. A chunk that fails stops the save with what went before it
 * kept: the same things can be sent again, and what was saved is skipped.
 */
export async function saveImport(
  source: ImportSource,
  things: readonly ImportThing[],
  progress: (done: number) => void = () => {},
  send: SendChunk = sendChunk,
): Promise<Saved> {
  let done = NOTHING_SAVED;
  for (let from = 0; from < things.length; from += IMPORT_CHUNK) {
    const chunk = things.slice(from, from + IMPORT_CHUNK);
    let counts: Saved;
    try {
      counts = await send(
        source,
        chunk.map((thing) => ({
          id: thing.itemId,
          search_id: searchFold(thing.itemId),
          source: thing.reference.source,
          ref: thing.reference.ref,
          value: thing.value,
        })),
      );
    } catch (error) {
      throw new ImportStopped(error, done, things.slice(from));
    }
    done = {
      saved: done.saved + counts.saved,
      kept: done.kept + counts.kept,
      refused: done.refused + counts.refused,
      over: done.over + counts.over,
    };
    progress(Math.min(1, (from + chunk.length) / things.length));
  }
  return done;
}

/** Where the caller's import from a source stands. */
export type ImportStanding = {
  // Begun within the day, so it can take more.
  readonly open: boolean;
  readonly thumbsLeft: number;
  // Until the source can be imported afresh, rounded up.
  readonly daysUntilNext: number;
};

/** Each source the caller imported from in the last 30 days. */
export async function fetchImportStandings(): Promise<
  ReadonlyMap<ImportSource, ImportStanding>
> {
  const { data, error } = await supabase().rpc("import_state");
  if (error) throw error;
  const standings = new Map<ImportSource, ImportStanding>();
  for (const row of (data ?? []) as {
    source: ImportSource;
    open: boolean;
    thumbs_left: number;
    again_in_seconds: number;
  }[])
    standings.set(row.source, {
      open: row.open,
      thumbsLeft: row.thumbs_left,
      daysUntilNext: Math.max(1, Math.ceil(row.again_in_seconds / 86_400)),
    });
  return standings;
}

/** Whether a source can take an import now: never imported, or still open. */
export function canImport(standing: ImportStanding | undefined): boolean {
  return standing === undefined || (standing.open && standing.thumbsLeft > 0);
}
