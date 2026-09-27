"use client";

import { foldQuery, matchesText } from "./discover";

// A row of the people screen: a friend, and all the screen knows about them.
// There is no person page to open and no standing to report (DESIGN §4).
export type PersonRow = {
  readonly uid: string;
  readonly displayName: string;
  readonly photoURL: string | null;
};

/**
 * Does this person match what is typed in the people screen's field?
 *
 * The name, over the same subsequence match the list uses, and nothing else —
 * the field filters the friends already on screen and reaches nobody past
 * them: a friend is made by a link, not found by typing (DESIGN §1).
 */
export function matchesPerson(person: PersonRow, query: string): boolean {
  return matchesText(foldQuery(query), person.displayName);
}
