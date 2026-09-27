// The cache's contract: a neighbourhood survives the codec unchanged, and a
// cached one patched with a delta equals a fresh load. The second is checked
// against a model of the database — friend lists, thumbs with the time they
// were given, tombstones, the two clocks — whose `neighbourhood` and `delta`
// say in TypeScript what 0015 and 0016 say in SQL; the pgTAP suite
// `29_snapshot_cache` checks the SQL says it.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import {
  applyDelta,
  bytesToText,
  type CachedNeighbourhood,
  type CachedNode,
  canonicalNeighbourhood,
  type DeltaRow,
  decodeNeighbourhood,
  encodeNeighbourhood,
  type NodeRow,
  neighbourhoodDifference,
  neighbourhoodFromRows,
  packNeighbourhood,
  textToBytes,
  unpackNeighbourhood,
} from "../src/snapshot-cache";

const JOIN = String.fromCodePoint(0);

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

type Thumb = { value: number; at: number };

// The rating key as the database keys it: item and tag, two columns.
function ratable(itemId: string, tag: string): string {
  return `${itemId}|${tag}`;
}

function halves(key: string): [string, string] {
  const [itemId, tag] = key.split("|");
  return [itemId as string, tag as string];
}

/** A seeded generator, so a failure is a sequence that can be replayed. */
function generator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

class Database {
  now = 1;
  readonly friends = new Map<string, Set<string>>();
  readonly ratings = new Map<string, Map<string, Thumb>>();
  readonly cleared = new Map<string, Map<string, number>>();
  readonly changedAt = new Map<string, number>();
  readonly friendsChangedAt = new Map<string, number>();

  constructor(
    readonly maxNodes: number,
    readonly maxDepth: number,
  ) {}

  addPerson(id: string): void {
    this.friends.set(id, new Set());
    this.ratings.set(id, new Map());
    this.cleared.set(id, new Map());
  }

  tick(): number {
    this.now += 1;
    return this.now;
  }

  rate(person: string, key: string, value: number): void {
    const own = this.ratings.get(person) as Map<string, Thumb>;
    const before = own.get(key);
    if (before?.value === value) return;
    const at = this.tick();
    own.set(key, { value, at });
    this.changedAt.set(person, at);
  }

  clear(person: string, key: string): void {
    const own = this.ratings.get(person) as Map<string, Thumb>;
    if (!own.delete(key)) return;
    const at = this.tick();
    (this.cleared.get(person) as Map<string, number>).set(key, at);
    this.changedAt.set(person, at);
  }

  befriend(one: string, other: string): void {
    if (one === other || this.friends.get(one)?.has(other)) return;
    const at = this.tick();
    for (const [from, to] of [
      [one, other],
      [other, one],
    ] as const) {
      this.friends.get(from)?.add(to);
      this.changedAt.set(from, at);
      this.friendsChangedAt.set(from, at);
    }
  }

  unfriend(one: string, other: string): void {
    if (!this.friends.get(one)?.has(other)) return;
    const at = this.tick();
    for (const [from, to] of [
      [one, other],
      [other, one],
    ] as const) {
      this.friends.get(from)?.delete(to);
      this.changedAt.set(from, at);
      this.friendsChangedAt.set(from, at);
    }
  }

  /** The account and everything cascading from it; its keys leave no tombstone. */
  deleteAccount(person: string): string[] {
    const friendsOf = [...(this.friends.get(person) ?? [])];
    for (const friend of friendsOf) this.unfriend(person, friend);
    this.friends.delete(person);
    this.ratings.delete(person);
    this.cleared.delete(person);
    this.changedAt.delete(person);
    this.friendsChangedAt.delete(person);
    return friendsOf;
  }

  /** `private.neighbourhood_cut`: levels in id order, cut at the node cap. */
  cut(viewer: string): string[] {
    const seen = [viewer];
    const inSeen = new Set(seen);
    let frontier = [viewer];
    for (
      let depth = 0;
      depth < this.maxDepth && seen.length < this.maxNodes;
      depth += 1
    ) {
      const next = new Set<string>();
      for (const person of frontier) {
        for (const friend of this.friends.get(person) ?? []) {
          if (!inSeen.has(friend)) next.add(friend);
        }
      }
      if (next.size === 0) break;
      const level = [...next].sort();
      for (const person of level) {
        if (seen.length < this.maxNodes) {
          seen.push(person);
          inSeen.add(person);
        }
      }
      frontier = level;
    }
    return seen;
  }

