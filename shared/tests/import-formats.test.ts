// The export files an import reads, against fixtures written by hand in the
// shape of real ones (`fixtures/import/`): no file there is anybody's.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { column, parseCsv, readTable } from "../src/import/csv";
import {
  type FileText,
  isWantedEntry,
  netflixReading,
  type Reading,
  readExport,
  withoutSeries,
} from "../src/import/formats";
import {
  fiveStarThumb,
  imdbThumb,
  letterboxdThumb,
  netflixThumb,
} from "../src/import/thumbs";

const FIXTURES = join(import.meta.dir, "fixtures", "import");

function file(path: string): FileText {
  return { path, text: readFileSync(join(FIXTURES, path), "utf8") };
}

function reading(...paths: string[]): Reading {
  const read = readExport(paths.map(file));
  if (typeof read === "string") throw new Error(`refused: ${read}`);
  return read;
}

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes and a comma inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
    ]);
  });

  it("keeps a newline inside quotes in its cell", () => {
    expect(parseCsv('a,"line one\nline two"\r\nb,c\r\n')).toEqual([
      ["a", "line one\nline two"],
      ["b", "c"],
    ]);
  });

  it("takes CRLF, LF and a last row with no newline", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("drops a BOM and blank lines, and keeps empty cells", () => {
    expect(parseCsv("﻿a,,c\n\n,\n")).toEqual([
      ["a", "", "c"],
      ["", ""],
    ]);
  });

  // Goodreads writes an ISBN as a formula so a spreadsheet keeps its zeros.
  it('reads `"=""0765377063"""` as `="0765377063"`', () => {
    expect(parseCsv('"=""0765377063"""')).toEqual([['="0765377063"']]);
  });

  it("reads a column by its header's name, whatever its case or quoting", () => {
    const table = readTable('Const,"IMDb Rating"\ntt1, 8.1 \n');
    const [row = []] = table.rows;
    expect(column(table, "imdb rating")(row)).toBe("8.1");
    expect(column(table, "missing")(row)).toBe("");
  });
});

describe("the cuts", () => {
  it.each([
    [1, -1],
    [4, -1],
    [5, "between"],
    [6, "between"],
    [7, 1],
    [10, 1],
  ] as const)("imdb %p is %p", (rating, cut) => {
    expect(imdbThumb(rating)).toBe(cut);
  });

  it.each([
    [0.5, false, -1],
    [2, false, -1],
    [2.5, false, "between"],
    [3.5, false, "between"],
    [4, false, 1],
    [5, false, 1],
    [null, true, 1],
    [3, true, 1],
    // A rating outside the middle wins over a heart.
    [2, true, -1],
    [null, false, "between"],
  ] as const)("letterboxd %p, liked %p, is %p", (rating, liked, cut) => {
    expect(letterboxdThumb(rating, liked)).toBe(cut);
  });

  it.each([
    [1, -1],
    [2, -1],
    [2.25, "between"],
    [3, "between"],
    [3.75, "between"],
    [4, 1],
    [4.25, 1],
    [5, 1],
  ] as const)("five stars %p is %p", (rating, cut) => {
    expect(fiveStarThumb(rating)).toBe(cut);
  });
});

describe("netflix thumbs", () => {
  it.each([
    [0, null],
    [1, -1],
    [2, 1],
    [3, 1],
    [4, null],
  ] as const)("%p is %p", (thumbs, cut) => {
    expect(netflixThumb(thumbs)).toBe(cut);
  });
});

