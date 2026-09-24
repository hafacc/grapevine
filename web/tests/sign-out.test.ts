import { describe, expect, it } from "bun:test";
import { forgetCachedFeeds } from "../utils/recs";
import { signOutFailed } from "../utils/store";

// The part of `Storage` the cleanup reads, over a plain map.
function storage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

describe("signing out", () => {
  it("counts as done when no session is left, whatever the server said", () => {
    // Offline: the revoke never arrived, and the device let go regardless.
    expect(signOutFailed(new TypeError("Failed to fetch"), false)).toBe(false);
    expect(signOutFailed(null, false)).toBe(false);
  });

  it("fails only when the device is still signed in", () => {
    expect(signOutFailed(new Error("refused"), true)).toBe(true);
  });

  it("leaves no cached feed behind, anybody's", () => {
    const kept = storage({
      "grapevine.recs.one": "[]",
      "grapevine.recs.two": "[]",
      theme: "dark",
      "sb-127-auth-token": "{}",
    });
    forgetCachedFeeds(kept);
    const left: string[] = [];
    for (let index = 0; index < kept.length; index += 1) {
      const key = kept.key(index);
      if (key) left.push(key);
    }
    expect(left.sort()).toEqual(["sb-127-auth-token", "theme"]);
  });
});