  /** One person's thumbs, nested as the database returns them, order bit on. */
  private nested(
    viewer: string,
    person: string,
    keep: (key: string, thumb: Thumb) => boolean,
  ): Record<string, Record<string, number>> {
    const mine = this.ratings.get(viewer) as Map<string, Thumb>;
    const nested: Record<string, Record<string, number>> = {};
    for (const [key, thumb] of this.ratings.get(person) ?? []) {
      if (!keep(key, thumb)) continue;
      const [itemId, tag] = halves(key);
      const later = (mine.get(key)?.at ?? Number.POSITIVE_INFINITY) < thumb.at;
      const forItem = nested[itemId] ?? {};
      forItem[tag] = later ? thumb.value * 2 : thumb.value;
      nested[itemId] = forItem;
    }
    return nested;
  }

  row(viewer: string, person: string): NodeRow {
    return {
      id: person,
      friend_ids: [...(this.friends.get(person) ?? [])].sort(),
      ratings: this.nested(viewer, person, () => true),
    };
  }

  neighbourhood(viewer: string): NodeRow[] {
    return this.cut(viewer).map((person) => this.row(viewer, person));
  }

  /** `private.snapshot_delta`'s rows after the cache row, from `since`. */
  delta(viewer: string, members: readonly string[], since: number): DeltaRow[] {
    const cut = this.cut(viewer);
    const inCut = new Set(cut);
    const inMembers = new Set(members);
    const rows: DeltaRow[] = [];
    for (const person of cut) {
      if (!inMembers.has(person)) {
        rows.push({
          state: "added",
          cleared: null,
          ...this.row(viewer, person),
        });
      }
    }
    for (const person of members) {
      if (!inCut.has(person)) {
        rows.push({
          state: "removed",
          id: person,
          friend_ids: null,
          ratings: null,
          cleared: null,
        });
      }
    }
    for (const person of cut) {
      if (!inMembers.has(person)) continue;
      if ((this.changedAt.get(person) ?? 0) <= since) continue;
      const tombstones = this.cleared.get(person) as Map<string, number>;
      const own = this.ratings.get(person) as Map<string, Thumb>;
      const cleared: Record<string, string[]> = {};
      for (const [key, at] of tombstones) {
        if (at <= since || own.has(key)) continue;
        const [itemId, tag] = halves(key);
        cleared[itemId] = [...(cleared[itemId] ?? []), tag];
      }
      rows.push({
        state: "changed",
        id: person,
        friend_ids:
          (this.friendsChangedAt.get(person) ?? 0) > since
            ? [...(this.friends.get(person) ?? [])].sort()
            : null,
        ratings: this.nested(
          viewer,
          person,
          (key, thumb) =>
            thumb.at > since || (tombstones.get(key) ?? 0) > since,
        ),
        cleared,
      });
    }
    return rows;
  }
}

const ITEMS = Array.from({ length: 30 }, (_, index) => `thing ${index}`);
const TAGS = ["", "", "", "loud", "cheap"];

function world(seed: number, people: number, maxNodes: number) {
  const random = generator(seed);
  const database = new Database(maxNodes, 6);
  const ids = Array.from({ length: people }, (_, index) => uuid(index + 1));
  for (const id of ids) database.addPerson(id);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(random() * list.length)] as T;
  for (let edge = 0; edge < people * 2; edge += 1) {
    database.befriend(pick(ids), pick(ids));
  }
  for (const id of ids) {
    for (let thumb = 0; thumb < 8; thumb += 1) {
      database.rate(
        id,
        ratable(pick(ITEMS), pick(TAGS)),
        random() < 0.5 ? 1 : -1,
      );
    }
  }
  return { database, ids, random, pick };
}

