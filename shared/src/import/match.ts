/**
 * Matching an imported row to the thing it is (DESIGN §1 "Importing"): a film,
 * series, book, album, song or performer to its English Wikipedia page
 * through Wikidata, a place to its OpenStreetMap object through Photon. The name a match gets is the one
 * the add button would have made for the same page or place, so an imported
 * thing and a hand-added one are one thing. Only a clean match is one: a row
 * with more than one thing it could be is missed, never guessed.
 *
 * Pure but for `ask`, which the caller supplies: it sends one request and
 * answers its JSON, and throws when the service cannot be reached. Pacing and
 * retries are the caller's. A matcher that meets a throw stops and leaves the
 * rows it had not finished undecided, so a later call can take them up.
 *
 * Wikidata's query service is fragile to a query's shape: each query here is
 * the form that answered in a second where an equivalent one timed out. Do
 * not restructure one without running it.
 */

import {
  type Candidate,
  isRateableKind,
  type Position,
  photonPlaces,
  roundPosition,
  titleToName,
  typedWords,
  WIKI_HEADERS,
} from "../references.ts";
import type { ImportRow, SpotifyKind } from "./formats.ts";

export type MatchRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  // Form-encoded, which makes the request a POST with no preflight.
  readonly body?: string;
};

export type Ask = (request: MatchRequest) => Promise<unknown>;

export type Outcome =
  | { readonly kind: "found"; readonly candidate: Candidate }
  | { readonly kind: "missed" };

const MISSED: Outcome = { kind: "missed" };

// Rows matched together: Wikipedia's API takes 50 titles and the query
// service answered 50 rows in one `VALUES` every time it was measured.
export const BATCH = 50;

// Each is in `RATEABLE_INSTANCE`.
const FILM_KINDS: ReadonlySet<string> = new Set([
  "Q11424", // film
  "Q20650540", // anime film
  "Q506240", // television film
  "Q29168811", // animated feature film
  "Q202866", // animated film
  "Q93204", // documentary film
  "Q24862", // short film
  "Q17517379", // animated short film
  "Q24869", // feature film
  "Q25110269", // live-action/animated film
  "Q98807719", // animated television film
]);

// Letterboxd files a miniseries, and now and then a series, among its films.
const SERIES_KINDS: ReadonlySet<string> = new Set([
  "Q1259759", // miniseries
  "Q5398426", // television series
  "Q581714", // animated series
  "Q117467246", // animated television series
  "Q63952888", // anime television series
]);

// A season can share its series' IMDb id, and a series is what is rated.
const SEASON_KIND = "Q3464665";

// What else an IMDb id names. A comic or a franchise can hold the id of its
// adaptation; the adaptation is what was rated.
const SCREEN_KINDS: ReadonlySet<string> = new Set([
  ...FILM_KINDS,
  ...SERIES_KINDS,
  "Q220898", // original video animation
  "Q113671041", // original net animation series
  "Q526877", // web series
  "Q170238", // sitcom
  "Q15416", // television program
  "Q1261214", // television special
  "Q123126551", // animated television special
  "Q7889", // video game
]);

const BOOK_KINDS: ReadonlySet<string> = new Set([
  "Q7725634", // literary work
  "Q571", // book
  "Q8261", // novel
  "Q47461344", // written work
  "Q725377", // graphic novel
]);

// A series a book opens shares its title and its author; the book is what
// was rated.
const BOOK_SERIES_KINDS: ReadonlySet<string> = new Set([
  "Q1667921", // novel series
  "Q277759", // book series
]);

function sparql(query: string): MatchRequest {
  return {
    url: "https://query.wikidata.org/sparql",
    // No `Api-User-Agent`: it would force a preflight on every request, and
    // the service's policy takes a browser's own agent.
    headers: { Accept: "application/sparql-results+json" },
    body: `query=${encodeURIComponent(query)}`,
  };
}

type Binding = Readonly<Record<string, { value?: unknown } | undefined>>;

function bindings(answer: unknown): Binding[] {
  const found = (answer as { results?: { bindings?: unknown } } | null)?.results
    ?.bindings;
  return Array.isArray(found) ? (found as Binding[]) : [];
}

const value = (binding: Binding, name: string): string | null => {
  const found = binding[name]?.value;
  return typeof found === "string" && found.length > 0 ? found : null;
};

const entityId = (uri: string | null): string | null =>
  uri?.split("/").pop() ?? null;

function literal(text: string, language: string): string {
  const escaped = text
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\s+/gu, " ");
  return `"${escaped}"@${language}`;
}

function wikipediaCandidate(ref: string, title: string): Candidate | null {
  const name = titleToName(title);
  if (name === null || !/^Q[1-9][0-9]*$/u.test(ref)) return null;
  return {
    source: "wikidata",
    ref,
    names: [name],
    description: "",
    matchText: "",
  };
}

// One thing, or a miss: two things a row could be are not chosen between.
function decide(candidates: readonly Candidate[]): Outcome {
  const distinct = candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => other.ref === candidate.ref) === index,
  );
  const [only] = distinct;
  return only !== undefined && distinct.length === 1
    ? { kind: "found", candidate: only }
    : MISSED;
}

