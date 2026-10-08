<script lang="ts">
  import { type SwipeDirection, swipeOutcome } from "../../utils/swipe";
  import type { RatingValue } from "../../utils/types";
  import Icon from "./icon.svelte";
  import { LuMinus, LuThumbsDown, LuThumbsUp } from "./icons";
  import type { SwipeLabel } from "./swipe-row.svelte";

  /**
   * One end of a row at desktop width: no on the left, yes on the right. Inset
   * 4 px with the one radius, because rows carry no rule between them and
   * flush buttons would run down the list as one colored column.
   *
   * It replaces the swipe and nothing else — the rest of the desktop is the phone
   * layout in a column. The side matching the viewer's current rating goes muted
   * with a minus, because pressing it clears, which is the same rule the swipe
   * follows. A row where a side is not a rating names what it does in a word
   * and an icon instead, since a thumb there would read as a verdict.
   */
  let {
    side,
    subject,
    value,
    onRate,
    label,
  }: {
    side: SwipeDirection;
    subject: string;
    value: RatingValue | null;
    onRate: (next: RatingValue | null) => void;
    label?: SwipeLabel;
  } = $props();

  const outcome = $derived(swipeOutcome(value, side));
  const clears = $derived(outcome.next === null);
  const yes = $derived(side === "right");
  const tone = $derived(
    clears
      ? "bg-surface-muted text-muted"
      : yes
        ? "bg-accent-soft text-accent-ink"
        : "bg-danger-soft text-danger-ink",
  );
</script>

{#if label}
  <button
    type="button"
    aria-label={`${label.word}, ${subject}`}
    onclick={() => onRate(outcome.next)}
    class={[
      "font-display m-1 flex min-w-[56px] shrink-0 items-center rounded-sm justify-center gap-1.5 px-3 text-[15px] font-semibold focus-visible:outline-offset-[-2px]",
      tone,
    ]}
  >
    <Icon icon={label.icon} size={16} aria-hidden="true" />
    {label.word}
  </button>
{:else}
  <button
    type="button"
    aria-label={`${yes ? "yes" : "no"} to ${subject}`}
    aria-pressed={clears}
    onclick={() => onRate(outcome.next)}
    class={[
      "m-1 flex w-[56px] shrink-0 items-center rounded-sm justify-center focus-visible:outline-offset-[-2px]",
      tone,
    ]}
  >
    <Icon icon={clears ? LuMinus : yes ? LuThumbsUp : LuThumbsDown} size={20} />
  </button>
{/if}
