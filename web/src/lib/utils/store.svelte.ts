import { onMount, untrack } from "svelte";
import {
  fetchFollowers,
  fetchFollowing,
  fetchLocked,
  fetchOwnProfile,
  fetchPrefilled,
  follow as pgFollow,
  removeFollower as pgRemoveFollower,
  unfollow as pgUnfollow,
  updateProfileIdentity,
} from "./accounts";
import {
  googleSignIn,
  deleteAccount as pgDeleteAccount,
  signOutFailed,
} from "./auth";
import { clientState, recordDebugEvent } from "./debug";
import { forgetHintsSeen } from "./first-run";
import { forgetFollowed } from "./followed-cache";
import { replaceHistory } from "./history";
import {
  forgetImportOffers,
  importOfferWaiting,
  setImportOffer,
} from "./import-offer";
import { forgetImportResumes } from "./import-resume";
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
  forgetPrefilledOffers,
  prefilledOfferWaiting,
  setPrefilledOffer,
} from "./prefilled-offer";
import { forgetRatingsUnless } from "./ratings";
import {
  HEALTHY,
  onChannelJoined as joinedHealth,
  onChannelLoss,
} from "./reattach";
import { forgetCachedFeeds, forgetFeedUnless, refreshMyRecs } from "./recs";
import { explainWriteFailure, lockedAfterUnfollow } from "./refusal";
import {
  historyDepth,
  LIST_SCREEN,
  pushEntry,
  replaceEntry,
  screenHash,
  stackForHash,
  stackIn,
} from "./router";
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
import type { Account, Profile, Screen } from "./types";

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

const NO_ACCOUNTS: Account[] = [];

// Everything below is replaced, never mutated, so each is `$state.raw`: a
// screen pushed into `history.state` has to be a plain object, and a proxy
// cannot be cloned into one.

// False when no Supabase project is wired up: sign-in is refused with an
// explanation rather than a failure, and the app still builds and renders.
const configured = supabaseConfigured();

let user = $state.raw<SessionUser | null>(null);
const uid = $derived(user?.uid ?? null);
// A row in `profiles`, not a field on the auth account, so it is fetched.
let profile = $state.raw<Profile | null>(null);
let profileReady = $state(false);
// No answer is coming right now, which is distinct from "no profile".
let profileUnreachable = $state(false);
// The account `profile` belongs to.
let profileOwner: string | null = null;
// A persisted session is restored asynchronously and a sign-in comes back with
// a code still to be exchanged, so this stops the gate flashing the welcome
// screen at someone already signed in.
let authReady = $state(false);
// The provider's error code when the trip to Google came back refused or
// cancelled, for the welcome screen to say; null otherwise.
let signInError = $state<string | null>(null);
// Re-attaching channels the server dropped. Bumping `generation` re-subscribes
// every one of them and has `useMyRecs` and `useMyRatings` read again, one
// retry budget for the whole app rather than one each; `retryTimer` being non-null doubles as the guard that
// collapses a burst of losses into one retry.
let generation = $state(0);
// Every channel died and the retry budget is spent, or the socket has stayed
// down past `SOCKET_STALE_MS`; the UI says the screen may be stale rather than
// pretending it is live, until a channel joins again.
let listenersLost = $state(false);
let health = HEALTHY;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// A re-attach that is due and waiting for the socket to come back. One at a
// time, so only one set of channels is made when the socket returns.
let socketWait: (() => void) | null = null;
// The accounts the viewer follows, and the people following the viewer.
let following = $state.raw<Account[]>(NO_ACCOUNTS);
let followers = $state.raw<Account[]>(NO_ACCOUNTS);
// Every prefilled account, which anybody may find and follow.
let prefilled = $state.raw<Account[]>(NO_ACCOUNTS);
// Whether `prefilled` has been read this session, or the read gave up.
let prefilledRead = $state<"waiting" | "read" | "failed">("waiting");
// A link this device was handed and has not answered yet: taken out
// of the address on arrival and kept across the trip to Google (`invites.ts`).
let inviteToken = $state<string | null>(null);
// Whose that link is, read signed out as well as in: undefined until the
// lookup answers, null when the link no longer works.
let inviteFrom = $state.raw<InviteOwner | null | undefined>(undefined);
// The lookup behind `inviteFrom` failed, so undefined will not change by
// itself; `retryInviteLookup` asks again.
let inviteLookupFailed = $state(false);
let inviteLookups = $state(0);
// The viewer's own link: undefined until read, null while it is off.
let myLink = $state<string | null | undefined>(undefined);
// Whether to ask, once, if a just-joined account wants to import ratings.
let importOffer = $state(false);
// Whether to offer, once, the prefilled accounts to a just-joined account.
let prefilledOffer = $state(false);

