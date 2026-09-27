"use client";

import { normalizeId } from "grapevine-shared";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { googleSignIn, deleteAccount as pgDeleteAccount } from "./auth";
import { clientState, recordDebugEvent } from "./debug";
import { forgetHintsSeen } from "./first-run";
import {
  fetchFriends,
  fetchLocked,
  fetchOwnProfile,
  unfriend as pgUnfriend,
  updateProfileIdentity,
} from "./friends";
import {
  fetchMyLink,
  forgetInvite,
  type InviteOwner,
  isInviteToken,
  inviteOwner as pgInviteOwner,
  redeemInvite as pgRedeemInvite,
  setInviteLink as pgSetInviteLink,
  turnOffLink as pgTurnOffLink,
  takeInvite,
} from "./invites";
import {
  HEALTHY,
  onChannelJoined as joinedHealth,
  onChannelLoss,
} from "./reattach";
import { forgetCachedFeeds } from "./recs";
import { explainWriteFailure, lockedAfterUnfriend } from "./refusal";
import { nextSessionUser, type SessionUser } from "./session-user";
import {
  exchangeFailure,
  forgetSignInReturn,
  SIGN_IN_TIMED_OUT,
  takeSignInReturn,
  withoutCode,
} from "./sign-in-return";
import {
  onChannelJoined,
  onChannelLost,
  retryTransient,
  subscribeChannel,
  supabase,
  supabaseConfigured,
  whenSocketOpen,
} from "./supabase";
import type { Friend, Profile, Screen } from "./types";

export type { SessionUser };

// How long a tab may go unwatched before coming back is worth a re-read. What
// is fetched rather than subscribed changes by the viewer's own action, so this
// is about a laptop that was shut, not a list that moves.
const REFETCH_AFTER_MS = 30_000;

// How long a re-attach may wait for the socket before the screen says it has
// stopped receiving updates. No channel is made while the socket is down, so
// nothing else fails in that time to run the retry budget out.
const SOCKET_STALE_MS = 15_000;

// How long the splash may wait for a session before the gate opens without
// one. Longer than `AUTH_DEADLINE_MS`, so a stalled exchange normally ends as
// the auth server's own error rather than as this.
const AUTH_GATE_MS = 15_000;

// How long the splash may wait for the profile before the page says the
// account cannot be reached. Longer than every retry `retryTransient` makes.
const PROFILE_GATE_MS = 15_000;

type ContextShape = {
  // False when no Supabase project is wired up: sign-in is refused with an
  // explanation rather than a failure, and the app still builds and renders.
  configured: boolean;
  authReady: boolean;
  // Every channel died and the retry budget is spent, or the socket has stayed
  // down past `SOCKET_STALE_MS`; the UI says the screen may be stale rather
  // than pretending it is live, until a channel joins again.
  listenersLost: boolean;
  // Bumped when a lost channel is to be re-attached. Read by `useMyRecs` and
  // `useMyRatings`, which own subscriptions of their own — one retry budget for
  // the whole app rather than one per hook.
  channelGeneration: number;
  user: SessionUser | null;
  // The provider's error code when the trip to Google came back refused or
  // cancelled, for the welcome screen to say; null otherwise.
  signInError: string | null;
  profile: Profile | null;
  profileReady: boolean;
  // No answer is coming right now, which is distinct from "no profile".
  profileUnreachable: boolean;
  friends: Friend[];
  // A friending link this device was handed and has not answered yet: taken out
  // of the address on arrival and kept across the trip to Google (`invites.ts`).
  inviteToken: string | null;
  // Whose that link is, read signed out as well as in: undefined until the
  // lookup answers, null when the link no longer works.
  inviteFrom: InviteOwner | null | undefined;
  // The lookup behind `inviteFrom` failed, so undefined will not change by
  // itself; `retryInviteLookup` asks again.
  inviteLookupFailed: boolean;
  retryInviteLookup: () => void;
  // The viewer's own link: undefined until read, null while it is off.
  myLink: string | null | undefined;
  screen: Screen;
  // Bumped on every history pop, so a screen can tell one from the next even
  // when the screen itself is unchanged.
  popped: number;
  navigate: (screen: Screen) => void;
  back: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  // The owner's id, or null when the link stopped working. Once the server has
  // answered, either way, the waiting token is spent.
  redeemInvite: (token: string) => Promise<string | null>;
  // Said no to, or found to be dead: forgotten without writing anything.
  dismissInvite: () => void;
  // Turns the viewer's link on, or replaces it; the old one stops working.
  setInviteLink: () => Promise<string>;
  turnOffLink: () => Promise<void>;
  unfriend: (friendUid: string) => Promise<void>;
  // Asks the server whether the account is locked and shows the answer.
  recheckLocked: () => Promise<boolean>;
  // What to say about a failed write, or null when the answer is that the
  // account is locked, which the locked screen then says instead.
  explainFailure: (error: unknown, fallback: string) => Promise<string | null>;
};