describe("the codec", () => {
  it("round-trips a neighbourhood, attributes, order bits and strangers' ids included", async () => {
    const { database, ids } = world(7, 40, 30);
    const nodes = neighbourhoodFromRows(
      database.neighbourhood(ids[0] as string),
    );
    const encoded = encodeNeighbourhood(nodes);
    assert.ok(encoded);
    const decoded = decodeNeighbourhood(encoded);
    assert.ok(decoded);
    assert.equal(
      canonicalNeighbourhood(decoded),
      canonicalNeighbourhood(nodes),
    );
    const packed = await packNeighbourhood(nodes);
    assert.ok(packed);
    const unpacked = await unpackNeighbourhood(packed);
    assert.ok(unpacked);
    assert.equal(
      canonicalNeighbourhood(unpacked),
      canonicalNeighbourhood(nodes),
    );
  });

  it("keeps every thumb value and a key with the join in it", () => {
    const nodes = new Map<string, CachedNode>([
      [
        uuid(1),
        {
          friendIds: [uuid(2), uuid(3)],
          ratings: { a: 1, b: -1, c: 2, d: -2, [`café${JOIN}日本`]: 1 },
        },
      ],
      [uuid(2), { friendIds: [uuid(1)], ratings: {} }],
    ]);
    const decoded = decodeNeighbourhood(
      encodeNeighbourhood(nodes) as Uint8Array,
    );
    assert.ok(decoded);
    assert.equal(
      canonicalNeighbourhood(decoded),
      canonicalNeighbourhood(nodes),
    );
  });

  it("refuses an id that is not a uuid rather than store it wrong", () => {
    const nodes = new Map<string, CachedNode>([
      ["not-a-uuid", { friendIds: [], ratings: {} }],
    ]);
    assert.equal(encodeNeighbourhood(nodes), null);
  });

  it("reads anything it could not have written as missing", async () => {
    const nodes = new Map<string, CachedNode>([
      [uuid(1), { friendIds: [uuid(2)], ratings: { a: 1 } }],
    ]);
    const encoded = encodeNeighbourhood(nodes) as Uint8Array;
    assert.equal(
      decodeNeighbourhood(encoded.subarray(0, encoded.length - 1)),
      null,
    );
    assert.equal(decodeNeighbourhood(Uint8Array.from([...encoded, 0])), null);
    assert.equal(decodeNeighbourhood(Uint8Array.from([5, 9])), null);
    assert.equal(await unpackNeighbourhood("abc"), null);
    assert.equal(await unpackNeighbourhood("\u0100"), null);
  });

  it("writes a one-sided friendship whole rather than lose it", () => {
    const nodes = new Map<string, CachedNode>([
      [uuid(1), { friendIds: [uuid(2), uuid(3)], ratings: {} }],
      [uuid(2), { friendIds: [], ratings: { a: 1 } }],
      [uuid(3), { friendIds: [uuid(1), uuid(1)], ratings: {} }],
    ]);
    const decoded = decodeNeighbourhood(
      encodeNeighbourhood(nodes) as Uint8Array,
    );
    assert.ok(decoded);
    assert.equal(
      canonicalNeighbourhood(decoded),
      canonicalNeighbourhood(nodes),
    );
  });

  it("carries every byte through text a column can hold", () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) =>
        length % 2 === 0
          ? (index * 37 + length) & 0xff
          : index % 3 === 0
            ? 0
            : 0xff,
      );
      const text = bytesToText(bytes);
      assert.ok(!text.includes("\u0000"));
      assert.ok(text.length <= Math.ceil((length * 8) / 7));
      assert.deepEqual(textToBytes(text), bytes);
    }
  });
});

