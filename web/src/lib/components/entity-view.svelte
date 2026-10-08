<script lang="ts" module>
  import type { RatingValue } from "../utils/types";

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
</script>

<script lang="ts">
  import { normalizeId } from "grapevine-shared";
  import { referenceUrl, sourceOf } from "grapevine-shared/references";
  import {
    ownAttributes,
    suggestAttributes,
  } from "grapevine-shared/suggest-attributes";
  import { cautiousScore } from "../utils/bar";
  import {
    type Attribute,
    attributesOf,
    foldQuery,
    matchesText,
  } from "../utils/discover";
  import { createItem, getItem } from "../utils/items";
  import { clearRating, ratingOf, setRating } from "../utils/ratings";
  import { useMyRatings } from "../utils/ratings.svelte";
  import { useMyRecs } from "../utils/recs.svelte";
  import { attachHeldReference } from "../utils/references";
  import { useItemReference } from "../utils/references.svelte";
  import { reportName } from "../utils/reports";
  import { grapevine } from "../utils/store.svelte";
  import AvatarButton from "./avatar-button.svelte";
  import { alert, confirm, run } from "./dialog.svelte";
  import LoadFailure from "./load-failure.svelte";
  import AddButton from "./ui/add-button.svelte";
  import Bar from "./ui/bar.svelte";
  import Chip from "./ui/chip.svelte";
  import EyeToggle from "./ui/eye-toggle.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuChevronLeft, LuExternalLink } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";
  import SearchField from "./ui/search-field.svelte";

  /**
   * One thing: its own rating, and every attribute it carries for this viewer.
   *
   * The title IS the item's rating control and the item's id IS the title — there
   * is no name to look up, because the id is the text somebody typed (DESIGN
   * §3.2). Nothing on the screen is a number or a count (DESIGN §4): the bars
   * carry the scores and nothing else does.
   *
   * Everything that outlives a tap reads `itemId` first and keeps what it read:
   * a write can land after the screen has moved on to another thing, or away.
   */
  let { itemId }: { itemId: string } = $props();

  const mine = useMyRatings();
  const recs = useMyRecs();
  let query = $state("");
  // Whether the catalog answered that this name exists, which is when it is
  // somebody's to report; a name only the viewer has typed is not.
  let inCatalog = $state<string | null>(null);
  // Reported from this screen this session. Nothing can be read back, so this
  // is only what stops the line being offered twice.
  let reported = $state<string | null>(null);
  let hideRated = $state(false);

  // Carried with the thing they were tapped on rather than cleared by an
  // effect: this screen is not remounted when one thing opens another, so a
  // list keyed on nothing would follow the viewer to the next thing.
  let tapped = $state.raw<TappedHere>({ itemId: "", tags: NO_TAGS });
  const provisional = $derived(
    tapped.itemId === itemId ? tapped.tags : NO_TAGS,
  );

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
  let catalogued: { itemId: string; found: Promise<boolean> } | null = null;

  $effect(() => {
    const id = itemId;
    const asked = {
      itemId: id,
      found: getItem(id)
        .then((item) => item !== null)
        .catch(() => false),
    };
    catalogued = asked;
    void asked.found.then((found) => {
      if (found) inCatalog = id;
    });
    return () => {
      if (catalogued === asked) catalogued = null;
    };
  });

  // A link chosen when the thing was added goes with its first write, after
  // the catalog row it points at.
  async function ensureCatalogued(id: string): Promise<void> {
    const asked = catalogued?.itemId === id ? catalogued.found : null;
    if (!(await (asked ?? Promise.resolve(false)))) {
      await createItem(id);
      if (itemId === id)
        catalogued = { itemId: id, found: Promise.resolve(true) };
    }
    await attachHeldReference(id);
  }

  // No write is held pending: `setRating` and `clearRating` apply the thumb to
  // the shared ratings state before they send anything and put it back if the
  // write is refused, so the screen answers the swipe and not the network.
  function rate(tag: string, next: RatingValue | null): void {
    const id = itemId;
    run(async () => {
      if (next === null) {
        await clearRating(id, tag);
      } else {
        await ensureCatalogued(id);
        await setRating(id, tag, next);
      }
    });
  }

  const entry = $derived(recs.byItemId.get(itemId));
  const own = $derived(ratingOf(mine.ratings, itemId, ""));

  const attributes = $derived.by(() => {
    const listed = attributesOf(itemId, entry, mine.ratings);
    const already = new Set(listed.map((attribute) => attribute.tag));
    // Nothing in reach has weighed in on one of these — that is what makes it a
    // proposal — so they sort where `attributesOf` puts an unknown score
    // anyway, and the one just tapped is at the top because it is the row the
    // viewer reached for.
    const proposed: Attribute[] = provisional
      .filter((tag) => !already.has(tag))
      .map((tag) => ({ tag, score: null, own: null }));
    return [...proposed, ...listed];
  });

  /**
   * The *suggested* rail: attributes to propose on this thing, worked out from
   * the viewer's own ratings on the client and nothing else (DESIGN §2.11).
   *
   * The ratings are what re-rank it: a thumb given here lands in that map before
   * anything is sent, so the row reorders on the swipe rather than on a reply.
   */
  const suggested = $derived.by(() => {
    const proposed = suggestAttributes(
      mine.ratings,
      ownAttributes(mine.ratings, itemId),
    );
    // Dropped only where the viewer's own tap already put the row on screen.
    // Dropping what the SCREEN carries would let somebody else's thumb decide
    // what is proposed, which is the one thing §2.11 exists to make impossible.
    return proposed.filter((tag) => !provisional.includes(tag));
  });
  const folded = $derived(foldQuery(query));
  const shown = $derived(
    attributes.filter(
      (attribute) =>
        (!hideRated || attribute.own === null) &&
        matchesText(folded, attribute.tag),
    ),
  );

  // Offered on every keystroke that names an attribute, not only when nothing
  // matched: identity is by folded name, so an add that collides is a find and
  // tapping it says yes to the attribute that already exists.
  const typedTag = $derived(normalizeId(query));

  function addAttribute(): void {
    const tag = typedTag;
    if (tag === null) return;
    const id = itemId;
    const typed = query;
    run(async () => {
      await ensureCatalogued(id);
      await setRating(id, tag, 1);
      // Emptied once the write has landed and not before: a refusal otherwise
      // takes the typed attribute with it. Anything typed since is somebody's
      // next one, so it stays.
      if (query === typed) query = "";
    });
  }

  // A tap is not an answer: it puts the attribute on screen as a row to swipe,
  // and the swipe is what writes anything.
  function propose(tag: string): void {
    const tags = tapped.itemId === itemId ? tapped.tags : NO_TAGS;
    tapped = tags.includes(tag)
      ? { itemId, tags }
      : { itemId, tags: [tag, ...tags] };
  }

  // Anyone can name a thing and nobody can rename one, so a name that is abuse,
  // a private person or spam is reported to the owner, who can remove it for
  // everyone (0013). No reason is asked for: the owner reads the name.
  async function report(): Promise<void> {
    const id = itemId;
    const sure = await confirm({
      title: "report this name?",
      body: "for a name that is abusive, names a private person, or is spam. it's looked at by hand, and a removed name is gone for everyone.",
      confirmLabel: "report",
      tone: "danger",
    });
    if (!sure) return;
    run(async () => {
      await reportName(id);
      reported = id;
      await alert({ title: "thanks. it'll be looked at." });
    }, "that didn't send. check your connection and try again.");
  }
  const reportable = $derived(entry !== undefined || inCatalog === itemId);

  const reference = useItemReference(() => itemId);
  const source = $derived(
    reference.current ? sourceOf(reference.current.source) : null,
  );
  const link = $derived(
    reference.current ? referenceUrl(reference.current) : null,
  );

  const ownSaid = $derived(answered(own));