function chunks<T>(all: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let from = 0; from < all.length; from += size)
    out.push(all.slice(from, from + size));
  return out;
}

type ImdbRow = Extract<ImportRow, { kind: "imdb" }>;
type FilmRow = Extract<ImportRow, { kind: "film" }>;
type BookRow = Extract<ImportRow, { kind: "book" }>;
type PlaceRow = Extract<ImportRow, { kind: "place" }>;
type SpotifyRow = Extract<ImportRow, { kind: "spotify" }>;
type TitleRow = Extract<ImportRow, { kind: "title" }>;

export function imdbRequest(ids: readonly string[]): MatchRequest {
  return sparql(`SELECT ?imdb ?item ?p31 ?p279 ?title WHERE {
  VALUES ?imdb { ${ids.map((id) => `"${id}"`).join(" ")} }
  ?item wdt:P345 ?imdb.
  OPTIONAL { ?item wdt:P31 ?p31. }
  OPTIONAL { ?item wdt:P279 ?p279. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
}`);
}

/**
 * The thing each asked id names: rateable, with an English Wikipedia page.
 * Several items can hold one id; a film or series wins over whatever else
 * does, and a series over one of its seasons.
 */
export function readImdbAnswer(answer: unknown): Map<string, Candidate[]> {
  type Item = {
    imdb: string;
    ref: string;
    title: string | null;
    instanceOf: Set<string>;
    subclassOf: Set<string>;
  };
  const items = new Map<string, Item>();
  for (const binding of bindings(answer)) {
    const ref = entityId(value(binding, "item"));
    const imdb = value(binding, "imdb");
    if (ref === null || imdb === null) continue;
    const key = `${imdb} ${ref}`;
    const item: Item = items.get(key) ?? {
      imdb,
      ref,
      title: value(binding, "title"),
      instanceOf: new Set(),
      subclassOf: new Set(),
    };
    const p31 = entityId(value(binding, "p31"));
    const p279 = entityId(value(binding, "p279"));
    if (p31 !== null) item.instanceOf.add(p31);
    if (p279 !== null) item.subclassOf.add(p279);
    items.set(key, item);
  }
  const ranked = new Map<string, { candidate: Candidate; rank: number }[]>();
  for (const item of items.values()) {
    if (item.title === null) continue;
    const kinds = [...item.instanceOf];
    if (!isRateableKind(kinds, [...item.subclassOf])) continue;
    const candidate = wikipediaCandidate(item.ref, item.title);
    if (candidate === null) continue;
    const rank = kinds.includes(SEASON_KIND)
      ? 1
      : kinds.some((kind) => SCREEN_KINDS.has(kind))
        ? 0
        : 2;
    ranked.set(item.imdb, [
      ...(ranked.get(item.imdb) ?? []),
      { candidate, rank },
    ]);
  }
  const found = new Map<string, Candidate[]>();
  for (const [imdb, entries] of ranked) {
    const best = Math.min(...entries.map((entry) => entry.rank));
    found.set(
      imdb,
      entries
        .filter((entry) => entry.rank === best)
        .map((entry) => entry.candidate),
    );
  }
  return found;
}

// Wikidata's property for each kind of Spotify address.
const SPOTIFY_PROPERTY: Readonly<Record<SpotifyKind, string>> = {
  track: "P2207",
  album: "P2205",
  artist: "P1902",
};

// Occupations as well, since a singer is offered as a performer.
export function spotifyRequest(
  of: SpotifyKind,
  ids: readonly string[],
): MatchRequest {
  return sparql(`SELECT ?id ?item ?p31 ?p279 ?p106 ?title WHERE {
  VALUES ?id { ${ids.map((id) => `"${id}"`).join(" ")} }
  ?item wdt:${SPOTIFY_PROPERTY[of]} ?id.
  OPTIONAL { ?item wdt:P31 ?p31. }
  OPTIONAL { ?item wdt:P279 ?p279. }
  OPTIONAL { ?item wdt:P106 ?p106. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
}`);
}

/**
 * The things each asked id names: rateable, with an English Wikipedia page.
 * A song and its single can share a page and an id; two items are a miss.
 */
export function readSpotifyAnswer(answer: unknown): Map<string, Candidate[]> {
  type Item = {
    id: string;
    ref: string;
    title: string | null;
    instanceOf: Set<string>;
    subclassOf: Set<string>;
    occupations: Set<string>;
  };
  const items = new Map<string, Item>();
  for (const binding of bindings(answer)) {
    const ref = entityId(value(binding, "item"));
    const id = value(binding, "id");
    if (ref === null || id === null) continue;
    const key = `${id} ${ref}`;
    const item: Item = items.get(key) ?? {
      id,
      ref,
      title: value(binding, "title"),
      instanceOf: new Set(),
      subclassOf: new Set(),
      occupations: new Set(),
    };
    const p31 = entityId(value(binding, "p31"));
    const p279 = entityId(value(binding, "p279"));
    const p106 = entityId(value(binding, "p106"));
    if (p31 !== null) item.instanceOf.add(p31);
    if (p279 !== null) item.subclassOf.add(p279);
    if (p106 !== null) item.occupations.add(p106);
    items.set(key, item);
  }
  const found = new Map<string, Candidate[]>();
  for (const item of items.values()) {
    if (item.title === null) continue;
    const rateable = isRateableKind(
      [...item.instanceOf],
      [...item.subclassOf],
      [...item.occupations],
    );
    const candidate = rateable
      ? wikipediaCandidate(item.ref, item.title)
      : null;
    if (candidate !== null)
      found.set(item.id, [...(found.get(item.id) ?? []), candidate]);
  }
  return found;
}

