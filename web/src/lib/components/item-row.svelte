<script lang="ts" module>
  import type { Attribute, FeedRow } from "../utils/discover";
  import type { ChipTone } from "./ui/chip.svelte";

  // A row's worth. A thing with thirty attributes would otherwise be
  // a row three lines deep, and the ones left out are the ones the viewer's own
  // feed is surest about — `attributesOf` puts the uncertain ones first.
  const CHIPS_PER_ROW = 3;

  // A drag that moved this far was a swipe, so the click the browser sends after
  // it is not a tap on the row and must not open anything.
  const TAP_SLOP = 8;

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
</script>

<script lang="ts">
  import type { RatingValue } from "../utils/types";
  import Bar from "./ui/bar.svelte";
  import Chip from "./ui/chip.svelte";
  import RateRow from "./ui/rate-row.svelte";

  // One thing in the list: its name, a row's worth of attributes and its bar,
  // rated in place and opened by a tap.
  let {
    row,
    onOpen,
    onRate,
  }: {
    row: FeedRow;
    onOpen: () => void;
    onRate: (next: RatingValue | null) => void;
  } = $props();

  let pressed: { x: number; y: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    pressed = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: MouseEvent): void {
    const from = pressed;
    pressed = null;
    if (
      from &&
      (Math.abs(event.clientX - from.x) >= TAP_SLOP ||
        Math.abs(event.clientY - from.y) >= TAP_SLOP)
    )
      return;
    onOpen();
  }

  const tint = $derived(
    row.own === 1
      ? "bg-accent-tint"
      : row.own === -1
        ? "bg-danger-tint"
        : "bg-surface",
  );
</script>

<RateRow subject={row.itemId} value={row.own} {onRate} frameClass={tint}>
  <button
    type="button"
    data-item={row.itemId}
    onpointerdown={onPointerDown}
    onclick={onClick}
    class={[
      "flex h-full w-full items-center gap-4 px-4 py-3 text-left focus-visible:outline-offset-[-2px]",
      tint,
    ]}
  >
    <span class="flex min-w-0 flex-grow flex-col gap-2">
      <!-- A name is up to 128 characters with no promise of a space in it. -->
      <span class="min-w-0 text-[17px] font-medium [overflow-wrap:anywhere]">
        {row.itemId}
      </span>
      {#if row.attributes.length > 0}
        <span class="flex flex-wrap gap-2">
          {#each chipsFor(row) as attribute (attribute.tag)}
            <Chip
              label={attribute.tag}
              tone={chipTone(attribute, row.matchedTags)}
            />
          {/each}
        </span>
      {/if}
    </span>
    <!-- The matched attribute owns the bar when a typed word found one, so
         the bar answers the same question the row does (DESIGN §1). -->
    <Bar subject={row.matchedTag ?? row.itemId} score={row.barScore} />
  </button>
</RateRow>
