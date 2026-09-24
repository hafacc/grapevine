"use client";

import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { LuChevronLeft, LuLoaderCircle, LuUserMinus } from "react-icons/lu";
import { useInstall } from "../utils/install";
import { useIsDesktop } from "../utils/media";
import {
  matchesPerson,
  type PersonRow,
  unknownHandle,
  usePeople,
} from "../utils/people";
import { useGrapevine } from "../utils/store";
import { errorCode } from "../utils/supabase";
import { switchAfter, switchSides } from "../utils/switches";
import { validateUsername } from "../utils/username";
import Avatar from "./avatar";
import { useAction, useDialog } from "./dialog";
import ThemeButton from "./theme-button";
import AddButton from "./ui/add-button";
import Button from "./ui/button";
import Chip from "./ui/chip";
import FieldNote from "./ui/field-note";
import Input from "./ui/input";
import RateRow from "./ui/rate-row";
import SearchField from "./ui/search-field";
import SwipeRow from "./ui/swipe-row";

function Heading({ children }: { children: ReactNode }): ReactElement {
  return (
    <h2 className="label px-4 pt-4 pb-2 text-[15px] text-muted">{children}</h2>
  );
}

// A row of the people list: avatar, name over handle, and beneath them the
// attributes the two of you agree on against the grain — at most three, in the
// order the server gave them. No bar: a person does not have a score.
function PersonLine({ person }: { person: PersonRow }): ReactElement {
  return (
    <div
      // The one thing on the row that names who it is without naming anything
      // about them, which is what `check:suggestions` finds a row by.
      data-person={person.uid}
      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5"
    >
      <Avatar name={person.displayName} photoURL={person.photoURL} size={40} />
      <span className="flex min-w-0 flex-grow flex-col">
        <span className="truncate text-[16px] font-medium">
          {person.displayName || "someone"}
        </span>
        {person.username ? (
          <span className="truncate text-[14px] text-muted">
            @{person.username}
          </span>
        ) : null}
        {person.attributes.length > 0 ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {person.attributes.map((attribute) => (
              <Chip key={attribute} label={attribute} />
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

// Photo, name, handle and sign out on one line, with the theme control beside
// them: there is no settings screen, so those two live here.
function MeLine(): ReactElement | null {
  const { profile, signOut } = useGrapevine();
  const { confirm, alert } = useDialog();

  async function leave(): Promise<void> {
    const sure = await confirm({
      title: "sign out?",
      body: "you can sign back in whenever you like.",
      confirmLabel: "sign out",
    });
    if (!sure) return;
    try {
      await signOut();
    } catch (error) {
      console.error(error);
      await alert({
        title: "that didn't work",
        body: "check your connection and try again.",
      });
    }
  }

  if (!profile) return null;

  return (
    <div className="flex items-center gap-3.5 bg-surface px-4 py-3.5">
      <Avatar
        name={profile.displayName}
        photoURL={profile.photoURL}
        size={48}
      />
      {/* Wrapped rather than cut: the two buttons beside it take most of a
          phone's width, and a name cut to a few letters is nobody's. */}
      <span className="flex min-w-0 flex-grow flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 text-[19px] leading-snug font-medium [overflow-wrap:anywhere]">
          {profile.displayName || "you"}
        </span>
        {profile.username ? (
          <span className="min-w-0 text-[15px] text-muted [overflow-wrap:anywhere]">
            @{profile.username}
          </span>
        ) : null}
      </span>
      <ThemeButton />
      <button
        type="button"
        onClick={() => void leave()}
        className="font-display inline-flex h-[44px] shrink-0 items-center justify-center rounded-sm border border-border bg-surface-muted px-4 text-[17px] font-semibold text-text"
      >
        sign out
      </button>
    </div>
  );
}

const CLAIM_FIELD = "claim-handle";

// The handle, and the only control that ever sets one: 0002 grants no UPDATE on
// the column, so there is nothing to edit afterwards and this line goes away for
// good once it has been used. It is above the switch because a handle is what
// `find_by_username` matches on, and an account without one can be asked to
// connect by nobody at all.
function ClaimHandleLine(): ReactElement | null {
  const { profile, claimUsername } = useGrapevine();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  if (!profile || profile.username) return null;

  const invalid = handle ? validateUsername(handle) : null;
  const problem = invalid ?? refused;

  async function claim(): Promise<void> {
    if (validateUsername(handle)) return;
    setBusy(true);
    setRefused(null);
    try {
      await claimUsername(handle);
    } catch (caught) {
      console.error(caught);
      // The store re-reads the profile before it raises, so a unique violation
      // arriving here is somebody else's handle rather than this account's own
      // second claim — the two share the code and nothing else could tell them
      // apart.
      setRefused(
        errorCode(caught) === "23505"
          ? "somebody already goes by that."
          : "couldn't claim that. check your connection.",
      );
    }
    setBusy(false);
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-border bg-surface px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void claim();
      }}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-grow">
          <Input
            id={CLAIM_FIELD}
            prefix="@"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="claim-handle-note"
            invalid={Boolean(invalid)}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="pick a handle"
          />
        </span>
        <Button
          type="submit"
          className="shrink-0"
          disabled={busy || handle.length === 0 || Boolean(invalid)}
        >
          {busy ? <LuLoaderCircle className="animate-spin" /> : "claim"}
        </Button>
      </span>
      <FieldNote id="claim-handle-note" tone={problem ? "danger" : "muted"}>
        {problem ?? "a handle is how a friend asks for you, and is permanent."}
      </FieldNote>
    </form>
  );
}

// Offered, never raised: Chrome's own banner is held in `install.ts` so that
// installing is something a person goes and does, from here. Silent on a
// browser that will neither prompt nor install by hand, and silent once it is
// installed.
function InstallLine(): ReactElement | null {
  const { ready, byHand, install } = useInstall();

  if (!ready && !byHand) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <p className="min-w-0 flex-grow text-[16px] text-muted">
        {ready
          ? "keep grapevine on your home screen"
          : "to keep grapevine on your home screen: share, then add to home screen"}
      </p>
      {ready ? (
        <Button
          variant="secondary"
          className="shrink-0"
          onClick={() => void install()}
        >
          install
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One of the two switches: a full-width line that IS the control (DESIGN-UI,
 * "Switch lines").
 *
 * Swiped on a phone, where it moves only the ways that change something
 * (`switchSides`). At desktop width it is one button with switch semantics
 * rather than the two side buttons a rating row gets: a switch has two states,
 * and a pair of yes and no buttons around one would offer a no that does
 * nothing while it is off.
 */
function SwitchLine({
  subject,
  on,
  rule,
  onChange,
  children,
}: {
  // What the switch controls, for its accessible name.
  subject: string;
  on: boolean;
  // Which of its edges carry a rule, which depends on what is next to it.
  rule: string;
  onChange: (on: boolean) => void;
  children: ReactNode;
}): ReactElement {
  const desktop = useIsDesktop();
  const line = `${rule} border-border px-4 py-3 text-[16px] ${
    on ? "bg-accent-soft text-accent-ink" : "bg-surface-muted text-muted"
  }`;
  if (desktop) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={subject}
        onClick={() => onChange(!on)}
        className={`block w-full text-left focus-visible:outline-offset-[-2px] ${line}`}
      >
        {children}
      </button>
    );
  } else {
    return (
      <SwipeRow
        value={on ? 1 : null}
        sides={switchSides(on)}
        onRate={(next) => onChange(switchAfter(next))}
        className={line}
      >
        <p>{children}</p>
      </SwipeRow>
    );
  }
}

// Only once there is a handle to be found by; before that the claim line stands
// here instead. Claiming turns it on, and this is the one way back off.
function FindableLine(): ReactElement | null {
  const { profile, setSearchable } = useGrapevine();
  const run = useAction();

  if (!profile?.username) return null;

  const findable = profile.searchable;
  const handle = `@${profile.username}`;
  return (
    <SwitchLine
      subject={`being findable as ${handle}`}
      on={findable}
      rule="border-t"
      onChange={(next) =>
        run(
          () => setSearchable(next),
          "that didn't save. check your connection and try again.",
        )
      }
    >
      {findable
        ? `findable as ${handle} — anyone who types it can ask to connect`
        : `swipe to be findable as ${handle}`}
    </SwitchLine>
  );
}

// One line, one sentence, because the setting is one sentence: off means you are
// named to nobody and your own list is written empty (DESIGN §5.1). Nothing may
// draw it as a state before the row has answered — the default reads "off",
// which is a claim about a privacy switch.
function DiscoverabilityLine(): ReactElement {
  const {
    profile,
    prefs,
    prefsReady,
    prefsUnreachable,
    setDiscoverableByTaste,
  } = useGrapevine();
  const run = useAction();

  if (!profile?.username) {
    // Not a switch yet: a suggestion is only worth making about someone who can
    // be asked, asking takes a handle, and the database refuses findable
    // without one. So the line says what it waits for, and a tap on it goes
    // there — a swipe that ends in "that didn't save" is the only other thing it
    // could do.
    return (
      <button
        type="button"
        onClick={() => document.getElementById(CLAIM_FIELD)?.focus()}
        className="block w-full border-y border-border bg-surface-muted px-4 py-3 text-left text-[16px] text-muted focus-visible:outline-offset-[-2px]"
      >
        claim a handle above to show up in friend suggestions
      </button>
    );
  } else if (!prefsReady) {
    return (
      <p className="border-y border-border bg-surface-muted px-4 py-3 text-[16px] text-muted">
        {prefsUnreachable
          ? "couldn't load whether you show up in friend suggestions"
          : "loading…"}
      </p>
    );
  } else {
    const shown = prefs.discoverableByTaste;
    return (
      <SwitchLine
        subject="showing up in friend suggestions"
        on={shown}
        rule="border-y"
        onChange={(next) =>
          run(
            () => setDiscoverableByTaste(next),
            "that didn't save. check your connection and try again.",
          )
        }
      >
        {shown
          ? "suggested to people with similar taste"
          : "swipe to show up in friend suggestions"}
      </SwitchLine>
    );
  }
}

export default function PeopleView(): ReactElement {
  const [query, setQuery] = useState("");
  const { asks, friends, suggested, searched, failed } = usePeople();
  const {
    prefs,
    prefsReady,
    sendFriendRequest,
    acceptRequest,
    declineRequest,
    dismissSuggestion,
    unfriend,
    back,
  } = useGrapevine();
  const { alert, confirm } = useDialog();
  const run = useAction();

  const matching = useMemo(() => {
    if (query.length === 0) return { asks, friends, suggested };
    const keep = (people: readonly PersonRow[]): readonly PersonRow[] =>
      people.filter((person) => matchesPerson(person, query));
    return {
      asks: keep(asks),
      friends: keep(friends),
      suggested: keep(suggested),
    };
  }, [asks, friends, suggested, query]);

  const shown = useMemo(
    () => [...matching.asks, ...matching.friends, ...matching.suggested],
    [matching],
  );
  const handle = unknownHandle(query, shown);

  // The one place a request is sent, from either the suggestion rows or the
  // handle nobody on screen has: both are the same ask, and the answers a
  // handle can come back with are the same either way.
  async function ask(username: string): Promise<void> {
    const outcome = await sendFriendRequest(username);
    switch (outcome) {
      case "sent":
        setQuery("");
        return;
      case "not-found":
        await alert({
          title: "nobody goes by that handle",
          body: "handles are exact — there is no browsing for people.",
        });
        return;
      case "already-friends":
        await alert({ title: "you two are already friends" });
        return;
      case "self":
        await alert({ title: "that one is you" });
        return;
    }
  }

  async function dropFriend(person: PersonRow): Promise<void> {
    const sure = await confirm({
      title: `unfriend ${person.displayName || "someone"}?`,
      body: "you'll drop out of each other's friends and feeds. to be friends again, one of you has to ask.",
      confirmLabel: "unfriend",
      tone: "danger",
    });
    if (!sure) return;
    run(
      () => unfriend(person.uid),
      "that didn't work. check your connection and try again.",
    );
  }

  // A search has answered and there is nobody in it, which is a different thing
  // from a search that has not answered yet — and both are different from the
  // switch being off, which the line above already explains.
  const nothingSimilar =
    query.length === 0 && matching.suggested.length === 0
      ? failed
        ? "couldn't look for people with similar taste just now."
        : searched && prefsReady && prefs.discoverableByTaste
          ? "nobody with similar taste yet."
          : null
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border bg-surface pr-2.5 pl-1">
        <button
          type="button"
          aria-label="back"
          onClick={back}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm bg-surface text-text focus-visible:outline-offset-[-2px]"
        >
          <LuChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="font-display min-w-0 flex-grow truncate text-[22px] font-semibold text-text">
          you and your friends
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Not filled: the section headings sit on the canvas (DESIGN-UI),
            and the rows bring their own surface. */}
        <div>
          <MeLine />
          <ClaimHandleLine />
          <FindableLine />
          <DiscoverabilityLine />
          <InstallLine />

          {matching.asks.length > 0 ? (
            <>
              <Heading>wants to connect</Heading>
              {matching.asks.map((person) => (
                <div key={person.uid} className="border-b border-border">
                  <RateRow
                    subject={`${person.displayName || "someone"}'s request`}
                    value={null}
                    onRate={(next) => {
                      const request = person.request;
                      if (!request) return;
                      run(async () => {
                        if (next !== 1) {
                          await declineRequest(request);
                        } else if ((await acceptRequest(request)) === "gone") {
                          await alert({
                            title: "that ask is no longer there",
                            body: "they may have taken it back.",
                          });
                        }
                      }, "that didn't work. check your connection and try again.");
                    }}
                    contentClassName="bg-surface"
                  >
                    <PersonLine person={person} />
                  </RateRow>
                </div>
              ))}
            </>
          ) : null}

          {matching.friends.length > 0 ? (
            <>
              <Heading>friends</Heading>
              {matching.friends.map((person) => (
                <div key={person.uid} className="border-b border-border">
                  {/* No is the only answer a friend row takes: there is nothing
                    to say yes to, and the glyph says what no does here. */}
                  <RateRow
                    subject={`being friends with ${person.displayName || "someone"}`}
                    value={null}
                    sides="no"
                    noGlyph={LuUserMinus}
                    onRate={() => void dropFriend(person)}
                    contentClassName="bg-surface"
                  >
                    <PersonLine person={person} />
                  </RateRow>
                </div>
              ))}
            </>
          ) : null}

          {matching.suggested.length > 0 || nothingSimilar ? (
            <>
              <Heading>similar taste</Heading>
              {matching.suggested.map((person) => (
                <div key={person.uid} className="border-b border-border">
                  {/* Yes sends the ordinary connect request, which hides this
                    person until they accept; no is the dismissal, which is a
                    preference and is never re-shown. */}
                  <RateRow
                    subject={`connecting with ${person.displayName || "someone"}`}
                    value={null}
                    onRate={(next) =>
                      run(
                        () =>
                          next === 1
                            ? ask(person.username)
                            : dismissSuggestion(person.uid),
                        "that didn't work. check your connection and try again.",
                      )
                    }
                    contentClassName="bg-surface"
                  >
                    <PersonLine person={person} />
                  </RateRow>
                </div>
              ))}
              {nothingSimilar ? (
                <p className="px-4 py-2.5 text-[16px] text-muted">
                  {nothingSimilar}
                </p>
              ) : null}
            </>
          ) : null}

          {query.length > 0 && shown.length === 0 ? (
            <p className="px-4 py-4 text-[16px] text-muted">
              nobody here goes by that handle. handles are exact — there is no
              browsing for people.
            </p>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2.5">
          {handle ? (
            <AddButton
              label={`ask @${handle} to connect`}
              onTap={() =>
                run(
                  () => ask(handle),
                  "that didn't send. check your connection and try again.",
                )
              }
            />
          ) : null}
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="filter, or type a handle"
          />
        </div>
      </div>
    </div>
  );
}
