"use client";

import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LuCheck,
  LuChevronLeft,
  LuCopy,
  LuLink,
  LuLoaderCircle,
  LuPencil,
  LuRefreshCw,
  LuShare2,
  LuUnlink,
  LuUserMinus,
} from "react-icons/lu";
import { useInstall } from "../utils/install";
import { inviteUrl } from "../utils/invites";
import { useIsDesktop } from "../utils/media";
import { matchesPerson, type PersonRow } from "../utils/people";
import { useGrapevine } from "../utils/store";
import Avatar from "./avatar";
import DeleteAccountLine from "./delete-account";
import { useAction, useDialog } from "./dialog";
import LookupSettingsLines from "./lookup-settings";
import RenameSheet from "./rename-sheet";
import ReportsLine from "./reports-sheet";
import ThemeButton from "./theme-button";
import Button from "./ui/button";
import IconButton from "./ui/icon-button";
import RateRow from "./ui/rate-row";
import SearchField from "./ui/search-field";

function Heading({ children }: { children: ReactNode }): ReactElement {
  return (
    <h2 className="label px-4 pt-4 pb-2 text-[15px] text-muted">{children}</h2>
  );
}

// A row of the people list: avatar and name. No bar: a person does not have a
// score.
function PersonLine({ person }: { person: PersonRow }): ReactElement {
  return (
    <div
      data-person={person.uid}
      className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5"
    >
      <Avatar name={person.displayName} photoURL={person.photoURL} size={40} />
      <span className="min-w-0 flex-grow truncate text-[16px] font-medium">
        {person.displayName || "someone"}
      </span>
    </div>
  );
}

// Photo, name and sign out on one line, with the theme control beside them:
// there is no settings screen, so those two live here. The name is the one
// thing about the account a person may change, and a tap on it is how.
function MeLine(): ReactElement | null {
  const { profile, signOut } = useGrapevine();
  const { confirm, alert } = useDialog();
  const [renaming, setRenaming] = useState(false);

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
      <button
        type="button"
        aria-label={`change your name, ${profile.displayName || "you"}`}
        onClick={() => setRenaming(true)}
        className="flex min-h-[44px] min-w-0 flex-grow items-center gap-2 rounded-sm text-left"
      >
        <span className="min-w-0 text-[19px] leading-snug font-medium [overflow-wrap:anywhere]">
          {profile.displayName || "you"}
        </span>
        <LuPencil
          size={16}
          aria-hidden="true"
          className="shrink-0 text-muted"
        />
      </button>
      {renaming ? <RenameSheet onClose={() => setRenaming(false)} /> : null}
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

// The one way to make a friend: a link, handed over somewhere else. One per
// person, with no expiry and no limit on uses. The link itself is never drawn:
// it is a bearer secret, and copying or sharing is all anybody does with it.
// The row swipes like any other, with words and icons rather than thumbs,
// since neither side is a rating: off, right turns it on; on, left turns it
// off and right replaces it, each asking first.
function LinkRow(): ReactElement {
  const { myLink, setInviteLink, turnOffLink } = useGrapevine();
  const { confirm, alert } = useDialog();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const desktop = useIsDesktop();

  // Feature-tested rather than sniffed: a phone's share sheet is how a link
  // gets to one person, and a desktop mostly has none. After mount, so the
  // prerendered HTML and the first client render agree.
  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  function make(): void {
    setBusy(true);
    setCopied(false);
    run(async () => {
      try {
        await setInviteLink();
      } finally {
        setBusy(false);
      }
    }, "couldn't make a link. check your connection and try again.");
  }

  async function replace(): Promise<void> {
    const sure = await confirm({
      title: "make a new link?",
      body: "the one you have stops working. people it added stay.",
      confirmLabel: "new link",
      tone: "danger",
    });
    if (sure) make();
  }

  async function turnOff(): Promise<void> {
    const sure = await confirm({
      title: "turn your link off?",
      body: "it stops working for anyone who has it. people it added stay.",
      confirmLabel: "turn off",
      tone: "danger",
    });
    if (!sure) return;
    setCopied(false);
    run(
      () => turnOffLink(),
      "that didn't work. check your connection and try again.",
    );
  }

  function url(): string {
    return inviteUrl(window.location.origin, myLink ?? "");
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
    } catch (error) {
      // Refused: an insecure origin or a denied permission. There is no field
      // to select by hand, so it is said.
      console.error(error);
      await alert({
        title: "couldn't copy your link",
        body: "try another browser.",
      });
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ url: url() });
    } catch (error) {
      // Closing the share sheet rejects too, and is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error(error);
      }
    }
  }

  if (myLink === undefined) {
    return (
      <p className="border-y border-border bg-surface px-4 py-3 text-[16px] text-muted">
        loading…
      </p>
    );
  } else {
    const on = myLink !== null;
    return (
      <div className="border-y border-border">
        <RateRow
          subject="your link"
          value={null}
          sides={on ? "both" : "yes"}
          labels={
            on
              ? {
                  no: { word: "turn off", icon: LuUnlink },
                  yes: { word: "new link", icon: LuRefreshCw },
                }
              : { yes: { word: "turn on", icon: LuLink } }
          }
          onRate={(next) => {
            if (busy) return;
            else if (!on) make();
            else if (next === 1) void replace();
            else void turnOff();
          }}
          contentClassName="bg-surface"
        >
          <div
            data-link={on ? "on" : "off"}
            className="flex min-h-[64px] items-center gap-2 px-4 py-2.5"
          >
            <div className="min-w-0 flex-grow">
              <p className="text-[16px]">
                {busy ? (
                  <LuLoaderCircle className="animate-spin text-muted" />
                ) : on ? (
                  "your link is on"
                ) : (
                  <span className="text-muted">your link is off</span>
                )}
              </p>
              {/* The one swipe on a phone nothing else explains; at desktop
                  width the side buttons say it. */}
              {desktop ? null : (
                <p className="text-[15px] text-muted">
                  {on
                    ? "swipe to turn off or make a new one"
                    : "swipe to turn on"}
                </p>
              )}
            </div>
            {on && canShare ? (
              <IconButton label="share your link" onClick={() => void share()}>
                <LuShare2 size={20} aria-hidden="true" />
              </IconButton>
            ) : null}
            {on ? (
              <IconButton
                label={copied ? "copied" : "copy your link"}
                onClick={() => void copy()}
                className={copied ? "text-accent-ink" : ""}
              >
                {copied ? (
                  <LuCheck size={20} aria-hidden="true" />
                ) : (
                  <LuCopy size={20} aria-hidden="true" />
                )}
              </IconButton>
            ) : null}
          </div>
        </RateRow>
      </div>
    );
  }
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

