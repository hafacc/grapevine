"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { foldQuery, matchesText } from "./discover";
import { useGrapevine } from "./store";
import {
  fetchSuggestions,
  refreshMySuggestions,
  sharedAttributes,
  visibleSuggestions,
} from "./suggestions";
import type { ConnectRequest, Suggestion } from "./types";
import { normalizeUsername } from "./username";

const NO_ATTRIBUTES: readonly string[] = [];

/**
 * Which section a person is in, which is also everything the screen knows about
 * them: there is no person page to open and no standing to report (DESIGN §4).
 */
export type PersonKind = "ask" | "friend" | "suggestion";

export type PersonRow = {
  readonly kind: PersonKind;
  readonly uid: string;
  readonly username: string;
  readonly displayName: string;
  readonly photoURL: string | null;
  // The attributes the two of you agree on against the grain, at most three
  // (DESIGN §5.1). Empty is a normal answer — somebody who agrees with you the
  // way your own network already does earns none — and the row is drawn without
  // them rather than with filler. A friend's row never carries any: there is
  // nothing left to decide about somebody you already know.
  readonly attributes: readonly string[];
  // The ask this row is, so accepting or declining has the row to act on.
  readonly request: ConnectRequest | null;
};

/**
 * Does this person match what is typed in the people screen's field?
 *
 * The handle and the name, over the same subsequence match the list uses, and
 * nothing else — there is no browsing for people and no search that reaches
 * past the three sections already on screen (DESIGN §1). A leading `@` is
 * dropped, because typing one is how a person says they mean a handle.
 */
export function matchesPerson(person: PersonRow, query: string): boolean {
  const folded = foldQuery(query.replace(/^@+/, ""));
  return (
    matchesText(folded, person.username) ||
    matchesText(folded, person.displayName)
  );
}

/**
 * The handle to offer *ask … to connect* for, or null.
 *
 * Only when what is typed could BE a handle and nobody on screen has it: a
 * handle is exact, and the ask goes to a person the viewer has named rather
 * than to one they picked out of a list.
 */
export function unknownHandle(
  query: string,
  shown: readonly PersonRow[],
): string | null {
  const handle = normalizeUsername(query);
  if (handle.length === 0) return null;
  return shown.some((person) => person.username === handle) ? null : handle;
}

function toRow(
  kind: PersonKind,
  person: {
    uid: string;
    username: string;
    displayName: string;
    photoURL?: string | null;
  },
  attributes: readonly string[],
  request: ConnectRequest | null,
): PersonRow {
  return {
    kind,
    uid: person.uid,
    username: person.username,
    displayName: person.displayName,
    photoURL: person.photoURL ?? null,
    attributes,
    request,
  };
}

/**
 * Everything the people screen draws, in the order it draws it.
 *
 * The suggestions are recomputed ON OPEN, the way the feed is: nothing runs
 * them on a schedule, so `refresh-suggestions` is called here and the function
 * decides whether that means anything — a list written under ten minutes ago
 * comes straight back, so opening this screen twice costs one search. Same rule
 * and same shape as `refreshMyRecs`, which is why the call is unconditional and
 * the window lives in one place rather than two.
 *
 * Nobody sees their own outgoing ask: asking somebody hides them from every
 * section until they accept (DESIGN §1). That is the whole of what
 * `outgoingRequests` is used for here.
 */
