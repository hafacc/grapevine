import { describe, expect, it } from "bun:test";
import { deflateRawSync } from "node:zlib";
import type { ImportRow, Outcome, Reading } from "grapevine-shared/import";
import type { Candidate } from "grapevine-shared/references";
import {
  canImport,
  createAsk,
  IMPORT_CHUNK,
  ImportStopped,
  type ImportThing,
  isImportClosed,
  orderThings,
  readImportCatalog,
  readImportFile,
  resolveImport,
  type Saved,
  saveImport,
} from "../src/lib/utils/import";
import type { CatalogView } from "../src/lib/utils/references";

const film = (title: string, value: 1 | -1 = 1): ImportRow => ({
  kind: "film",
  title,
  year: 2000,
  value,
});

const candidate = (ref: string, ...names: string[]): Candidate => ({
  source: ref.startsWith("Q") ? "wikidata" : "osm",
  ref,
  names,
  description: `about ${names[0]}`,
  matchText: "",
});

const found = (ref: string, ...names: string[]): Outcome => ({
  kind: "found",
  candidate: candidate(ref, ...names),
});

function catalog(
  names: string[],
  links: Record<string, string> = {},
): CatalogView {
  const linkOfName = new Map(
    Object.entries(links).map(([name, ref]) => [
      name,
      { source: ref.startsWith("Q") ? "wikidata" : "osm", ref } as const,
    ]),
  );
  return {
    names: new Set([...names, ...Object.keys(links)]),
    linkOfName,
    nameOfLink: new Map(
      [...linkOfName].map(([name, link]) => [
        `${link.source}\u0000${link.ref}`,
        name,
      ]),
    ),
  };
}

describe("resolveImport", () => {
  it("puts a thumb on the thing that holds the link, whatever it is called", () => {
    expect(
      resolveImport(
        [film("Alien", -1)],
        [found("Q103569", "alien (film)")],
        catalog([], { "alien (1979 film)": "Q103569" }),
        {},
      ),
    ).toEqual([
      {
        itemId: "alien (1979 film)",
        reference: { source: "wikidata", ref: "Q103569" },
        value: -1,
        known: true,
      },
    ]);
  });

  it("names a new thing as the add button would", () => {
    const things = resolveImport(
      [film("Dune")],
      [found("Q60834962", "dune (2021 film)")],
      catalog([]),
      {},
    );
    expect(things[0]).toMatchObject({
      itemId: "dune (2021 film)",
      known: false,
    });
  });

  it("links a name that is here with no link", () => {
    const things = resolveImport(
      [film("Heat")],
      [found("Q42198", "heat (1995 film)")],
      catalog(["heat (1995 film)"]),
      {},
    );
    expect(things[0]).toMatchObject({
      itemId: "heat (1995 film)",
      known: true,
    });
  });

  it("leaves out a name that holds a different link, and a place tries its longer name", () => {
    const things = resolveImport(
      [
        film("Solaris"),
        { kind: "place", name: "Joe's Pizza", lat: 1, lon: 1, value: 1 },
      ],
      [
        found("Q2", "solaris"),
        found("n2", "joe's pizza", "joe's pizza (carmine street)"),
      ],
      catalog([], { solaris: "Q1", "joe's pizza": "n1" }),
      {},
    );
    expect(things.map((thing) => thing.itemId)).toEqual([
      "joe's pizza (carmine street)",
    ]);
  });

  it("leaves out what the viewer already rated, by the thing and not the file's name", () => {
    expect(
      resolveImport(
        [film("Paddington 2"), film("Alien")],
        [found("Q5", "paddington 2"), found("Q103569", "alien (film)")],
        catalog([], { "alien (1979 film)": "Q103569" }),
        { "paddington 2": { "": -1 }, "alien (1979 film)": { "": 1 } },
      ),
    ).toEqual([]);
  });

  it("counts a thumb on only an attribute as not rated", () => {
    expect(
      resolveImport(
        [film("Heat")],
        [found("Q42198", "heat (1995 film)")],
        catalog(["heat (1995 film)"]),
        { "heat (1995 film)": { tense: 1 } },
      ),
    ).toHaveLength(1);
  });

  it("saves nothing for a miss or a row not reached", () => {
    expect(
      resolveImport(
        [film("A Trip to the Dentist"), film("Unreached")],
        [{ kind: "missed" }, null],
        catalog([]),
        {},
      ),
    ).toEqual([]);
  });

  it("keeps one thumb for two rows that are one thing", () => {
    const things = resolveImport(
      [film("Gangs of Wasseypur", 1), film("Gangs of Wasseypur 2", -1)],
      [found("Q50", "gangs of wasseypur"), found("Q50", "gangs of wasseypur")],
      catalog([]),
      {},
    );
    expect(things.map((thing) => thing.value)).toEqual([1]);
  });
});

