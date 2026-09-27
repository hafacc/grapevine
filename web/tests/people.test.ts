import { describe, expect, it } from "bun:test";
import { matchesPerson, type PersonRow } from "../utils/people";

const person = (uid: string, displayName: string): PersonRow => ({
  uid,
  displayName,
  photoURL: null,
});

const SHOWN = [person("ada", "Ada Lovelace"), person("emile", "Émile Zola")];

describe("matchesPerson", () => {
  it("matches a name, past its case and its accents", () => {
    expect(matchesPerson(SHOWN[0], "ada")).toBe(true);
    expect(matchesPerson(SHOWN[1], "emile zola")).toBe(true);
    expect(matchesPerson(SHOWN[1], "ZOLA")).toBe(true);
  });

  it("says no to somebody else", () => {
    expect(matchesPerson(SHOWN[0], "zola")).toBe(false);
  });

  // There is no handle to type: the field filters names and nothing else.
  it("does not match on the uid", () => {
    expect(matchesPerson(person("turing", "Alan"), "turing")).toBe(false);
  });
});