export default function PeopleView(): ReactElement {
  const [query, setQuery] = useState("");
  const { profile, friends, unfriend, back } = useGrapevine();
  const { confirm } = useDialog();
  const run = useAction();

  const matching = useMemo(
    () =>
      query.length === 0
        ? friends
        : friends.filter((person) => matchesPerson(person, query)),
    [friends, query],
  );

  async function dropFriend(person: PersonRow): Promise<void> {
    // The last connection locks the account (0010), which is said first. An
    // admin is never locked (0014).
    const last = friends.length === 1 && !profile?.admin;
    const sure = await confirm({
      title: `remove ${person.displayName || "someone"} from your vine?`,
      body: last
        ? "they're the last person in your vine. your account will be locked until someone sends you a link."
        : "you'll no longer shape each other's lists. to undo it, one of you has to send a link.",
      confirmLabel: "remove",
      tone: "danger",
    });
    if (!sure) return;
    run(
      () => unfriend(person.uid),
      "that didn't work. check your connection and try again.",
    );
  }

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
          you and your vine
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Not filled: the section headings sit on the canvas (DESIGN-UI),
            and the rows bring their own surface. */}
        <div>
          <MeLine />
          <LinkRow />
          <InstallLine />
          <LookupSettingsLines />
          <ReportsLine />

          {matching.length > 0 ? (
            <>
              <Heading>your vine</Heading>
              {matching.map((person) => (
                <div key={person.uid} className="border-b border-border">
                  {/* No is the only answer a friend row takes: there is nothing
                    to say yes to, and the word says what no does here. */}
                  <RateRow
                    subject={person.displayName || "someone"}
                    value={null}
                    sides="no"
                    labels={{ no: { word: "remove", icon: LuUserMinus } }}
                    onRate={() => void dropFriend(person)}
                    contentClassName="bg-surface"
                  >
                    <PersonLine person={person} />
                  </RateRow>
                </div>
              ))}
            </>
          ) : null}

          {query.length > 0 && matching.length === 0 ? (
            <p className="px-4 py-4 text-[16px] text-muted">
              nobody here by that name. to add someone, send them a link.
            </p>
          ) : null}

          {/* Last, under everything, so it is never where a thumb lands by
              habit; hidden while filtering, which is about other people. */}
          {query.length === 0 ? <DeleteAccountLine /> : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2.5">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="filter by name"
          />
        </div>
      </div>
    </div>
  );
}
