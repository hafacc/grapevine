import { describe, expect, it } from "bun:test";
import {
  applyThumbsSince,
  buildSnapshot,
  type Held,
  inBatches,
  readThumbsSince,
  staleAccounts,
  stampSignature,
  type Thumbs,
  type ThumbsSince,
} from "../src/lib/utils/taste";

const JOIN = String.fromCodePoint(0);

const held = (stamp: string): Held => ({
  stamp,
  revision: 1,
  removed: 0,
  thumbs: {},
});

describe("staleAccounts", () => {
  it("names the accounts that are new or whose stamp moved", () => {
    const known = new Map([
      ["a", held("1")],
      ["b", held("1")],
    ]);
    expect(
      staleAccounts(
        [
          { uid: "a", stamp: "1" },
          { uid: "b", stamp: "2" },
          { uid: "c", stamp: "1" },
        ],
        known,
      ),
    ).toEqual(["b", "c"]);
  });
});

describe("stampSignature", () => {
  it("does not depend on the order the stamps came back in", () => {
    const one = { uid: "a", stamp: "1" };
    const other = { uid: "b", stamp: "2" };
    expect(stampSignature([one, other])).toBe(stampSignature([other, one]));
    expect(stampSignature([one])).not.toBe(stampSignature([one, other]));
  });
});

describe("buildSnapshot", () => {
  it("names the viewer, whom they follow and everybody's thumbs under one key", () => {
    const snapshot = buildSnapshot(
      "me",
      { dune: { "": 1, film: 1 } },
      new Map<string, Thumbs>([
        ["critic", { dune: { "": -1 } }],
        ["quiet", {}],
      ]),
    );
    expect(snapshot.users).toEqual(["me", "critic", "quiet"]);
    expect(snapshot.follows).toEqual({ me: ["critic", "quiet"] });
    expect(snapshot.ratings).toEqual({
      me: { dune: 1, [`dune${JOIN}film`]: 1 },
      critic: { dune: -1 },
    });
  });

  it("never has the viewer follow themselves", () => {
    const snapshot = buildSnapshot("me", {}, new Map([["me", {}]]));
    expect(snapshot.follows).toEqual({ me: [] });
  });
});

describe("readThumbsSince", () => {
  it("reads a whole answer and refuses anything else", () => {
    const answer = {
      revision: 4,
      removed: 0,
      full: false,
      thumbs: { dune: { "": 1 } },
      cleared: [["arrival", ""]],
    };
    expect(readThumbsSince(answer)).toEqual(answer as unknown as ThumbsSince);
    expect(readThumbsSince(null)).toBe(null);
    expect(readThumbsSince({ ...answer, revision: "4" })).toBe(null);
    expect(readThumbsSince({ ...answer, cleared: [["arrival"]] })).toBe(null);
    expect(readThumbsSince({ ...answer, thumbs: null })).toBe(null);
  });
});

describe("applyThumbsSince", () => {
  const before = { dune: { "": 1, film: 1 }, arrival: { "": 1 } };
  const since = (
    patch: Partial<ThumbsSince>,
  ): ThumbsSince => ({
    revision: 9,
    removed: 0,
    full: false,
    thumbs: {},
    cleared: [],
    ...patch,
  });

  it("is the answer itself when the answer is everything", () => {
    const thumbs = { tenet: { "": -1 } };
    expect(applyThumbsSince(before, since({ full: true, thumbs }))).toEqual(
      thumbs,
    );
  });

  it("puts in what was written and takes out what was cleared", () => {
    expect(
      applyThumbsSince(
        before,
        since({
          thumbs: { dune: { "": -1 }, tenet: { film: 1 } },
          cleared: [
            ["dune", "film"],
            ["arrival", ""],
            ["nothing held", ""],
          ],
        }),
      ),
    ).toEqual({ dune: { "": -1 }, tenet: { film: 1 } });
  });

  // Cleared and given again is both a tombstone and a row; the row is what is
  // there now.
  it("lets a thumb given again win over its clearing", () => {
    expect(
      applyThumbsSince(
        before,
        since({ thumbs: { arrival: { "": -1 } }, cleared: [["arrival", ""]] }),
      ),
    ).toEqual({ dune: { "": 1, film: 1 }, arrival: { "": -1 } });
  });

  it("leaves what was held untouched", () => {
    applyThumbsSince(before, since({ cleared: [["dune", ""]] }));
    expect(before.dune).toEqual({ "": 1, film: 1 });
  });

  it("keeps a thing named __proto__", () => {
    const thumbs = JSON.parse('{"__proto__": {"": 1}}');
    const after = applyThumbsSince({}, since({ thumbs }));
    expect(Object.keys(after)).toEqual(["__proto__"]);
  });
});

describe("inBatches", () => {
  it("answers in the order asked, never more than the limit at once", async () => {
    let running = 0;
    let most = 0;
    const answers = await inBatches([3, 1, 2, 5, 4], 2, async (wait) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, wait));
      running -= 1;
      return wait * 10;
    });
    expect(answers).toEqual([30, 10, 20, 50, 40]);
    expect(most).toBe(2);
  });
});
