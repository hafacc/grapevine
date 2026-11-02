/**
 * The export files an import reads (DESIGN §1 "Importing"): which one a
 * file is, by what is in it, and its rows as thumbs.
 *
 * Columns are read by header name, so a format that gains or loses a column
 * still reads. No date is read from any of them: an imported thumb is stamped
 * when it is imported.
 */

import { column, readTable, type Table } from "./csv.ts";
import {
  type Cut,
  fiveStarThumb,
  imdbThumb,
  letterboxdThumb,
  netflixThumb,
  type Thumb,
} from "./thumbs.ts";

export type ImportSource =
  | "imdb"
  | "letterboxd"
  | "goodreads"
  | "google-maps"
  | "storygraph"
  | "netflix"
  | "trakt"
  | "spotify";

export const IMPORT_SOURCES: readonly ImportSource[] = [
  "imdb",
  "letterboxd",
  "goodreads",
  "google-maps",
  "storygraph",
  "netflix",
  "trakt",
  "spotify",
];

/** One rated thing from a file, with what its matcher needs and no more. */
export type ImportRow =
  | {
      readonly kind: "imdb";
      readonly imdbId: string;
      readonly title: string;
      readonly year: number | null;
      readonly value: Thumb;
    }
  | {
      readonly kind: "film";
      readonly title: string;
      readonly year: number | null;
      readonly value: Thumb;
    }
  | {
      readonly kind: "book";
      readonly title: string;
      readonly author: string;
      readonly value: Thumb;
    }
  | {
      readonly kind: "place";
      readonly name: string;
      readonly lat: number;
      readonly lon: number;
      readonly value: Thumb;
    }
  // A film or a series by its title alone, as Netflix names it.
  | {
      readonly kind: "title";
      readonly title: string;
      readonly value: Thumb;
    }
  | {
      readonly kind: "spotify";
      readonly of: SpotifyKind;
      readonly spotifyId: string;
      readonly value: Thumb;
    };

/** What a Spotify address names. */
export type SpotifyKind = "track" | "album" | "artist";

export type Reading = {
  readonly source: ImportSource;
  readonly rows: readonly ImportRow[];
  // Rated, and not imported: a rating in the middle, or a single episode.
  readonly leftOut: number;
  // Netflix's file holds every profile on the account; `rows` is all of them
  // until `netflixReading` is asked for the ones that are the person's.
  readonly netflix?: NetflixFile;
};

/** One thumb of Netflix's file, with whose it is. */
export type NetflixRating = {
  readonly profile: string;
  readonly title: string;
  readonly cut: Cut;
};

export type NetflixFile = {
  // In the order the file first names them.
  readonly profiles: readonly string[];
  readonly ratings: readonly NetflixRating[];
};

/**
 * Why a file was not read. `list` files are the right service's wrong file;
 * each has its own sentence on screen.
 */
export type Refusal =
  | "unreadable"
  | "imdb-list"
  | "letterboxd-list"
  | "takeout-without-reviews"
  | "trakt-without-ratings"
  | "netflix-without-ratings";

export type FileText = { readonly path: string; readonly text: string };

function wholeNumber(cell: string): number | null {
  return /^\d+$/u.test(cell) ? Number(cell) : null;
}

type Tally = {
  rows: ImportRow[];
  leftOut: number;
};

function sort(tally: Tally, cut: Cut, row: ImportRow): void {
  if (cut === "between") tally.leftOut += 1;
  else tally.rows.push({ ...row, value: cut });
}

const has = (table: Table, ...names: string[]): boolean =>
  names.every((name) => table.header.includes(name));

function readImdb(table: Table): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  const id = column(table, "const");
  // `You rated` until 2017.
  const rating = column(
    table,
    table.header.includes("your rating") ? "your rating" : "you rated",
  );
  const title = column(table, "title");
  const type = column(table, "title type");
  const year = column(table, "year");
  for (const row of table.rows) {
    const stars = wholeNumber(rating(row));
    if (!/^tt\d+$/u.test(id(row)) || stars === null || stars < 1) continue;
    // `TV Episode` today, `tvEpisode` in older files.
    if (type(row).replace(/\s/gu, "").toLowerCase() === "tvepisode") {
      tally.leftOut += 1;
      continue;
    }
    sort(tally, imdbThumb(stars), {
      kind: "imdb",
      imdbId: id(row),
      title: title(row),
      year: wholeNumber(year(row)),
      value: 1,
    });
  }
  return tally;
}

