// DESIGN §3.4a: the neighbourhood a viewer's last refresh loaded, kept between
// refreshes as one compressed blob, and patched with what changed since.
//
// A patched neighbourhood must equal what `private.neighbourhood` would return
// now, field for field: the core runs unchanged on it, so any difference is a
// wrong feed. `tests/snapshot-cache.test.ts` checks that on generated event
// sequences, and every `RELOAD_EVERY`th refresh checks it again against a full
// load.

import { sanitizeFriendIds, sanitizeRatings } from "./entries.ts";

/**
 * The codec and the patch rules below. `private.snapshot_delta` patches only a
 * cache of the version it is asked for, so bumping this makes every stored
 * cache reload once. Bump it with any change to either, or to `N_max` or the
 * depth backstop.
 */
export const CACHE_VERSION = 1;

/**
 * A full load, and a comparison against the patch, every this many refreshes:
 * a safety net under a patch the tests show exact, priced in DESIGN §3.4a.
 */
export const RELOAD_EVERY = 100;

/**
 * One loaded person: their friend list, and their thumbs keyed as the core
 * takes them (`sanitizeRatings`), order bit included.
 */
export type CachedNode = {
  readonly friendIds: readonly string[];
  readonly ratings: Readonly<Record<string, number>>;
};

/** Everyone `private.neighbourhood` loaded, by id. */
export type CachedNeighbourhood = ReadonlyMap<string, CachedNode>;

/** A row as `private.neighbourhood` and `private.load_nodes` return it. */
export type NodeRow = {
  readonly id: string;
  readonly friend_ids: unknown;
  readonly ratings: unknown;
};

/** A row of `private.snapshot_delta` (0016). */
export type DeltaRow = {
  readonly state: string;
  readonly id: string;
  readonly friend_ids: unknown;
  readonly ratings: unknown;
  readonly cleared: unknown;
};

function nodeOf(row: { friend_ids: unknown; ratings: unknown }): CachedNode {
  return {
    friendIds: sanitizeFriendIds(row.friend_ids),
    ratings: sanitizeRatings(row.ratings) ?? {},
  };
}

/** A full load's rows as a cached neighbourhood, in the order they came. */
export function neighbourhoodFromRows(
  rows: readonly NodeRow[],
): Map<string, CachedNode> {
  const nodes = new Map<string, CachedNode>();
  for (const row of rows) nodes.set(row.id, nodeOf(row));
  return nodes;
}

/**
 * The keys a delta's `cleared` names (item to a list of tags), joined the way
 * `sanitizeRatings` joins them, so a clear and a thumb on one thing meet on one
 * key.
 */
function clearedKeys(cleared: unknown): string[] {
  if (typeof cleared !== "object" || cleared === null) return [];
  const asThumbs: Record<string, Record<string, number>> = {};
  for (const [itemId, tags] of Object.entries(cleared)) {
    if (!Array.isArray(tags)) continue;
    const forItem: Record<string, number> = {};
    for (const tag of tags) if (typeof tag === "string") forItem[tag] = 1;
    asThumbs[itemId] = forItem;
  }
  return Object.keys(sanitizeRatings(asThumbs) ?? {});
}

/**
 * The cached neighbourhood with a delta applied, or null when the delta names a
 * kept person the cache does not hold — a cache and a delta from two moments,
 * which only a full load can answer.
 *
 * - `removed` people go; `added` people arrive whole.
 * - A `changed` person loses the keys cleared since, gains or replaces the
 *   thumbs written since, and takes the new friend list when there is one.
 * - The order bit of a thumb nobody rewrote is relative to the viewer's own
 *   thumb on that thing. Where the viewer's thumb was given, turned over or
 *   cleared since, every such thumb was given before `since` and so before the
 *   viewer's: plain `±1`, never `±2`. Thumbs the delta carries came with their
 *   bit computed against the viewer's current thumb and are left alone.
 */