export function usePeople(): {
  asks: readonly PersonRow[];
  friends: readonly PersonRow[];
  suggested: readonly PersonRow[];
  // The search has been run at least once for this viewer, so an empty
  // `suggested` is an answer rather than a screen that has not asked yet.
  searched: boolean;
  searching: boolean;
  // The search could not be run. Distinct from "nobody was found", the same way
  // every other read on this screen keeps the two apart.
  failed: boolean;
} {
  const {
    user,
    friends,
    incomingRequests,
    outgoingRequests,
    prefs,
    prefsReady,
    suggestions: stored,
    channelGeneration,
  } = useGrapevine();
  const uid = user?.uid ?? null;

  // Written by the search below and preferred over the stored list once it is:
  // a recompute that found somebody new has already answered with the uids, and
  // re-reading is what turns those into the names a row is drawn with.
  const [searched, setSearched] = useState<readonly Suggestion[] | null>(null);
  // A search has answered for this viewer, so an empty list is an answer.
  const [ran, setRan] = useState(false);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attributes, setAttributes] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  // Who has been asked about, so a re-render while a call is in flight does not
  // send a second one. Cleared with the viewer, since the answer is about the
  // pair and not about the person.
  const asked = useRef<Set<string>>(new Set());
  // Only the newest search may answer: one asked for before the switch moved
  // describes the old setting, and landing last it would say so.
  const latest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!uid) return;
    latest.current += 1;
    const mine = latest.current;
    setSearching(true);
    try {
      const result = await refreshMySuggestions();
      // The call answers with uids and nothing else, so a list that moved is
      // read back for the handles and names its rows are drawn with.
      const found =
        result.suggested === null ? null : await fetchSuggestions(uid);
      if (mine !== latest.current) return;
      if (found !== null) setSearched(found);
      setRan(true);
      setFailed(false);
    } catch (error) {
      console.error("suggestions", error);
      if (mine === latest.current) setFailed(true);
    } finally {
      if (mine === latest.current) setSearching(false);
    }
  }, [uid]);

  // `channelGeneration` is what re-runs this after a dropped connection: the
  // screen is fetched rather than subscribed, so a reconnection is the only
  // signal that it may have missed something.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `channelGeneration` is unread on purpose — bumping it is how a lost channel gets re-read.
  useEffect(() => {
    if (!uid) {
      setSearched(null);
      setRan(false);
      setFailed(false);
      setAttributes({});
      asked.current = new Set();
      return;
    }
    void refresh();
  }, [uid, channelGeneration, refresh]);

  // The switch moving is a new question. The server forgets when it last
  // searched as the setting is written (0001's `forget_suggestions_search`), so
  // this search runs rather than answering from its window with the list the
  // old setting wrote — which, switched on, is the empty one, and would put
  // "nobody with similar taste yet" on screen before anybody had looked.
  const discoverable = prefsReady ? prefs.discoverableByTaste : null;
  const seenDiscoverable = useRef<boolean | null>(null);
  useEffect(() => {
    const before = seenDiscoverable.current;
    seenDiscoverable.current = discoverable;
    if (before === null || discoverable === null || before === discoverable)
      return;
    setRan(false);
    void refresh();
  }, [discoverable, refresh]);

  const offered = useMemo(
    () =>
      visibleSuggestions(searched ?? stored, prefs, friends, outgoingRequests),
    [searched, stored, prefs, friends, outgoingRequests],
  );

  // Only the two kinds of row that carry chips, and only the people already on
  // screen: the function answers for somebody who asked the viewer or who was
  // suggested to them, which is exactly this set.
  const wanted = useMemo(
    () => [
      ...incomingRequests.map((request) => request.other.uid),
      ...offered.map((suggestion) => suggestion.uid),
    ],
    [incomingRequests, offered],
  );

  useEffect(() => {
    if (!uid) return;
    for (const other of wanted) {
      if (asked.current.has(other)) continue;
      asked.current.add(other);
      void sharedAttributes(other)
        .then((tags) => setAttributes((known) => ({ ...known, [other]: tags })))
        .catch((error) => {
          // Forgotten rather than cached as empty: a read that failed says
          // nothing about what the two of you agree on, and an empty list is a
          // claim this screen makes out loud.
          asked.current.delete(other);
          console.error("shared attributes", error);
        });
    }
  }, [uid, wanted]);

  const asks = useMemo(
    () =>
      incomingRequests.map((request) =>
        toRow(
          "ask",
          request.other,
          attributes[request.other.uid] ?? NO_ATTRIBUTES,
          request,
        ),
      ),
    [incomingRequests, attributes],
  );

  const friendRows = useMemo(
    () => friends.map((friend) => toRow("friend", friend, NO_ATTRIBUTES, null)),
    [friends],
  );

  const suggestedRows = useMemo(
    () =>
      offered.map((suggestion) =>
        toRow(
          "suggestion",
          { ...suggestion, photoURL: null },
          attributes[suggestion.uid] ?? NO_ATTRIBUTES,
          null,
        ),
      ),
    [offered, attributes],
  );

  return {
    asks,
    friends: friendRows,
    suggested: suggestedRows,
    searched: ran,
    searching,
    failed,
  };
}
