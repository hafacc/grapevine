import { describe, expect, it } from "bun:test";
import type { Candidate } from "grapevine-shared/references";
import { readLookupSettings } from "../src/lib/utils/lookup";
import {
  type CatalogView,
  chooseMatch,
  classifyMatches,
  heldReference,
} from "../src/lib/utils/references";

function candidate(
  source: "wikidata" | "osm",
  ref: string,
  ...names: string[]
): Candidate {
  return { source, ref, names, description: "", matchText: names[0] ?? "" };
}

function catalog(
  names: string[],
  linked: [string, "wikidata" | "osm", string][] = [],
): CatalogView {
  return {
    names: new Set(names),
    linkOfName: new Map(
      linked.map(([name, source, ref]) => [name, { source, ref }]),
    ),
    nameOfLink: new Map(
      linked.map(([name, source, ref]) => [`${source}\u0000${ref}`, name]),
    ),
  };
}

// The four states of a match (DESIGN §1.2).
describe("classifyMatches", () => {
  it("opens the thing that already holds the link, under its own name", () => {
    const rows = classifyMatches(
      [candidate("wikidata", "Q190192", "dune (novel)")],
      catalog(["dune"], [["dune", "wikidata", "Q190192"]]),
    );
    expect(rows).toEqual([
      expect.objectContaining({ kind: "existing", itemId: "dune" }),
    ]);
  });

  it("offers a free name as a new thing", () => {
    const rows = classifyMatches(
      [candidate("wikidata", "Q190192", "dune (novel)")],
      catalog([]),
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({ kind: "free", itemId: "dune (novel)" }),
    );
  });

  it("asks about a name that is here without a link", () => {
    const rows = classifyMatches(
      [candidate("wikidata", "Q25391", "dune")],
      catalog(["dune"]),
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({ kind: "plain", itemId: "dune" }),
    );
  });

  it("gives a place a longer name when another link holds the shorter", () => {
    const rows = classifyMatches(
      [
        candidate(
          "osm",
          "n2",
          "joe's pizza (village, new york)",
          "joe's pizza (carmine street, village, new york)",
        ),
      ],
      catalog(
        ["joe's pizza (village, new york)"],
        [["joe's pizza (village, new york)", "osm", "n1"]],
      ),
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: "free",
        itemId: "joe's pizza (carmine street, village, new york)",
      }),
    );
  });

  it("drops a match whose every name another link holds", () => {
    const rows = classifyMatches(
      [candidate("wikidata", "Q2", "dune")],
      catalog(["dune"], [["dune", "wikidata", "Q1"]]),
    );
    expect(rows).toEqual([]);
  });

  it("offers one thing once", () => {
    const rows = classifyMatches(
      [
        candidate("wikidata", "Q1", "dune"),
        candidate("osm", "n1", "dune"),
      ],
      catalog([]),
    );
    expect(rows.map((row) => row.candidate.ref)).toEqual(["Q1"]);
  });
});

describe("readLookupSettings", () => {
  it("is on for both until turned off", () => {
    expect(readLookupSettings({ getItem: () => null })).toEqual({
      lookUp: true,
      useLocation: true,
    });
  });

  it("reads each switch turned off", () => {
    const stored: Record<string, string> = {
      "grapevine:lookup-location": "off",
    };
    expect(readLookupSettings({ getItem: (key) => stored[key] ?? null })).toEqual(
      { lookUp: true, useLocation: false },
    );
  });

  // A private window, or storage turned off.
  it("is on when storage cannot be read", () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
    };
    expect(readLookupSettings(throwing)).toEqual({
      lookUp: true,
      useLocation: true,
    });
    expect(readLookupSettings(null)).toEqual({
      lookUp: true,
      useLocation: true,
    });
  });
});

describe("chooseMatch", () => {
  const dune = candidate("wikidata", "Q25391", "dune");

  // The viewer may have rated it already, so no thumb is coming to carry it.
  it("links a name already here, rated or not, at once", async () => {
    const written: string[] = [];
    await chooseMatch({ kind: "plain", candidate: dune, itemId: "dune" }, async (itemId, reference) => {
      written.push(`${itemId} ${reference.source} ${reference.ref}`);
    });
    expect(written).toEqual(["dune wikidata Q25391"]);
    expect(heldReference("dune")).toBeNull();
  });

  it("holds a new name's link for its first thumb", async () => {
    const written: string[] = [];
    const novel = candidate("wikidata", "Q190192", "dune (novel)");
    await chooseMatch({ kind: "free", candidate: novel, itemId: "dune (novel)" }, async (itemId) => {
      written.push(itemId);
    });
    expect(written).toEqual([]);
    expect(heldReference("dune (novel)")).toEqual({ source: "wikidata", ref: "Q190192" });
  });

  it("writes nothing for a thing that already holds the link", async () => {
    const written: string[] = [];
    await chooseMatch({ kind: "existing", candidate: dune, itemId: "sand dune" }, async (itemId) => {
      written.push(itemId);
    });
    expect(written).toEqual([]);
    expect(heldReference("sand dune")).toBeNull();
  });
});