describe("imdb", () => {
  it("reads today's file: ids, thumbs, the middle and single episodes", () => {
    const read = reading("imdb-ratings.csv");
    expect(read.source).toBe("imdb");
    expect(read.rows).toEqual([
      {
        kind: "imdb",
        imdbId: "tt15239678",
        title: "Dune: Part Two",
        year: 2024,
        value: 1,
      },
      {
        kind: "imdb",
        imdbId: "tt5697572",
        title: "Cats",
        year: 2019,
        value: -1,
      },
      {
        kind: "imdb",
        imdbId: "tt0903747",
        title: "Breaking Bad",
        year: 2008,
        value: 1,
      },
      {
        kind: "imdb",
        imdbId: "tt7366338",
        title: "Chernobyl",
        year: 2019,
        value: -1,
      },
    ]);
    // One rated in the middle, and one episode.
    expect(read.leftOut).toBe(2);
  });

  it("reads a 2019 file: no original title, camel-case kinds, other dates", () => {
    const read = reading("imdb-ratings-2019.csv");
    expect(
      read.rows.map((row) => [row.kind === "imdb" && row.imdbId, row.value]),
    ).toEqual([
      ["tt0133093", 1],
      ["tt0944947", -1],
    ]);
    expect(read.leftOut).toBe(1);
  });

  it("reads a file from before 2017, whose rating is `You rated`", () => {
    const read = reading("imdb-ratings-2016.csv");
    expect(read.rows.map((row) => row.kind === "imdb" && row.imdbId)).toEqual([
      "tt2872718",
    ]);
    expect(read.leftOut).toBe(2);
  });

  it("says a watchlist is a list", () => {
    expect(readExport([file("imdb-watchlist.csv")])).toBe("imdb-list");
  });
});

describe("letterboxd", () => {
  it("joins ratings and likes on the film's address", () => {
    const read = reading(
      "letterboxd/ratings.csv",
      "letterboxd/likes/films.csv",
    );
    expect(read.source).toBe("letterboxd");
    expect(read.rows).toEqual([
      { kind: "film", title: "Dune: Part Two", year: 2024, value: 1 },
      { kind: "film", title: "Cats", year: 2019, value: -1 },
      // A middle rating with a heart is a yes.
      {
        kind: "film",
        title: "Everything Everywhere All at Once",
        year: 2022,
        value: 1,
      },
      // A low rating wins over a heart.
      { kind: "film", title: "The Room", year: 2003, value: -1 },
      // A heart with no rating.
      { kind: "film", title: "Paddington 2", year: 2017, value: 1 },
    ]);
    expect(read.leftOut).toBe(1);
  });

  it("reads ratings.csv on its own", () => {
    const read = reading("letterboxd/ratings.csv");
    expect(read.rows).toHaveLength(3);
    expect(read.leftOut).toBe(2);
  });

  // The three lists share a header, so only the zip's path says which is likes.
  it("refuses a list chosen on its own", () => {
    expect(readExport([file("letterboxd/watchlist.csv")])).toBe(
      "letterboxd-list",
    );
    expect(
      readExport([
        { path: "films.csv", text: file("letterboxd/likes/films.csv").text },
      ]),
    ).toBe("letterboxd-list");
  });

  it("takes a zip whose files sit in a folder", () => {
    const read = readExport([
      { ...file("letterboxd/ratings.csv"), path: "export/ratings.csv" },
      { ...file("letterboxd/likes/films.csv"), path: "export/likes/films.csv" },
    ]);
    expect(typeof read !== "string" && read.rows).toHaveLength(5);
  });
});

describe("goodreads", () => {
  it("reads today's file: the series stripped, unrated dropped", () => {
    const read = reading("goodreads_library_export.csv");
    expect(read.source).toBe("goodreads");
    expect(read.rows).toEqual([
      {
        kind: "book",
        title: "The Three-Body Problem",
        author: "Liu Cixin",
        value: 1,
      },
      {
        kind: "book",
        title: "Lord of the Flies",
        author: "William Golding",
        value: -1,
      },
    ]);
    expect(read.leftOut).toBe(1);
  });

  it("reads the 31-column file from before 2022", () => {
    expect(reading("goodreads_library_export-2019.csv").rows).toEqual([
      { kind: "book", title: "Dune", author: "Frank Herbert", value: 1 },
    ]);
  });

  it.each([
    [
      "The Name of the Wind (The Kingkiller Chronicle, #1)",
      "The Name of the Wind",
    ],
    ["Saga, Vol. 1 (Saga, #1-6)", "Saga, Vol. 1"],
    ["Dune (Dune #1)", "Dune"],
    ["Persepolis (Persepolis, #1-2)", "Persepolis"],
    // Not a series: a bracket with no number.
    [
      "The Stranger (Vintage International)",
      "The Stranger (Vintage International)",
    ],
    ["Emma", "Emma"],
  ])("strips the series from %p", (title, stripped) => {
    expect(withoutSeries(title)).toBe(stripped);
  });
});

