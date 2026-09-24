"use client";

import { normalizeId } from "grapevine-shared";
import {
  ownAttributes,
  suggestAttributes,
} from "grapevine-shared/suggest-attributes";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronLeft } from "react-icons/lu";
import {
  type Attribute,
  attributesOf,
  foldQuery,
  matchesText,
} from "../utils/discover";
import { createItem, getItem } from "../utils/items";
import {
  clearRating,
  ratingOf,
  setRating,
  useMyRatings,
} from "../utils/ratings";
import { useMyRecs } from "../utils/recs";
import { useGrapevine } from "../utils/store";
import type { RatingValue } from "../utils/types";
import AvatarButton from "./avatar-button";
import { useAction } from "./dialog";
import LoadFailure from "./load-failure";
import AddButton from "./ui/add-button";
import Bar from "./ui/bar";
import Chip from "./ui/chip";
import EyeToggle from "./ui/eye-toggle";
import RateRow from "./ui/rate-row";
import SearchField from "./ui/search-field";

// A title bar and an attribute row are shallower than a row in the list, so
// they travel less before letting go rates (DESIGN-UI, "Swipe reveal").
const TRAVEL = 96;

/**
 * The attributes a viewer has tapped on one thing and not yet answered.
 *
 * They are rows on this screen and nothing else: an attribute exists on a thing
 * because somebody RATED it there (DESIGN §2.11), so a chip tapped and
 * abandoned leaves nothing behind — not in the catalog, not in anybody's feed,
 * and gone on the next open. The thing they were tapped on rides along so that
 * opening another one starts empty.
 */
type TappedHere = {
  readonly itemId: string;
  readonly tags: readonly string[];
};

const NO_TAGS: readonly string[] = [];

/**
 * What a row is filled with, given the viewer's own thumb on it.
 *
 * The stronger `*-soft` rather than the list's `*-tint`: a thing's own screen
 * carries its verdict as a background, so anything rated inside it has to mark
 * itself against an already-tinted page (DESIGN-UI, "Soft and tint").
 */
function rowFill(own: RatingValue | null): string {
  if (own === 1) return "border-accent bg-accent-soft text-accent-ink";
  else if (own === -1) return "border-danger bg-danger-soft text-danger-ink";
  else return "border-border bg-surface text-text";
}

// The tone is the whole of what a rated row says, and a tone is not something
// every reader can see.
function answered(own: RatingValue | null): string | null {
  if (own === 1) return "you said yes";
  else if (own === -1) return "you said no";
  else return null;
}

/**
 * One thing: its own rating, and every attribute it carries for this viewer.
 *
 * The title IS the item's rating control and the item's id IS the title — there
 * is no name to look up, because the id is the text somebody typed (DESIGN
 * §3.2). Nothing on the screen is a number or a count (DESIGN §4): the bars
 * carry the scores and nothing else does.
 */