const Ctx = createContext<ContextShape | null>(null);

const EMPTY_FRIENDS: Friend[] = [];

const LIST_SCREEN: Screen = { kind: "list" };
const PEOPLE_SCREEN: Screen = { kind: "people" };

// The fragment rather than a path, because the site is a static export with no
// server to route with. The ids are not secrets — every read they name is gated
// by the policies.
export function screenHash(screen: Screen): string {
  switch (screen.kind) {
    case "list":
      return "#/";
    case "people":
      return "#/people";
    case "item":
      return `#/item/${encodeURIComponent(screen.id)}`;
  }
}

// The inverse. Null for anything unrecognized, which callers read as "go to the
// list" rather than "render nothing".
export function screenForHash(hash: string): Screen | null {
  let segments: string[];
  try {
    segments = hash
      .replace(/^#/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return null; // a malformed %-escape names no screen either
  }
  const [first, second] = segments;
  switch (segments.length) {
    case 0:
      return LIST_SCREEN;
    case 1:
      return first === "people" ? PEOPLE_SCREEN : null;
    case 2:
      if (first === "item") {
        // A pasted or hand-typed link carries whatever spelling it was written
        // with, and the id is that text folded — so folding here is what makes
        // `#/item/Caf%C3%A9%20Bleu` and `#/item/caf%C3%A9%20bleu` one link.
        // `normalizeId` refuses what no id can be, which names no item.
        const id = normalizeId(second);
        return id === null ? null : { kind: "item", id };
      } else return null;
    default:
      return null;
  }
}

// A fragment names only the top screen, so a pasted link gets the list seeded
// beneath it — otherwise arriving on a thing means arriving with no way back.
export function stackForHash(hash: string): Screen[] {
  const screen = screenForHash(hash) ?? LIST_SCREEN;
  if (screen.kind === "list") return [screen];
  else return [LIST_SCREEN, screen];
}

// `depth` is how back() tells "a screen of ours is behind this" from "leaving
// the site".
type NavState = {
  readonly grapevineStack?: readonly Screen[];
  readonly grapevineDepth?: number;
  readonly grapevineScroll?: number;
};

function historyDepth(): number {
  return (window.history.state as NavState | null)?.grapevineDepth ?? 0;
}

// Merged, not replaced: Next's router keeps its own data in history.state, and
// clobbering it turns back/forward into a hard reload.
function entryState(
  stack: readonly Screen[],
  depth: number,
  scroll = 0,
): unknown {
  return {
    ...window.history.state,
    grapevineStack: stack,
    grapevineDepth: depth,
    grapevineScroll: scroll,
  };
}

// Per history entry rather than in React state, since that's what survives a
// reload and a forward.
export function historyScroll(): number {
  return (window.history.state as NavState | null)?.grapevineScroll ?? 0;
}

// Called by the page, the only place that knows which element scrolls.
export function rememberScroll(offset: number): void {
  const state = window.history.state as NavState | null;
  if (!state?.grapevineStack) return;
  window.history.replaceState(
    { ...window.history.state, grapevineScroll: offset },
    "",
    window.location.hash,
  );
}

function pushEntry(stack: readonly Screen[]): void {
  window.history.pushState(
    entryState(stack, historyDepth() + 1),
    "",
    screenHash(stack[stack.length - 1]),
  );
}

function replaceEntry(stack: readonly Screen[], depth = historyDepth()): void {
  window.history.replaceState(
    // Carrying the scroll, because a replace changes what this entry POINTS AT
    // and not where the reader is standing in it. Defaulting to 0, coming back
    // to the entry later would land at the top of a list the reader had
    // scrolled deep into.
    entryState(stack, depth, historyScroll()),
    "",
    screenHash(stack[stack.length - 1]),
  );
}

/**
 * Whether a sign-out left this device signed in. An error alone is not that:
 * the local session is removed before the server is told, so offline the call
 * fails and the device is signed out all the same.
 */
export function signOutFailed(error: unknown, sessionLeft: boolean): boolean {
  return error !== null && error !== undefined && sessionLeft;
}

// What this device keeps about the account that was signed in. The session is
// the SDK's to remove; the feed cache and the hints seen are ours.
function forgetDevice(): void {
  try {
    forgetCachedFeeds(window.localStorage);
    forgetHintsSeen(window.localStorage);
  } catch {
    // Storage refused: there was nothing written to it to forget.
  }
}

// Only on a sign-out somebody asked for, not on every `SIGNED_OUT`: a stale
// session refused on load signs out too, and would take with it the link that
// was just opened.
function forgetTab(): void {
  forgetInvite();
  forgetSignInReturn();
}

export function GrapevineProvider({ children }: { children: ReactNode }) {
  const configured = supabaseConfigured();

  const [user, setUser] = useState<SessionUser | null>(null);
  const uid = user?.uid ?? null;
  // A row in `profiles`, not a field on the auth account, so it is fetched.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileUnreachable, setUnreachable] = useState(false);
  // The account `profile` belongs to.
  const profileOwner = useRef<string | null>(null);
  // A persisted session is restored asynchronously and a sign-in comes back with
  // a code still to be exchanged, so this stops the gate flashing the welcome
  // screen at someone already signed in.
  const [authReady, setAuthReady] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  // Re-attaching channels the server dropped. Bumping `generation` re-subscribes
  // every one of them, here and in the two hooks that own their own;
  // `retryTimer` being non-null doubles as the guard that collapses a burst of
  // losses into one retry.
  const [generation, setGeneration] = useState(0);
  const [listenersLost, setListenersLost] = useState(false);
  const health = useRef(HEALTHY);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A re-attach that is due and waiting for the socket to come back. One at a
  // time, so only one set of channels is made when the socket returns.
  const socketWait = useRef<(() => void) | null>(null);
  const [friends, setFriends] = useState<Friend[]>(EMPTY_FRIENDS);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteFrom, setInviteFrom] = useState<InviteOwner | null | undefined>(
    undefined,
  );
  const [inviteLookupFailed, setInviteLookupFailed] = useState(false);
  const [inviteLookups, setInviteLookups] = useState(0);
  const [myLink, setMyLink] = useState<string | null | undefined>(undefined);

  // The list is only the starting guess — the effect below reads the real stack
  // out of the URL, which can't happen here because this also runs at prerender.
  const [stack, setStack] = useState<Screen[]>([LIST_SCREEN]);
  const [popped, setPopped] = useState(0);
  const screen = stack[stack.length - 1];

  // Every forward move pushes a real history entry and back() delegates to
  // history.back(), so the OS back button and the in-app one are one button.
  const navigate = useCallback(
    (target: Screen) => {
      const next = [...stack, target];
      pushEntry(next);
      setStack(next);
    },
    [stack],
  );
  const back = useCallback(() => {
    if (historyDepth() > 0) {
      window.history.back();
    } else {
      // Nothing of ours behind this entry, so Back means "up a level" rather
      // than "leave the site" — and there is one level, the list.
      const next: Screen[] = [LIST_SCREEN];
      replaceEntry(next);
      setStack(next);
    }
  }, []);

  useEffect(() => {
    // First, so a screen carried across the trip to Google is back in the
    // fragment before anything below reads it, and a link's token is out of it.
    takeSignInReturn();
    setInviteToken(takeInvite());
    // The fragment wins when the two disagree, being the half a user can edit.
    const saved =
      (window.history.state as NavState | null)?.grapevineStack ?? [];
    const restored =
      saved.length > 0 &&
      screenHash(saved[saved.length - 1]) === window.location.hash
        ? [...saved]
        : stackForHash(window.location.hash);
    // Never push: the arrival entry is ours to annotate, and pushing would leave
    // a phantom under the first Back.
    replaceEntry(restored);
    setStack(restored);

    function onPop(event: PopStateEvent): void {
      const stacked = (event.state as NavState | null)?.grapevineStack;
      // Bumped so the page can tell one pop from the next even on the same screen.
      setPopped((count) => count + 1);
      setStack(
        stacked && stacked.length > 0
          ? [...stacked]
          : stackForHash(window.location.hash),
      );
    }
    // The browser has already pushed a blank entry by the time this fires, so we
    // adopt it in place — a second write is the double entry this scheme avoids.
    function onHashChange(): void {
      // A link pasted into a tab that is already open. Taken out before the
      // fragment is read, so what is left is the list.
      const taken = takeInvite();
      if (taken !== null) setInviteToken(taken);
      const current = (window.history.state as NavState | null)?.grapevineStack;
      const showing = current?.[current.length - 1];
      if (showing && screenHash(showing) === window.location.hash) return;
      const next = stackForHash(window.location.hash);
      replaceEntry(next, Math.max(historyDepth(), 1));
      setStack(next);
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  // Read through a ref, not a closure. An action can be HELD — captured at the
  // tap, run after the identity sheet writes a profile — and a callback that
  // closed over `profile` would capture the null that opened the sheet, throw
  // "not signed in" after the name had saved, and have the sheet blame the
  // network. Anything a held action can reach must read the profile at CALL
  // time.
  const profileRef = useRef<Profile | null>(profile);
  profileRef.current = profile;

  const cancelReattach = useCallback((): void => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    socketWait.current?.();
    socketWait.current = null;
  }, []);

  useEffect(() => {
    // Once per incident: `lost` stays set until a channel joins again.
    const report = (): void => {
      if (health.current.lost) return;
      health.current = { ...health.current, lost: true };
      recordDebugEvent("listeners-lost", {
        spent: health.current.budget.spent,
        ...clientState(),
      });
      setListenersLost(true);
    };
    const reattach = (): void => {
      retryTimer.current = null;
      if (socketWait.current !== null) return;
      let done = false;
      const stale = setTimeout(report, SOCKET_STALE_MS);
      const cancel = whenSocketOpen(() => {
        done = true;
        clearTimeout(stale);
        socketWait.current = null;
        setGeneration((previous) => previous + 1);
      });
      if (!done)
        socketWait.current = () => {
          clearTimeout(stale);
          cancel();
        };
    };
    const stopLosses = onChannelLost(() => {
      // Every channel dies together whenever the token is what's refused, so a
      // burst has to buy ONE re-attach, not one per channel.
      if (retryTimer.current !== null) return;
      const response = onChannelLoss(health.current, Date.now());
      if (response.kind === "ignore") return;
      if (response.kind === "report") {
        report();
      } else {
        health.current = response.health;
        retryTimer.current = setTimeout(reattach, response.delay);
      }
    });
    const stopJoins = onChannelJoined(() => {
      health.current = joinedHealth(health.current);
      setListenersLost(false);
    });
    return () => {
      stopLosses();
      stopJoins();
      cancelReattach();
    };
  }, [cancelReattach]);

  // The pending re-attach has to be cancelled alongside the counters: sign-out
  // kills every channel by itself, so one still armed would re-attach against
  // the new session — and, being the burst guard, swallow its first real loss.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `uid` IS the dependency — the effect reads nothing from it and exists only to fire when the account changes.
  useEffect(() => {
    cancelReattach();
    health.current = HEALTHY;
    setListenersLost(false);
  }, [uid]);

  useEffect(() => {
    if (!configured) {
      // No project, so no session is possible and the gate can settle at once.
      setAuthReady(true);
      return;
    }
    setSignInError(takeSignInReturn().errorCode);
    let settled = false;
    // Only a return from Google is reported: a gate that opens late on a
    // restored session has nothing to tell a visitor who never tried.
    const returning = new URLSearchParams(window.location.search).has("code");
    const dropCode = (): void => {
      const cleaned = withoutCode(window.location.href);
      if (cleaned !== null)
        window.history.replaceState(window.history.state, "", cleaned);
    };
    // A failed exchange of `?code=` is not delivered to the listener below:
    // `initialize()` resolves with it and supabase-js only logs it, so without
    // this the welcome screen comes back as though nothing had been tried.
    void supabase()
      .auth.initialize()
      .then(({ error }) => {
        if (!error || !returning) return;
        setSignInError(exchangeFailure(error));
        dropCode();
      });
    const deadline = setTimeout(() => {
      if (settled) return;
      if (returning) {
        setSignInError(SIGN_IN_TIMED_OUT);
        dropCode();
      }
      setAuthReady(true);
    }, AUTH_GATE_MS);
    // `INITIAL_SESSION` arrives once the SDK has restored a persisted session
    // and, on the way back from Google, exchanged the `?code=` in the query
    // string — so this fires after both and there is no second read to settle
    // the gate with. Nothing but state and this device's own storage is touched
    // inside the callback: the SDK holds its own lock while it runs, and a query
    // issued from in here waits on a lock that waits on it.
    const { data } = supabase().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") forgetDevice();
      setUser((previous) => nextSessionUser(previous, session));
      settled = true;
      clearTimeout(deadline);
      setAuthReady(true);
    });
    return () => {
      clearTimeout(deadline);
      data.subscription.unsubscribe();
    };
  }, [configured]);

  // Whose link is waiting, asked once per token and signed out or in: the
  // welcome screen names it, and the question after sign-in shows the face.
  // A dead link is forgotten from storage at once — the screen showing says so
  // — so it does not come back from Google to be said a second time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `inviteLookups` is unread on purpose — bumping it is how a failed lookup is asked again.
  useEffect(() => {
    setInviteFrom(undefined);
    setInviteLookupFailed(false);
    if (!configured || !inviteToken) return;
    if (!isInviteToken(inviteToken)) {
      forgetInvite();
      setInviteFrom(null);
      return;
    }
    let live = true;
    void retryTransient(() => pgInviteOwner(inviteToken))
      .then((owner) => {
        if (!live) return;
        if (owner === null) forgetInvite();
        setInviteFrom(owner);
      })
      .catch((error) => {
        console.error("invite owner", error);
        if (live) setInviteLookupFailed(true);
      });
    return () => {
      live = false;
    };
  }, [configured, inviteToken, inviteLookups]);

  const retryInviteLookup = useCallback(() => {
    setInviteLookups((count) => count + 1);
  }, []);

  const refreshFriends = useCallback(async (): Promise<void> => {
    if (!uid) return;
    setFriends(await fetchFriends(uid));
  }, [uid]);

  // A read that never answers neither fails nor succeeds, so without this the
  // splash stays up for good. Keyed on the account and not on each re-read: a
  // lost channel re-runs the reads, and restarting the clock with them would
  // keep the gate shut for as long as the channels kept failing.
  useEffect(() => {
    if (!uid || profileReady) return;
    const gate = setTimeout(() => setUnreachable(true), PROFILE_GATE_MS);
    return () => clearTimeout(gate);
  }, [uid, profileReady]);

  /**
   * Everything the signed-in viewer owns, read on mount and again when the tab
   * comes back.
   *
   * These change by the viewer's own action — which this tab already knows
   * about, and writes through below — so a channel each would be subscriptions
   * bought to deliver nothing. What DOES move under a reader, the feed and a new
   * friend, has a channel of its own.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is unread on purpose — bumping it is how a lost channel gets re-read.
  useEffect(() => {
    if (!configured || !uid) {
      profileOwner.current = null;
      setProfile(null);
      setProfileReady(false);
      setUnreachable(false);
      setFriends(EMPTY_FRIENDS);
      setMyLink(undefined);
      return;
    }
    const mine = uid;
    let live = true;
    let last = 0;
    // One incident, not one per retry: this effect re-runs when the session or
    // the retry generation changes, which is what "another incident" means.
    let reported = false;

    /**
     * The profile, and whether the account is locked (0010).
     *
     * A read that FAILED leaves `profileReady` false and reports the session as
     * unreachable, so a returning viewer with no network sees "can't reach us"
     * rather than a screen drawn from a guess. There is no "the profile is
     * missing" case: the row is created by the same transaction that creates
     * the account.
     */
    const loadProfile = async (): Promise<void> => {
      try {
        const next = await retryTransient(() => fetchOwnProfile(mine));
        if (!live) return;
        setProfile(next);
        setProfileReady(true);
        setUnreachable(false);
      } catch (error) {
        if (!live) return;
        console.error("profile", error);
        setUnreachable(true);
        if (!reported) {
          reported = true;
          recordDebugEvent("profile-unreachable", {
            code: String(error),
            ...clientState(),
          });
        }
      }
    };

    const loadSocial = async (): Promise<void> => {
      const [link] = await Promise.all([fetchMyLink(), refreshFriends()]);
      if (!live) return;
      setMyLink(link);
    };

    const loadAll = (): void => {
      last = Date.now();
      void loadProfile();
      void retryTransient(loadSocial).catch((error) =>
        console.error("social", error),
      );
    };

    // A session swap must not show the old profile while the new one loads. A
    // re-read for the same account keeps it: a lost channel re-runs this
    // effect, and blanking the profile would put the splash back on every loss.
    if (profileOwner.current !== mine) {
      profileOwner.current = mine;
      setProfile(null);
      setProfileReady(false);
    }
    loadAll();

    const onWake = (): void => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last < REFETCH_AFTER_MS) return;
      loadAll();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      live = false;
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [configured, uid, generation, refreshFriends]);

  /**
   * A new friend, live.
   *
   * Somebody opening the viewer's link makes a friendship the viewer did not
   * act in, so it arrives as the INSERT of the viewer's own half of the pair,
   * which the `friendships` read policy bounds. Deletes are not published
   * (`0006_realtime.sql`): a deleted row has nothing to apply a policy to, and
   * its key is both uuids, so an unfriending is seen on the next load.
   *
   * The payload is not read: the row wants the profile at the far end anyway,
   * so an event is a signal to re-read rather than a row to apply.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is unread on purpose — bumping it is how a lost channel gets re-attached.
  useEffect(() => {
    if (!configured || !uid) return;
    const channel = supabase()
      .channel(`friends:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friendships",
          filter: `user_id=eq.${uid}`,
        },
        () => {
          void refreshFriends().catch((error) =>
            console.error("friends", error),
          );
        },
      );
    subscribeChannel(channel, "friends");
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [configured, uid, generation, refreshFriends]);

  const signIn = useCallback(() => googleSignIn(), []);

  // This device only. The default scope revokes every refresh token the account
  // holds, so signing out of a borrowed laptop would sign the phone out too.
  //
  // The session is dropped here whether or not the server heard about it, so an
  // error with no session left is a sign-out that worked: offline, the request
  // to revoke the token fails after the device has already let go of it.
  const signOut = useCallback(async () => {
    const { error } = await supabase().auth.signOut({ scope: "local" });
    const { data } = await supabase().auth.getSession();
    if (!signOutFailed(error, data.session !== null)) {
      forgetDevice();
      forgetTab();
      setInviteToken(null);
    } else {
      throw error;
    }
  }, []);

  // The server has already revoked every session the account held, so what is
  // left is this device's copy of one; a failure here leaves the account gone
  // either way, and is not reported as the deletion failing.
  const deleteAccount = useCallback(async () => {
    await pgDeleteAccount();
    try {
      await signOut();
    } catch (error) {
      console.error(error);
      forgetDevice();
      forgetTab();
    }
  }, [signOut]);

  // One row, and every friend sees the new name the next time they read a
  // profile: there is no copy of it on an edge to go around rewriting.
  const updateDisplayName = useCallback(
    async (displayName: string) => {
      if (!uid) throw new Error("not signed in");
      await updateProfileIdentity(uid, {
        displayName,
        photoURL: profileRef.current?.photoURL ?? null,
      });
      setProfile((current) =>
        current ? { ...current, displayName } : current,
      );
    },
    [uid],
  );

  // Forgotten once the server has answered, whatever it said. A write that
  // never answered keeps the token, so the next load asks again.
  const redeemInvite = useCallback(
    async (token: string) => {
      const owner = await pgRedeemInvite(token);
      forgetInvite();
      setInviteToken(null);
      if (owner !== null && owner !== uid) {
        // The friendship `redeem_invite` just wrote is what unlocks (0010).
        setProfile((current) =>
          current ? { ...current, locked: false } : current,
        );
        await refreshFriends();
      }
      return owner;
    },
    [uid, refreshFriends],
  );

  const dismissInvite = useCallback(() => {
    forgetInvite();
    setInviteToken(null);
  }, []);

  const setInviteLink = useCallback(async () => {
    const token = await pgSetInviteLink();
    setMyLink(token);
    return token;
  }, []);

  const turnOffLink = useCallback(async () => {
    const token = myLink;
    if (!token) return;
    await pgTurnOffLink(token);
    setMyLink(null);
  }, [myLink]);

  // A locked account's link is revoked with the lock (0010).
  const showLocked = useCallback((locked: boolean): void => {
    if (locked) setMyLink(null);
    setProfile((current) => (current ? { ...current, locked } : current));
  }, []);

  const recheckLocked = useCallback(async (): Promise<boolean> => {
    const locked = await fetchLocked();
    showLocked(locked);
    return locked;
  }, [showLocked]);

  const explainFailure = useCallback(
    async (error: unknown, fallback: string): Promise<string | null> => {
      const failure = await explainWriteFailure(error, fallback, recheckLocked);
      return failure.kind === "locked" ? null : failure.text;
    },
    [recheckLocked],
  );

  const unfriend = useCallback(
    async (friendUid: string) => {
      if (!uid) throw new Error("not signed in");
      await pgUnfriend(uid, friendUid);
      const left = friends.filter((entry) => entry.uid !== friendUid);
      setFriends((current) =>
        current.filter((entry) => entry.uid !== friendUid),
      );
      // The last connection locks the account (0010).
      showLocked(await lockedAfterUnfriend(fetchLocked, left.length));
    },
    [uid, friends, showLocked],
  );

  const value: ContextShape = {
    configured,
    authReady,
    listenersLost,
    channelGeneration: generation,
    user,
    signInError,
    profile,
    profileReady,
    profileUnreachable,
    friends,
    inviteToken,
    inviteFrom,
    inviteLookupFailed,
    retryInviteLookup,
    myLink,
    screen,
    popped,
    navigate,
    back,
    signIn,
    signOut,
    deleteAccount,
    updateDisplayName,
    redeemInvite,
    dismissInvite,
    setInviteLink,
    turnOffLink,
    unfriend,
    recheckLocked,
    explainFailure,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGrapevine(): ContextShape {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useGrapevine must be used within GrapevineProvider");
  return ctx;
}
