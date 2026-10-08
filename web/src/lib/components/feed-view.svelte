<script lang="ts" module>
  import type { Item } from "../utils/types";

  // Long enough that a typed word is one query rather than six, short enough that
  // the catalog has usually landed by the time the fingers stop.
  const SEARCH_DEBOUNCE_MS = 200;

  const NO_ITEMS: readonly Item[] = [];
</script>

<script lang="ts">
  import { normalizeId } from "grapevine-shared";
  import { parseQuery, relationFrom } from "grapevine-shared/search";
  import { onMount, untrack } from "svelte";
  import { hiddenByEye, lookAlike, searchFeed } from "../utils/discover";
  import { hintSeen, markHintSeen } from "../utils/first-run";
  import { searchItems, validateItemId } from "../utils/items";
  import { lookUp } from "../utils/lookup";
  import { desktop } from "../utils/media.svelte";
  import { clearRating, setRating } from "../utils/ratings";
  import { useMyRatings } from "../utils/ratings.svelte";
  import { refreshMyRecs } from "../utils/recs";
  import { useMyRecs } from "../utils/recs.svelte";
  import {
    type MatchRow,
    chooseMatch as pickMatch,
    resolveMatches,
  } from "../utils/references";
  import { isForbiddenCall } from "../utils/refusal";
  import { historyScroll, rememberScroll } from "../utils/router";
  import { grapevine } from "../utils/store.svelte";
  import type { RatingValue } from "../utils/types";
  import AvatarButton from "./avatar-button.svelte";
  import ItemRow from "./item-row.svelte";
  import LoadFailure from "./load-failure.svelte";
  import MatchSheet from "./match-sheet.svelte";
  import NothingYet from "./nothing-yet.svelte";
  import AddButton from "./ui/add-button.svelte";
  import CenteredNote from "./ui/centered-note.svelte";
  import EyeToggle from "./ui/eye-toggle.svelte";
  import FieldNote from "./ui/field-note.svelte";
  import Icon from "./ui/icon.svelte";
  import IconButton from "./ui/icon-button.svelte";
  import { LuX } from "./ui/icons";
  import SearchField from "./ui/search-field.svelte";
  import Wordmark from "./wordmark.svelte";

  /**
   * The one list, and the whole app around it (DESIGN §1).
   *
   * With the field empty it is the viewer's feed in §2.6's order; typing filters
   * it by name and by attribute and merges in whatever the catalog holds under
   * that prefix, so a thing that exists is found rather than made a second time.
   * A row is the only way to a thing.
   */
  const recs = useMyRecs();
  const mine = useMyRatings();

  let query = $state("");
  let hideRated = $state(false);
  let catalog = $state.raw<readonly Item[]>(NO_ITEMS);
  let searching = $state(false);
  let problem = $state<string | null>(null);
  let looking = $state(false);
  let matches = $state.raw<{
    typed: string;
    rows: readonly MatchRow[];
  } | null>(null);
  let scroller: HTMLElement | undefined = $state();
  // Read after mount: storage is not there while a page is prerendered.
  let hintShown = $state(false);
  const uid = $derived(grapevine.profile?.uid ?? null);
  $effect(() => {
    hintShown = uid !== null && !hintSeen(uid);
  });

  function dismissHint(): void {
    hintShown = false;
    if (uid !== null) markHintSeen(uid);
  }

  // Only words: `!`, `@` and `#` steer a search over what the viewer already
  // holds, and nothing typed with one is a name that could be found or added.
  const plain = $derived(parseQuery(query).plain);
  // What a disabled add shows: the query as a name would be folded, operators
  // and all, since it cannot be one.
  const shownQuery = $derived(
    query.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim(),
  );
  // The folded id, not the raw text: it is what the catalog ranges over, so
  // "Blue Bottle" and "blue bottle" are one query and a capital costs no read.
  const asId = $derived(plain ? (normalizeId(query) ?? "") : "");

  $effect(() => {
    const id = asId;
    if (id.length === 0) {
      catalog = NO_ITEMS;
      searching = false;
      return;
    }
    searching = true;
    let live = true;
    const timer = setTimeout(() => {
      searchItems(id)
        .then((found) => {
          if (!live) return;
          catalog = found;
          searching = false;
        })
        .catch((failure) => {
          if (!live) return;
          console.error("item search", failure);
          catalog = NO_ITEMS;
          searching = false;
          problem = "couldn't search just now. try again.";
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  // On open, and nowhere else. `refresh-recs` decides whether that means
  // anything: a feed checked under ten minutes ago with no new thumb behind it
  // comes straight back, so this is not a recompute per visit.
  // A 403 is the function refusing a locked caller, which this tab had not
  // heard about yet.
  onMount(() => {
    refreshMyRecs().catch((failure) => {
      console.error("refreshRecs", failure);
      if (isForbiddenCall(failure))
        void grapevine
          .recheckLocked()
          .catch((error) => console.error("locked", error));
    });
  });

  // From the viewer's own feed and nothing else, so it discloses nothing
  // (DESIGN §4); recomputed only when the feed changes.
  const relation = $derived(
    relationFrom(
      recs.entries.map((entry) => ({ weight: entry.conf, tags: entry.tags })),
    ),
  );
  // A step behind the field, so a keystroke is drawn before a long feed has
  // been searched again: several words cost several times one (DESIGN §1
  // "Search").
  let listQuery = $state("");
  $effect(() => {
    const typed = query;
    const timer = setTimeout(() => {
      listQuery = typed;
    }, 0);
    return () => clearTimeout(timer);
  });
  const found = $derived(
    searchFeed(recs.entries, mine.ratings, {
      query: listQuery,
      hideRated,
      catalog,
      relation,
    }),
  );
  const rows = $derived(found.rows);
  const unmatched = $derived(found.unmatched);
  const allHidden = $derived(
    hiddenByEye(recs.entries, mine.ratings, {
      query: listQuery,
      hideRated,
      catalog,
    }),
  );

  // Over everything the viewer could reach, not `rows`: the query has already
  // filtered the look-alike out of those, since it is a name the query does not
  // match.
  const sameLooking = $derived(
    query.length > 0 && plain
      ? lookAlike(query, [
          ...recs.entries.map((entry) => entry.itemId),
          ...catalog.map((item) => item.id),
        ])
      : null,
  );
  const idProblem = $derived(
    plain && query.trim().length > 0 ? validateItemId(query) : null,
  );
  // What adding would create, which is not what was typed: the id is the
  // folded text, and a label with the capitals left in names a thing that
  // will never exist.
  const typedId = $derived(idProblem === null ? normalizeId(query) : null);
  // No feed has ever been written and the ask to write one failed, so the empty
  // list is the failure's and not the viewer's.
  const neverComputed = $derived(recs.refreshFailed && recs.computedAt === 0);

  // Written continuously rather than on the way out: a browser Back gives no
  // chance to save anything first.
  onMount(() => {
    const element = scroller;
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
  });

  // Coming back to the list puts it where it was left. Instant, never smooth: an
  // animation on something that has only just appeared reads as the page moving
  // under you.
  $effect(() => {
    // Not read for its value: it is the signal that history moved, which is
    // the only thing this effect exists to answer.
    void grapevine.popped;
    return untrack(() => {
      const to = historyScroll();
      if (to === 0) return;
      const apply = () => {
        scroller?.scrollTo({ top: to, behavior: "instant" });
        return (scroller?.scrollTop ?? 0) >= to;
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
    });
  });

  async function rate(itemId: string, next: RatingValue | null): Promise<void> {
    problem = null;
    // A first swipe is the hint learned.
    if (hintShown) dismissHint();
    try {
      if (next === null) await clearRating(itemId, "");
      else await setRating(itemId, "", next);
    } catch (failure) {
      console.error("rate", failure);
      problem = await grapevine.explainFailure(
        failure,
        "couldn't save that just now. try again.",
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
    looking = true;
    let offered: readonly MatchRow[] = [];
    try {
      offered = await resolveMatches(await lookUp(id));
    } catch (failure) {
      console.error("look up", failure);
    }
    looking = false;
    if (offered.length > 0) matches = { typed: id, rows: offered };
    else grapevine.navigate({ kind: "item", id });
  }

  function chooseMatch(row: MatchRow): void {
    matches = null;
    void pickMatch(row)
      .catch((failure) => console.error("link", failure))
      .finally(() => grapevine.navigate({ kind: "item", id: row.itemId }));
  }

  // Announced, never counted: a reader who cannot see the list change is told
  // that it did, and a number of matches is the kind of figure DESIGN §4 keeps
  // off every screen.
  const status = $derived(
    query.length === 0 || searching
      ? ""
      : rows.length > 0
        ? "showing results"
        : "nothing matches",
  );
</script>

<div class="flex h-full flex-col">
  <header
    class="flex h-[56px] shrink-0 items-center justify-between border-b border-border bg-surface pr-2.5 pl-4"
  >
    <Wordmark />
    <AvatarButton />
  </header>

  <main
    bind:this={scroller}
    class="flex min-h-0 flex-grow flex-col overflow-y-auto"
  >
    <!-- The canvas shows under the rows on a phone;
         at desktop width the column is filled, so it reads as one object
         against the canvas beside it. -->
    <div class="flex flex-grow flex-col md:bg-surface">
      <p aria-live="polite" class="sr-only">{status}</p>
      {#if recs.failed || neverComputed}
        <div class="p-4">
          <LoadFailure subject="your recommendations" />
        </div>
      {/if}
      {#if mine.failed}
        <div class="px-4 pb-4">
          <LoadFailure subject="your ratings" />
        </div>
      {/if}
      <!-- Once per viewer, over the first list with something in it: a gesture
           taught before there is anything to use it on teaches nothing. At
           desktop width the thumbs on the buttons say it already. -->
      {#if hintShown && query.length === 0 && rows.length > 0}
        <div
          class="flex items-center gap-2 border-b border-border py-1 pr-1.5 pl-4"
        >
          <p class="min-w-0 flex-grow text-[15px] text-muted">
            {desktop.current
              ? "this list comes from your vine."
              : "this list comes from your vine. swipe right for yes, left for no."}
          </p>
          <IconButton label="got it" onclick={dismissHint}>
            <Icon icon={LuX} size={18} aria-hidden="true" />
          </IconButton>
        </div>
      {/if}
      {#each rows as row (row.itemId)}
        <ItemRow
          {row}
          onOpen={() => grapevine.navigate({ kind: "item", id: row.itemId })}
          onRate={(next) => void rate(row.itemId, next)}
        />
      {/each}
      <!-- Only about a feed that was READ: an empty list under a failed read
           is not a fact about the viewer. Under a query, only once the catalog
           has answered and the list has caught up with the field, or it would
           flash on every keystroke. -->
      {#if rows.length === 0 && recs.ready && !recs.failed && !neverComputed && listQuery === query && (query.length === 0 || !searching)}
        {#if allHidden}
          <p class="px-4 py-4 text-[16px] text-muted">
            you've rated everything here. the eye shows it again.
          </p>
        {:else if query.length === 0}
          <NothingYet />
        {:else}
          <CenteredNote>
            nothing matches
            {(unmatched.length > 0 ? unmatched : [query.trim()])
              .map((word) => `“${word}”`)
              .join(", ")}
          </CenteredNote>
        {/if}
      {/if}
    </div>
  </main>

  <div
    class="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
  >
    <div class="flex flex-col gap-2.5">
      {#if problem}
        <FieldNote tone="danger">{problem}</FieldNote>
      {/if}
      <!-- Shown the first rather than left to add a second: NFKC keeps a
           Cyrillic `а` apart from a Latin one, and no reader can (DESIGN
           §3.2). -->
      {#if sameLooking}
        <button
          type="button"
          onclick={() => grapevine.navigate({ kind: "item", id: sameLooking })}
          class="text-left text-[15px] text-muted"
        >
          already here:
          <span class="text-accent-ink">{sameLooking}</span>
        </button>
      {/if}
      {#if idProblem}
        <FieldNote>{idProblem}</FieldNote>
      {/if}
      {#if typedId}
        <AddButton
          label={`add “${typedId}”`}
          onTap={() => void addTyped()}
          busy={looking}
        />
      {:else if !plain && query.trim().length > 0}
        <!-- Disabled rather than gone: the add is always where it was, and
             an operator is not part of a name (DESIGN §1 "Search"). -->
        <AddButton label={`add “${shownQuery}”`} disabled />
      {/if}
      {#if matches}
        <MatchSheet
          typed={matches.typed}
          rows={matches.rows}
          onChoose={chooseMatch}
          onTyped={() => {
            const typed = matches?.typed;
            matches = null;
            if (typed !== undefined)
              grapevine.navigate({ kind: "item", id: typed });
          }}
          onClose={() => {
            matches = null;
          }}
        />
      {/if}
      <div class="flex items-center gap-2.5">
        <SearchField
          value={query}
          onChange={(next) => {
            query = next;
            problem = null;
          }}
          placeholder="search or add anything"
        />
        <EyeToggle
          hiding={hideRated}
          onToggle={() => {
            hideRated = !hideRated;
          }}
          label={hideRated
            ? "show things you have rated"
            : "hide things you have rated"}
        />
      </div>
    </div>
  </div>
</div>