describe("google maps", () => {
  it("reads a Takeout whose names follow the account's language", () => {
    const read = reading("takeout/Maps (Meine Orte)/Bewertungen.json");
    expect(read.source).toBe("google-maps");
    // Newest first; a draft, a review with no place and `[0, 0]` are skipped.
    expect(read.rows).toEqual([
      {
        kind: "place",
        name: "Pier 39",
        lat: 37.8087,
        lon: -122.4098,
        value: -1,
      },
      {
        kind: "place",
        name: "Tartine Bakery",
        lat: 37.7614,
        lon: -122.4241,
        value: 1,
      },
    ]);
    expect(read.leftOut).toBe(1);
  });

  it("reads the older spelling, with its coordinates as text", () => {
    expect(reading("takeout-reviews-old.json").rows).toEqual([
      { kind: "place", name: "Fuglen", lat: 59.9172, lon: 10.7405, value: -1 },
      {
        kind: "place",
        name: "Oslo City Hall",
        lat: 59.9075,
        lon: 10.7389,
        value: 1,
      },
    ]);
  });

  it("says a Takeout with no reviews has none", () => {
    expect(
      readExport(
        [
          {
            path: "Takeout/Maps (your places)/Saved Places.json",
            text: '{"type":"FeatureCollection","features":[]}',
          },
        ],
        [
          "Takeout/archive_browser.html",
          "Takeout/Maps (your places)/Saved Places.json",
        ],
      ),
    ).toBe("takeout-without-reviews");
  });
});

describe("storygraph", () => {
  it("reads quarter stars, the first author, and leaves out the middle and unrated", () => {
    const read = reading("storygraph.csv");
    expect(read.source).toBe("storygraph");
    expect(read.rows).toEqual([
      {
        kind: "book",
        title: "Good Omens",
        author: "Terry Pratchett",
        value: 1,
      },
      {
        kind: "book",
        title: "Rise of the Dragon Queen",
        author: "Someone Made Up",
        value: -1,
      },
    ]);
    // `3.75` is in the middle; an unrated book is no rating at all.
    expect(read.leftOut).toBe(1);
  });
});

describe("netflix", () => {
  const read = () => reading("netflix/CONTENT_INTERACTION/Ratings.csv");
  const title = (name: string, value: 1 | -1) => ({
    kind: "title" as const,
    title: name,
    value,
  });

  it("names every profile in the file, in its order", () => {
    expect(read().source).toBe("netflix");
    expect(read().netflix?.profiles).toEqual(["Sam", "Kids", "Alex"]);
  });

  it("reads every profile's thumbs, one per title, until some are chosen", () => {
    expect(read().rows).toEqual([
      title("The Irishman", -1),
      title("Dark", 1),
      title("House of Cards", 1),
      title("Paw Patrol", 1),
    ]);
    // Wednesday, a yes and a no; Roma, three stars.
    expect(read().leftOut).toBe(2);
  });

  it("reads only the chosen profiles' thumbs", () => {
    const file = read().netflix;
    if (file === undefined) throw new Error("no profiles");
    const chosen = netflixReading(file, new Set(["Sam"]));
    expect(chosen.rows).toEqual([
      title("Wednesday", 1),
      title("The Irishman", -1),
      title("Dark", 1),
      title("House of Cards", 1),
    ]);
    expect(chosen.leftOut).toBe(1);
  });

  it("says a Netflix download with no ratings has none", () => {
    expect(
      readExport(
        [],
        [
          "netflix-report/CONTENT_INTERACTION/ViewingActivity.csv",
          "netflix-report/Cover sheet.pdf",
        ],
      ),
    ).toBe("netflix-without-ratings");
  });
});

