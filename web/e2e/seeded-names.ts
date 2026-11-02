// How a dumped world's names become the seeded stack's, shared by the seeding
// and by the tests that look for them on screen.

/** What the crate joins an item to one of its attributes with. */
export const RATABLE_JOIN = String.fromCodePoint(0);

/**
 * A few of the simulator's `i0`… ids under names a person would actually type,
 * so that every test runs over an accent, a script with no Latin in it and a
 * space between two words rather than over ASCII alone.
 *
 * `café bleu` is the one the written tests name: its `search_id` is
 * `cafe bleu`, so typing the unaccented spelling has to find it.
 */
export const NAMED_ITEMS: Readonly<Record<string, string>> = {
  i0: "café bleu",
  i1: "日本",
  i2: "late night diner",
  i3: "o'brien's",
};

/**
 * The simulator's `t0`… attributes as words, and as words that share no
 * spelling: the list's search forgives a typo, and `t1` typed for `t2` is one,
 * so under the simulator's own names a query for one attribute would be
 * answered by all of them.
 */
export const NAMED_TAGS: Readonly<Record<string, string>> = {
  t0: "cozy",
  t1: "outdoors",
  t2: "spicy",
  t3: "vegan",
  t4: "loud",
  t5: "bookish",
};

/**
 * The id a simulated item is stored and drawn under. There is no second field
 * for a name, so this IS the display text and it has to be something
 * `normalizeId` would have emitted.
 */
export function itemIdOf(simulated: string): string {
  return NAMED_ITEMS[simulated] ?? simulated;
}

/** The word a simulated attribute is stored under. */
export function tagOf(simulated: string): string {
  return NAMED_TAGS[simulated] ?? simulated;
}

/**
 * The one prefilled account a seeded stack holds, which nobody follows until a
 * test or a person does.
 */
export const SEEDED_PREFILLED = {
  handle: "critic",
  displayName: "The Critic",
  // A thing only this account has rated, so following it is visible on a list.
  ownItem: "the critic's pick",
} as const;
