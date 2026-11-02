// Matching imported rows, against answers written by hand in the shape
// Wikipedia, Wikidata's query service and Photon give. Nothing here touches
// the network.

import { describe, expect, it } from "bun:test";

import type { ImportRow } from "../src/import/formats";
import {
  type Ask,
  BATCH,
  bookGuesses,
  filmGuesses,
  imdbRequest,
  type MatchRequest,
  matchRows,
  type Outcome,
  type Page,
  type PageFacts,
  pickBook,
  pickFilm,
  pickPlace,
  placeQueries,
  placeRequest,
  readBookLabelAnswer,
  readFactsAnswer,
  readFilmLabelAnswer,
  readImdbAnswer,
  readSpotifyAnswer,
  readTitleLabelAnswer,
  readTitlesAnswer,
  spotifyRequest,
  titleLabelRequest,
  titlesRequests,
} from "../src/import/match";
import { isRateableKind } from "../src/references";

type Film = Extract<ImportRow, { kind: "film" }>;
type Book = Extract<ImportRow, { kind: "book" }>;
type Place = Extract<ImportRow, { kind: "place" }>;

const film = (title: string, year: number | null): Film => ({
  kind: "film",
  title,
  year,
  value: 1,
});
const book = (title: string, author: string): Book => ({
  kind: "book",
  title,
  author,
  value: 1,
});

const entity = (id: string) => ({
  value: `http://www.wikidata.org/entity/${id}`,
});
const text = (value: string | number) => ({ value: String(value) });
const sparqlAnswer = (bindings: object[]) => ({ results: { bindings } });

const page = (title: string, ref: string): Page => ({ title, ref });
const facts = (
  title: string,
  kinds: string[],
  firstYear: number | null = null,
  authors: string[] = [],
): PageFacts => ({ title, kinds, firstYear, authors });

const names = (outcome: Outcome): string[] =>
  outcome.kind === "found" ? [outcome.candidate.names[0] ?? ""] : [];

const FILM = "Q11424";
const SERIES = "Q5398426";
const NOVEL = "Q8261";

describe("imdb ids", () => {
  it("asks for every id in one form-encoded request", () => {
    const request = imdbRequest(["tt0110912", "tt0109830"]);
    expect(request.url).toBe("https://query.wikidata.org/sparql");
    expect(decodeURIComponent(request.body ?? "")).toContain(
      'VALUES ?imdb { "tt0110912" "tt0109830" }',
    );
    // A preflight on every request otherwise.
    expect(Object.keys(request.headers)).toEqual(["Accept"]);
  });

  const row = (
    imdb: string,
    item: string,
    kind: string | null,
    title: string | null,
  ) => ({
    imdb: text(imdb),
    item: entity(item),
    ...(kind === null ? {} : { p31: entity(kind) }),
    ...(title === null ? {} : { title: text(title) }),
  });

  it("keeps a rateable thing that has an English page, named as add names it", () => {
    const found = readImdbAnswer(
      sparqlAnswer([
        row("tt1", "Q100", FILM, "Dune (2021 film)"),
        // No English page.
        row("tt2", "Q200", FILM, null),
        // A person is not rated.
        row("tt3", "Q300", "Q5", "Somebody"),
        // `8½` cannot be a name.
        row("tt4", "Q400", FILM, "8½"),
      ]),
    );
    expect([...found.keys()]).toEqual(["tt1"]);
    expect(found.get("tt1")?.[0]).toMatchObject({
      source: "wikidata",
      ref: "Q100",
      names: ["dune (2021 film)"],
    });
  });

  it("takes a series over its season and over the comic it came from", () => {
    const found = readImdbAnswer(
      sparqlAnswer([
        row("tt1", "Q11", "Q3464665", "The X-Files season 10"),
        row("tt1", "Q10", SERIES, "The X-Files"),
        row("tt2", "Q20", "Q1004", "Barefoot Gen"),
        row("tt2", "Q21", "Q20650540", "Barefoot Gen (1983 film)"),
        // A season that is all the id names is taken.
        row("tt3", "Q30", "Q3464665", "The Haunting of Hill House (TV series)"),
      ]),
    );
    expect(found.get("tt1")?.map((candidate) => candidate.ref)).toEqual([
      "Q10",
    ]);
    expect(found.get("tt2")?.map((candidate) => candidate.ref)).toEqual([
      "Q21",
    ]);
    expect(found.get("tt3")?.map((candidate) => candidate.ref)).toEqual([
      "Q30",
    ]);
  });

  it("gives one item to each of the ids that name it", () => {
    const found = readImdbAnswer(
      sparqlAnswer([
        row("tt1", "Q50", FILM, "Gangs of Wasseypur"),
        row("tt2", "Q50", FILM, "Gangs of Wasseypur"),
      ]),
    );
    expect(found.get("tt1")?.[0]?.ref).toBe("Q50");
    expect(found.get("tt2")?.[0]?.ref).toBe("Q50");
  });
});