// Joined on the film's address: a film both rated and liked is one row.
function readLetterboxd(ratings: Table | null, likes: Table | null): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  const liked = new Set<string>();
  if (likes !== null) {
    const uri = column(likes, "letterboxd uri");
    for (const row of likes.rows) liked.add(uri(row));
  }
  const rated = new Set<string>();
  const film = (
    table: Table,
    row: readonly string[],
  ): Extract<ImportRow, { kind: "film" }> => ({
    kind: "film",
    title: column(table, "name")(row),
    year: wholeNumber(column(table, "year")(row)),
    value: 1,
  });
  if (ratings !== null) {
    const uri = column(ratings, "letterboxd uri");
    const rating = column(ratings, "rating");
    for (const row of ratings.rows) {
      const stars = Number(rating(row));
      const entry = film(ratings, row);
      if (entry.title === "" || !(stars >= 0.5 && stars <= 5)) continue;
      rated.add(uri(row));
      sort(tally, letterboxdThumb(stars, liked.has(uri(row))), entry);
    }
  }
  if (likes !== null) {
    const uri = column(likes, "letterboxd uri");
    for (const row of likes.rows) {
      const entry = film(likes, row);
      if (entry.title === "" || rated.has(uri(row))) continue;
      sort(tally, letterboxdThumb(null, true), entry);
    }
  }
  return tally;
}

// `The Three-Body Problem (Remembrance of Earth’s Past, #1)`: the series is
// in the title's last bracket.
const SERIES = /\s*\([^()]*#\s*[\d.,\s–-]+[^()]*\)\s*$/u;

/** A Goodreads title without the series it is filed under. */
export function withoutSeries(title: string): string {
  return title.replace(SERIES, "").trim();
}

function readGoodreads(table: Table): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  const title = column(table, "title");
  const author = column(table, "author");
  const rating = column(table, "my rating");
  for (const row of table.rows) {
    const stars = wholeNumber(rating(row));
    // `0` is unrated, and a shelf is not a rating.
    if (stars === null || stars < 1 || title(row) === "") continue;
    const name = withoutSeries(title(row));
    sort(tally, fiveStarThumb(stars), {
      kind: "book",
      title: name,
      // The file pads a name with a run of spaces after an initial.
      author: author(row).replace(/\s+/gu, " "),
      value: 1,
    });
  }
  return tally;
}

function readStoryGraph(table: Table): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  const title = column(table, "title");
  const authors = column(table, "authors");
  const rating = column(table, "star rating");
  for (const row of table.rows) {
    // Quarter stars, `4.25`; empty is unrated.
    const stars = /^\d+(\.\d+)?$/u.test(rating(row)) ? Number(rating(row)) : 0;
    const [author = ""] = authors(row).split(", ");
    if (stars <= 0 || stars > 5 || title(row) === "") continue;
    // Some titles carry their edition's series, as Goodreads' all do.
    sort(tally, fiveStarThumb(stars), {
      kind: "book",
      title: withoutSeries(title(row)),
      author: author.replace(/\s+/gu, " ").trim(),
      value: 1,
    });
  }
  return tally;
}

function readNetflix(table: Table): NetflixFile {
  const profile = column(table, "profile name");
  const title = column(table, "title name");
  const type = column(table, "rating type");
  const thumbs = column(table, "thumbs value");
  const stars = column(table, "star value");
  const profiles: string[] = [];
  const ratings: NetflixRating[] = [];
  for (const row of table.rows) {
    const name = title(row).replace(/\s+/gu, " ");
    // `0` is unrated, and a negative star is "not interested" or "not seen".
    const cut =
      type(row) === "thumb"
        ? netflixThumb(wholeNumber(thumbs(row)) ?? 0)
        : type(row) === "star" && /^[1-5]$/u.test(stars(row))
          ? fiveStarThumb(Number(stars(row)))
          : null;
    if (name === "" || cut === null) continue;
    if (!profiles.includes(profile(row))) profiles.push(profile(row));
    ratings.push({ profile: profile(row), title: name, cut });
  }
  return { profiles, ratings };
}

/**
 * The thumbs of the chosen profiles, one per title. The file is a log: a
 * title rated twice, or by two of the chosen, is taken only when every thumb
 * on it agrees, since which came last would take the file's dates.
 */
