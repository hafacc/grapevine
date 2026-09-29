// The link registry and its two adapters, against answers recorded from
// Wikipedia and Photon on 2026-09-26, and Wikidata's kinds for the same pages
// on 2026-09-28, trimmed to the three properties read (`fixtures/lookup.json`).
// No test here touches the network.

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type Candidate,
  isGoodMatch,
  isRateable,
  isReference,
  MAX_CHECKED,
  MAX_SHOWN,
  pickShown,
  placeQualifier,
  referenceUrl,
  roundPosition,
  SOURCES,
  type SourceKey,
  sourceOf,
  titleToName,
  toCheck,
  type WikidataClaim,
} from "../src/references";

type Recorded = {
  search: unknown;
  prefix: unknown;
  photon: unknown;
  kinds: unknown;
};
const RECORDED = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "lookup.json"), "utf8"),
) as Record<string, Recorded>;

function source(key: SourceKey) {
  const found = sourceOf(key);
  if (found === null) throw new Error(`no source ${key}`);
  return found;
}

function recorded(typed: string): Recorded {
  const found = RECORDED[typed];
  if (found === undefined) throw new Error(`nothing recorded for ${typed}`);
  return found;
}

// Before the kind check, as the searches answer.
function searched(typed: string): readonly Candidate[] {
  const { search, prefix } = recorded(typed);
  return source("wikidata").parse([search, prefix]);
}

// What `lookUp` hands `pickShown`: Wikipedia's matches after the kind check.
function candidates(typed: string): Map<SourceKey, readonly Candidate[]> {
  const check = source("wikidata").check;
  if (check === undefined) throw new Error("no kind check");
  return new Map<SourceKey, readonly Candidate[]>([
    [
      "wikidata",
      check.keep(toCheck(typed, searched(typed)), [recorded(typed).kinds]),
    ],
    ["osm", source("osm").parse([recorded(typed).photon])],
  ]);
}

function shown(typed: string): string[] {
  return pickShown(typed, candidates(typed)).map(
    (candidate) => candidate.names[0] ?? "",
  );
}