describe("spotify ids", () => {
  it("asks each kind of address under its own property", () => {
    const body = (of: "track" | "album" | "artist") =>
      decodeURIComponent(
        spotifyRequest(of, ["4Z8W4fKeB5YxbusRsdQVPb"]).body ?? "",
      );
    expect(body("artist")).toContain("wdt:P1902 ?id");
    expect(body("album")).toContain("wdt:P2205 ?id");
    expect(body("track")).toContain("wdt:P2207 ?id");
    expect(body("artist")).toContain('VALUES ?id { "4Z8W4fKeB5YxbusRsdQVPb" }');
  });

  const row = (
    id: string,
    item: string,
    kind: string,
    title: string | null,
    occupation: string | null = null,
  ) => ({
    id: text(id),
    item: entity(item),
    p31: entity(kind),
    ...(occupation === null ? {} : { p106: entity(occupation) }),
    ...(title === null ? {} : { title: text(title) }),
  });

  it("keeps an album, a band and a singer with an English page", () => {
    const found = readSpotifyAnswer(
      sparqlAnswer([
        row("a1", "Q1", "Q208569", "OK Computer"),
        row("b1", "Q2", "Q215380", "Radiohead"),
        row("s1", "Q3", "Q5", "Mitski", "Q177220"),
        // A person who is not a performer, and an album with no page.
        row("p1", "Q4", "Q5", "Somebody", "Q82955"),
        row("a2", "Q5", "Q208569", null),
      ]),
    );
    expect([...found.keys()]).toEqual(["a1", "b1", "s1"]);
    expect(found.get("s1")?.[0]).toMatchObject({
      source: "wikidata",
      ref: "Q3",
      names: ["mitski"],
    });
  });

  it("misses an id two things hold", async () => {
    const { outcomes } = await matchRows(
      [
        { kind: "spotify", of: "track", spotifyId: "t1", value: 1 },
        { kind: "spotify", of: "track", spotifyId: "t2", value: -1 },
      ],
      async () =>
        sparqlAnswer([
          row("t1", "Q10", "Q7366", "Creep (Radiohead song)"),
          row("t1", "Q11", "Q134556", "Creep (single)"),
          row("t2", "Q12", "Q7366", "Karma Police"),
        ]),
    );
    expect(outcomes.map((outcome) => outcome?.kind)).toEqual([
      "missed",
      "found",
    ]);
  });
});