describe("trakt", () => {
  const traktFiles = [
    "trakt/ratings-movies.json",
    "trakt/ratings-shows.json",
    "trakt/ratings-seasons.json",
    "trakt/ratings-episodes.json",
    "trakt/watched-movies.json",
  ];

  it("reads every ratings file of the zip as one list", () => {
    const read = reading(...traktFiles);
    expect(read.source).toBe("trakt");
    expect(read.rows).toEqual([
      {
        kind: "imdb",
        imdbId: "tt15239678",
        title: "Dune: Part Two",
        year: 2024,
        value: 1,
      },
      {
        kind: "imdb",
        imdbId: "tt5697572",
        title: "Cats",
        year: 2019,
        value: -1,
      },
      // No IMDb id: matched by its title and year.
      { kind: "film", title: "Aftersun", year: 2022, value: 1 },
      {
        kind: "imdb",
        imdbId: "tt7366338",
        title: "Chernobyl",
        year: 2019,
        value: 1,
      },
    ]);
    // A 6, a season and an episode.
    expect(read.leftOut).toBe(3);
  });

  it("reads one file chosen on its own", () => {
    expect(reading("trakt/ratings-shows.json").rows).toHaveLength(1);
  });

  it("says an export whose ratings are empty has none", () => {
    expect(
      readExport(
        [{ path: "ratings-movies.json", text: "[]" }],
        ["user-settings.json", "ratings-movies.json"],
      ),
    ).toBe("trakt-without-ratings");
  });
});

describe("spotify", () => {
  it("reads liked songs, saved albums and followed artists as a yes, and what is banned as a no", () => {
    const read = reading("spotify/Spotify Account Data/YourLibrary.json");
    expect(read.source).toBe("spotify");
    expect(read.rows).toEqual([
      {
        kind: "spotify",
        of: "track",
        spotifyId: "6LgJvl0Xdtc73RJ1mmpotq",
        value: 1,
      },
      {
        kind: "spotify",
        of: "album",
        spotifyId: "0ETFjACtuP2ADo6LFhL6HN",
        value: 1,
      },
      {
        kind: "spotify",
        of: "artist",
        spotifyId: "4Z8W4fKeB5YxbusRsdQVPb",
        value: 1,
      },
      {
        kind: "spotify",
        of: "track",
        spotifyId: "3oGvRB0MAfPseLw39gVzGh",
        value: -1,
      },
      {
        kind: "spotify",
        of: "artist",
        spotifyId: "4GNC7GD6oZMSxPGyXy4MNC",
        value: -1,
      },
    ]);
    expect(read.leftOut).toBe(0);
  });

  it("is not a library without a Spotify address in it", () => {
    expect(
      readExport([
        {
          path: "YourLibrary.json",
          text: '{"tracks":[],"albums":[],"artists":[{"name":"x","uri":""}]}',
        },
      ]),
    ).toBe("unreadable");
  });
});

describe("readExport", () => {
  it.each([
    "name,email\na,b\n",
    "",
    "{not json",
    '{"type":"Other"}',
    "\u0000\u0001PK",
  ])("refuses %p as unreadable", (text) => {
    expect(readExport([{ path: "file", text }])).toBe("unreadable");
  });

  it.each([
    ["ratings.csv", true],
    ["likes/films.csv", true],
    ["letterboxd-someone-2025-06-06-15-42-utc/ratings.csv", true],
    ["Takeout/Maps (your places)/Reviews.json", true],
    ["Takeout/Maps (Meine Orte)/Bewertungen.json", true],
    ["Takeout/Maps (tus sitios)/Reseñas.json", true],
    ["netflix-report/CONTENT_INTERACTION/Ratings.csv", true],
    ["netflix-report/CONTENT_INTERACTION/ViewingActivity.csv", false],
    ["ratings-movies.json", true],
    ["ratings-episodes-2.json", true],
    ["Spotify Account Data/YourLibrary.json", true],
    ["MyData/YourLibrary.json", true],
    ["watched-movies.json", false],
    ["Spotify Account Data/Playlist1.json", false],
    ["watchlist.csv", false],
    ["lists/favourites.csv", false],
    ["profile.csv", false],
    ["Takeout/Drive/notes.json", false],
    ["Takeout/archive_browser.html", false],
  ])("wants %p from a zip: %p", (path, wanted) => {
    expect(isWantedEntry(path)).toBe(wanted);
  });
});