export function netflixReading(
  file: NetflixFile,
  chosen: ReadonlySet<string>,
): Reading {
  const byTitle = new Map<string, Set<Cut>>();
  for (const { profile, title, cut } of file.ratings) {
    if (!chosen.has(profile)) continue;
    byTitle.set(title, (byTitle.get(title) ?? new Set()).add(cut));
  }
  const tally: Tally = { rows: [], leftOut: 0 };
  for (const [title, cuts] of byTitle) {
    const thumbs = [...cuts].filter((cut) => cut !== "between");
    const [only] = thumbs;
    if (only !== undefined && thumbs.length === 1)
      tally.rows.push({ kind: "title", title, value: only });
    else tally.leftOut += 1;
  }
  return { source: "netflix", ...tally, netflix: file };
}

type Feature = {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function features(json: unknown): Feature[] | null {
  const collection = json as { type?: unknown; features?: unknown } | null;
  return collection?.type === "FeatureCollection" &&
    Array.isArray(collection.features)
    ? (collection.features as Feature[])
    : null;
}

const NEW_RATING = "five_star_rating_published";
const OLD_RATING = "Star Rating";

/** Whether this is Takeout's `Reviews.json`, in either of its spellings. */
function isMapsReviews(json: unknown): boolean {
  return (
    features(json)?.some(
      (feature) =>
        typeof feature?.properties === "object" &&
        feature.properties !== null &&
        (NEW_RATING in feature.properties || OLD_RATING in feature.properties),
    ) ?? false
  );
}

function readMaps(json: unknown): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  const dated: {
    date: string;
    cut: Cut;
    row: Extract<ImportRow, { kind: "place" }>;
  }[] = [];
  for (const feature of features(json) ?? []) {
    const properties = feature?.properties ?? {};
    const location = (properties.location ??
      properties.Location ??
      {}) as Record<string, unknown>;
    const geo = (location["Geo Coordinates"] ?? {}) as Record<string, unknown>;
    const point = Array.isArray(feature?.geometry?.coordinates)
      ? feature.geometry.coordinates
      : [];
    const stars = Number(properties[NEW_RATING] ?? properties[OLD_RATING]);
    const name = location.name ?? location["Business Name"];
    const lon = Number(point[0] ?? geo.Longitude);
    const lat = Number(point[1] ?? geo.Latitude);
    // A draft has no published rating; `[0, 0]` is Google's "unknown".
    if (!(stars >= 1 && stars <= 5)) continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    dated.push({
      date: String(properties.date ?? properties.Published ?? ""),
      cut: fiveStarThumb(stars),
      row: { kind: "place", name: name.trim(), lat, lon, value: 1 },
    });
  }
  // Newest first, since a long history is cut to its newest places. Both
  // spellings date a review in ISO 8601, which sorts as text.
  dated.sort((left, right) =>
    left.date < right.date ? 1 : left.date > right.date ? -1 : 0,
  );
  for (const { cut, row } of dated) sort(tally, cut, row);
  return tally;
}

type SpotifyEntry = { uri?: unknown };
type SpotifyLibrary = Partial<Record<string, SpotifyEntry[]>>;

// Each of `YourLibrary.json`'s lists, as what it says about the thing: a
// liked song, a saved album and a followed artist are a yes; a hidden song
// and an artist not to be played, a no. Shows, episodes and local files are
// not read.
const SPOTIFY_LISTS: readonly {
  readonly list: string;
  readonly of: SpotifyKind;
  readonly value: Thumb;
}[] = [
  { list: "tracks", of: "track", value: 1 },
  { list: "albums", of: "album", value: 1 },
  { list: "artists", of: "artist", value: 1 },
  { list: "bannedTracks", of: "track", value: -1 },
  { list: "bannedArtists", of: "artist", value: -1 },
];

const SPOTIFY_URI = /^spotify:(track|album|artist):([0-9A-Za-z]{22})$/u;

/** Whether this is Spotify's `YourLibrary.json`. */
function isSpotifyLibrary(json: unknown): json is SpotifyLibrary {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return false;
  const library = json as SpotifyLibrary;
  return (
    ["tracks", "albums", "artists"].every((list) =>
      Array.isArray(library[list]),
    ) &&
    SPOTIFY_LISTS.some(({ list }) =>
      (library[list] ?? []).some(
        (entry) =>
          typeof entry?.uri === "string" && SPOTIFY_URI.test(entry.uri),
      ),
    )
  );
}