describe("netflix titles", () => {
  type Title = Extract<ImportRow, { kind: "title" }>;
  const title = (name: string): Title => ({
    kind: "title",
    title: name,
    value: 1,
  });
  const row = (
    t: string,
    item: string,
    kinds: string,
    page: string | null,
    netflix: string | null = null,
  ) => ({
    t: text(t),
    item: entity(item),
    kinds: text(kinds),
    ...(page === null ? {} : { title: text(page) }),
    ...(netflix === null ? {} : { netflix: text(netflix) }),
  });

  it("asks each title in English and mul, for films and series by label", () => {
    const body = decodeURIComponent(
      titleLabelRequest([title("Dark"), title("Dark")]).body ?? "",
    );
    expect(body).toContain('VALUES ?t { "Dark"@en "Dark"@mul }');
    expect(body).toContain("VALUES ?kind { wd:Q11424 wd:Q5398426 }");
    expect(body).toContain("wdt:P1874 ?netflix");
  });

  it("takes the one thing of a name, and of several the one with a Netflix id", () => {
    const outcomes = readTitleLabelAnswer(
      [title("Dark"), title("Wednesday"), title("Roma"), title("Okja")],
      sparqlAnswer([
        row("Dark", "Q1", SERIES, "Dark (TV series)", "80100172"),
        // Two rows for one item: its two Netflix ids.
        row("Dark", "Q1", SERIES, "Dark (TV series)", "80100173"),
        row("Wednesday", "Q2", SERIES, "Wednesday (TV series)", "81231974"),
        row("Wednesday", "Q3", FILM, "Wednesday (1974 film)"),
        row("Wednesday", "Q4", FILM, null),
        row("Roma", "Q5", FILM, "Roma (2018 film)"),
        row("Roma", "Q6", FILM, "Roma (1972 film)"),
        row("Okja", "Q7", FILM, "Okja"),
      ]),
    );
    expect(outcomes.map(names)).toEqual([
      ["dark (tv series)"],
      ["wednesday (tv series)"],
      // Two films, and neither holds an id: never guessed.
      [],
      ["okja"],
    ]);
  });

  it("misses two that hold a Netflix id, one with no page, and none", () => {
    const outcomes = readTitleLabelAnswer(
      [title("Lupin"), title("Kingdom"), title("Nothing")],
      sparqlAnswer([
        row("Lupin", "Q1", SERIES, "Lupin (French TV series)", "80994082"),
        row("Lupin", "Q2", FILM, "Lupin (film)", "81000000"),
        row("Kingdom", "Q3", SERIES, null, "80180171"),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "missed",
      "missed",
      "missed",
    ]);
  });
});

describe("wikipedia titles", () => {
  it("asks 50 titles a request, each once, and none the API would refuse", () => {
    const titles = Array.from({ length: 120 }, (_, index) => `Film ${index}`);
    const requests = titlesRequests([...titles, "Film 0", "a|b", "#1", " "]);
    expect(requests).toHaveLength(3);
    // The titles, and the one `|` between the two page props asked for.
    expect(requests[0]?.url.split("%7C")).toHaveLength(BATCH + 1);
    expect(requests[0]?.url).toContain("origin=*");
    expect(requests[0]?.headers["Api-User-Agent"]).toContain("grapevine");
  });

  it("follows a normalized title and a redirect to its page", () => {
    const pages = readTitlesAnswer({
      query: {
        normalized: [{ from: "se7en (film)", to: "Se7en (film)" }],
        redirects: [
          { from: "Se7en (film)", to: "Seven (1995 film)" },
          // Into a section of another article: not this thing's page.
          { from: "Some Short", to: "A Director", tofragment: "Shorts" },
        ],
        pages: [
          {
            title: "Seven (1995 film)",
            pageprops: { wikibase_item: "Q190908" },
          },
          { title: "A Director", pageprops: { wikibase_item: "Q5" } },
          {
            title: "Heat",
            pageprops: { wikibase_item: "Q1", disambiguation: "" },
          },
          { title: "No Such Film (film)", missing: true },
        ],
      },
    });
    expect(pages.get("se7en (film)")).toEqual(
      page("Seven (1995 film)", "Q190908"),
    );
    expect(pages.get("Se7en (film)")?.ref).toBe("Q190908");
    expect(pages.get("Seven (1995 film)")?.ref).toBe("Q190908");
    expect(pages.has("Some Short")).toBe(false);
    expect(pages.has("Heat")).toBe(false);
    expect(pages.has("No Such Film (film)")).toBe(false);
  });

  it("reads kinds, the earliest year and authors", () => {
    const read = readFactsAnswer(
      sparqlAnswer([
        {
          item: entity("Q1"),
          title: text("Dune (2021 film)"),
          first: text(2021),
          kinds: text(`${FILM},Q229390`),
        },
        {
          item: entity("Q2"),
          title: text("Devs"),
          began: text(2020),
          kinds: text("Q1259759"),
        },
        {
          item: entity("Q3"),
          title: text("Dune (novel)"),
          kinds: text(NOVEL),
          authors: text("Frank Herbert|Frank Patrick Herbert"),
        },
      ]),
    );
    expect(read.get("Q1")).toEqual(
      facts("Dune (2021 film)", [FILM, "Q229390"], 2021),
    );
    expect(read.get("Q2")?.firstYear).toBe(2020);
    expect(read.get("Q3")?.authors).toEqual([
      "Frank Herbert",
      "Frank Patrick Herbert",
    ]);
  });
});

describe("films by name and year", () => {
  it("guesses the dated page first, and Wikipedia's lower-case short words", () => {
    expect(filmGuesses(film("Dune", 2021))).toEqual([
      "Dune (2021 film)",
      "Dune (film)",
      "Dune (miniseries)",
      "Dune (TV series)",
      "Dune",
    ]);
    expect(filmGuesses(film("Stranger Than Fiction", 2006))).toContain(
      "Stranger than Fiction (2006 film)",
    );
    expect(filmGuesses(film("BEEF", 2023))).toContain("Beef (TV series)");
    expect(filmGuesses(film("M", 1931))).toHaveLength(5);
  });

  const pages = new Map([
    ["Dune (2021 film)", page("Dune (2021 film)", "Q2021")],
    ["Dune (1984 film)", page("Dune (1984 film)", "Q1984")],
    ["Dune (film)", page("Dune (1984 film)", "Q1984")],
    ["Dune (miniseries)", page("Frank Herbert's Dune", "Q2000")],
    ["Dune", page("Dune (novel)", "Q9000")],
    ["Suspiria", page("Suspiria", "Q1977")],
    ["Suspiria (2018 film)", page("Suspiria (2018 film)", "Q2018")],
    ["Parasite", page("Parasite (2019 film)", "Q9001")],
    ["Twins (film)", page("Twins (1988 film)", "Q9002")],
    ["Twins", page("Twins (1989 film)", "Q9003")],
    ["Shameless (TV series)", page("Shameless (British TV series)", "Q9004")],
    ["Devs (miniseries)", page("Devs", "Q9005")],
  ]);
  const known = new Map([
    ["Q2021", facts("Dune (2021 film)", [FILM], 2021)],
    ["Q1984", facts("Dune (1984 film)", [FILM], 1984)],
    ["Q2000", facts("Frank Herbert's Dune", ["Q1259759"], 2000)],
    ["Q9000", facts("Dune (novel)", [NOVEL])],
    ["Q1977", facts("Suspiria", [FILM], 1977)],
    ["Q2018", facts("Suspiria (2018 film)", [FILM], 2018)],
    ["Q9001", facts("Parasite (2019 film)", [FILM], 2019)],
    ["Q9002", facts("Twins (1988 film)", [FILM], 1988)],
    ["Q9003", facts("Twins (1989 film)", [FILM], 1989)],
    ["Q9004", facts("Shameless (British TV series)", [SERIES])],
    ["Q9005", facts("Devs", ["Q1259759"], 2020)],
  ]);
  const pick = (title: string, year: number | null) =>
    names(pickFilm(film(title, year), pages, known));

  it("lands a remake on its own year", () => {
    expect(pick("Dune", 2021)).toEqual(["dune (2021 film)"]);
    expect(pick("Dune", 1984)).toEqual(["dune (1984 film)"]);
    expect(pick("Suspiria", 1977)).toEqual(["suspiria"]);
    expect(pick("Suspiria", 2018)).toEqual(["suspiria (2018 film)"]);
  });

  it("takes a year one off, for a festival premiere", () => {
    expect(pick("Parasite", 2020)).toEqual(["parasite (2019 film)"]);
    expect(pick("Parasite", 2021)).toEqual([]);
  });

  it("is not a book that shares the title", () => {
    expect(pick("Dune", 1965)).toEqual([]);
  });

  it("misses two films at the same distance, and never guesses", () => {
    expect(pickFilm(film("Twins", null), pages, known).kind).toBe("missed");
  });

  it("takes a miniseries by its year, and no series without one", () => {
    expect(pick("Devs", 2020)).toEqual(["devs"]);
    expect(pick("Dune", 2000)).toEqual(["frank herbert's dune"]);
    // A short with no page must not land on a series of its name.
    expect(pick("Shameless", 2012)).toEqual([]);
  });

  it("reads the label query for a row no page was found for", () => {
    const rows = [
      film("WALL·E", 2008),
      film("Heat", 1995),
      film("Nothing", 2000),
    ];
    const binding = (
      title: string,
      year: number,
      item: string,
      page: string,
      first: number,
    ) => ({
      t: text(title),
      y: text(year),
      item: entity(item),
      title: text(page),
      first: text(first),
    });
    const outcomes = readFilmLabelAnswer(
      rows,
      sparqlAnswer([
        binding("WALL·E", 2008, "Q1", "WALL-E", 2008),
        binding("Heat", 1995, "Q2", "Heat (1995 film)", 1995),
        // A year off: the exact year wins.
        binding("Heat", 1995, "Q3", "Natural Justice: Heat", 1996),
      ]),
    );
    expect(outcomes.map(names)).toEqual([["wall-e"], ["heat (1995 film)"], []]);
  });
});

describe("books", () => {
  it("guesses the title whole and without its subtitle", () => {
    expect(
      bookGuesses(
        book("Sapiens: A Brief History of Humankind", "Yuval Noah Harari"),
      ),
    ).toEqual([
      "Sapiens: A Brief History of Humankind (Harari novel)",
      "Sapiens: A Brief History of Humankind (novel)",
      "Sapiens: A Brief History of Humankind (book)",
      "Sapiens: A Brief History of Humankind",
      "Sapiens (Harari novel)",
      "Sapiens (novel)",
      "Sapiens (book)",
      "Sapiens",
    ]);
  });

  const pages = new Map([
    ["Dune (novel)", page("Dune (novel)", "Q9000")],
    ["Dune", page("Dune (franchise)", "Q9006")],
    ["Dune (book)", page("Dune (2021 film)", "Q9007")],
    ["The Hunger Games (novel)", page("The Hunger Games (novel)", "Q9008")],
    ["The Hunger Games", page("The Hunger Games", "Q9009")],
    ["Macbeth", page("Macbeth", "Q9010")],
    ["Crime and Punishment", page("Crime and Punishment", "Q9011")],
    ["It (novel)", page("It (novel)", "Q9012")],
    ["Emma (novel)", page("Emma (novel)", "Q9013")],
  ]);
  const known = new Map([
    ["Q9000", facts("Dune (novel)", [NOVEL], null, ["Frank Herbert"])],
    ["Q9006", facts("Dune (franchise)", ["Q196600"], null, [])],
    // An adaptation can name the novelist as its author.
    ["Q9007", facts("Dune (2021 film)", [FILM], 2021, ["Frank Herbert"])],
    [
      "Q9008",
      facts("The Hunger Games (novel)", [NOVEL], null, ["Suzanne Collins"]),
    ],
    [
      "Q9009",
      facts("The Hunger Games", ["Q1667921"], null, ["Suzanne Collins"]),
    ],
    ["Q9010", facts("Macbeth", ["Q25379"], null, ["William Shakespeare"])],
    [
      "Q9011",
      facts("Crime and Punishment", [NOVEL], null, [
        "Fyodor Dostoyevsky",
        "Fyodor Dostoevsky",
        "Фёдор Достоевский",
      ]),
    ],
    ["Q9012", facts("It (novel)", [NOVEL], null, ["Stephen King"])],
    ["Q9013", facts("Emma (novel)", [NOVEL], null, ["Jane Austen"])],
  ]);
  const pick = (title: string, author: string) =>
    names(pickBook(book(title, author), pages, known));

  it("is the book by the file's author, and never the film of it", () => {
    expect(pick("Dune", "Frank Herbert")).toEqual(["dune (novel)"]);
  });

  it("takes the book over the series it opens", () => {
    expect(pick("The Hunger Games", "Suzanne Collins")).toEqual([
      "the hunger games (novel)",
    ]);
  });

  it("matches an author by any name they go by, folded", () => {
    expect(pick("Crime and Punishment", "Fyodor Dostoevsky")).toEqual([
      "crime and punishment",
    ]);
    expect(pick("It", "STEPHEN  KING")).toEqual(["it (novel)"]);
    // A middle initial or a suffix one side has and the other has not.
    expect(pick("It", "Stephen E. King Jr.")).toEqual(["it (novel)"]);
    expect(pick("It", "Stephen Kingsley")).toEqual([]);
  });

  it("takes something written that is not filed as a book", () => {
    expect(pick("Macbeth", "William Shakespeare")).toEqual(["macbeth"]);
  });

  it("imports no book whose author does not match", () => {
    expect(pick("Emma", "Alexander McCall Smith")).toEqual([]);
    expect(pick("It", "")).toEqual([]);
  });

  it("reads the label query, a book before anything else written", () => {
    const binding = (
      title: string,
      item: string,
      author: string,
      kinds: string,
      filed: string | null,
    ) => ({
      t: text(title),
      item: entity(item),
      authorName: text(author),
      kinds: text(kinds),
      ...(filed === null ? {} : { title: text(filed) }),
    });
    const filed = readBookLabelAnswer(
      [
        book("Kitchen Confidential", "Anthony Bourdain"),
        book("Jaws", "Peter Benchley"),
      ],
      sparqlAnswer([
        binding(
          "Kitchen Confidential",
          "Q1",
          "Anthony Bourdain",
          "Q571",
          "Kitchen Confidential (book)",
        ),
        binding(
          "Kitchen Confidential",
          "Q1",
          "Anthony Michael Bourdain",
          "Q571",
          "Kitchen Confidential (book)",
        ),
        binding("Jaws", "Q2", "Peter Benchley", NOVEL, "Jaws (novel)"),
        binding("Jaws", "Q3", "Peter Benchley", FILM, "Jaws (film)"),
        binding("Jaws", "Q4", "Somebody Else", NOVEL, "Jaws (other novel)"),
        binding("Jaws", "Q5", "Peter Benchley", NOVEL, null),
      ]),
    );
    expect(filed).toEqual([
      [{ ref: "Q1", title: "Kitchen Confidential (book)" }],
      [{ ref: "Q2", title: "Jaws (novel)" }],
    ]);
  });
});

describe("places", () => {
  const place = (name: string, lat = 51.5194, lon = -0.127): Place => ({
    kind: "place",
    name,
    lat,
    lon,
    value: 1,
  });
  const feature = (
    name: string,
    id: number,
    lat: number,
    lon: number,
    kind: [string, string] = ["tourism", "museum"],
  ) => ({
    geometry: { coordinates: [lon, lat] },
    properties: {
      osm_type: "N",
      osm_id: id,
      osm_key: kind[0],
      osm_value: kind[1],
      name,
      city: "London",
      district: "Bloomsbury",
    },
  });

  it("sends the name, a position rounded to about a kilometre and a box around it", () => {
    const request = placeRequest(
      "Tartine Bakery",
      place("Tartine Bakery", 37.76142, -122.42413),
    );
    expect(request.url).toBe(
      "https://photon.komoot.io/api/?q=Tartine%20Bakery&lat=37.76&lon=-122.42&bbox=-122.44,37.74,-122.40,37.78&limit=10&lang=en",
    );
    expect(placeQueries("The British Museum")).toEqual([
      "The British Museum",
      "British Museum",
      "British",
    ]);
    expect(placeQueries("Puttshack - Nashville")).toEqual([
      "Puttshack - Nashville",
      "Puttshack",
    ]);
    expect(placeQueries("Joe's Pizza")).toEqual(["Joe's Pizza", "Joe's"]);
    expect(placeQueries("Avis")).toEqual(["Avis"]);
  });

  it("takes a rateable place within reach whose name is the review's", () => {
    const outcome = pickPlace(place("The British Museum"), {
      features: [
        feature("The British Museum Afternoon Tea", 2, 51.5196, -0.1268, [
          "amenity",
          "cafe",
        ]),
        feature("British Museum", 1, 51.5195, -0.1269),
      ],
    });
    expect(outcome).toMatchObject({ kind: "found", candidate: { ref: "n1" } });
    expect(names(outcome)).toEqual(["british museum (bloomsbury, london)"]);
  });

  it("takes the one place whose name begins the review's", () => {
    expect(
      pickPlace(place("Dishoom Covent Garden"), {
        features: [
          feature("Dishoom", 5, 51.5194, -0.127, ["amenity", "restaurant"]),
        ],
      }),
    ).toMatchObject({ kind: "found", candidate: { ref: "n5" } });
  });

  it("misses when a name holds only some of the review's words, or all and more", () => {
    const kinds = (name: string, found: string) =>
      pickPlace(place(name), {
        features: [feature(found, 2, 51.5196, -0.1268, ["amenity", "cafe"])],
      }).kind;
    expect(kinds("Tom's Donuts", "Donuts")).toBe("missed");
    expect(
      kinds("The British Museum", "The British Museum Afternoon Tea"),
    ).toBe("missed");
    // Two branches begin the name: not guessed.
    expect(
      pickPlace(place("Blue Bottle Coffee Hayes Valley"), {
        features: [
          feature("Blue Bottle Coffee", 3, 51.5194, -0.127, [
            "amenity",
            "cafe",
          ]),
          feature("Blue Bottle", 4, 51.5195, -0.127, ["amenity", "cafe"]),
        ],
      }).kind,
    ).toBe("missed");
  });

  it("misses a place too far off, of no rateable kind, or of another name", () => {
    const outcome = (found: object) =>
      pickPlace(place("British Museum"), { features: [found] }).kind;
    expect(outcome(feature("British Museum", 1, 51.53, -0.127))).toBe("missed");
    expect(
      outcome(
        feature("British Museum", 1, 51.5195, -0.1269, ["highway", "bus_stop"]),
      ),
    ).toBe("missed");
    expect(
      outcome(
        feature("Museum Tavern", 1, 51.5195, -0.1269, ["amenity", "pub"]),
      ),
    ).toBe("missed");
    expect(pickPlace(place("British Museum"), null).kind).toBe("missed");
  });

  it("takes the nearer of one place mapped twice", () => {
    const outcome = pickPlace(place("Ghibli Museum"), {
      features: [
        feature("Ghibli Museum", 8, 51.52, -0.127),
        feature("Ghibli Museum", 9, 51.51941, -0.127),
      ],
    });
    expect(outcome).toMatchObject({ kind: "found", candidate: { ref: "n9" } });
  });
});

describe("matchRows", () => {
  const rows: ImportRow[] = Array.from({ length: 120 }, (_, index) => ({
    kind: "imdb",
    imdbId: `tt${index + 1}`,
    title: `Film ${index + 1}`,
    year: 2000,
    value: 1,
  }));
  const answer = (request: MatchRequest) =>
    sparqlAnswer(
      [...decodeURIComponent(request.body ?? "").matchAll(/"(tt\d+)"/gu)]
        // Every third id has no page.
        .filter(([, id]) => Number(id?.slice(2)) % 3 !== 0)
        .map(([, id]) => ({
          imdb: text(id ?? ""),
          item: entity(`Q${id?.slice(2)}`),
          p31: entity(FILM),
          title: text(`Film ${id?.slice(2)}`),
        })),
    );

  it("matches a batch at a time and says how far it is", async () => {
    const asked: MatchRequest[] = [];
    const steps: number[] = [];
    const ask: Ask = async (request) => {
      asked.push(request);
      return answer(request);
    };
    const { outcomes, stopped } = await matchRows(rows, ask, (done) =>
      steps.push(done),
    );
    expect(stopped).toBe(false);
    expect(asked).toHaveLength(3);
    expect(steps).toEqual([50 / 120, 100 / 120, 1]);
    expect(
      outcomes.filter((outcome) => outcome?.kind === "found"),
    ).toHaveLength(80);
    expect(
      outcomes.filter((outcome) => outcome?.kind === "missed"),
    ).toHaveLength(40);
  });

  it("stops when the service does, and takes up where it stopped", async () => {
    let calls = 0;
    const failing: Ask = async (request) => {
      calls += 1;
      if (calls === 2) throw new Error("unreachable");
      return answer(request);
    };
    const first = await matchRows(rows, failing);
    expect(first.stopped).toBe(true);
    expect(first.outcomes.filter((outcome) => outcome !== null)).toHaveLength(
      50,
    );

    const asked: MatchRequest[] = [];
    const second = await matchRows(
      rows,
      async (request) => {
        asked.push(request);
        return answer(request);
      },
      () => {},
      first.outcomes,
    );
    expect(second.stopped).toBe(false);
    expect(asked).toHaveLength(2);
    expect(second.outcomes.every((outcome) => outcome !== null)).toBe(true);
  });

  it("finds a place under its bare name, past what only resembles it", async () => {
    const museum = {
      kind: "place",
      name: "The British Museum",
      lat: 51.5194,
      lon: -0.127,
      value: 1,
    } as const;
    const feature = (name: string, id: number, kind: string) => ({
      geometry: { coordinates: [-0.1269, 51.5195] },
      properties: {
        osm_type: "N",
        osm_id: id,
        osm_key: kind === "museum" ? "tourism" : "amenity",
        osm_value: kind,
        name,
      },
    });
    const { outcomes } = await matchRows([museum], async (request) =>
      new URL(request.url).searchParams.get("q") === "British Museum"
        ? { features: [feature("British Museum", 1, "museum")] }
        : {
            features: [feature("The British Museum Afternoon Tea", 2, "cafe")],
          },
    );
    expect(outcomes[0]).toMatchObject({
      kind: "found",
      candidate: { ref: "n1" },
    });
  });

  it("asks about one place at a time, the bare name second", async () => {
    const asked: string[] = [];
    const { outcomes } = await matchRows(
      [
        {
          kind: "place",
          name: "The Spotted Pig",
          lat: 40.7356,
          lon: -74.0067,
          value: 1,
        },
      ],
      async (request) => {
        asked.push(new URL(request.url).searchParams.get("q") ?? "");
        return { features: [] };
      },
    );
    expect(asked).toEqual(["The Spotted Pig", "Spotted Pig", "Spotted"]);
    expect(outcomes).toEqual([{ kind: "missed" }]);
  });
});

describe("kinds", () => {
  // A match of a kind the add button would not offer would be a thing with
  // two rules.
  it.each([
    "Q11424",
    "Q24862",
    "Q17517379",
    "Q1259759",
    "Q5398426",
    "Q117467246",
    "Q1261214",
    "Q3464665",
  ])("%p is rateable", (kind) => {
    expect(isRateableKind([kind])).toBe(true);
  });
});
