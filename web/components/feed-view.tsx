"use client";

import { normalizeId } from "grapevine-shared";
import { parseQuery, relationFrom } from "grapevine-shared/search";
import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LuX } from "react-icons/lu";
import {
  type Attribute,
  type FeedRow,
  hiddenByEye,
  lookAlike,
  searchFeed,
} from "../utils/discover";
import { hintSeen, markHintSeen } from "../utils/first-run";
import { searchItems, validateItemId } from "../utils/items";
import { lookUp } from "../utils/lookup";
import { useIsDesktop } from "../utils/media";
import { clearRating, setRating, useMyRatings } from "../utils/ratings";
import { refreshMyRecs, useMyRecs } from "../utils/recs";
import {
  type MatchRow,
  chooseMatch as pickMatch,
  resolveMatches,
} from "../utils/references";
import { isForbiddenCall } from "../utils/refusal";
import { historyScroll, rememberScroll, useGrapevine } from "../utils/store";
import type { Item, RatingValue } from "../utils/types";
import AvatarButton from "./avatar-button";
import LoadFailure from "./load-failure";
import MatchSheet from "./match-sheet";
import AddButton from "./ui/add-button";
import Bar from "./ui/bar";
import Button from "./ui/button";
import Chip, { type ChipTone } from "./ui/chip";
import EyeToggle from "./ui/eye-toggle";
import FieldNote from "./ui/field-note";
import IconButton from "./ui/icon-button";
import RateRow from "./ui/rate-row";
import SearchField from "./ui/search-field";
import Wordmark, { Mark } from "./wordmark";

// Long enough that a typed word is one query rather than six, short enough that
// the catalog has usually landed by the time the fingers stop.
const SEARCH_DEBOUNCE_MS = 200;

// A row's worth. A thing with thirty attributes would otherwise be
// a row three lines deep, and the ones left out are the ones the viewer's own
// feed is surest about — `attributesOf` puts the uncertain ones first.
const CHIPS_PER_ROW = 3;

// A drag that moved this far was a swipe, so the click the browser sends after
// it is not a tap on the row and must not open anything.
const TAP_SLOP = 8;

const NO_ITEMS: readonly Item[] = [];

function chipTone(
  attribute: Attribute,
  matchedTags: readonly string[],
): ChipTone {
  if (matchedTags.includes(attribute.tag)) return "match";
  else if (attribute.own === 1) return "yes";
  else if (attribute.own === -1) return "no";
  else return "plain";
}

// The matched attributes first, because they are the row's answer to "why is
// this here" and show how the words were read; the rest keep `attributesOf`'s
// order.
function chipsFor(row: FeedRow): readonly Attribute[] {
  const matched = row.attributes.filter((attribute) =>
    row.matchedTags.includes(attribute.tag),
  );
  const rest = row.attributes.filter(
    (attribute) => !row.matchedTags.includes(attribute.tag),
  );
  return [...matched, ...rest].slice(0, CHIPS_PER_ROW);
}

function ItemRow({
  row,
  onOpen,
  onRate,
}: {
  row: FeedRow;
  onOpen: () => void;
  onRate: (next: RatingValue | null) => void;
}): ReactElement {
  const pressed = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    pressed.current = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: { clientX: number; clientY: number }): void {
    const from = pressed.current;
    pressed.current = null;
    if (
      from &&
      (Math.abs(event.clientX - from.x) >= TAP_SLOP ||
        Math.abs(event.clientY - from.y) >= TAP_SLOP)
    )
      return;
    onOpen();
  }

  // The rule goes on the frame, so at desktop width it runs under the side
  // buttons too rather than stopping short of them.
  const tint =
    row.own === 1
      ? "bg-accent-tint"
      : row.own === -1
        ? "bg-danger-tint"
        : "bg-surface";
  const rule =
    row.own === 1
      ? "border-accent"
      : row.own === -1
        ? "border-danger"
        : "border-border";

  const content = (
    <button
      type="button"
      data-item={row.itemId}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`flex h-full w-full items-center gap-4 px-4 py-3 text-left focus-visible:outline-offset-[-2px] ${tint}`}
    >
      <span className="flex min-w-0 flex-grow flex-col gap-2">
        {/* A name is up to 128 characters with no promise of a space in it. */}
        <span className="min-w-0 text-[17px] font-medium [overflow-wrap:anywhere]">
          {row.itemId}
        </span>
        {row.attributes.length > 0 ? (
          <span className="flex flex-wrap gap-2">
            {chipsFor(row).map((attribute) => (
              <Chip
                key={attribute.tag}
                label={attribute.tag}
                tone={chipTone(attribute, row.matchedTags)}
              />
            ))}
          </span>
        ) : null}
      </span>
      <Bar
        // The matched attribute owns the bar when a typed word found one, so
        // the bar answers the same question the row does (DESIGN §1).
        subject={row.matchedTag ?? row.itemId}
        score={row.barScore}
      />
    </button>
  );

  return (
    <RateRow
      subject={row.itemId}
      value={row.own}
      onRate={onRate}
      frameClassName={`border-b ${rule}`}
    >
      {content}
    </RateRow>
  );
}

