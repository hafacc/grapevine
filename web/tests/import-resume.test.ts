import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  forgetImportResumes,
  importResume,
  setImportResume,
} from "../src/lib/utils/import-resume";

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

describe("import resume", () => {
  it("takes the same file up where it stopped", () => {
    setImportResume("me", { source: "google-maps", total: 900, done: 240 });
    expect(importResume("me", "google-maps", 900)).toBe(240);
  });

  it("starts another file, another source or another account from the top", () => {
    setImportResume("me", { source: "google-maps", total: 900, done: 240 });
    expect(importResume("me", "google-maps", 901)).toBe(0);
    expect(importResume("me", "imdb", 900)).toBe(0);
    expect(importResume("you", "google-maps", 900)).toBe(0);
  });

  it("forgets a finished run, and everybody's on sign-out", () => {
    setImportResume("me", { source: "imdb", total: 10, done: 5 });
    setImportResume("me", null);
    expect(importResume("me", "imdb", 10)).toBe(0);
    setImportResume("me", { source: "imdb", total: 10, done: 5 });
    setImportResume("you", { source: "imdb", total: 10, done: 5 });
    forgetImportResumes(window.localStorage);
    expect(window.localStorage.length).toBe(0);
  });

  it("reads anything unreadable as nothing kept", () => {
    window.localStorage.setItem("grapevine:import-resume:me", "{not json");
    expect(importResume("me", "imdb", 10)).toBe(0);
    window.localStorage.setItem(
      "grapevine:import-resume:me",
      JSON.stringify({ source: "imdb", total: 10, done: 10 }),
    );
    expect(importResume("me", "imdb", 10)).toBe(0);
  });
});