describe("orderThings", () => {
  const thing = (itemId: string, value: 1 | -1, known: boolean): ImportThing => ({
    itemId,
    reference: { source: "wikidata", ref: "Q1" },
    value,
    known,
  });

  it("puts the viewer's list first, then the catalog, then new names, a no before a yes", () => {
    const ordered = orderThings(
      [
        thing("new yes", 1, false),
        thing("catalog yes", 1, true),
        thing("list yes", 1, true),
        thing("new no", -1, false),
        thing("list no", -1, true),
        thing("catalog no", -1, true),
        thing("new yes two", 1, false),
      ],
      new Set(["list yes", "list no"]),
    );
    expect(ordered.map((entry) => entry.itemId)).toEqual([
      "list no",
      "list yes",
      "catalog no",
      "catalog yes",
      "new no",
      "new yes",
      "new yes two",
    ]);
  });
});

describe("readImportCatalog", () => {
  it("reads the catalog a chunk at a time and merges the answers", async () => {
    const outcomes: Outcome[] = Array.from({ length: 95 }, (_, index) =>
      found(`Q${index + 1}`, `thing ${index + 1}`),
    );
    const sizes: number[] = [];
    const view = await readImportCatalog(outcomes, async (candidates) => {
      sizes.push(candidates.length);
      return catalog(candidates.slice(0, 1).map((entry) => entry.names[0] ?? ""));
    });
    expect(sizes).toEqual([40, 40, 15]);
    expect([...view.names]).toEqual(["thing 1", "thing 41", "thing 81"]);
  });
});

describe("saveImport", () => {
  const things: ImportThing[] = Array.from({ length: 1200 }, (_, index) => ({
    itemId: `café ${index}`,
    reference: { source: "wikidata", ref: `Q${index + 1}` },
    value: index % 2 === 0 ? 1 : -1,
    known: false,
  }));
  const counts = (saved: number): Saved => ({ saved, kept: 0, refused: 0, over: 0 });

  it("sends chunks of 500 with the stripped copy of each name, and adds up the counts", async () => {
    const sent: { source: string; size: number; first: unknown }[] = [];
    const steps: number[] = [];
    const total = await saveImport(
      "letterboxd",
      things,
      (done) => steps.push(done),
      async (source, chunk) => {
        sent.push({ source, size: chunk.length, first: chunk[0] });
        return { saved: chunk.length - 2, kept: 1, refused: 1, over: 0 };
      },
    );
    expect(sent.map((call) => call.size)).toEqual([IMPORT_CHUNK, IMPORT_CHUNK, 200]);
    expect(sent[0]).toMatchObject({
      source: "letterboxd",
      first: { id: "café 0", search_id: "cafe 0", source: "wikidata", ref: "Q1", value: 1 },
    });
    expect(total).toEqual({ saved: 1194, kept: 3, refused: 3, over: 0 });
    expect(steps).toEqual([500 / 1200, 1000 / 1200, 1]);
  });

  it("stops at a chunk that fails, with what was saved and what is left", async () => {
    let calls = 0;
    const save = saveImport("imdb", things, undefined, async (_, chunk) => {
      calls += 1;
      if (calls === 2) throw new TypeError("Failed to fetch");
      return counts(chunk.length);
    });
    const stopped = await save.catch((error) => error);
    expect(stopped).toBeInstanceOf(ImportStopped);
    expect((stopped as ImportStopped).done).toEqual(counts(500));
    expect((stopped as ImportStopped).left).toHaveLength(700);
    expect((stopped as ImportStopped).left[0]?.itemId).toBe("café 500");
  });

  it("tells a closed import from any other failure", () => {
    expect(isImportClosed({ code: "GV429" })).toBe(true);
    expect(isImportClosed({ code: "PT429" })).toBe(false);
    expect(isImportClosed(new Error("x"))).toBe(false);
  });

  it("can import a source never imported, or one still open with room", () => {
    expect(canImport(undefined)).toBe(true);
    expect(canImport({ open: true, thumbsLeft: 3, daysUntilNext: 30 })).toBe(true);
    expect(canImport({ open: true, thumbsLeft: 0, daysUntilNext: 30 })).toBe(false);
    expect(canImport({ open: false, thumbsLeft: 9000, daysUntilNext: 12 })).toBe(false);
  });
});

