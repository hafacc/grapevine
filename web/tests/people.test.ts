import { describe, expect, it } from "bun:test";
import { matchesPerson, type PersonRow, unknownHandle } from "../utils/people";

const person = (username: string, displayName: string): PersonRow => ({
  kind: "suggestion",
  uid: username,
  username,
  displayName,
  photoURL: null,
  attributes: [],
  request: null,
});

const SHOWN = [person("ada", "Ada Lovelace"), person("emile", "Émile Zola")];

describe("matchesPerson", () => {
  it("matches a handle, with or without the @", () => {
    expect(matchesPerson(SHOWN[0], "ada")).toBe(true);
    expect(matchesPerson(SHOWN[0], "@ada")).toBe(true);
  });

  it("matches a name, past its case and its accents", () => {
    expect(matchesPerson(SHOWN[1], "emile zola")).toBe(true);
    expect(matchesPerson(SHOWN[1], "ZOLA")).toBe(true);
  });

  it("says no to somebody else", () => {
    expect(matchesPerson(SHOWN[0], "zola")).toBe(false);
  });
});

describe("unknownHandle", () => {
  // A handle is exact and there is no browsing for people, so the ask is
  // offered for a name nobody on screen holds (DESIGN §1).
  it("offers a handle nobody on screen has", () => {
    expect(unknownHandle("@turing", SHOWN)).toBe("turing");
  });

  it("offers nothing for somebody already shown", () => {
    expect(unknownHandle("ADA", SHOWN)).toBe(null);
  });

  it("offers nothing for an empty field", () => {
    expect(unknownHandle("  ", SHOWN)).toBe(null);
  });
});