// Everyone but an admin arrives with somebody in their vine, so this is for an
// admin with no vine yet, or a vine that has rated nothing yet.
function NothingYet(): ReactElement {
  const { navigate } = useGrapevine();
  return (
    <div className="flex flex-grow flex-col items-center justify-center gap-5 px-8 text-center">
      <Mark />
      <p className="text-[17px] leading-[1.55]">
        nothing here yet. search to add something, or add people to your vine.
      </p>
      <Button
        onClick={() => navigate({ kind: "people" })}
        className="h-[44px] w-full text-[17px]"
      >
        add to your vine
      </Button>
    </div>
  );
}

// Once per viewer, over the first list with something in it: a gesture taught
// before there is anything to use it on teaches nothing. At desktop width the
// thumbs on the buttons say it already.
function FirstRunHint({ onDismiss }: { onDismiss: () => void }): ReactElement {
  const desktop = useIsDesktop();
  return (
    <div className="flex items-center gap-2 border-b border-border py-1 pr-1.5 pl-4">
      <p className="min-w-0 flex-grow text-[15px] text-muted">
        {desktop
          ? "this list comes from your vine."
          : "this list comes from your vine. swipe right for yes, left for no."}
      </p>
      <IconButton label="got it" onClick={onDismiss}>
        <LuX size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

/**
 * The one list, and the whole app around it (DESIGN §1).
 *
 * With the field empty it is the viewer's feed in §2.6's order; typing filters
 * it by name and by attribute and merges in whatever the catalog holds under
 * that prefix, so a thing that exists is found rather than made a second time.
 * A row is the only way to a thing.
 */
export default function FeedView(): ReactElement {
  const { navigate, popped, profile, recheckLocked, explainFailure } =
    useGrapevine();
  const {
    entries,
    computedAt,
    ready,
    failed: feedFailed,
    refreshFailed,
  } = useMyRecs();
  const { ratings, failed: ratingsFailed } = useMyRatings();

  const [query, setQuery] = useState("");
  const [hideRated, setHideRated] = useState(false);
  const [catalog, setCatalog] = useState<readonly Item[]>(NO_ITEMS);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [matches, setMatches] = useState<{
    typed: string;
    rows: readonly MatchRow[];
  } | null>(null);
  const scroller = useRef<HTMLElement>(null);
  // Read after mount: storage is not there during the static export.
  const [hintShown, setHintShown] = useState(false);
  const uid = profile?.uid ?? null;
  useEffect(() => {
    setHintShown(uid !== null && !hintSeen(uid));
  }, [uid]);

  function dismissHint(): void {
    setHintShown(false);
    if (uid !== null) markHintSeen(uid);
  }

  // Only words: `!`, `@` and `#` steer a search over what the viewer already
  // holds, and nothing typed with one is a name that could be found or added.
  const plain = parseQuery(query).plain;
  // What a disabled add shows: the query as a name would be folded, operators
  // and all, since it cannot be one.
  const shownQuery = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  // The folded id, not the raw text: it is what the catalog ranges over, so
  // "Blue Bottle" and "blue bottle" are one query and a capital costs no read.
  const asId = plain ? (normalizeId(query) ?? "") : "";

  useEffect(() => {
    if (asId.length === 0) {
      setCatalog(NO_ITEMS);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const timer = setTimeout(() => {
      searchItems(asId)
        .then((found) => {
          if (!live) return;
          setCatalog(found);
          setSearching(false);
        })
        .catch((failure) => {
          if (!live) return;
          console.error("item search", failure);
          setCatalog(NO_ITEMS);
          setSearching(false);
          setProblem("couldn't search just now. try again.");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [asId]);

  // On open, and nowhere else. `refresh-recs` decides whether that means
  // anything: a feed checked under ten minutes ago with no new thumb behind it
  // comes straight back, so this is not a recompute per visit.
  // A 403 is the function refusing a locked caller, which this tab had not
  // heard about yet.
  useEffect(() => {
    refreshMyRecs().catch((failure) => {
      console.error("refreshRecs", failure);
      if (isForbiddenCall(failure))
        void recheckLocked().catch((error) => console.error("locked", error));
    });
  }, [recheckLocked]);

  // From the viewer's own feed and nothing else, so it discloses nothing
  // (DESIGN §4); recomputed only when the feed changes.
  const relation = useMemo(
    () =>
      relationFrom(
        entries.map((entry) => ({ weight: entry.conf, tags: entry.tags })),
      ),
    [entries],
  );
  // Deferred, so a keystroke lands in the field before a long feed has been
  // searched again: several words cost several times one (DESIGN §1 "Search").
  const listQuery = useDeferredValue(query);
  const { rows, unmatched } = useMemo(
    () =>
      searchFeed(entries, ratings, {
        query: listQuery,
        hideRated,
        catalog,
        relation,
      }),
    [entries, ratings, listQuery, hideRated, catalog, relation],
  );
  const allHidden = useMemo(
    () =>
      hiddenByEye(entries, ratings, { query: listQuery, hideRated, catalog }),
    [entries, ratings, listQuery, hideRated, catalog],
  );

  // Over everything the viewer could reach, not `rows`: the query has already
  // filtered the look-alike out of those, since it is a name the query does not
  // match.
  const sameLooking = useMemo(
    () =>
      query.length > 0 && plain
        ? lookAlike(query, [
            ...entries.map((entry) => entry.itemId),
            ...catalog.map((item) => item.id),
          ])
        : null,
    [query, plain, entries, catalog],
  );
  const idProblem =
    plain && query.trim().length > 0 ? validateItemId(query) : null;
  // What adding would create, which is not what was typed: the id is the
  // folded text, and a label with the capitals left in names a thing that
  // will never exist.
  const typedId = idProblem === null ? normalizeId(query) : null;
  // No feed has ever been written and the ask to write one failed, so the empty
  // list is the failure's and not the viewer's.
  const neverComputed = refreshFailed && computedAt === 0;

  // Written continuously rather than on the way out: a browser Back gives no
  // chance to save anything first.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let queued = 0;
    const onScroll = () => {
      window.clearTimeout(queued);
      queued = window.setTimeout(() => rememberScroll(element.scrollTop), 150);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(queued);
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Coming back to the list puts it where it was left. Instant, never smooth: an
  // animation on something that has only just appeared reads as the page moving
  // under you.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `popped` is not read here — it is the signal that history moved, which is the only thing this effect exists to answer.
  useEffect(() => {
    const to = historyScroll();
    if (to === 0) return;
    const apply = () => {
      scroller.current?.scrollTo({ top: to, behavior: "instant" });
      return (scroller.current?.scrollTop ?? 0) >= to;
    };
    if (apply()) return;
    // You cannot scroll to 900px until something is 900px tall, and the feed
    // this list is returning to may not have landed yet — so retry while it
    // fills in. Landing short is the honest failure: too high, never somewhere
    // unvisited.
    const timers = [60, 160, 320, 640].map((delay) =>
      window.setTimeout(apply, delay),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [popped]);

  async function rate(itemId: string, next: RatingValue | null): Promise<void> {
    setProblem(null);
    // A first swipe is the hint learned.
    if (hintShown) dismissHint();
    try {
      if (next === null) await clearRating(itemId, "");
      else await setRating(itemId, "", next);
    } catch (failure) {
      console.error("rate", failure);
      setProblem(
        await explainFailure(
          failure,
          "couldn't save that just now. try again.",
        ),
      );
    }
  }

  // Provisionally: nothing is written until the thing is rated or given an
  // attribute, so a name typed and abandoned never enters the catalog
  // (DESIGN §1.2).
  //
  // Looked up first, on the tap and never while typing: a match found in
  // Wikipedia or OpenStreetMap is offered, and nothing found, switched off or
  // too slow adds the name as typed.
  async function addTyped(): Promise<void> {
    const id = normalizeId(query);
    if (id === null || looking) return;
    setLooking(true);
    let rows: readonly MatchRow[] = [];
    try {
      rows = await resolveMatches(await lookUp(id));
    } catch (failure) {
      console.error("look up", failure);
    }
    setLooking(false);
    if (rows.length > 0) setMatches({ typed: id, rows });
    else navigate({ kind: "item", id });
  }

  function chooseMatch(row: MatchRow): void {
    setMatches(null);
    void pickMatch(row)
      .catch((failure) => console.error("link", failure))
      .finally(() => navigate({ kind: "item", id: row.itemId }));
  }

  // Announced, never counted: a reader who cannot see the list change is told
  // that it did, and a number of matches is the kind of figure DESIGN §4 keeps
  // off every screen.
  const status =
    query.length === 0 || searching
      ? ""
      : rows.length > 0
        ? "showing results"
        : "nothing matches";

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-border bg-surface pr-2.5 pl-4">
        <Wordmark />
        <AvatarButton />
      </header>

      <main
        ref={scroller}
        className="flex min-h-0 flex-grow flex-col overflow-y-auto"
      >
        {/* The canvas shows under the rows on a phone;
            at desktop width the column is filled, so it reads as one object
            against the canvas beside it. */}
        <div className="flex flex-grow flex-col md:bg-surface">
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
          {feedFailed || neverComputed ? (
            <div className="p-4">
              <LoadFailure subject="your recommendations" />
            </div>
          ) : null}
          {ratingsFailed ? (
            <div className="px-4 pb-4">
              <LoadFailure subject="your ratings" />
            </div>
          ) : null}
          {hintShown && query.length === 0 && rows.length > 0 ? (
            <FirstRunHint onDismiss={dismissHint} />
          ) : null}
          {rows.map((row) => (
            <ItemRow
              key={row.itemId}
              row={row}
              onOpen={() => navigate({ kind: "item", id: row.itemId })}
              onRate={(next) => void rate(row.itemId, next)}
            />
          ))}
          {/* Only about a feed that was READ, and only with nothing typed: an
            empty list under a query is what the add button is for, and an empty
            list under a failed read is not a fact about the viewer. */}
          {rows.length === 0 &&
          query.length === 0 &&
          ready &&
          !feedFailed &&
          !neverComputed ? (
            allHidden ? (
              <p className="px-4 py-4 text-[16px] text-muted">
                you've rated everything here. the eye shows it again.
              </p>
            ) : (
              <NothingYet />
            )
          ) : null}
        </div>
      </main>

      <div className="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2.5">
          {problem ? <FieldNote tone="danger">{problem}</FieldNote> : null}
          {/* Shown the first rather than left to add a second: NFKC keeps a
            Cyrillic `а` apart from a Latin one, and no reader can (DESIGN
            §3.2). */}
          {sameLooking ? (
            <button
              type="button"
              onClick={() => navigate({ kind: "item", id: sameLooking })}
              className="text-left text-[15px] text-muted"
            >
              already here:{" "}
              <span className="text-accent-ink">{sameLooking}</span>
            </button>
          ) : null}
          {/* Said, because a word nothing here matches changes no row and
            would otherwise look ignored. */}
          {unmatched.length > 0 ? (
            <FieldNote>
              nothing matches {unmatched.map((word) => `“${word}”`).join(", ")}
            </FieldNote>
          ) : null}
          {idProblem ? <FieldNote>{idProblem}</FieldNote> : null}
          {typedId ? (
            <AddButton
              label={`add “${typedId}”`}
              onTap={() => void addTyped()}
              busy={looking}
            />
          ) : !plain && query.trim().length > 0 ? (
            // Disabled rather than gone: the add is always where it was, and
            // an operator is not part of a name (DESIGN §1 "Search").
            <AddButton label={`add “${shownQuery}”`} disabled />
          ) : null}
          {matches ? (
            <MatchSheet
              typed={matches.typed}
              rows={matches.rows}
              onChoose={chooseMatch}
              onTyped={() => {
                setMatches(null);
                navigate({ kind: "item", id: matches.typed });
              }}
              onClose={() => setMatches(null)}
            />
          ) : null}
          <div className="flex items-center gap-2.5">
            <SearchField
              value={query}
              onChange={(next) => {
                setQuery(next);
                setProblem(null);
              }}
              placeholder="search or add anything"
            />
            <EyeToggle
              hiding={hideRated}
              onToggle={() => setHideRated((hiding) => !hiding)}
              label={
                hideRated
                  ? "show things you have rated"
                  : "hide things you have rated"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