describe("the registry", () => {
  it("has one entry per key", () => {
    const keys = SOURCES.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // A link is the id spliced into a fixed URL.
  it("takes no id that could leave its URL", () => {
    for (const entry of SOURCES) {
      for (const bad of ["", "/", "?", "#", ":", "..", " ", "%2f"]) {
        expect(isReference(entry.key, `${bad}`)).toBe(false);
      }
    }
    expect(isReference("wikidata", "Q42/../x")).toBe(false);
    expect(isReference("osm", "n1?x")).toBe(false);
  });

  it("checks each source's format", () => {
    expect(isReference("wikidata", "Q190192")).toBe(true);
    expect(isReference("wikidata", "Q0")).toBe(false);
    expect(isReference("wikidata", "q190192")).toBe(false);
    expect(isReference("osm", "n931799207")).toBe(true);
    expect(isReference("osm", "w1")).toBe(true);
    expect(isReference("osm", "r1")).toBe(true);
    expect(isReference("osm", "x1")).toBe(false);
    expect(isReference("imdb", "tt1")).toBe(false);
  });

  it("builds each link from the id", () => {
    expect(referenceUrl({ source: "wikidata", ref: "Q190192" })).toBe(
      "https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q190192",
    );
    expect(referenceUrl({ source: "osm", ref: "n931799207" })).toBe(
      "https://www.openstreetmap.org/node/931799207",
    );
    expect(referenceUrl({ source: "osm", ref: "w5" })).toBe(
      "https://www.openstreetmap.org/way/5",
    );
    expect(referenceUrl({ source: "osm", ref: "r5" })).toBe(
      "https://www.openstreetmap.org/relation/5",
    );
    expect(referenceUrl({ source: "osm", ref: "x5" })).toBeNull();
  });

  it("credits OpenStreetMap, and only OpenStreetMap", () => {
    expect(source("osm").attribution?.text).toBe(
      "© OpenStreetMap contributors",
    );
    expect(source("wikidata").attribution).toBeNull();
  });
});

// The database's copy of the patterns is a row per source in the newest
// migration that fills `private.ref_sources`.
describe("the database's copy of the formats", () => {
  const MIGRATIONS = join(
    import.meta.dir,
    "..",
    "..",
    "supabase",
    "migrations",
  );
  const sql = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .filter((text) => text.includes("insert into private.ref_sources"))
    .join("\n");

  it("carries every source with the same pattern", () => {
    for (const entry of SOURCES) {
      const row = new RegExp(
        `\\('${entry.key}',\\s*'${entry.pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}'\\)`,
      );
      expect(sql).toMatch(row);
    }
  });
});

describe("titleToName", () => {
  it("keeps a colon and a parenthetical", () => {
    expect(titleToName("Star Wars: A New Hope")).toBe("star wars: a new hope");
    expect(titleToName("Dune (novel)")).toBe("dune (novel)");
  });

  it("drops trademark signs and a # at the front of a word", () => {
    expect(titleToName("Häagen-Dazs™")).toBe("häagen-dazs");
    expect(titleToName("Pier #39")).toBe("pier 39");
  });

  it("offers nothing the name rules refuse", () => {
    expect(titleToName("!Women Art Revolution")).toBeNull();
    expect(titleToName("x".repeat(129))).toBeNull();
    expect(titleToName("   ")).toBeNull();
  });
});

describe("placeQualifier", () => {
  it("is the neighbourhood and the city", () => {
    expect(
      placeQualifier({
        name: "Joe's Pizza",
        locality: "University Village",
        district: "Manhattan",
        city: "New York",
        state: "New York",
      }),
    ).toEqual(["University Village", "New York"]);
  });

  it("is the two nearest wider areas without a neighbourhood, and never the name", () => {
    expect(
      placeQualifier({
        name: "Paris",
        state: "Île-de-France",
        country: "France",
      }),
    ).toEqual(["Île-de-France", "France"]);
    expect(
      placeQualifier({ name: "Tokyo", city: "Tokyo", country: "Japan" }),
    ).toEqual(["Japan"]);
  });
});

describe("the Wikipedia adapter", () => {
  it("asks both searches, as a browser naming itself", () => {
    const requests = source("wikidata").requests("dune novel", null);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain(
      "generator=search&gsrsearch=dune%20novel",
    );
    expect(requests[1]?.url).toContain("generator=prefixsearch");
    expect(requests[0]?.url).toContain("origin=*");
    expect(requests[0]?.headers["Api-User-Agent"]).toContain("grapevine");
  });

  it("drops disambiguation pages and pages with no Wikidata id", () => {
    const found = searched("dune");
    expect(found.map((candidate) => candidate.ref)).not.toContain("Q114103");
    expect(found.every((candidate) => /^Q\d+$/.test(candidate.ref))).toBe(true);
    const novel = found.find((candidate) => candidate.ref === "Q190192");
    expect(novel?.names).toEqual(["dune (novel)"]);
    expect(novel?.description).toBe(
      "1965 science fiction novel by frank herbert",
    );
  });

  it("interleaves the two searches without repeats", () => {
    const refs = searched("dune").map((candidate) => candidate.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("forgives a typo and a half-typed word", () => {
    expect(shown("radiohed")[0]).toBe("radiohead");
    expect(shown("tirmisu")[0]).toBe("tiramisu");
    expect(shown("everything everywher")[0]).toBe(
      "everything everywhere all at once",
    );
  });

  it("matches a redirect that led to the page", () => {
    expect(shown("star wars a new hope")).toContain("star wars (film)");
  });

  it("parses nothing out of a failed or empty answer", () => {
    expect(source("wikidata").parse([null, undefined])).toEqual([]);
    expect(source("wikidata").parse([{}, { query: {} }])).toEqual([]);
  });
});

describe("the kind check", () => {
  const check = source("wikidata").check;
  if (check === undefined) throw new Error("no kind check");

  it("asks Wikidata once, for the matches' ids", () => {
    const asked = toCheck("dune", searched("dune"));
    const requests = check.requests(asked);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("action=wbgetentities");
    expect(requests[0]?.url).toContain("origin=*");
    expect(requests[0]?.url).toContain(
      asked.map((candidate) => candidate.ref).join("%7C"),
    );
  });

  it("offers a book or a film, never the landform", () => {
    const names = shown("dune");
    expect(names).toContain("dune (novel)");
    expect(names).toContain("dune (2021 film)");
    expect(names).not.toContain("dune");
    expect(names).not.toContain("list of dune characters");
  });

  it("offers a food by what it is a kind of", () => {
    expect(isRateable({ P279: [claim("Q2095")] })).toBe(true);
    expect(isRateable({ P31: [claim("Q2095")] })).toBe(true);
  });

  it("offers a person only as a performer", () => {
    expect(isRateable({ P31: [claim("Q5")], P106: [claim("Q177220")] })).toBe(
      true,
    );
    expect(isRateable({ P31: [claim("Q5")], P106: [claim("Q36180")] })).toBe(
      false,
    );
  });

  it("does not count a kind of place's subclasses as places", () => {
    // "ramen shop" is a subclass of restaurant, and is nowhere.
    expect(isRateable({ P279: [claim("Q11707")] })).toBe(false);
    expect(isRateable({ P31: [claim("Q11707")] })).toBe(true);
  });

  it("ignores a deprecated claim", () => {
    expect(isRateable({ P31: [claim("Q11424", "deprecated")] })).toBe(false);
  });

  it("keeps nothing when the kinds could not be read", () => {
    expect(check.keep(searched("dune"), [null])).toEqual([]);
    expect(check.keep(searched("dune"), [{}])).toEqual([]);
  });

  it("asks about at most MAX_CHECKED, and only what matched every word", () => {
    const asked = toCheck("dune", searched("dune"));
    expect(asked.length).toBeLessThanOrEqual(MAX_CHECKED);
    expect(asked.every((candidate) => isGoodMatch("dune", candidate))).toBe(
      true,
    );
  });
});

function claim(id: string, rank = "normal"): WikidataClaim {
  return { rank, mainsnak: { datavalue: { value: { id } } } };
}

describe("the Photon adapter", () => {
  it("sends a rounded position, and none when it has none", () => {
    const [near] = source("osm").requests("joe's pizza", {
      lat: 40.730612,
      lon: -73.986634,
    });
    expect(near?.url).toContain("&lat=40.73&lon=-73.99");
    expect(near?.url).toContain("lang=en");
    const [far] = source("osm").requests("joe's pizza", null);
    expect(far?.url).not.toContain("lat=");
  });

  it("names a place with where it is, and has longer names to fall back on", () => {
    const joes = (candidates("joe's pizza").get("osm") ?? []).find(
      (candidate) => candidate.ref === "n931799207",
    );
    expect(joes?.names).toEqual([
      "joe's pizza (university village, new york)",
      "joe's pizza (carmine street, university village, new york)",
      "joe's pizza (7 carmine street, university village, new york)",
    ]);
    expect(joes?.description).toBe("restaurant · carmine street, new york");
  });

  it("matches whole words only, so a far-off look-alike is not offered", () => {
    const shownPlaces = pickShown("tirmisu", candidates("tirmisu")).filter(
      (candidate) => candidate.source === "osm",
    );
    expect(shownPlaces).toEqual([]);
  });

  it("offers somewhere to go, never a village or a peak", () => {
    const parsed = source("osm").parse([
      {
        features: [
          ["amenity", "restaurant", 1],
          ["place", "village", 2],
          ["natural", "peak", 3],
          ["shop", "books", 4],
          ["amenity", "parking", 5],
        ].map(([key, value, id]) => ({
          properties: {
            osm_type: "N",
            osm_id: id,
            osm_key: key,
            osm_value: value,
            name: "dune",
          },
        })),
      },
    ]);
    expect(parsed.map((candidate) => candidate.ref)).toEqual(["n1", "n4"]);
  });

  it("finds a place by the area it is in", () => {
    expect(shown("joes pizza new york")).toContain(
      "joe's pizza (university village, new york)",
    );
    expect(
      shown("ichiran shibuya").some((name) => name.startsWith("ichiran")),
    ).toBe(true);
  });
});

describe("what is offered", () => {
  it("is nothing for something personal", () => {
    for (const typed of [
      "mom's lasagna",
      "grandma's apple pie",
      "friday trivia night",
    ]) {
      expect(shown(typed)).toEqual([]);
    }
  });

  it("reads punctuation in a title as a break, and as nothing", () => {
    const [novel] = candidates("dune").get("wikidata") ?? [];
    if (novel === undefined) throw new Error("no candidate");
    const hyphenated: Candidate = {
      ...novel,
      names: ["moby-dick"],
      matchText: source("wikidata")
        .parse([
          {
            query: {
              pages: [
                {
                  title: "Moby-Dick",
                  index: 1,
                  description: "",
                  pageprops: { wikibase_item: "Q174596" },
                },
              ],
            },
          },
        ])
        .map((candidate) => candidate.matchText)
        .join(" "),
    };
    expect(isGoodMatch("moby dick", hyphenated)).toBe(true);
    expect(isGoodMatch("moby-dick", hyphenated)).toBe(true);
    expect(isGoodMatch("mobydick", hyphenated)).toBe(true);
    expect(shown("joes pizza new york")).toContain(
      "joe's pizza (university village, new york)",
    );
  });

  it("needs every typed word", () => {
    const [novel] = (candidates("dune").get("wikidata") ?? []).filter(
      (candidate) => candidate.ref === "Q190192",
    );
    if (novel === undefined) throw new Error("no novel");
    expect(isGoodMatch("dune", novel)).toBe(true);
    expect(isGoodMatch("dune herbert", novel)).toBe(true);
    expect(isGoodMatch("dune lasagna", novel)).toBe(false);
    expect(isGoodMatch("", novel)).toBe(false);
  });

  it("is at most five, Wikipedia's three and then two places", () => {
    const picked = pickShown("cafe de flore", candidates("cafe de flore"));
    expect(picked.length).toBeLessThanOrEqual(MAX_SHOWN);
    const firstPlace = picked.findIndex(
      (candidate) => candidate.source === "osm",
    );
    if (firstPlace >= 0) expect(firstPlace).toBeLessThanOrEqual(3);
    expect(picked.map((candidate) => candidate.names[0])).toContain(
      "café de flore",
    );
  });
});

describe("roundPosition", () => {
  it("keeps two decimals, about a kilometre", () => {
    expect(roundPosition({ lat: 37.774929, lon: -122.419416 })).toEqual({
      lat: 37.77,
      lon: -122.42,
    });
  });
});
