// How a dumped world's names become the seeded stack's, shared by the seeding
// and by `check:recs-parity`, which has to turn them back to compare the stack
// with the crate. Plain `.mjs` because that check runs under `node`.

/** What the crate joins an item to one of its attributes with. */
export const RATABLE_JOIN = String.fromCodePoint(0);

/**
 * A few of the simulator's `i0`… ids under names a person would actually type,
 * so that every check runs over an accent, a script with no Latin in it and a
 * space between two words rather than over ASCII alone.
 *
 * `café bleu` is the one the written checks name: its `search_id` is
 * `cafe bleu`, so typing the unaccented spelling has to find it.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const NAMED_ITEMS = {
  i0: "café bleu",
  i1: "日本",
  i2: "late night diner",
  i3: "o'brien's",
};

/**
 * The id this thing is stored and drawn under — there is no second field for a
 * name (DESIGN §3.2), so this IS the display text and it has to be something
 * `normalizeId` would have emitted.
 *
 * @param {string} simulated
 * @returns {string}
 */
export function itemIdOf(simulated) {
  return NAMED_ITEMS[simulated] ?? simulated;
}
