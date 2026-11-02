import { foldQuery } from "./discover";
import type { Account } from "./types";

/** Order accounts by name, then by id so two of one name keep their places. */
export function byName(left: Account, right: Account): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.uid.localeCompare(right.uid)
  );
}

/** An account the people screen's search found, and which of its tags it read. */
export type FoundAccount = {
  readonly account: Account;
  readonly matchedTags: readonly string[];
};

function startsAWord(text: string, word: string): boolean {
  return foldQuery(text)
    .split(" ")
    .some((part) => part.startsWith(word));
}

function named(account: Account, word: string): boolean {
  return (
    (account.handle !== null && foldQuery(account.handle).startsWith(word)) ||
    startsAWord(account.displayName, word)
  );
}

/**
 * The accounts the people screen's search finds (DESIGN §1 item 5): every word
 * typed starts the handle, a word of the name, or a word of one of a prefilled
 * account's tags — any of them, not only those its row shows by default.
 *
 * `known` is everybody the viewer may see at all — the accounts they follow,
 * the people following them, and every prefilled account — so nobody is found
 * who was not already theirs to see, and a person, who has no tags, is found
 * by name alone. Each account once, by name. Punctuation, operators included,
 * folds away, so `@ebert` is `ebert`.
 */
export function findAccounts(
  query: string,
  known: readonly Account[],
): FoundAccount[] {
  const words = foldQuery(query)
    .split(" ")
    .filter((word) => word.length > 0);
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const found: FoundAccount[] = [];
  for (const account of known) {
    if (seen.has(account.uid)) continue;
    seen.add(account.uid);
    const matched = new Set<string>();
    const answers = words.every((word) => {
      const tags = account.tags.filter((tag) => startsAWord(tag, word));
      for (const tag of tags) matched.add(tag);
      return tags.length > 0 || named(account, word);
    });
    if (answers)
      found.push({
        account,
        matchedTags: account.tags.filter((tag) => matched.has(tag)),
      });
  }
  return found.sort((left, right) => byName(left.account, right.account));
}

// As many as a thing's row carries, and for the same reason: a row's worth.
const CHIPS_PER_ROW = 3;

/**
 * The tags an account's row shows: the matched ones first, then the rest, a
 * row's worth — and every matched tag, however far down the account's list it
 * sits, since it is why the row is there.
 */
export function accountChips(
  account: Account,
  matchedTags: readonly string[],
): readonly string[] {
  const matched = account.tags.filter((tag) => matchedTags.includes(tag));
  return [
    ...matched,
    ...account.tags.filter((tag) => !matchedTags.includes(tag)),
  ].slice(0, Math.max(CHIPS_PER_ROW, matched.length));
}
