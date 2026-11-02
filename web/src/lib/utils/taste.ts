import { type ScoreData, sanitizeRatings } from "grapevine-shared/entries";

// One account's thumbs as the database hands them over: item id, then tag,
// with the empty string for the thing itself.
export type Thumbs = Readonly<Record<string, Readonly<Record<string, number>>>>;

// What `followed_stamps` answers per followed account: a value that changes
// whenever that account's thumbs do, and says nothing else about them.
export type Stamp = { readonly uid: string; readonly stamp: string };

// A followed account's thumbs as last read: the stamp they were read at, and
// the two numbers the server needs to answer with only what changed since.
export type Held = {
  readonly stamp: string;
  readonly revision: number;
  readonly removed: number;
  readonly thumbs: Thumbs;
};

// What `account_thumbs_since` answers: everything (`full`), or the thumbs
// written and the thumbs cleared since the revision it was asked from.
export type ThumbsSince = {
  readonly revision: number;
  readonly removed: number;
  readonly full: boolean;
  readonly thumbs: Thumbs;
  readonly cleared: readonly (readonly [string, string])[];
};

// The core's input and output, as `rust/src/data.rs` declares them.
export type Snapshot = {
  readonly users: readonly string[];
  readonly follows: Readonly<Record<string, readonly string[]>>;
  readonly ratings: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

export type CoreResult = {
  readonly viewer: string;
  readonly scores: Readonly<Record<string, ScoreData>>;
  // Read through `readPlot`, which is what decides its shape.
  readonly plot?: unknown;
};

/** The followed accounts whose thumbs have to be read: new, or changed. */
export function staleAccounts(
  stamps: readonly Stamp[],
  held: ReadonlyMap<string, Held>,
): string[] {
  return stamps
    .filter(({ uid, stamp }) => held.get(uid)?.stamp !== stamp)
    .map(({ uid }) => uid);
}

/**
 * An answer from the server as a `ThumbsSince`, or null for anything that is
 * not one: what is kept on the device is only ever built from an answer that
 * was whole.
 */
export function readThumbsSince(answer: unknown): ThumbsSince | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { revision, removed, full, thumbs, cleared } = answer as Record<
    string,
    unknown
  >;
  if (
    typeof revision !== "number" ||
    typeof removed !== "number" ||
    typeof full !== "boolean" ||
    typeof thumbs !== "object" ||
    thumbs === null ||
    !Array.isArray(cleared)
  )
    return null;
  const pairs: [string, string][] = [];
  for (const pair of cleared) {
    if (
      !Array.isArray(pair) ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    )
      return null;
    pairs.push([pair[0], pair[1]]);
  }
  return { revision, removed, full, thumbs: thumbs as Thumbs, cleared: pairs };
}

/**
 * An account's thumbs after an answer: the answer itself when it is full,
 * otherwise what was held with the cleared thumbs taken out and the written
 * ones put in. Cleared first, because a thumb cleared and given again is both,
 * and the one that is there now is the written one.
 */
export function applyThumbsSince(held: Thumbs, answer: ThumbsSince): Thumbs {
  if (answer.full) return answer.thumbs;
  // Entries rather than assignment, so a thing named `__proto__` is a key.
  const items = new Map<string, Map<string, number>>();
  for (const [itemId, tags] of Object.entries(held))
    items.set(itemId, new Map(Object.entries(tags)));
  for (const [itemId, tag] of answer.cleared) {
    const tags = items.get(itemId);
    tags?.delete(tag);
    if (tags?.size === 0) items.delete(itemId);
  }
  for (const [itemId, tags] of Object.entries(answer.thumbs)) {
    const known = items.get(itemId) ?? new Map<string, number>();
    for (const [tag, value] of Object.entries(tags)) known.set(tag, value);
    items.set(itemId, known);
  }
  return Object.fromEntries(
    [...items].map(([itemId, tags]) => [itemId, Object.fromEntries(tags)]),
  );
}

/**
 * One value for "the same followed thumbs as last time", whatever order the
 * stamps came back in.
 */
export function stampSignature(stamps: readonly Stamp[]): string {
  return stamps
    .map(({ uid, stamp }) => `${uid}:${stamp}`)
    .sort()
    .join(" ");
}

/**
 * What the core is handed: the viewer, whom they follow, and everybody's
 * thumbs under one key per rated thing.
 *
 * A followed account with no usable thumb is still named, so that following
 * it is a fact the core is told rather than one it has to infer. The viewer is
 * left out of their own follows whatever the stamps say.
 */
export function buildSnapshot(
  viewer: string,
  own: Thumbs,
  followed: ReadonlyMap<string, Thumbs>,
): Snapshot {
  const ids = [...followed.keys()].filter((uid) => uid !== viewer).sort();
  const ratings: Record<string, Readonly<Record<string, number>>> = {};
  const mine = sanitizeRatings(own);
  if (mine !== null) ratings[viewer] = mine;
  for (const uid of ids) {
    const theirs = sanitizeRatings(followed.get(uid));
    if (theirs !== null) ratings[uid] = theirs;
  }
  return { users: [viewer, ...ids], follows: { [viewer]: ids }, ratings };
}

/** At most `limit` of `tasks` in flight at once, answers in the order asked. */
export async function inBatches<Input, Output>(
  inputs: readonly Input[],
  limit: number,
  task: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = new Array(inputs.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < inputs.length) {
      const index = next;
      next += 1;
      results[index] = await task(inputs[index] as Input);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, lane),
  );
  return results;
}
