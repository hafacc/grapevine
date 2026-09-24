import { describe, expect, it } from "bun:test";
import { DEFAULT_PREFS } from "../utils/prefs";
import { visibleSuggestions } from "../utils/suggestions";
import type { ConnectRequest, Friend, Suggestion } from "../utils/types";

const suggestion = (uid: string): Suggestion => ({
  uid,
  username: `${uid}_h`,
  displayName: uid.toUpperCase(),
});

const friend = (uid: string): Friend => ({
  uid,
  username: `${uid}_h`,
  displayName: uid.toUpperCase(),
  photoURL: null,
  since: 0,
});

const asked = (to: string): ConnectRequest => ({
  from: "me",
  to,
  createdAt: 0,
  other: {
    uid: to,
    username: `${to}_h`,
    displayName: to.toUpperCase(),
    photoURL: null,
  },
});

const OFFERED = [suggestion("a"), suggestion("b"), suggestion("c")];

describe("visibleSuggestions", () => {
  it("shows the stored list, in the order the search ranked it", () => {
    expect(
      visibleSuggestions(OFFERED, DEFAULT_PREFS, [], []).map(
        (item) => item.uid,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  // The stored list is as old as the last search, so all three of these can
  // have happened since it was written; none is worth showing as a suggestion.
  it("drops anyone dismissed, befriended or already asked", () => {
    const prefs = { ...DEFAULT_PREFS, dismissedSuggestions: ["a"] };
    expect(
      visibleSuggestions(OFFERED, prefs, [friend("b")], [asked("c")]),
    ).toEqual([]);
  });

  it("is empty for a viewer the search has never run for", () => {
    expect(visibleSuggestions([], DEFAULT_PREFS, [], [])).toEqual([]);
  });
});