// The list is only the starting guess — `start` reads the real stack out of
// the URL, which can't happen here because this also runs at prerender.
let stack = $state.raw<Screen[]>([LIST_SCREEN]);
// Bumped on every history pop, so a screen can tell one from the next even
// when the screen itself is unchanged.
let popped = $state(0);

// Every forward move pushes a real history entry and back() delegates to
// history.back(), so the OS back button and the in-app one are one button.
function navigate(target: Screen): void {
  const next = [...stack, target];
  pushEntry(next);
  stack = next;
}

function back(): void {
  if (historyDepth() > 0) {
    window.history.back();
  } else {
    // Nothing of ours behind this entry, so Back means "up a level" rather
    // than "leave the site" — and there is one level, the list.
    home();
  }
}

// To the list, in place of the screen showing: where a flow that has finished
// leaves, so Back does not return into it.
function home(): void {
  const next: Screen[] = [LIST_SCREEN];
  replaceEntry(next);
  stack = next;
}

// What this device keeps about the account that was signed in. The session is
// the SDK's to remove; the feed cache, the thumbs of the accounts it followed
// and the hints seen are ours.
function forgetDevice(): void {
  void forgetFollowed();
  try {
    forgetCachedFeeds(window.localStorage);
    forgetHintsSeen(window.localStorage);
    forgetImportOffers(window.localStorage);
    forgetPrefilledOffers(window.localStorage);
    forgetImportResumes(window.localStorage);
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

function cancelReattach(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  socketWait?.();
  socketWait = null;
}

function retryInviteLookup(): void {
  inviteLookups += 1;
}

// The list is computed from whom the viewer follows, so a change to that is a
// reason to compute it again.
function recomputeList(): void {
  void refreshMyRecs().catch((error) => console.error("recs", error));
}

// Bumped by every change to the follows made here, so a read that started
// before one cannot put back what it was.
let followsVersion = 0;

async function refreshFollows(): Promise<void> {
  const mine = uid;
  if (!mine) return;
  followsVersion += 1;
  const asked = followsVersion;
  const [nextFollowing, nextFollowers] = await Promise.all([
    fetchFollowing(mine),
    fetchFollowers(mine),
  ]);
  if (uid !== mine || followsVersion !== asked) return;
  const changed =
    nextFollowing.length !== following.length ||
    nextFollowing.some(
      (account) => !following.some((known) => known.uid === account.uid),
    );
  following = nextFollowing;
  followers = nextFollowers;
  if (changed) recomputeList();
}

function signIn(): Promise<void> {
  return googleSignIn();
}

// This device only. The default scope revokes every refresh token the account
// holds, so signing out of a borrowed laptop would sign the phone out too.
//
// The session is dropped here whether or not the server heard about it, so an
// error with no session left is a sign-out that worked: offline, the request
// to revoke the token fails after the device has already let go of it.
async function signOut(): Promise<void> {
  const { error } = await supabase().auth.signOut({ scope: "local" });
  const { data } = await supabase().auth.getSession();
  if (!signOutFailed(error, data.session !== null)) {
    forgetDevice();
    forgetTab();
    inviteToken = null;
  } else {
    throw error;
  }
}

// The server has already revoked every session the account held, so what is
// left is this device's copy of one; a failure here leaves the account gone
// either way, and is not reported as the deletion failing.
async function deleteAccount(): Promise<void> {
  await pgDeleteAccount();
  try {
    await signOut();
  } catch (error) {
    console.error(error);
    forgetDevice();
    forgetTab();
  }
}

// One row, and everyone sees the new name the next time they read the
// profile: there is no copy of it anywhere to go around rewriting.
async function updateDisplayName(displayName: string): Promise<void> {
  const mine = uid;
  if (!mine) throw new Error("not signed in");
  await updateProfileIdentity(mine, {
    displayName,
    photoURL: profile?.photoURL ?? null,
  });
  if (profile) profile = { ...profile, displayName };
}

// The owner's id, or null when the link stopped working. Forgotten once the
// server has answered, whatever it said. A write that never answered keeps the
// token, so the next load asks again.
async function redeemInvite(token: string): Promise<string | null> {
  const mine = uid;
  const known = following;
  const owner = await pgRedeemInvite(token);
  forgetInvite();
  inviteToken = null;
  if (owner !== null && owner !== mine) {
    // Asked after the link is answered, of somebody it added: a new
    // account has just arrived and has nothing in its list.
    if (mine && !known.some((account) => account.uid === owner)) {
      setImportOffer(mine, true);
      importOffer = true;
      setPrefilledOffer(mine, true);
      prefilledOffer = true;
    }
    // The follow `redeem_invite` just wrote is what unlocks.
    if (profile) profile = { ...profile, locked: false };
    // The link is answered and its question gone from the screen: a failed
    // re-read has nobody to tell, and the next load reads again.
    await refreshFollows().catch((error) => console.error("follows", error));
  }
  return owner;
}

function answerImportOffer(): void {
  if (uid) setImportOffer(uid, false);
  importOffer = false;
}

function answerPrefilledOffer(): void {
  if (uid) setPrefilledOffer(uid, false);
  prefilledOffer = false;
}

// Said no to, or found to be dead: forgotten without writing anything.
function dismissInvite(): void {
  forgetInvite();
  inviteToken = null;
}

// Turns the viewer's link on, or replaces it; the old one stops working.
async function setInviteLink(): Promise<string> {
  const token = await pgSetInviteLink();
  myLink = token;
  return token;
}

async function turnOffLink(): Promise<void> {
  const token = myLink;
  if (!token) return;
  await pgTurnOffLink(token);
  myLink = null;
}

// A locked account's link is revoked with the lock.
function showLocked(locked: boolean): void {
  if (locked) myLink = null;
  if (profile) profile = { ...profile, locked };
}

// Asks the server whether the account is locked and shows the answer.
async function recheckLocked(): Promise<boolean> {
  const locked = await fetchLocked();
  showLocked(locked);
  return locked;
}

// What to say about a failed write, or null when the answer is that the
// account is locked, which the locked screen then says instead.
async function explainFailure(
  error: unknown,
  fallback: string,
): Promise<string | null> {
  const failure = await explainWriteFailure(error, fallback, recheckLocked);
  return failure.kind === "locked" ? null : failure.text;
}

// With no link: a prefilled account, or a person who already follows the
// viewer. Anybody else is followed by accepting their link.
async function follow(account: Account): Promise<void> {
  await pgFollow(account);
  followsVersion += 1;
  if (!following.some((known) => known.uid === account.uid))
    following = [...following, account];
  // Following back a person is what unlocks an account they followed first.
  if (!account.prefilled && profile?.locked)
    profile = { ...profile, locked: false };
  recomputeList();
}

async function unfollow(account: Account): Promise<void> {
  const mine = uid;
  if (!mine) throw new Error("not signed in");
  await pgUnfollow(mine, account.uid);
  followsVersion += 1;
  following = following.filter((entry) => entry.uid !== account.uid);
  recomputeList();
  // Following no other person locks the account.
  showLocked(
    await lockedAfterUnfollow(
      fetchLocked,
      following.filter((entry) => !entry.prefilled).length,
      Boolean(profile?.admin),
    ),
  );
}

async function removeFollower(account: Account): Promise<void> {
  const mine = uid;
  if (!mine) throw new Error("not signed in");
  await pgRemoveFollower(mine, account.uid);
  followsVersion += 1;
  followers = followers.filter((entry) => entry.uid !== account.uid);
  // The server replaced the link, so the one that person was handed is dead.
  if (myLink) {
    try {
      myLink = await fetchMyLink();
    } catch (error) {
      console.error("link", error);
      myLink = undefined;
    }
  }
}

/**
 * Runs `body` again whenever what `dependencies` reads changes, and reads
 * nothing else: an effect that tracked every signal its body happened to touch
 * would re-run the account's reads on any of them.
 */
function watch(
  dependencies: () => unknown,
  // biome-ignore lint/suspicious/noConfusingVoidType: the shape `$effect` itself takes — nothing, or a cleanup.
  body: () => void | (() => void),
): void {
  $effect(() => {
    dependencies();
    return untrack(body);
  });
}

/**
 * Starts everything the app keeps in step with the browser and the session:
 * the screen stack, the session, the profile and the channels. Called once,
 * while the root layout is being set up, and stopped with it.
 */
export function startGrapevine(): void {
  onMount(() => {
    // First, so a screen carried across the trip to Google is back in the
    // fragment before anything below reads it, and a link's token is out of it.
    takeSignInReturn();
    inviteToken = takeInvite();
    // The fragment wins when the two disagree, being the half a user can edit.
    const saved = stackIn(window.history.state);
    const restored =
      saved.length > 0 &&
      screenHash(saved[saved.length - 1]) === window.location.hash
        ? [...saved]
        : stackForHash(window.location.hash);
    // Never push: the arrival entry is ours to annotate, and pushing would leave
    // a phantom under the first Back.
    replaceEntry(restored);
    stack = restored;

    function onPop(event: PopStateEvent): void {
      const stacked = stackIn(event.state);
      // Bumped so a screen can tell one pop from the next even on the same
      // screen.
      popped += 1;
      stack =
        stacked.length > 0 ? [...stacked] : stackForHash(window.location.hash);
    }
    // The browser has already pushed a blank entry by the time this fires, so we
    // adopt it in place — a second write is the double entry this scheme avoids.
    function onHashChange(): void {
      // A link pasted into a tab that is already open. Taken out before the
      // fragment is read, so what is left is the list.
      const taken = takeInvite();
      if (taken !== null) inviteToken = taken;
      const current = stackIn(window.history.state);
      const showing = current[current.length - 1];
      if (showing && screenHash(showing) === window.location.hash) return;
      const next = stackForHash(window.location.hash);
      replaceEntry(next, Math.max(historyDepth(), 1));
      stack = next;
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onHashChange);
    };
  });

  // The reports screen is an admin's; for anybody else `#/reports` goes where a
  // fragment naming no screen goes. Only once the profile has answered, since
  // until then nobody is known not to be an admin. The server answers a
  // non-admin nothing either way.
  const admin = $derived(Boolean(profile?.admin));
  watch(
    () => [profileReady, admin, stack],
    () => {
      if (!profileReady || admin) return;
      if (!stack.some((entry) => entry.kind === "reports")) return;
      home();
    },
  );

  onMount(() => {
    // Once per incident: `lost` stays set until a channel joins again.
    const report = (): void => {
      if (health.lost) return;
      health = { ...health, lost: true };
      recordDebugEvent("listeners-lost", {
        spent: health.budget.spent,
        ...clientState(),
      });
      listenersLost = true;
    };
    const reattach = (): void => {
      retryTimer = null;
      if (socketWait !== null) return;
      let done = false;
      const stale = setTimeout(report, SOCKET_STALE_MS);
      const cancel = whenSocketOpen(() => {
        done = true;
        clearTimeout(stale);
        socketWait = null;
        generation += 1;
      });
      if (!done)
        socketWait = () => {
          clearTimeout(stale);
          cancel();
        };
    };
    const stopLosses = onChannelLost(() => {
      // Every channel dies together whenever the token is what's refused, so a
      // burst has to buy ONE re-attach, not one per channel.
      if (retryTimer !== null) return;
      const response = onChannelLoss(health, Date.now());
      if (response.kind === "ignore") return;
      if (response.kind === "report") {
        report();
      } else {
        health = response.health;
        retryTimer = setTimeout(reattach, response.delay);
      }
    });
    const stopJoins = onChannelJoined(() => {
      health = joinedHealth(health);
      listenersLost = false;
    });
    return () => {
      stopLosses();
      stopJoins();
      cancelReattach();
    };
  });

  // The pending re-attach has to be cancelled alongside the counters: sign-out
  // kills every channel by itself, so one still armed would re-attach against
  // the new session — and, being the burst guard, swallow its first real loss.
  watch(
    () => uid,
    () => {
      // Here and not in the screens that read them: those are gone by the
      // time a sign-out could tell them, and what they held was somebody's.
      forgetFeedUnless(uid);
      forgetRatingsUnless(uid);
      cancelReattach();
      health = HEALTHY;
      listenersLost = false;
    },
  );

  onMount(() => {
    if (!configured) {
      // No project, so no session is possible and the gate can settle at once.
      authReady = true;
      return;
    }
    signInError = takeSignInReturn().errorCode;
    let settled = false;
    // Only a return from Google is reported: a gate that opens late on a
    // restored session has nothing to tell a visitor who never tried.
    const returning = new URLSearchParams(window.location.search).has("code");
    const dropCode = (): void => {
      const cleaned = withoutCode(window.location.href);
      if (cleaned !== null) replaceHistory(window.history.state, cleaned);
    };
    // A failed exchange of `?code=` is not delivered to the listener below:
    // `initialize()` resolves with it and supabase-js only logs it, so without
    // this the welcome screen comes back as though nothing had been tried.
    void supabase()
      .auth.initialize()
      .then(({ error }) => {
        if (!error || !returning) return;
        signInError = exchangeFailure(error);
        dropCode();
      });
    const deadline = setTimeout(() => {
      if (settled) return;
      if (returning) {
        signInError = SIGN_IN_TIMED_OUT;
        dropCode();
      }
      authReady = true;
    }, AUTH_GATE_MS);
    // `INITIAL_SESSION` arrives once the SDK has restored a persisted session
    // and, on the way back from Google, exchanged the `?code=` in the query
    // string — so this fires after both and there is no second read to settle
    // the gate with. Nothing but state and this device's own storage is touched
    // inside the callback: the SDK holds its own lock while it runs, and a query
    // issued from in here waits on a lock that waits on it.
    const { data } = supabase().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") forgetDevice();
      user = nextSessionUser(user, session);
      settled = true;
      clearTimeout(deadline);
      authReady = true;
    });
    return () => {
      clearTimeout(deadline);
      data.subscription.unsubscribe();
    };
  });

  // Whose link is waiting, asked once per token and signed out or in: the
  // welcome screen names it, and the question after sign-in shows the face.
  // A dead link is forgotten from storage at once — the screen showing says so
  // — so it does not come back from Google to be said a second time.
  // `inviteLookups` is unread on purpose: bumping it is how a failed lookup is
  // asked again.
  watch(
    () => [inviteToken, inviteLookups],
    () => {
      inviteFrom = undefined;
      inviteLookupFailed = false;
      const token = inviteToken;
      if (!configured || !token) return;
      if (!isInviteToken(token)) {
        forgetInvite();
        inviteFrom = null;
        return;
      }
      let live = true;
      void retryTransient(() => pgInviteOwner(token))
        .then((owner) => {
          if (!live) return;
          if (owner === null) forgetInvite();
          inviteFrom = owner;
        })
        .catch((error) => {
          console.error("invite owner", error);
          if (live) inviteLookupFailed = true;
        });
      return () => {
        live = false;
      };
    },
  );

  // A read that never answers neither fails nor succeeds, so without this the
  // splash stays up for good. Keyed on the account and not on each re-read: a
  // lost channel re-runs the reads, and restarting the clock with them would
  // keep the gate shut for as long as the channels kept failing.
  watch(
    () => [uid, profileReady],
    () => {
      if (!uid || profileReady) return;
      const gate = setTimeout(() => {
        profileUnreachable = true;
      }, PROFILE_GATE_MS);
      return () => clearTimeout(gate);
    },
  );

  /**
   * Everything the signed-in viewer owns, read on mount and again when the tab
   * comes back.
   *
   * These change by the viewer's own action — which this tab already knows
   * about, and writes through above — so a channel each would be subscriptions
   * bought to deliver nothing. What DOES move under a reader, a new follower,
   * has a channel of its own.
   *
   * `generation` is unread on purpose: bumping it is how a lost channel gets
   * re-read.
   */
  watch(
    () => [uid, generation],
    () => {
      const mine = uid;
      if (!configured || !mine) {
        profileOwner = null;
        profile = null;
        profileReady = false;
        profileUnreachable = false;
        following = NO_ACCOUNTS;
        followers = NO_ACCOUNTS;
        prefilled = NO_ACCOUNTS;
        prefilledRead = "waiting";
        myLink = undefined;
        importOffer = false;
        prefilledOffer = false;
        return;
      }
      importOffer = importOfferWaiting(mine);
      prefilledOffer = prefilledOfferWaiting(mine);
      let live = true;
      let last = 0;
      // One incident, not one per retry: this effect re-runs when the session or
      // the retry generation changes, which is what "another incident" means.
      let reported = false;

      /**
       * The profile, whether the account is locked and whether it is an admin.
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
          profile = next;
          profileReady = true;
          profileUnreachable = false;
        } catch (error) {
          if (!live) return;
          console.error("profile", error);
          profileUnreachable = true;
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
        const [link, everyPrefilled] = await Promise.all([
          fetchMyLink(),
          fetchPrefilled(),
          refreshFollows(),
        ]);
        if (!live) return;
        myLink = link;
        prefilled = everyPrefilled;
        prefilledRead = "read";
      };

      const loadAll = (): void => {
        last = Date.now();
        void loadProfile();
        // A followed account may have rated since: one small request says
        // whether, and nothing is computed when none has.
        recomputeList();
        void retryTransient(loadSocial).catch((error) => {
          console.error("social", error);
          // A re-read that failed keeps what an earlier one read.
          if (live && prefilledRead === "waiting") prefilledRead = "failed";
        });
      };

      // A session swap must not show the old profile while the new one loads. A
      // re-read for the same account keeps it: a lost channel re-runs this
      // effect, and blanking the profile would put the splash back on every loss.
      if (profileOwner !== mine) {
        profileOwner = mine;
        profile = null;
        profileReady = false;
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
    },
  );

  /**
   * A new follower, live.
   *
   * Somebody opening the viewer's link follows them, which the viewer did not
   * act in, so it arrives as the INSERT of a row naming the viewer as the one
   * followed, which the `follows` read policy bounds. Deletes are not published
   * (`0004_realtime.sql`): a deleted row has nothing to apply a policy to, so
   * being unfollowed, or removed as a follower, is seen on the next load.
   *
   * The payload is not read: the row wants the profile at the far end anyway,
   * so an event is a signal to re-read rather than a row to apply.
   *
   * `generation` is unread on purpose: bumping it is how a lost channel gets
   * re-attached.
   */
  watch(
    () => [uid, generation],
    () => {
      const mine = uid;
      if (!configured || !mine) return;
      const channel = supabase()
        .channel(`follows:${mine}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "follows",
            filter: `followed_id=eq.${mine}`,
          },
          () => {
            void refreshFollows().catch((error) =>
              console.error("follows", error),
            );
          },
        );
      subscribeChannel(channel, "follows");
      return () => {
        void supabase().removeChannel(channel);
      };
    },
  );
}

/**
 * The app's one store: who is signed in, what they own, and which screen is
 * showing. Read its fields where they are used rather than copying them out,
 * so a reader follows a change.
 */
export const grapevine = {
  configured,
  get authReady() {
    return authReady;
  },
  get listenersLost() {
    return listenersLost;
  },
  // Bumped when a lost channel is to be re-attached.
  get channelGeneration() {
    return generation;
  },
  get user() {
    return user;
  },
  get signInError() {
    return signInError;
  },
  get profile() {
    return profile;
  },
  get profileReady() {
    return profileReady;
  },
  get profileUnreachable() {
    return profileUnreachable;
  },
  get following() {
    return following;
  },
  get followers() {
    return followers;
  },
  get prefilled() {
    return prefilled;
  },
  get prefilledRead() {
    return prefilledRead;
  },
  get inviteToken() {
    return inviteToken;
  },
  get inviteFrom() {
    return inviteFrom;
  },
  get inviteLookupFailed() {
    return inviteLookupFailed;
  },
  retryInviteLookup,
  get myLink() {
    return myLink;
  },
  get screen() {
    return stack[stack.length - 1];
  },
  get popped() {
    return popped;
  },
  navigate,
  back,
  home,
  get importOffer() {
    return importOffer;
  },
  answerImportOffer,
  get prefilledOffer() {
    return prefilledOffer;
  },
  answerPrefilledOffer,
  signIn,
  signOut,
  deleteAccount,
  updateDisplayName,
  redeemInvite,
  dismissInvite,
  setInviteLink,
  turnOffLink,
  follow,
  unfollow,
  removeFollower,
  recheckLocked,
  explainFailure,
};