export default function EntityView({
  itemId,
}: {
  itemId: string;
}): ReactElement {
  const { back } = useGrapevine();
  const { ratings, failed: ratingsFailed } = useMyRatings();
  const { byItemId, error, failed: feedFailed } = useMyRecs();
  const run = useAction();
  const [query, setQuery] = useState("");
  const [hideRated, setHideRated] = useState(false);

  // Carried with the thing they were tapped on rather than cleared by an
  // effect: this screen is not remounted when one thing opens another, so a
  // list keyed on nothing would follow the viewer to the next thing.
  const [tapped, setTapped] = useState<TappedHere>({ itemId, tags: [] });
  const provisional = tapped.itemId === itemId ? tapped.tags : NO_TAGS;

  /**
   * Whether the shared catalog holds this thing, which decides whether a first
   * thumb has to create it (DESIGN §1.2: a name typed into the field opens the
   * thing PROVISIONALLY, and nothing is written until it is rated).
   *
   * The promise itself rather than its answer, so a swipe that lands before the
   * read does waits for it: guessing "it exists" leaves the thing out of
   * everybody else's search, and guessing "it does not" spends one of the
   * viewer's daily writes on a row that is already there. A read that fails
   * reads as absent, because the insert behind `createItem` is an upsert and
   * doing it needlessly costs one write where skipping it costs the catalog a
   * row. There is no ratings-to-items foreign key, so this cannot be inferred
   * from the feed.
   */
  const catalogued = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const asked = getItem(itemId)
      .then((item) => item !== null)
      .catch(() => false);
    catalogued.current = asked;
    return () => {
      if (catalogued.current === asked) catalogued.current = null;
    };
  }, [itemId]);

  async function ensureCatalogued(): Promise<void> {
    if (await (catalogued.current ?? Promise.resolve(false))) return;
    await createItem(itemId);
    catalogued.current = Promise.resolve(true);
  }

  // No write is held pending: `setRating` and `clearRating` apply the thumb to
  // the shared ratings state before they send anything and put it back if the
  // write is refused, so the screen answers the swipe and not the network.
  function rate(tag: string, next: RatingValue | null): void {
    run(async () => {
      if (next === null) {
        await clearRating(itemId, tag);
      } else {
        await ensureCatalogued();
        await setRating(itemId, tag, next);
      }
    });
  }

  const entry = byItemId.get(itemId);
  const own = ratingOf(ratings, itemId, "");

  // DESIGN §1 "The bar": `user_recs.error` is already on the score's own scale
  // and the bar maps a width of 2 onto a width of 1, so the step the fill may
  // move in is half of it. Null is no feed to quantize against, which the bar
  // draws as nothing known yet rather than picking a step of its own.
  const quantum = error === null ? null : error / 2;

  // An entry with `conf: 0` is one carried only by an attribute of it — its
  // chips are why it is in the feed at all, and the thing's own score behind
  // them is supported by nothing, so the title's bar says nothing known yet.
  const itemQuantum = entry !== undefined && entry.conf > 0 ? quantum : null;

  const attributes = useMemo(() => {
    const listed = attributesOf(itemId, entry, ratings);
    const already = new Set(listed.map((attribute) => attribute.tag));
    // Nothing in reach has weighed in on one of these — that is what makes it a
    // proposal — so they sort where `attributesOf` puts an unknown score
    // anyway, and the one just tapped is at the top because it is the row the
    // viewer reached for.
    const proposed: Attribute[] = provisional
      .filter((tag) => !already.has(tag))
      .map((tag) => ({ tag, score: null, own: null }));
    return [...proposed, ...listed];
  }, [itemId, entry, ratings, provisional]);

  /**
   * The *suggested* rail: attributes to propose on this thing, worked out from
   * the viewer's own ratings on the client and nothing else (DESIGN §2.11).
   *
   * `ratings` is what re-ranks it: a thumb given here lands in that map before
   * anything is sent, so the row reorders on the swipe rather than on a reply.
   */
  const suggested = useMemo(() => {
    const proposed = suggestAttributes(ratings, ownAttributes(ratings, itemId));
    // Dropped only where the viewer's own tap already put the row on screen.
    // Dropping what the SCREEN carries would let somebody else's thumb decide
    // what is proposed, which is the one thing §2.11 exists to make impossible.
    return proposed.filter((tag) => !provisional.includes(tag));
  }, [itemId, ratings, provisional]);
  const folded = foldQuery(query);
  const shown = attributes.filter(
    (attribute) =>
      (!hideRated || attribute.own === null) &&
      matchesText(folded, attribute.tag),
  );

  // Offered on every keystroke that names an attribute, not only when nothing
  // matched: identity is by folded name, so an add that collides is a find and
  // tapping it says yes to the attribute that already exists.
  const typedTag = normalizeId(query);

  function addAttribute(): void {
    if (typedTag === null) return;
    const typed = query;
    run(async () => {
      await ensureCatalogued();
      await setRating(itemId, typedTag, 1);
      // Emptied once the write has landed and not before: a refusal otherwise
      // takes the typed attribute with it. Anything typed since is somebody's
      // next one, so it stays.
      setQuery((current) => (current === typed ? "" : current));
    });
  }

  // A tap is not an answer: it puts the attribute on screen as a row to swipe,
  // and the swipe is what writes anything.
  function propose(tag: string): void {
    setTapped((current) => {
      const tags = current.itemId === itemId ? current.tags : NO_TAGS;
      return tags.includes(tag)
        ? { itemId, tags }
        : { itemId, tags: [tag, ...tags] };
    });
  }

  const ownSaid = answered(own);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="bg-surface">
        <RateRow
          subject={itemId}
          value={own}
          onRate={(next) => rate("", next)}
          travel={TRAVEL}
          frameClassName={`border-b ${rowFill(own)}`}
          contentClassName="flex min-w-0 items-center gap-3 min-h-[56px] py-1.5 pr-2.5 pl-1"
        >
          {/* No fill of its own: on a rated bar a surface square behind the
              arrow is a hole in the verdict. */}
          <button
            type="button"
            aria-label="back"
            onClick={back}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm text-text focus-visible:outline-offset-[-2px]"
          >
            <LuChevronLeft size={20} aria-hidden="true" />
          </button>
          {/* Wrapped, never cut: the name is the thing, and there is nowhere
              else on a phone to read the rest of it. */}
          <h1 className="font-display min-w-0 flex-grow text-[22px] leading-tight font-semibold text-text [overflow-wrap:anywhere]">
            {itemId}
          </h1>
          {ownSaid ? <span className="sr-only">{ownSaid}</span> : null}
          <Bar
            subject={itemId}
            score={entry?.score ?? 0}
            quantum={itemQuantum}
          />
          <AvatarButton onAccent={own === 1} />
        </RateRow>
      </div>

      <main className="flex min-h-0 flex-grow flex-col overflow-y-auto">
        <div className="flex flex-grow flex-col bg-surface">
          {/* Said out loud because the thumbs below are drawn from these two
            reads: with the viewer's own ratings unread, a row they have already
            answered renders un-rated, and swiping the way they voted sets it
            again rather than clearing it. */}
          {ratingsFailed || feedFailed ? (
            <div className="flex flex-col gap-3 p-4">
              {ratingsFailed ? <LoadFailure subject="your ratings" /> : null}
              {feedFailed ? (
                <LoadFailure subject="your recommendations" />
              ) : null}
            </div>
          ) : null}

          {shown.map((attribute) => {
            const said = answered(attribute.own);
            return (
              <RateRow
                key={attribute.tag}
                subject={attribute.tag}
                value={attribute.own}
                onRate={(next) => rate(attribute.tag, next)}
                travel={TRAVEL}
                frameClassName={`border-b ${rowFill(attribute.own)}`}
                contentClassName="flex min-w-0 items-center gap-3 px-4 py-3.5"
              >
                <span className="min-w-0 flex-grow text-[17px] font-medium [overflow-wrap:anywhere]">
                  {attribute.tag}
                </span>
                {said ? <span className="sr-only">{said}</span> : null}
                <Bar
                  subject={attribute.tag}
                  score={attribute.score ?? 0}
                  quantum={attribute.score === null ? null : quantum}
                />
              </RateRow>
            );
          })}

          {/* The heading stays whatever the rail holds: it names a group and
            claims nothing about it, and a viewer who has rated no attributes
            anywhere gets an empty rail rather than a line of filler telling
            them so. Nothing here is a count, a source or a rank — a chip is the
            attribute and nothing else (DESIGN §4). */}
          <h2 className="label px-4 pt-4 pb-2 text-[15px] text-muted">
            suggested
          </h2>
          <div className="flex flex-wrap gap-2 px-4 pb-5">
            {suggested.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                tone="add"
                onTap={() => propose(tag)}
              />
            ))}
          </div>
        </div>
      </main>

      <div className="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2.5">
          {typedTag === null ? null : (
            <AddButton
              label={`add attribute “${typedTag}”`}
              onTap={addAttribute}
            />
          )}
          <div className="flex items-center gap-2.5">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="filter attributes"
            />
            <EyeToggle
              hiding={hideRated}
              onToggle={() => setHideRated(!hideRated)}
              label="hide attributes you have rated"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