// A title Wikipedia's API would refuse, or would read as two.
const UNASKABLE = /[|#<>[\]{}\n]/u;

/** One request per 50 titles: each title's page, following redirects. */
export function titlesRequests(titles: readonly string[]): MatchRequest[] {
  const askable = [...new Set(titles)].filter(
    (title) => title.trim().length > 0 && !UNASKABLE.test(title),
  );
  return chunks(askable, BATCH).map((batch) => ({
    url: `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=pageprops&ppprop=wikibase_item%7Cdisambiguation&titles=${batch.map(encodeURIComponent).join("%7C")}`,
    headers: WIKI_HEADERS,
  }));
}

export type Page = {
  readonly title: string;
  readonly ref: string;
};

type TitlesAnswer = {
  query?: {
    normalized?: { from?: unknown; to?: unknown }[];
    redirects?: { from?: unknown; to?: unknown; tofragment?: unknown }[];
    pages?: {
      title?: unknown;
      missing?: unknown;
      invalid?: unknown;
      pageprops?: { wikibase_item?: unknown; disambiguation?: unknown };
    }[];
  };
};

/**
 * The page each asked title names, by the title as asked. Not a missing page,
 * not a disambiguation page, and not a redirect into a section of another
 * article, which is a page about something else.
 */
export function readTitlesAnswer(answer: unknown): Map<string, Page> {
  const query = (answer as TitlesAnswer | null)?.query;
  const pages = new Map<string, Page>();
  for (const page of query?.pages ?? []) {
    const ref = page.pageprops?.wikibase_item;
    if (typeof page.title !== "string" || typeof ref !== "string") continue;
    if (page.missing !== undefined || page.invalid !== undefined) continue;
    if (page.pageprops?.disambiguation !== undefined) continue;
    pages.set(page.title, { title: page.title, ref });
  }
  const redirected = new Map<string, string | null>();
  for (const redirect of query?.redirects ?? [])
    redirected.set(
      String(redirect.from),
      redirect.tofragment === undefined ? String(redirect.to) : null,
    );
  const asked = new Map<string, Page>();
  const resolve = (from: string, title: string): void => {
    const target = redirected.has(title) ? redirected.get(title) : title;
    const page =
      target === null || target === undefined ? null : pages.get(target);
    if (page) asked.set(from, page);
  };
  for (const title of pages.keys()) resolve(title, title);
  for (const from of redirected.keys()) resolve(from, from);
  for (const entry of query?.normalized ?? [])
    resolve(String(entry.from), String(entry.to));
  return asked;
}

export type PageFacts = {
  readonly title: string;
  readonly kinds: readonly string[];
  // The earliest release, which is what tells a film from its remake; for a
  // series, the year it began.
  readonly firstYear: number | null;
  // Every name its authors go by, in English and in `mul`, where Wikidata
  // now keeps a label that is the same in every language.
  readonly authors: readonly string[];
};

function entityValues(refs: readonly string[]): string {
  return refs.map((ref) => `wd:${ref}`).join(" ");
}

export function filmFactsRequest(refs: readonly string[]): MatchRequest {
  return sparql(`SELECT ?item ?title (MIN(YEAR(?date)) AS ?first) (MIN(YEAR(?start)) AS ?began) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "entity/"); separator=",") AS ?kinds) WHERE {
  VALUES ?item { ${entityValues(refs)} }
  ?item wdt:P31 ?p31.
  OPTIONAL { ?item wdt:P577 ?date. }
  OPTIONAL { ?item wdt:P580 ?start. }
  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
} GROUP BY ?item ?title`);
}

export function bookFactsRequest(refs: readonly string[]): MatchRequest {
  return sparql(`SELECT ?item ?title (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "entity/"); separator=",") AS ?kinds) (GROUP_CONCAT(DISTINCT ?authorName; separator="|") AS ?authors) WHERE {
  VALUES ?item { ${entityValues(refs)} }
  OPTIONAL { ?item wdt:P31 ?p31. }
  OPTIONAL { ?item wdt:P50 ?author. ?author rdfs:label|skos:altLabel ?authorName. FILTER(LANG(?authorName) IN ("en", "mul")) }
  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
} GROUP BY ?item ?title`);
}

const listed = (text: string | null, separator: string): string[] =>
  (text ?? "").split(separator).filter(Boolean);

/** What Wikidata says of each asked item, by its id. */
export function readFactsAnswer(answer: unknown): Map<string, PageFacts> {
  const facts = new Map<string, PageFacts>();
  for (const binding of bindings(answer)) {
    const ref = entityId(value(binding, "item"));
    const title = value(binding, "title");
    if (ref === null || title === null) continue;
    const first = Number(value(binding, "first") ?? value(binding, "began"));
    facts.set(ref, {
      title,
      kinds: listed(value(binding, "kinds"), ","),
      firstYear: Number.isInteger(first) && first > 0 ? first : null,
      authors: listed(value(binding, "authors"), "|"),
    });
  }
  return facts;
}

// Wikipedia writes a title's short words in lower case where other
// services capitalise them: `Stranger than Fiction`.
const SHORT_WORDS =
  /(?<=\S\s)(A|An|And|As|At|But|By|For|From|In|Nor|Of|On|Or|Than|The|To|Vs\.?|With)(?=\s)/gu;

function spellings(title: string): string[] {
  const whole = title.trim().replace(/\s+/gu, " ");
  // `BEEF` is filed as `Beef`.
  const shouted = /\p{Lu}{4}/u.test(whole) && whole === whole.toUpperCase();
  const cased = shouted
    ? whole
        .toLowerCase()
        .replace(/(^|\s)\p{L}/gu, (start) => start.toUpperCase())
    : whole;
  return [
    ...new Set([
      whole,
      cased,
      cased.replace(SHORT_WORDS, (word) => word.toLowerCase()),
    ]),
  ];
}

type Guess = {
  readonly title: string;
  // The guess names the row's own year, which settles a tie.
  readonly dated: boolean;
};

function filmGuessList(row: FilmRow): Guess[] {
  return spellings(row.title).flatMap((title) => [
    ...(row.year === null
      ? []
      : [{ title: `${title} (${row.year} film)`, dated: true }]),
    { title: `${title} (film)`, dated: false },
    { title: `${title} (miniseries)`, dated: false },
    { title: `${title} (TV series)`, dated: false },
    { title, dated: false },
  ]);
}

/** The pages a film might be on, most exact first. */
export function filmGuesses(row: FilmRow): string[] {
  return filmGuessList(row).map((guess) => guess.title);
}

const isKind = (facts: PageFacts, kinds: ReadonlySet<string>): boolean =>
  facts.kinds.some((kind) => kinds.has(kind));

// A film's year in a file and its earliest release can differ by one: a
// festival premiere the December before.
const YEAR_SLACK = 1;

/**
 * The film a row is, of the pages its guesses found. The nearest in years
 * wins, and the page whose title names the year wins a tie; two left at the
 * same distance are a miss. A series is taken only by its year: a short
 * with no page of its own must not land on a series of the same name.
 */
export function pickFilm(
  row: FilmRow,
  pages: ReadonlyMap<string, Page>,
  facts: ReadonlyMap<string, PageFacts>,
): Outcome {
  type Scored = { candidate: Candidate; apart: number; dated: boolean };
  const scored: Scored[] = [];
  for (const guess of filmGuessList(row)) {
    const page = pages.get(guess.title);
    const known = page === undefined ? undefined : facts.get(page.ref);
    if (page === undefined || known === undefined) continue;
    const film = isKind(known, FILM_KINDS);
    if (!film && !isKind(known, SERIES_KINDS)) continue;
    const dated = row.year !== null && known.firstYear !== null;
    if (!film && !dated) continue;
    const apart = dated
      ? Math.abs((known.firstYear ?? 0) - (row.year ?? 0))
      : YEAR_SLACK;
    if (apart > YEAR_SLACK) continue;
    const candidate = wikipediaCandidate(page.ref, page.title);
    if (candidate !== null)
      scored.push({ candidate, apart, dated: guess.dated });
  }
  const nearest = Math.min(...scored.map((entry) => entry.apart));
  const best = scored.filter((entry) => entry.apart === nearest);
  const named = best.find((entry) => entry.dated);
  return decide((named ? [named] : best).map((entry) => entry.candidate));
}

export function filmLabelRequest(rows: readonly FilmRow[]): MatchRequest {
  const asked = rows
    .filter((row) => row.year !== null)
    .flatMap((row) =>
      ["en", "mul"].map(
        (language) => `(${literal(row.title, language)} ${row.year})`,
      ),
    );
  return sparql(`SELECT ?t ?y ?item ?title (MIN(YEAR(?date)) AS ?first) WHERE {
  VALUES (?t ?y) { ${asked.join(" ")} }
  ?item rdfs:label|skos:altLabel ?t.
  ?item wdt:P31/wdt:P279* wd:Q11424.
  ?item wdt:P577 ?date.
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
} GROUP BY ?t ?y ?item ?title HAVING(ABS(MIN(YEAR(?date)) - ?y) <= 1)`);
}

/** The film each row is by its label and year, for rows no page was found for. */
export function readFilmLabelAnswer(
  rows: readonly FilmRow[],
  answer: unknown,
): Outcome[] {
  const found = bindings(answer);
  return rows.map((row) => {
    const scored = found
      .filter(
        (binding) =>
          value(binding, "t") === row.title.replace(/\s+/gu, " ") &&
          Number(value(binding, "y")) === row.year,
      )
      .map((binding) => ({
        candidate: wikipediaCandidate(
          entityId(value(binding, "item")) ?? "",
          value(binding, "title") ?? "",
        ),
        apart: Math.abs(Number(value(binding, "first")) - (row.year ?? 0)),
      }))
      .filter(
        (entry): entry is { candidate: Candidate; apart: number } =>
          entry.candidate !== null,
      );
    const nearest = Math.min(...scored.map((entry) => entry.apart));
    return decide(
      scored
        .filter((entry) => entry.apart === nearest)
        .map((entry) => entry.candidate),
    );
  });
}

/**
 * Every film and television series, of any subclass of either (a miniseries
 * is one), whose label is a title exactly: whether it has a page or not, and
 * whether it holds a Netflix id.
 */
export function titleLabelRequest(rows: readonly TitleRow[]): MatchRequest {
  const titles = [...new Set(rows.map((row) => row.title))];
  const asked = titles.flatMap((title) =>
    ["en", "mul"].map((language) => literal(title, language)),
  );
  return sparql(`SELECT ?t ?item ?netflix ?title (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "entity/"); separator=",") AS ?kinds) WHERE {
  VALUES ?t { ${asked.join(" ")} }
  VALUES ?kind { wd:Q11424 wd:Q5398426 }
  ?item rdfs:label ?t.
  ?item wdt:P31/wdt:P279* ?kind.
  OPTIONAL { ?item wdt:P31 ?p31. }
  OPTIONAL { ?item wdt:P1874 ?netflix. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
} GROUP BY ?t ?item ?netflix ?title`);
}

/**
 * The thing each title is with no year to tell two apart: the one film or
 * series of that name, or of several, the one that holds a Netflix id. Two
 * that hold one, or none, are a miss, as is a match with no page or of a kind
 * the add button would not offer.
 */
export function readTitleLabelAnswer(
  rows: readonly TitleRow[],
  answer: unknown,
): Outcome[] {
  type Item = {
    title: string | null;
    netflix: boolean;
    kinds: Set<string>;
  };
  const byTitle = new Map<string, Map<string, Item>>();
  for (const binding of bindings(answer)) {
    const asked = value(binding, "t");
    const ref = entityId(value(binding, "item"));
    if (asked === null || ref === null) continue;
    const items = byTitle.get(asked) ?? new Map<string, Item>();
    const item: Item = items.get(ref) ?? {
      title: null,
      netflix: false,
      kinds: new Set(),
    };
    item.title ??= value(binding, "title");
    item.netflix ||= value(binding, "netflix") !== null;
    for (const kind of listed(value(binding, "kinds"), ","))
      item.kinds.add(kind);
    items.set(ref, item);
    byTitle.set(asked, items);
  }
  return rows.map((row) => {
    const items = [...(byTitle.get(row.title) ?? new Map<string, Item>())];
    const held = items.filter(([, item]) => item.netflix);
    const [only] = items.length === 1 ? items : held.length === 1 ? held : [];
    if (only === undefined) return MISSED;
    const [ref, item] = only;
    const candidate =
      item.title !== null && isRateableKind([...item.kinds])
        ? wikipediaCandidate(ref, item.title)
        : null;
    return candidate === null ? MISSED : { kind: "found", candidate };
  });
}

/** A book's title as it might be filed: whole, and without its subtitle. */
export function bookTitles(title: string): string[] {
  const whole = title.trim();
  return [
    ...new Set([
      whole,
      whole.split(":")[0]?.trim() ?? whole,
      whole.split(/,? or,/u)[0]?.trim() ?? whole,
    ]),
  ].filter((entry) => entry.length > 0);
}

const surname = (author: string): string =>
  author.trim().split(/\s+/u).pop() ?? "";

/** The pages a book might be on, most exact first. */
export function bookGuesses(row: BookRow): string[] {
  return bookTitles(row.title).flatMap((title) => [
    `${title} (${surname(row.author)} novel)`,
    `${title} (novel)`,
    `${title} (book)`,
    title,
  ]);
}

// Accents, case, spaces and punctuation: `J.R.R. Tolkien` is `J. R. R. Tolkien`.
const foldName = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

// A name's given name and surname, without what files and Wikidata disagree
// on: `Clayton M. Christensen` is `Clayton Christensen`, and `Kurt Vonnegut
// Jr.` is `Kurt Vonnegut`.
function nameEnds(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !/^(jr|sr|ii|iii|iv)$/u.test(word));
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  return words.length > 1 ? `${first} ${last}` : first;
}