function readSpotify(library: SpotifyLibrary): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  for (const { list, of, value } of SPOTIFY_LISTS) {
    const entries = library[list];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const uri = typeof entry?.uri === "string" ? entry.uri : "";
      const [, kind, spotifyId] = SPOTIFY_URI.exec(uri) ?? [];
      // A song with no address is matched by nothing: its title is not
      // enough to say which recording it is.
      if (kind !== of || spotifyId === undefined) continue;
      sort(tally, value, { kind: "spotify", of, spotifyId, value: 1 });
    }
  }
  return tally;
}

// `ratings-movies.json`, or `ratings-movies-2.json` past its first page.
const TRAKT_RATINGS =
  /(^|\/)ratings-(movies|shows|seasons|episodes)(-\d+)?\.json$/iu;

const TRAKT_KINDS = ["movie", "show", "season", "episode"];

type TraktRating = {
  rating?: unknown;
  type?: unknown;
  movie?: TraktTitle;
  show?: TraktTitle;
};
type TraktTitle = {
  title?: unknown;
  year?: unknown;
  ids?: { imdb?: unknown };
};

/** Whether this is one of Trakt's `ratings-*.json`: its own API's answer. */
function isTraktRatings(json: unknown): json is TraktRating[] {
  return (
    Array.isArray(json) &&
    json.some(
      (entry: TraktRating | null) =>
        typeof entry?.rating === "number" &&
        typeof entry.type === "string" &&
        TRAKT_KINDS.includes(entry.type) &&
        typeof (entry as Record<string, unknown>)[entry.type] === "object",
    )
  );
}

// Every page of every one of the four files is one list: a film and a show
// are thumbs, a season and an episode are left out as IMDb's episodes are.
function readTrakt(files: readonly TraktRating[][]): Tally {
  const tally: Tally = { rows: [], leftOut: 0 };
  for (const entry of files.flat()) {
    const stars = entry?.rating;
    if (typeof stars !== "number" || !Number.isInteger(stars)) continue;
    if (stars < 1 || stars > 10) continue;
    if (entry.type === "season" || entry.type === "episode") {
      tally.leftOut += 1;
      continue;
    }
    const titled = entry.type === "movie" ? entry.movie : entry.show;
    if (titled === undefined || typeof titled.title !== "string") continue;
    const title = titled.title.trim();
    const year =
      typeof titled.year === "number" && Number.isInteger(titled.year)
        ? titled.year
        : null;
    const imdbId = titled.ids?.imdb;
    if (title === "") continue;
    // A title with no IMDb id is matched as Letterboxd's are.
    sort(
      tally,
      imdbThumb(stars),
      typeof imdbId === "string" && /^tt\d+$/u.test(imdbId)
        ? { kind: "imdb", imdbId, title, year, value: 1 }
        : { kind: "film", title, year, value: 1 },
    );
  }
  return tally;
}

const LETTERBOXD_LIST = ["date", "name", "year", "letterboxd uri"];

type Recognised =
  | { readonly is: "imdb"; readonly table: Table }
  | { readonly is: "imdb-list" }
  | { readonly is: "goodreads"; readonly table: Table }
  | { readonly is: "storygraph"; readonly table: Table }
  | { readonly is: "netflix"; readonly table: Table }
  | { readonly is: "letterboxd-ratings"; readonly table: Table }
  // `watched.csv`, `watchlist.csv` and `likes/films.csv` share one header, so
  // only the path inside the zip says which this is.
  | {
      readonly is: "letterboxd-list";
      readonly table: Table;
      readonly likes: boolean;
    }
  | { readonly is: "google-maps"; readonly json: unknown }
  | { readonly is: "trakt"; readonly ratings: TraktRating[] }
  | { readonly is: "spotify"; readonly library: SpotifyLibrary }
  | null;