export function applyDelta(
  cached: CachedNeighbourhood,
  viewer: string,
  rows: readonly DeltaRow[],
): Map<string, CachedNode> | null {
  const nodes = new Map(cached);
  const fresh = new Set<string>();
  const written = new Map<string, Set<string>>();
  let viewerMoved: string[] = [];

  for (const row of rows) {
    if (row.state === "removed") {
      nodes.delete(row.id);
    } else if (row.state === "added") {
      nodes.set(row.id, nodeOf(row));
      fresh.add(row.id);
    } else if (row.state === "changed") {
      const before = cached.get(row.id);
      if (!before) return null;
      const ratings: Record<string, number> = { ...before.ratings };
      const cleared = clearedKeys(row.cleared);
      for (const key of cleared) delete ratings[key];
      const thumbs = sanitizeRatings(row.ratings) ?? {};
      Object.assign(ratings, thumbs);
      written.set(row.id, new Set(Object.keys(thumbs)));
      nodes.set(row.id, {
        friendIds:
          row.friend_ids === null || row.friend_ids === undefined
            ? before.friendIds
            : sanitizeFriendIds(row.friend_ids),
        ratings,
      });
      if (row.id === viewer) viewerMoved = [...cleared, ...Object.keys(thumbs)];
    }
  }

  if (viewerMoved.length > 0) {
    for (const [id, node] of nodes) {
      if (fresh.has(id)) continue;
      const rewritten = written.get(id);
      let ratings: Record<string, number> | null = null;
      for (const key of viewerMoved) {
        const value = node.ratings[key];
        if (value === undefined || rewritten?.has(key)) continue;
        if (Math.abs(value) === 2) {
          ratings ??= { ...node.ratings };
          ratings[key] = Math.sign(value);
        }
      }
      if (ratings) nodes.set(id, { friendIds: node.friendIds, ratings });
    }
  }
  return nodes;
}

/**
 * One string per neighbourhood that two equal ones share: sorted people, sorted
 * friend lists, sorted thumbs. What the periodic check compares.
 */
export function canonicalNeighbourhood(nodes: CachedNeighbourhood): string {
  return JSON.stringify(
    [...nodes.keys()].sort().map((id) => {
      const node = nodes.get(id) as CachedNode;
      return [
        id,
        [...node.friendIds].sort(),
        Object.keys(node.ratings)
          .sort()
          .map((key) => [key, node.ratings[key]]),
      ];
    }),
  );
}

/**
 * How two neighbourhoods differ, in counts only: the diagnostic a failed check
 * logs names nobody.
 */