function sameAuthor(author: string, names: readonly string[]): boolean {
  const whole = foldName(author);
  const ends = nameEnds(author);
  return (
    whole.length > 0 &&
    names.some(
      (name) =>
        foldName(name) === whole ||
        (ends.length > 0 && nameEnds(name) === ends),
    )
  );
}

// How surely a thing by the row's author is the book: a book, then anything
// else written, then a series. A film is never it: an adaptation can name the
// novelist as its author.
function bookRank(kinds: readonly string[]): number | null {
  if (kinds.some((kind) => BOOK_KINDS.has(kind))) return 0;
  else if (kinds.some((kind) => BOOK_SERIES_KINDS.has(kind))) return 2;
  else if (kinds.some((kind) => SCREEN_KINDS.has(kind))) return null;
  else return 1;
}

function bestRanked<Entry extends { readonly rank: number }>(
  entries: readonly Entry[],
): Entry[] {
  const best = Math.min(...entries.map((entry) => entry.rank));
  return entries.filter((entry) => entry.rank === best);
}

/**
 * The book a row is, of the pages its guesses found: a thing whose author is
 * the file's, which is what a title alone cannot say. A book with no author
 * match is not imported. Two books left are a miss.
 */
export function pickBook(
  row: BookRow,
  pages: ReadonlyMap<string, Page>,
  facts: ReadonlyMap<string, PageFacts>,
): Outcome {
  const ranked: { candidate: Candidate; rank: number }[] = [];
  for (const guess of bookGuesses(row)) {
    const page = pages.get(guess);
    const known = page === undefined ? undefined : facts.get(page.ref);
    if (page === undefined || known === undefined) continue;
    if (!sameAuthor(row.author, known.authors)) continue;
    const rank = bookRank(known.kinds);
    const candidate = wikipediaCandidate(page.ref, page.title);
    if (candidate !== null && rank !== null) ranked.push({ candidate, rank });
  }
  return decide(bestRanked(ranked).map((entry) => entry.candidate));
}

