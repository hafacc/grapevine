<script lang="ts">
  import type { Snippet } from "svelte";
  import { desktop } from "../../utils/media.svelte";
  import type { RatingValue } from "../../utils/types";
  import SideButton from "./side-buttons.svelte";
  import SwipeRow, { type SwipeLabels } from "./swipe-row.svelte";

  /**
   * Anything that can be rated in place: swiped at phone width, and at desktop
   * width the same row between its two side buttons (DESIGN §1.8).
   *
   * The list and a thing's own screen both draw rows this way, and the rule for
   * which of the two a viewer gets lives here alone — in two copies it is the
   * kind of thing that stays in step until the day somebody changes one.
   */
  let {
    subject,
    value,
    onRate,
    travel,
    sides = "both",
    labels,
    frameClass = "",
    contentClass = "",
    children,
  }: {
    // What the side buttons name, since a button with a glyph and no text says
    // nothing about which row it belongs to.
    subject: string;
    value: RatingValue | null;
    onRate: (next: RatingValue | null) => void;
    travel?: number;
    // "no" is a row with only the one answer: a swipe left, or at desktop width
    // the left button alone. "yes" is the mirror of it.
    sides?: "both" | "no" | "yes";
    // Words in place of the thumbs, for a row where a side is not a rating.
    labels?: SwipeLabels;
    // The whole row, side buttons included: its rule and, where the row carries
    // the viewer's own answer as a color, its fill.
    frameClass?: string;
    // Only the part a swipe moves, which is why padding belongs here: at desktop
    // width it must not push the buttons apart.
    contentClass?: string;
    children: Snippet;
  } = $props();
</script>

{#if desktop.current}
  <div class={["flex shrink-0 items-stretch", frameClass]}>
    {#if sides !== "yes"}
      <SideButton side="left" {subject} {value} {onRate} label={labels?.no} />
    {/if}
    <div class={["min-w-0 flex-grow", contentClass]}>
      {@render children()}
    </div>
    {#if sides !== "no"}
      <SideButton side="right" {subject} {value} {onRate} label={labels?.yes} />
    {/if}
  </div>
{:else}
  <div class="shrink-0">
    <SwipeRow
      {value}
      {onRate}
      {travel}
      {sides}
      {labels}
      class={`${frameClass} ${contentClass}`}
    >
      {@render children()}
    </SwipeRow>
  </div>
{/if}