export function neighbourhoodDifference(
  patched: CachedNeighbourhood,
  fresh: CachedNeighbourhood,
): { missing: number; extra: number; friendLists: number; thumbs: number } {
  let missing = 0;
  let extra = 0;
  let friendLists = 0;
  let thumbs = 0;
  for (const [id, node] of fresh) {
    const other = patched.get(id);
    if (!other) {
      missing += 1;
      continue;
    }
    if (
      JSON.stringify([...node.friendIds].sort()) !==
      JSON.stringify([...other.friendIds].sort())
    ) {
      friendLists += 1;
    }
    const keys = new Set([
      ...Object.keys(node.ratings),
      ...Object.keys(other.ratings),
    ]);
    for (const key of keys) {
      if (node.ratings[key] !== other.ratings[key]) thumbs += 1;
    }
  }
  for (const id of patched.keys()) if (!fresh.has(id)) extra += 1;
  return { missing, extra, friendLists, thumbs };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A thumb's value as two bits.
const VALUE_CODES: readonly number[] = [-2, -1, 1, 2];

// Whether each friendship between two loaded people is written once (and read
// back into both lists) or both lists are written whole.
const SYMMETRIC = 1;
const WHOLE = 0;

function writeVarint(out: number[], value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

/** Sorted, then each as its distance from the one before. */
function writeGaps(out: number[], indices: number[]): void {
  indices.sort((left, right) => left - right);
  let last = 0;
  for (const index of indices) {
    writeVarint(out, index - last);
    last = index;
  }
}

function isSymmetric(nodes: CachedNeighbourhood): boolean {
  for (const [id, node] of nodes) {
    if (new Set(node.friendIds).size !== node.friendIds.length) return false;
    for (const friend of node.friendIds) {
      const other = nodes.get(friend);
      if (other && !other.friendIds.includes(id)) return false;
    }
  }
  return true;
}

/**
 * The neighbourhood as bytes, before compression, laid out for what gzip can
 * and cannot find (DESIGN §3.4a):
 *
 * - every id once, 16 bytes: the loaded in their order, then everyone else a
 *   friend list names. Random, so a third of the blob whatever is done;
 * - every thumb key once, the most rated first, so the common keys get the
 *   small indices;
 * - each column on its own — counts, friend lists, thumb keys, values — since
 *   gzip does better on like next to like;
 * - friend lists and thumb keys sorted and written as gaps, as varints;
 * - a friendship between two loaded people written once, from the end with
 *   the smaller index, which the database's reciprocity makes exact (a
 *   one-sided edge falls back to whole lists);
 * - values two bits each, four to a byte.
 *
 * Null when an id is not a lowercase uuid, which the database never returns,
 * so that neighbourhood is simply not cached. What comes back from `decode` is
 * equal under `canonicalNeighbourhood`, not in order: friend lists come back
 * sorted, as the database sorts them, and thumbs in key order.
 */
export function encodeNeighbourhood(
  nodes: CachedNeighbourhood,
): Uint8Array | null {
  const loaded = [...nodes.keys()];
  const people = new Map<string, number>();
  for (const id of loaded) people.set(id, people.size);
  for (const node of nodes.values()) {
    for (const friend of node.friendIds) {
      if (!people.has(friend)) people.set(friend, people.size);
    }
  }
  for (const id of people.keys()) if (!UUID_PATTERN.test(id)) return null;

  const frequency = new Map<string, number>();
  for (const node of nodes.values()) {
    for (const key of Object.keys(node.ratings)) {
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }
  const keyOrder = [...frequency.keys()].sort(
    (left, right) =>
      (frequency.get(right) as number) - (frequency.get(left) as number) ||
      (left < right ? -1 : left > right ? 1 : 0),
  );
  const keys = new Map(keyOrder.map((key, index) => [key, index]));
  const symmetric = isSymmetric(nodes);

  const header: number[] = [];
  writeVarint(header, people.size);
  writeVarint(header, loaded.length);
  for (const id of people.keys()) {
    const hex = id.replaceAll("-", "");
    for (let at = 0; at < 32; at += 2) {
      header.push(Number.parseInt(hex.slice(at, at + 2), 16));
    }
  }
  const encoder = new TextEncoder();
  writeVarint(header, keys.size);
  for (const key of keyOrder) {
    const bytes = encoder.encode(key);
    writeVarint(header, bytes.length);
    for (const byte of bytes) header.push(byte);
  }
  header.push(symmetric ? SYMMETRIC : WHOLE);

  const counts: number[] = [];
  const friends: number[] = [];
  const thumbs: number[] = [];
  const values: number[] = [];
  let packed = 0;
  let inPack = 0;
  loaded.forEach((id, self) => {
    const node = nodes.get(id) as CachedNode;
    const written = node.friendIds
      .map((friend) => people.get(friend) as number)
      .filter((index) => !symmetric || index > self);
    writeVarint(counts, written.length);
    writeGaps(friends, written);
    const rated = Object.entries(node.ratings)
      .map(([key, value]) => [keys.get(key) as number, value] as const)
      .sort((left, right) => left[0] - right[0]);
    writeVarint(counts, rated.length);
    writeGaps(
      thumbs,
      rated.map(([index]) => index),
    );
    for (const [, value] of rated) {
      packed |= VALUE_CODES.indexOf(value) << (2 * inPack);
      inPack += 1;
      if (inPack === 4) {
        values.push(packed);
        packed = 0;
        inPack = 0;
      }
    }
  });
  if (inPack > 0) values.push(packed);
  return Uint8Array.from([
    ...header,
    ...counts,
    ...friends,
    ...thumbs,
    ...values,
  ]);
}

class Reader {
  private at = 0;
  constructor(private readonly bytes: Uint8Array) {}

  varint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.bytes[this.at];
      if (byte === undefined || scale > 2 ** 49) throw new Error("truncated");
      this.at += 1;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 0x80;
    }
  }

  byte(): number {
    return this.take(1)[0] as number;
  }

  take(length: number): Uint8Array {
    if (this.at + length > this.bytes.length) throw new Error("truncated");
    const slice = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }

  gaps(count: number, bound: number): number[] {
    const indices: number[] = [];
    let last = 0;
    for (let index = 0; index < count; index += 1) {
      last += this.varint();
      if (last >= bound) throw new Error("out of range");
      indices.push(last);
    }
    return indices;
  }

  done(): boolean {
    return this.at === this.bytes.length;
  }
}

function uuidOf(bytes: Uint8Array): string {
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `encodeNeighbourhood` undone, or null for anything it could not have
 * written: a cache that cannot be read is a cache that is missing.
 */
export function decodeNeighbourhood(
  bytes: Uint8Array,
): Map<string, CachedNode> | null {
  try {
    const reader = new Reader(bytes);
    const peopleCount = reader.varint();
    const loadedCount = reader.varint();
    if (loadedCount > peopleCount) return null;
    const people: string[] = [];
    for (let index = 0; index < peopleCount; index += 1) {
      people.push(uuidOf(reader.take(16)));
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const keyCount = reader.varint();
    const keys: string[] = [];
    for (let index = 0; index < keyCount; index += 1) {
      keys.push(decoder.decode(reader.take(reader.varint())));
    }
    const mode = reader.byte();
    if (mode !== SYMMETRIC && mode !== WHOLE) return null;

    const friendCounts: number[] = [];
    const thumbCounts: number[] = [];
    for (let index = 0; index < loadedCount; index += 1) {
      friendCounts.push(reader.varint());
      thumbCounts.push(reader.varint());
    }
    const friendLists: number[][] = Array.from(
      { length: loadedCount },
      () => [],
    );
    friendCounts.forEach((count, self) => {
      for (const friend of reader.gaps(count, peopleCount)) {
        if (mode === SYMMETRIC) {
          if (friend <= self) throw new Error("not symmetric");
          if (friend < loadedCount) friendLists[friend]?.push(self);
        }
        friendLists[self]?.push(friend);
      }
    });
    const rated = thumbCounts.map((count) => reader.gaps(count, keyCount));
    const valueBytes = reader.take(
      Math.ceil(thumbCounts.reduce((sum, count) => sum + count, 0) / 4),
    );
    if (!reader.done()) return null;

    const nodes = new Map<string, CachedNode>();
    let thumb = 0;
    for (let index = 0; index < loadedCount; index += 1) {
      const ratings: Record<string, number> = {};
      for (const key of rated[index] as number[]) {
        const packed = valueBytes[thumb >> 2] as number;
        ratings[keys[key] as string] = VALUE_CODES[
          (packed >> (2 * (thumb & 3))) & 3
        ] as number;
        thumb += 1;
      }
      const friendIds = (friendLists[index] as number[])
        .map((friend) => people[friend] as string)
        .sort();
      nodes.set(people[index] as string, { friendIds, ratings });
    }
    return nodes;
  } catch {
    return null;
  }
}

/**
 * Bytes as text a `text` column holds and the wire carries at one byte a
 * character: seven bits to a character, the value itself for 1–127 and
 * U+0080 (two bytes) for 0, since text cannot hold a NUL. About an eighth
 * over the bytes, where base64 is a third and a bytea's hex is double — and
 * postgres.js reads every result as text, so the protocol's binary format is
 * not on offer.
 */
export function bytesToText(bytes: Uint8Array): string {
  const characters: string[] = [];
  let bits = 0;
  let held = 0;
  const emit = (value: number) =>
    characters.push(String.fromCharCode(value === 0 ? 0x80 : value));
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    held += 8;
    while (held >= 7) {
      held -= 7;
      emit((bits >> held) & 0x7f);
    }
    bits &= (1 << held) - 1;
  }
  if (held > 0) emit((bits << (7 - held)) & 0x7f);
  return characters.join("");
}

/** `bytesToText` undone, or null for a character it never writes. */
export function textToBytes(text: string): Uint8Array | null {
  const bytes = new Uint8Array(Math.floor((text.length * 7) / 8));
  let bits = 0;
  let held = 0;
  let at = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0 || code > 0x80) return null;
    bits = (bits << 7) | (code === 0x80 ? 0 : code);
    held += 7;
    if (held >= 8) {
      held -= 8;
      if (at < bytes.length) bytes[at] = (bits >> held) & 0xff;
      at += 1;
    }
    bits &= (1 << held) - 1;
  }
  return bytes;
}

async function through(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The stored blob: the encoding, gzipped, as text. Null when it cannot be encoded. */
export async function packNeighbourhood(
  nodes: CachedNeighbourhood,
): Promise<string | null> {
  const encoded = encodeNeighbourhood(nodes);
  return encoded
    ? bytesToText(await through(encoded, new CompressionStream("gzip")))
    : null;
}

/** A stored blob read back, or null when it is not one `pack` wrote. */
export async function unpackNeighbourhood(
  blob: string,
): Promise<Map<string, CachedNode> | null> {
  try {
    const bytes = textToBytes(blob);
    return bytes
      ? decodeNeighbourhood(
          await through(bytes, new DecompressionStream("gzip")),
        )
      : null;
  } catch {
    return null;
  }
}