export function bookLabelRequest(rows: readonly BookRow[]): MatchRequest {
  const titles = [...new Set(rows.flatMap((row) => bookTitles(row.title)))];
  const asked = titles.flatMap((title) =>
    ["en", "mul"].map((language) => literal(title, language)),
  );
  return sparql(`SELECT ?t ?item ?author ?authorName ?title (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p31), "entity/"); separator=",") AS ?kinds) WHERE {
  VALUES ?t { ${asked.join(" ")} }
  ?item rdfs:label|skos:altLabel ?t.
  ?item wdt:P50 ?author.
  ?author rdfs:label|skos:altLabel ?authorName. FILTER(LANG(?authorName) IN ("en", "mul"))
  OPTIONAL { ?item wdt:P31 ?p31. }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
} GROUP BY ?t ?item ?author ?authorName ?title`);
}

export type Filed = { readonly ref: string; readonly title: string };

/**
 * Where each row's book is filed by its label and author: the item, and the
 * title Wikidata holds for its page. That title can be a stale one that now
 * redirects to another thing, so the caller asks Wikipedia for the page and
 * keeps it only if it is still this item's.
 */
export function readBookLabelAnswer(
  rows: readonly BookRow[],
  answer: unknown,
): Filed[][] {
  const found = bindings(answer);
  return rows.map((row) => {
    const titles = bookTitles(row.title).map((title) =>
      title.replace(/\s+/gu, " "),
    );
    const ranked: (Filed & { rank: number })[] = [];
    for (const binding of found) {
      const ref = entityId(value(binding, "item"));
      const title = value(binding, "title");
      const rank = bookRank(listed(value(binding, "kinds"), ","));
      if (ref === null || title === null || rank === null) continue;
      if (!titles.includes(value(binding, "t") ?? "")) continue;
      if (!sameAuthor(row.author, [value(binding, "authorName") ?? ""]))
        continue;
      if (!ranked.some((entry) => entry.ref === ref))
        ranked.push({ ref, title, rank });
    }
    return bestRanked(ranked).map(({ ref, title }) => ({ ref, title }));
  });
}