describe("applyDelta", () => {
  it("resets the order bit of thumbs nobody rewrote on a thing the viewer rated again", () => {
    const viewer = uuid(1);
    const other = uuid(2);
    const cached = new Map<string, CachedNode>([
      [viewer, { friendIds: [other], ratings: { x: 1 } }],
      [other, { friendIds: [viewer], ratings: { x: -2, y: 2 } }],
    ]);
    const patched = applyDelta(cached, viewer, [
      {
        state: "changed",
        id: viewer,
        friend_ids: null,
        ratings: { x: { "": -1 } },
        cleared: {},
      },
    ]);
    assert.deepEqual(patched?.get(other)?.ratings, { x: -1, y: 2 });
  });

  it("refuses a delta that names a kept person the cache never held", () => {
    const cached = new Map<string, CachedNode>([
      [uuid(1), { friendIds: [], ratings: {} }],
    ]);
    assert.equal(
      applyDelta(cached, uuid(1), [
        {
          state: "changed",
          id: uuid(9),
          friend_ids: null,
          ratings: {},
          cleared: {},
        },
      ]),
      null,
    );
  });

  it("counts a difference without naming anyone", () => {
    const fresh = new Map<string, CachedNode>([
      [uuid(1), { friendIds: [uuid(2)], ratings: { a: 1 } }],
      [uuid(2), { friendIds: [uuid(1)], ratings: {} }],
    ]);
    const patched = new Map<string, CachedNode>([
      [uuid(1), { friendIds: [], ratings: { a: -1, b: 1 } }],
      [uuid(3), { friendIds: [], ratings: {} }],
    ]);
    assert.deepEqual(neighbourhoodDifference(patched, fresh), {
      missing: 1,
      extra: 1,
      friendLists: 1,
      thumbs: 2,
    });
  });
});

describe("a patched neighbourhood equals a fresh load", () => {
  // The delta reads from a little before the watermark, as 0016 does, so a
  // change the cache already holds is read again; applying it again must be a
  // no-op.
  const MARGIN = 3;

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`over generated events, seed ${seed}`, async () => {
      const { database, ids, random, pick } = world(seed, 80, 30);
      const viewer = ids[0] as string;
      let alive = [...ids];
      let cached: CachedNeighbourhood = neighbourhoodFromRows(
        database.neighbourhood(viewer),
      );
      let since = database.now;
      let patches = 0;

      for (let refresh = 0; refresh < 60; refresh += 1) {
        const events = [1, 5, 20, 80][refresh % 4] as number;
        let dropped = false;
        for (let event = 0; event < events; event += 1) {
          const roll = random();
          const person = random() < 0.1 ? viewer : pick(alive);
          const own = [
            ...(database.ratings.get(person) as Map<string, Thumb>).keys(),
          ];
          if (roll < 0.45) {
            database.rate(
              person,
              ratable(pick(ITEMS), pick(TAGS)),
              random() < 0.5 ? 1 : -1,
            );
          } else if (roll < 0.6 && own.length > 0) {
            const key = pick(own);
            const thumb = database.ratings.get(person)?.get(key) as Thumb;
            database.rate(person, key, -thumb.value);
          } else if (roll < 0.75 && own.length > 0) {
            database.clear(person, pick(own));
          } else if (roll < 0.82) {
            const cleared = [
              ...(database.cleared.get(person) as Map<string, number>).keys(),
            ];
            if (cleared.length > 0) database.rate(person, pick(cleared), 1);
          } else if (roll < 0.91) {
            database.befriend(person, pick(alive));
          } else if (roll < 0.98) {
            const friends = [...(database.friends.get(person) ?? [])];
            if (friends.length > 0) database.unfriend(person, pick(friends));
          } else if (person !== viewer) {
            // 0016's purge: a cache that loaded the account, or a friend of
            // it, is dropped, so the next refresh loads in full.
            const friendsOf = database.deleteAccount(person);
            alive = alive.filter((id) => id !== person);
            if ([person, ...friendsOf].some((id) => cached.has(id))) {
              dropped = true;
            }
          }
        }

        const fresh = neighbourhoodFromRows(database.neighbourhood(viewer));
        let next: CachedNeighbourhood = fresh;
        if (!dropped) {
          const stored = await unpackNeighbourhood(
            (await packNeighbourhood(cached)) as string,
          );
          assert.ok(stored);
          const patched = applyDelta(
            stored,
            viewer,
            database.delta(viewer, [...stored.keys()], since - MARGIN),
          );
          assert.ok(patched);
          assert.equal(
            canonicalNeighbourhood(patched),
            canonicalNeighbourhood(fresh),
            `refresh ${refresh}`,
          );
          patches += 1;
          next = patched;
        }
        cached = next;
        since = database.now;
        database.tick();
      }
      assert.ok(patches > 40);
    });
  }
});
