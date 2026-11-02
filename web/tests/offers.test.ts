import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  forgetImportOffers,
  importOfferWaiting,
  setImportOffer,
} from "../src/lib/utils/import-offer";
import {
  forgetPrefilledOffers,
  prefilledOfferWaiting,
  setPrefilledOffer,
} from "../src/lib/utils/prefilled-offer";

function memoryStorage(): Storage {
  const kept = new Map<string, string>();
  return {
    get length() {
      return kept.size;
    },
    key: (index: number) => [...kept.keys()][index] ?? null,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
    clear: () => kept.clear(),
  };
}

const original = (globalThis as { window?: unknown }).window;
beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    localStorage: memoryStorage(),
  };
});
afterEach(() => {
  (globalThis as { window?: unknown }).window = original;
});

describe("first-run offers", () => {
  it("waits for the account it was set for until answered", () => {
    setPrefilledOffer("me", true);
    expect(prefilledOfferWaiting("me")).toBe(true);
    expect(prefilledOfferWaiting("you")).toBe(false);
    setPrefilledOffer("me", false);
    expect(prefilledOfferWaiting("me")).toBe(false);
  });

  it("keeps the two offers apart", () => {
    setPrefilledOffer("me", true);
    setImportOffer("me", true);
    setPrefilledOffer("me", false);
    expect(importOfferWaiting("me")).toBe(true);
    forgetImportOffers(window.localStorage);
    expect(importOfferWaiting("me")).toBe(false);
  });

  it("forgets everybody's on sign-out, and nothing else", () => {
    setPrefilledOffer("me", true);
    setPrefilledOffer("you", true);
    window.localStorage.setItem("grapevine-theme", "dark");
    forgetPrefilledOffers(window.localStorage);
    expect(prefilledOfferWaiting("me")).toBe(false);
    expect(prefilledOfferWaiting("you")).toBe(false);
    expect(window.localStorage.getItem("grapevine-theme")).toBe("dark");
  });

  it("asks nothing when storage refuses", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error("refused");
      },
    };
    setPrefilledOffer("me", true);
    expect(prefilledOfferWaiting("me")).toBe(false);
  });
});