// How far apart a review's pin and the place's own may be: the largest
// distance of a right match measured was 161 m, a museum's centre.
export const PLACE_REACH_METRES = 200;

function metresApart(from: Position, to: Position): number {
  const radians = Math.PI / 180;
  const earth = 6_371_000;
  const half =
    Math.sin(((to.lat - from.lat) * radians) / 2) ** 2 +
    Math.cos(from.lat * radians) *
      Math.cos(to.lat * radians) *
      Math.sin(((to.lon - from.lon) * radians) / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(half));
}

// A place's words, with and without a leading article: Google writes `The
// British Museum` where OpenStreetMap writes `British Museum`.
function placeWords(name: string): string[] {
  const words = [
    ...new Set([
      ...typedWords(name),
      ...typedWords(name.replace(/\p{P}/gu, " ")),
    ]),
  ];
  return words[0] === "the" ? words.slice(1) : words;
}

// A name's words in the order they are said, without a leading article.
function inOrder(name: string): string[] {
  const words = typedWords(name.replace(/\p{P}/gu, " "));
  return words[0] === "the" ? words.slice(1) : words;
}

const within = (inner: readonly string[], outer: readonly string[]): boolean =>
  inner.length > 0 && inner.every((word) => outer.includes(word));

/**
 * What a place is asked as, each tried until one is found: its name as
 * given; without a leading article; without the branch or the description
 * Google appends (`Puttshack - Nashville`); and its first word, which is a
 * chain's name where OpenStreetMap files `Chipotle Mexican Grill` as
 * `Chipotle`. The later ones find a place whose name begins the
 * review's.
 */