</script>

<div class="flex h-full min-h-0 flex-col bg-bg">
  <div class="bg-surface">
    <RateRow
      subject={itemId}
      value={own}
      onRate={(next) => rate("", next)}
      travel={TRAVEL}
      frameClass={`border-b ${rowFill(own)}`}
      contentClass="flex min-w-0 items-center gap-3 min-h-[56px] py-1.5 pr-2.5 pl-1"
    >
      <!-- No fill of its own: on a rated bar a surface square behind the
           arrow is a hole in the verdict. -->
      <button
        type="button"
        aria-label="back"
        onclick={grapevine.back}
        class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm text-text focus-visible:outline-offset-[-2px]"
      >
        <Icon icon={LuChevronLeft} size={20} aria-hidden="true" />
      </button>
      <!-- Wrapped, never cut: the name is the thing, and there is nowhere
           else on a phone to read the rest of it. -->
      <h1
        class="font-display min-w-0 flex-grow text-[22px] leading-tight font-semibold text-text [overflow-wrap:anywhere]"
      >
        {itemId}
      </h1>
      {#if ownSaid}
        <span class="sr-only">{ownSaid}</span>
      {/if}
      {#if source && link}
        <!-- biome-ignore lint/a11y/useAnchorContent: named by its `aria-label`; the glyph is all it draws. -->
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`open on ${source.label.toLowerCase()}`}
          title={`open on ${source.label.toLowerCase()}`}
          class="grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-offset-[-2px]"
        >
          <Icon icon={LuExternalLink} size={20} aria-hidden="true" />
        </a>
      {/if}
      <Bar
        subject={itemId}
        score={cautiousScore(entry?.score ?? null, entry?.conf ?? null)}
      />
      <AvatarButton onAccent={own === 1} />
    </RateRow>
  </div>

  <main class="flex min-h-0 flex-grow flex-col overflow-y-auto">
    <div class="flex flex-grow flex-col bg-surface">
      <!-- Said out loud because the thumbs below are drawn from these two
           reads: with the viewer's own ratings unread, a row they have already
           answered renders un-rated, and swiping the way they voted sets it
           again rather than clearing it. -->
      {#if mine.failed || recs.failed}
        <div class="flex flex-col gap-3 p-4">
          {#if mine.failed}
            <LoadFailure subject="your ratings" />
          {/if}
          {#if recs.failed}
            <LoadFailure subject="your recommendations" />
          {/if}
        </div>
      {/if}

      {#each shown as attribute (attribute.tag)}
        {@const said = answered(attribute.own)}
        <RateRow
          subject={attribute.tag}
          value={attribute.own}
          onRate={(next) => rate(attribute.tag, next)}
          travel={TRAVEL}
          frameClass={rowFill(attribute.own)}
          contentClass="flex min-w-0 items-center gap-3 px-4 py-3.5"
        >
          <span
            class="min-w-0 flex-grow text-[17px] font-medium [overflow-wrap:anywhere]"
          >
            {attribute.tag}
          </span>
          {#if said}
            <span class="sr-only">{said}</span>
          {/if}
          <Bar subject={attribute.tag} score={attribute.score} />
        </RateRow>
      {/each}

      <!-- The heading stays whatever the rail holds: it names a group and
           claims nothing about it, and a viewer who has rated no attributes
           anywhere gets an empty rail rather than a line of filler telling
           them so. Nothing here is a count, a source or a rank — a chip is the
           attribute and nothing else (DESIGN §4). -->
      <h2 class="label px-4 pt-4 pb-2 text-[15px] text-muted">suggested</h2>
      <div class="flex flex-wrap gap-2 px-4 pb-5">
        {#each suggested as tag (tag)}
          <Chip label={tag} tone="add" onTap={() => propose(tag)} />
        {/each}
      </div>

      <!-- Last, and quiet: about the name, not the thing's rating. -->
      <div class="mt-auto">
        {#if reportable}
          <button
            type="button"
            disabled={reported === itemId}
            onclick={() => void report()}
            class="block w-full border-t border-border bg-surface px-4 py-3 text-left text-[15px] text-muted focus-visible:outline-offset-[-2px] disabled:cursor-default"
          >
            {reported === itemId ? "reported" : "report this name"}
          </button>
        {/if}
      </div>
    </div>
  </main>

  <div
    class="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
  >
    <div class="flex flex-col gap-2.5">
      {#if typedTag !== null}
        <AddButton label={`add attribute “${typedTag}”`} onTap={addAttribute} />
      {/if}
      <div class="flex items-center gap-2.5">
        <SearchField
          value={query}
          onChange={(next) => {
            query = next;
          }}
          placeholder="filter attributes"
        />
        <EyeToggle
          hiding={hideRated}
          onToggle={() => {
            hideRated = !hideRated;
          }}
          label="hide attributes you have rated"
        />
      </div>
    </div>
  </div>
</div>