describe("createAsk", () => {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  it("posts a form with no cookie, and gets JSON back", async () => {
    const seen: RequestInit[] = [];
    const ask = createAsk(async (_, init) => {
      seen.push(init);
      return ok({ fine: true });
    });
    expect(
      await ask({ url: "https://query.wikidata.org/sparql", headers: { Accept: "x" }, body: "query=1" }),
    ).toEqual({ fine: true });
    expect(seen[0]).toMatchObject({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "origin",
      headers: { Accept: "x", "Content-Type": "application/x-www-form-urlencoded" },
    });
  });

  it("makes a request that never answered once more, then gives up", async () => {
    let calls = 0;
    const flaky = createAsk(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return ok(1);
    });
    expect(await flaky({ url: "https://en.wikipedia.org/w/api.php", headers: {} })).toBe(1);
    const dead = createAsk(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(dead({ url: "https://en.wikipedia.org/w/api.php", headers: {} })).rejects.toThrow();
  });

  it("waits out one 429, and stops at a second or at any other refusal", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => {
      waits.push(ms);
    };
    let calls = 0;
    const once = createAsk(async () => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
        : ok("after");
    }, wait);
    expect(await once({ url: "https://en.wikipedia.org/w/api.php", headers: {} })).toBe("after");
    expect(waits).toEqual([2000]);
    const always = createAsk(async () => new Response("", { status: 429 }), wait);
    await expect(always({ url: "https://en.wikipedia.org/w/api.php", headers: {} })).rejects.toThrow();
    const broken = createAsk(async () => new Response("", { status: 504 }), wait);
    await expect(broken({ url: "https://query.wikidata.org/sparql", headers: {} })).rejects.toThrow();
  });

  it("asks Photon no more than once every 1.1 seconds", async () => {
    let clock = 0;
    const waits: number[] = [];
    const ask = createAsk(
      async () => ok({}),
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      () => clock,
    );
    const place = { url: "https://photon.komoot.io/api/?q=a", headers: {} };
    await ask(place);
    clock += 300;
    await ask(place);
    await ask({ url: "https://en.wikipedia.org/w/api.php", headers: {} });
    expect(waits).toEqual([800]);
  });

  it("backs off when Photon refuses, slows down, and carries on", async () => {
    let clock = 0;
    const waits: number[] = [];
    let calls = 0;
    const ask = createAsk(
      async () => {
        calls += 1;
        if (calls === 1) return new Response("", { status: 429 });
        if (calls === 2) throw new TypeError("Failed to fetch");
        return ok({ features: [] });
      },
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      () => clock,
    );
    const place = { url: "https://photon.komoot.io/api/?q=a", headers: {} };
    expect(await ask(place)).toEqual({ features: [] });
    expect(waits).toEqual([10_000, 60_000]);
    // Twice refused, so a quarter of the pace from here on.
    await ask(place);
    expect(waits[2]).toBe(4_400);
  });

  it("stops asking Photon after its last wait", async () => {
    const waits: number[] = [];
    const ask = createAsk(
      async () => new Response("", { status: 503 }),
      async (ms) => {
        waits.push(ms);
      },
      () => 0,
    );
    await expect(
      ask({ url: "https://photon.komoot.io/api/?q=a", headers: {} }),
    ).rejects.toThrow();
    expect(waits.filter((ms) => ms >= 10_000)).toEqual([10_000, 60_000, 300_000]);
  });
});

describe("readImportFile", () => {
  const encoder = new TextEncoder();
  const RATINGS = "Date,Name,Year,Letterboxd URI,Rating\r\n2024-03-02,Amélie,2001,https://boxd.it/2aLg,5\r\n";

  // One deflated entry, as small as a zip gets.
  function zipOf(path: string, text: string): Blob {
    const name = encoder.encode(path);
    const raw = encoder.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(8, 8, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, 8, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, name.length, true);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 1, true);
    end.setUint16(10, 1, true);
    end.setUint32(12, 46 + name.length, true);
    end.setUint32(16, 30 + name.length + data.length, true);
    return new Blob([header, name, data, central, name, end] as BlobPart[]);
  }

  it("reads a bare file by what is in it", async () => {
    const read = await readImportFile(new Blob([RATINGS]));
    expect((read as Reading).source).toBe("letterboxd");
    expect((read as Reading).rows).toHaveLength(1);
  });

  it("reads the wanted entries of a zip", async () => {
    const read = await readImportFile(zipOf("ratings.csv", RATINGS));
    expect((read as Reading).rows[0]).toMatchObject({ title: "Amélie", value: 1 });
  });

  it("reads Spotify's library inside its folder, and no other file of the zip", async () => {
    const library = JSON.stringify({
      tracks: [{ artist: "a", album: "b", track: "c", uri: "spotify:track:6LgJvl0Xdtc73RJ1mmpotq" }],
      albums: [],
      artists: [],
    });
    const read = await readImportFile(zipOf("Spotify Account Data/YourLibrary.json", library));
    expect((read as Reading).source).toBe("spotify");
    expect(await readImportFile(zipOf("Spotify Account Data/Playlist1.json", library))).toBe(
      "unreadable",
    );
  });

  it("says why it cannot read a tgz, a Takeout with no reviews, and anything else", async () => {
    expect(await readImportFile(new Blob([new Uint8Array([0x1f, 0x8b, 8, 0])]))).toBe("tgz");
    expect(await readImportFile(zipOf("Takeout/Drive/notes.txt", "hello"))).toBe(
      "takeout-without-reviews",
    );
    expect(await readImportFile(zipOf("notes.txt", "hello"))).toBe("unreadable");
    expect(await readImportFile(new Blob(["PK\u0003\u0004 but not really"]))).toBe("unreadable");
    expect(await readImportFile(new Blob(["just some words"]))).toBe("unreadable");
  });
});