export function placeQueries(name: string): string[] {
  const whole = name.trim().replace(/\s+/gu, " ");
  const bare = whole.replace(/^the\s+/iu, "");
  const head = bare.split(/\s+[-–—|(]\s*|,\s/u)[0]?.trim() ?? bare;
  const [first = ""] = head.split(" ");
  return [
    ...new Set([whole, bare, head, ...(first.length >= 5 ? [first] : [])]),
  ].filter((query) => query.length > 0);
}

// Half the side of the box a place is looked for in, in degrees: about two
// kilometres, around a position rounded to one.
const PLACE_BOX = 0.02;

export function placeRequest(query: string, row: PlaceRow): MatchRequest {
  // Rounded as the add button's is: about a kilometre. Photon's own leaning
  // towards a position is weak, and a chain's name finds its branches a
  // country away, so the search is held to a box around it.
  const { lat, lon } = roundPosition(row);
  const corner = (value: number, by: number): string => (value + by).toFixed(2);
  const box = [
    corner(lon, -PLACE_BOX),
    corner(lat, -PLACE_BOX),
    corner(lon, PLACE_BOX),
    corner(lat, PLACE_BOX),
  ].join(",");
  return {
    url: `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lon}&bbox=${box}&limit=10&lang=en`,
    headers: {},
  };
}

/**
 * The place a review is of, from Photon's answer: a rateable place within
 * reach whose name is the review's, or begins it. One whose name only holds
 * some of the review's words, or holds them all and more, is not it: a
 * museum's cafe sits beside the museum.
 */
export function pickPlace(row: PlaceRow, answer: unknown): Outcome {
  const wanted = placeWords(row.name);
  const near = photonPlaces(answer)
    .filter(
      (place) =>
        place.position !== null &&
        metresApart(row, place.position) <= PLACE_REACH_METRES,
    )
    .map((place) => ({
      candidate: place.candidate,
      name: place.name,
      words: placeWords(place.name),
      apart: place.position === null ? 0 : metresApart(row, place.position),
    }))
    .sort((left, right) => left.apart - right.apart);
  const same = near.filter(
    (place) => within(wanted, place.words) && within(place.words, wanted),
  );
  // One shop mapped twice, as a point and as its building, is one place.
  const [nearest] = same;
  if (nearest !== undefined)
    return { kind: "found", candidate: nearest.candidate };
  // Google's name is often OpenStreetMap's with a branch or a description
  // after it: `Dishoom Covent Garden`, `Chipotle Mexican Grill`. Only one
  // such place within reach is taken; the other way round is the cafe.
  const spoken = inOrder(row.name);
  const leading = near.filter((place) => {
    const name = inOrder(place.name);
    return (
      name.length > 0 &&
      name.length < spoken.length &&
      name.every((word, index) => spoken[index] === word)
    );
  });
  const [only] = leading;
  if (only !== undefined && leading.length === 1)
    return { kind: "found", candidate: only.candidate };
  return MISSED;
}

async function askPages(
  titles: readonly string[],
  ask: Ask,
): Promise<Map<string, Page>> {
  const pages = new Map<string, Page>();
  for (const request of titlesRequests(titles))
    for (const [asked, page] of readTitlesAnswer(await ask(request)))
      pages.set(asked, page);
  return pages;
}

const refsOf = (pages: ReadonlyMap<string, Page>): string[] => [
  ...new Set([...pages.values()].map((page) => page.ref)),
];

async function matchImdb(
  rows: readonly ImdbRow[],
  ask: Ask,
): Promise<Outcome[]> {
  const found = readImdbAnswer(
    await ask(imdbRequest(rows.map((row) => row.imdbId))),
  );
  return rows.map((row) => decide(found.get(row.imdbId) ?? []));
}

async function matchSpotify(
  rows: readonly SpotifyRow[],
  ask: Ask,
): Promise<Outcome[]> {
  const found = new Map<string, Candidate[]>();
  for (const of of ["track", "album", "artist"] as const) {
    const ids = rows.filter((row) => row.of === of).map((row) => row.spotifyId);
    if (ids.length === 0) continue;
    for (const [id, candidates] of readSpotifyAnswer(
      await ask(spotifyRequest(of, ids)),
    ))
      found.set(`${of}:${id}`, candidates);
  }
  return rows.map((row) =>
    decide(found.get(`${row.of}:${row.spotifyId}`) ?? []),
  );
}

async function matchTitles(
  rows: readonly TitleRow[],
  ask: Ask,
): Promise<Outcome[]> {
  return readTitleLabelAnswer(rows, await ask(titleLabelRequest(rows)));
}

async function matchFilms(
  rows: readonly FilmRow[],
  ask: Ask,
): Promise<Outcome[]> {
  const pages = await askPages(rows.flatMap(filmGuesses), ask);
  const refs = refsOf(pages);
  const facts =
    refs.length === 0
      ? new Map<string, PageFacts>()
      : readFactsAnswer(await ask(filmFactsRequest(refs)));
  const outcomes = rows.map((row) => pickFilm(row, pages, facts));
  const left = rows.filter(
    (row, index) => outcomes[index]?.kind === "missed" && row.year !== null,
  );
  if (left.length === 0) return outcomes;
  const byLabel = readFilmLabelAnswer(left, await ask(filmLabelRequest(left)));
  return rows.map(
    (row, index) => byLabel[left.indexOf(row)] ?? outcomes[index] ?? MISSED,
  );
}

async function matchBooks(
  rows: readonly BookRow[],
  ask: Ask,
): Promise<Outcome[]> {
  const pages = await askPages(rows.flatMap(bookGuesses), ask);
  const refs = refsOf(pages);
  const facts =
    refs.length === 0
      ? new Map<string, PageFacts>()
      : readFactsAnswer(await ask(bookFactsRequest(refs)));
  const outcomes = rows.map((row) => pickBook(row, pages, facts));
  const left = rows.filter((_, index) => outcomes[index]?.kind === "missed");
  if (left.length === 0) return outcomes;
  const filed = readBookLabelAnswer(left, await ask(bookLabelRequest(left)));
  const current = await askPages(
    filed.flat().map((entry) => entry.title),
    ask,
  );
  return rows.map((row, index) => {
    const at = left.indexOf(row);
    if (at === -1) return outcomes[index] ?? MISSED;
    return decide(
      (filed[at] ?? [])
        .map((entry) => ({ entry, page: current.get(entry.title) }))
        .filter(({ entry, page }) => page?.ref === entry.ref)
        .map(({ entry, page }) =>
          wikipediaCandidate(entry.ref, page?.title ?? entry.title),
        )
        .filter((candidate): candidate is Candidate => candidate !== null),
    );
  });
}

async function matchPlace(row: PlaceRow, ask: Ask): Promise<Outcome> {
  for (const query of placeQueries(row.name)) {
    const outcome = pickPlace(row, await ask(placeRequest(query, row)));
    if (outcome.kind === "found") return outcome;
  }
  return MISSED;
}

async function matchBatch(
  rows: readonly ImportRow[],
  ask: Ask,
): Promise<Outcome[]> {
  const of = <Kind extends ImportRow["kind"]>(kind: Kind) =>
    rows.filter(
      (row): row is Extract<ImportRow, { kind: Kind }> => row.kind === kind,
    );
  const imdb = of("imdb");
  const films = of("film");
  const books = of("book");
  const places = of("place");
  const spotify = of("spotify");
  const titles = of("title");
  const decided = new Map<ImportRow, Outcome>();
  const keep = (asked: readonly ImportRow[], outcomes: readonly Outcome[]) => {
    for (const [index, row] of asked.entries())
      decided.set(row, outcomes[index] ?? MISSED);
  };
  if (imdb.length > 0) keep(imdb, await matchImdb(imdb, ask));
  if (films.length > 0) keep(films, await matchFilms(films, ask));
  if (books.length > 0) keep(books, await matchBooks(books, ask));
  if (spotify.length > 0) keep(spotify, await matchSpotify(spotify, ask));
  if (titles.length > 0) keep(titles, await matchTitles(titles, ask));
  for (const place of places) keep([place], [await matchPlace(place, ask)]);
  return rows.map((row) => decided.get(row) ?? MISSED);
}

export type Matching = {
  // One per row; null for a row not reached before a stop.
  readonly outcomes: readonly (Outcome | null)[];
  // The service stopped answering part-way.
  readonly stopped: boolean;
};

/**
 * Matches every row not yet decided, a batch at a time, calling `progress`
 * with the share done after each. `known` is an earlier call's outcomes, for
 * taking up where a stop left off.
 */
export async function matchRows(
  rows: readonly ImportRow[],
  ask: Ask,
  progress: (done: number) => void = () => {},
  known: readonly (Outcome | null)[] = [],
): Promise<Matching> {
  const outcomes: (Outcome | null)[] = rows.map(
    (_, index) => known[index] ?? null,
  );
  const todo = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => outcomes[index] === null);
  // A place is a request of its own, so its batch is one: a stop then loses
  // nothing already answered.
  const size = rows.some((row) => row.kind === "place") ? 1 : BATCH;
  let done = rows.length - todo.length;
  for (const batch of chunks(todo, size)) {
    let matched: Outcome[];
    try {
      matched = await matchBatch(
        batch.map(({ row }) => row),
        ask,
      );
    } catch {
      return { outcomes, stopped: true };
    }
    for (const [at, { index }] of batch.entries())
      outcomes[index] = matched[at] ?? MISSED;
    done += batch.length;
    progress(done / rows.length);
  }
  return { outcomes, stopped: false };
}