function recognise({ path, text }: FileText): Recognised {
  if (/^\s*[{[]/u.test(text.slice(0, 64).replace(/^﻿/u, ""))) {
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^﻿/u, ""));
    } catch {
      return null;
    }
    if (isMapsReviews(json)) return { is: "google-maps", json };
    else if (isTraktRatings(json)) return { is: "trakt", ratings: json };
    else if (isSpotifyLibrary(json)) return { is: "spotify", library: json };
    else return null;
  }
  const table = readTable(text);
  if (has(table, "const", "your rating") || has(table, "const", "you rated"))
    return { is: "imdb", table };
  else if (has(table, "const", "title")) return { is: "imdb-list" };
  else if (has(table, "book id", "my rating", "exclusive shelf"))
    return { is: "goodreads", table };
  else if (has(table, "profile name", "title name", "thumbs value"))
    return { is: "netflix", table };
  else if (has(table, "title", "authors", "isbn/uid", "star rating"))
    return { is: "storygraph", table };
  else if (
    has(table, ...LETTERBOXD_LIST, "rating") &&
    table.header.length === 5
  )
    return { is: "letterboxd-ratings", table };
  else if (has(table, ...LETTERBOXD_LIST) && table.header.length === 4)
    return {
      is: "letterboxd-list",
      table,
      likes: /(^|\/)likes\/films\.csv$/iu.test(path),
    };
  else return null;
}

/**
 * Whether a file inside a zip is worth reading: a `ratings.csv` (Letterboxd's
 * and Netflix's), Letterboxd's likes, anything in Takeout's Maps folder, whose
 * name and whose files' names follow the account's language, Trakt's ratings
 * and Spotify's library.
 */
export function isWantedEntry(path: string): boolean {
  return (
    /(^|\/)ratings\.csv$/iu.test(path) ||
    /(^|\/)likes\/films\.csv$/iu.test(path) ||
    /(^|\/)maps[^/]*\/[^/]+\.json$/iu.test(path) ||
    TRAKT_RATINGS.test(path) ||
    /(^|\/)yourlibrary\.json$/iu.test(path)
  );
}

/**
 * What the chosen file holds: one file's text, or the wanted entries of a
 * zip. `paths` is every name in the zip, read or not, which is what tells a
 * Takeout with no reviews from a zip that is nothing known.
 */
export function readExport(
  files: readonly FileText[],
  paths: readonly string[] = files.map((file) => file.path),
): Reading | Refusal {
  const known = files.map(recognise);
  const finish = (source: ImportSource, tally: Tally): Reading => ({
    source,
    ...tally,
  });
  let ratings: Table | null = null;
  let likes: Table | null = null;
  let loneList = false;
  for (const file of known) {
    if (file?.is === "letterboxd-ratings") ratings = file.table;
    else if (file?.is === "letterboxd-list" && file.likes) likes = file.table;
    else if (file?.is === "letterboxd-list") loneList = true;
  }
  if (ratings !== null || likes !== null)
    return finish("letterboxd", readLetterboxd(ratings, likes));
  // Trakt's ratings are four files, each in pages of their own.
  const trakt = known.flatMap((file) =>
    file?.is === "trakt" ? [file.ratings] : [],
  );
  if (trakt.length > 0) return finish("trakt", readTrakt(trakt));
  for (const file of known) {
    if (file?.is === "imdb") {
      const tally = readImdb(file.table);
      // A list's export has the rating column too, empty on a watchlist.
      const unrated = tally.rows.length + tally.leftOut === 0;
      if (unrated && file.table.header.includes("position")) return "imdb-list";
      else return finish("imdb", tally);
    } else if (file?.is === "goodreads")
      return finish("goodreads", readGoodreads(file.table));
    else if (file?.is === "storygraph")
      return finish("storygraph", readStoryGraph(file.table));
    else if (file?.is === "netflix") {
      const netflix = readNetflix(file.table);
      return netflixReading(netflix, new Set(netflix.profiles));
    } else if (file?.is === "google-maps")
      return finish("google-maps", readMaps(file.json));
    else if (file?.is === "spotify")
      return finish("spotify", readSpotify(file.library));
  }
  if (known.some((file) => file?.is === "imdb-list")) return "imdb-list";
  else if (loneList) return "letterboxd-list";
  else if (paths.some((path) => /^takeout\//iu.test(path)))
    return "takeout-without-reviews";
  else if (paths.some((path) => TRAKT_RATINGS.test(path)))
    return "trakt-without-ratings";
  else if (paths.some((path) => /(^|\/)content_interaction\//iu.test(path)))
    return "netflix-without-ratings";
  else return "unreadable";
}
