import { describe, expect, it } from "bun:test";
import { accountChips, byName, findAccounts } from "../src/lib/utils/people";
import type { Account } from "../src/lib/utils/types";

const person = (uid: string, displayName: string): Account => ({
  uid,
  displayName,
  photoURL: null,
  prefilled: false,
  handle: null,
  tags: [],
});

const prefilled = (
  handle: string,
  displayName: string,
  tags: readonly string[] = [],
): Account => ({
  uid: handle,
  displayName,
  photoURL: null,
  prefilled: true,
  handle,
  tags,
});

describe("findAccounts", () => {
  const known = [
    prefilled("ebert", "Roger Ebert"),
    prefilled("infatuation", "The Infatuation"),
    person("u1", "Roger Federer"),
    person("u2", "Ada Lovelace"),
    person("emile", "Émile Zola"),
  ];
  const found = (query: string) =>
    findAccounts(query, known).map(({ account }) => account.uid);

  it("finds by the start of a handle or of a word of the name", () => {
    expect(found("ebe")).toEqual(["ebert"]);
    expect(found("roger")).toEqual(["ebert", "u1"]);
    expect(found("love")).toEqual(["u2"]);
    expect(found("fatuation")).toEqual([]);
  });

  it("matches past case and accents", () => {
    expect(found("EMILE zola")).toEqual(["emile"]);
  });

  it("wants every word", () => {
    expect(found("roger ebert")).toEqual(["ebert"]);
    expect(found("roger fed")).toEqual(["u1"]);
  });

  it("finds nobody for nothing typed", () => {
    expect(found("")).toEqual([]);
    expect(found("  ")).toEqual([]);
  });

  // Punctuation folds away, so the old way of asking still answers.
  it("reads @ebert as ebert", () => {
    expect(found("@ebert")).toEqual(["ebert"]);
  });

  // A person has no handle, and the id is nobody's to type.
  it("does not match on the uid", () => {
    expect(found("u1")).toEqual([]);
  });

  it("lists an account once however it is known", () => {
    const twice = [...known, person("u2", "Ada Lovelace")];
    expect(findAccounts("ada", twice)).toHaveLength(1);
  });
});

describe("findAccounts by tags", () => {
  const known = [
    prefilled("onebite", "Dave Portnoy", ["pizza"]),
    prefilled("obama", "Barack Obama", ["song", "book", "film"]),
    prefilled("ebert", "Roger Ebert", ["film"]),
    prefilled("razzies", "Golden Raspberry Awards", ["film"]),
    prefilled("late", "Night Owl", ["late night"]),
    prefilled("broad", "Wide Reader", ["novel", "poem", "essay", "comic"]),
    person("u1", "Film Buff"),
  ];
  const found = (query: string) =>
    findAccounts(query, known).map(({ account }) => account.uid);
  const matched = (query: string, uid: string) =>
    findAccounts(query, known).find(({ account }) => account.uid === uid)
      ?.matchedTags;

  it("finds a prefilled account by the attributes its thumbs use", () => {
    expect(found("pizza")).toEqual(["onebite"]);
    expect(found("piz")).toEqual(["onebite"]);
    expect(matched("pizza", "onebite")).toEqual(["pizza"]);
  });

  it("finds every account with the tag, by name", () => {
    expect(found("film")).toEqual(["obama", "u1", "razzies", "ebert"]);
  });

  // Not only the three a row shows by default.
  it("finds by any tag, the fourth too", () => {
    expect(found("comic")).toEqual(["broad"]);
    expect(matched("comic", "broad")).toEqual(["comic"]);
  });

  it("reads a tag of two words from either word, past case and accents", () => {
    expect(found("night")).toEqual(["late"]);
    expect(found("LATE NIGHT")).toEqual(["late"]);
    expect(found("fílm")).toEqual(["obama", "u1", "razzies", "ebert"]);
  });

  it("wants every word, from a name or a tag", () => {
    expect(found("roger film")).toEqual(["ebert"]);
    expect(found("obama book")).toEqual(["obama"]);
    expect(found("obama pizza")).toEqual([]);
  });

  it("finds a person by name and never by a tag", () => {
    expect(matched("film", "u1")).toEqual([]);
    expect(found("buff")).toEqual(["u1"]);
  });

  it("does not match a tag by scattered letters", () => {
    expect(found("pza")).toEqual([]);
    expect(found("izza")).toEqual([]);
  });
});

describe("accountChips", () => {
  const broad = prefilled("broad", "Wide Reader", [
    "novel",
    "poem",
    "essay",
    "comic",
  ]);

  it("shows the first three when nothing matched", () => {
    expect(accountChips(broad, [])).toEqual(["novel", "poem", "essay"]);
  });

  it("puts a matched tag first, from past the first three", () => {
    expect(accountChips(broad, ["comic"])).toEqual(["comic", "novel", "poem"]);
  });

  it("shows every matched tag, more than three if it must", () => {
    expect(accountChips(broad, ["novel", "poem", "essay", "comic"])).toEqual([
      "novel",
      "poem",
      "essay",
      "comic",
    ]);
  });
});

describe("byName", () => {
  it("orders by name, and two of one name by id", () => {
    const sorted = [
      prefilled("pitchfork", "Pitchfork"),
      prefilled("obama", "Barack Obama"),
      person("b", "Ada"),
      person("a", "Ada"),
    ].sort(byName);
    expect(sorted.map((account) => account.uid)).toEqual([
      "a",
      "b",
      "obama",
      "pitchfork",
    ]);
  });
});
