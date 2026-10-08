<script lang="ts" module>
  import type { IconData } from "./icons";

  // A word and its icon, for a side that is not a rating: a thumb there would
  // read as a verdict.
  export type SwipeLabel = { readonly word: string; readonly icon: IconData };
  export type SwipeLabels = {
    readonly no?: SwipeLabel;
    readonly yes?: SwipeLabel;
  };

  // How far the row travels, and — at half of it — how far it has to go before
  // letting go rates. A title bar or an attribute row is shallower, so the caller
  // may say 96.
  const TRAVEL = 104;

  // Enough movement to be a swipe rather than a tap or the start of a scroll.
  const ENGAGE = 8;

  const REVEALS = {
    yes: "bg-accent",
    no: "bg-danger",
    clear: "bg-clear",
  } as const;
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    glyphSide,
    type SwipeDirection,
    swipeOutcome,
  } from "../../utils/swipe";
  import type { RatingValue } from "../../utils/types";
  import Icon from "./icon.svelte";
  import { LuMinus, LuThumbsDown, LuThumbsUp } from "./icons";

  const GLYPHS = {
    up: LuThumbsUp,
    down: LuThumbsDown,
    minus: LuMinus,
  } as const satisfies Record<string, IconData>;

  /**
   * A row that is rated by being swiped, which on a phone is the only way to rate
   * anything.
   *
   * The row moves horizontally and does nothing else: no rotation and no vertical
   * travel. This is a choice between two sides, not a card being thrown away, and
   * the borrowed card-deck motion would say the opposite.
   *
   * A drag is claimed only once it is more horizontal than vertical, so a swipe
   * that begins as a scroll stays a scroll and the list underneath keeps working.
   */
  let {
    value,
    onRate,
    travel = TRAVEL,
    sides = "both",
    labels,
    class: className = "",
    children,
  }: {
    value: RatingValue | null;
    onRate: (next: RatingValue | null) => void;
    travel?: number;
    // "no" moves only leftwards, for a row with nothing to say yes to; "yes"
    // only rightwards, for a switch that is off and has nothing to say no to.
    sides?: "both" | "no" | "yes";
    // Words in place of the thumbs, for a row where a side is not a rating: the
    // reveal says what letting go will do.
    labels?: SwipeLabels;
    // The row's own look, fill included. It goes on a layer inside the moving
    // card rather than on the card, whose `surface` is what stops the reveal
    // showing through: two background utilities on one element leave which of
    // them wins to the order of the stylesheet.
    class?: string;
    children: Snippet;
  } = $props();

  let offset = $state(0);
  // What letting go reads: the drawn `offset` can be a frame behind a quick
  // drag back, and acting on it would fire a swipe that was taken back.
  let latest = 0;
  let dragging = $state(false);
  let start: { x: number; y: number; engaged: boolean } | null = null;
  // A swipe that ends over a button inside the row must not also press it.
  let swiped = false;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swiped = false;
    start = { x: event.clientX, y: event.clientY, engaged: false };
  }

  function onPointerMove(
    event: PointerEvent & { currentTarget: HTMLDivElement },
  ): void {
    const from = start;
    if (!from) return;
    const across = event.clientX - from.x;
    const down = event.clientY - from.y;
    if (!from.engaged) {
      // A gesture that reads as vertical is the scroller's, and giving it back
      // means letting go of it for good rather than watching for a later turn.
      if (Math.abs(down) > Math.abs(across)) {
        start = null;
        return;
      }
      if (Math.abs(across) < ENGAGE) return;
      from.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging = true;
    }
    latest = Math.max(
      sides === "yes" ? 0 : -travel,
      Math.min(sides === "no" ? 0 : travel, across),
    );
    offset = latest;
  }

  function onPointerEnd(): void {
    const engaged = start?.engaged ?? false;
    start = null;
    swiped = engaged;
    dragging = false;
    const released = latest;
    latest = 0;
    if (engaged && Math.abs(released) >= travel / 2) {
      const direction: SwipeDirection = released > 0 ? "right" : "left";
      onRate(swipeOutcome(value, direction).next);
    }
    offset = 0;
  }

  function onClickCapture(event: MouseEvent): void {
    if (!swiped) return;
    swiped = false;
    event.stopPropagation();
    event.preventDefault();
  }

  const direction: SwipeDirection = $derived(offset >= 0 ? "right" : "left");
  const outcome = $derived(swipeOutcome(value, direction));
  const label = $derived(direction === "right" ? labels?.yes : labels?.no);
</script>

<div class={["relative", REVEALS[outcome.reveal]]}>
  <div
    aria-hidden="true"
    class={[
      "absolute inset-0 flex items-center text-white",
      label ? "px-4" : "px-[30px]",
      glyphSide(direction) === "left" ? "justify-start" : "justify-end",
    ]}
  >
    {#if label}
      <!-- Stacked: side by side, the pair is wider than the travel reveals. -->
      <span
        class="font-display flex flex-col items-center gap-1 text-[17px] leading-none font-semibold"
      >
        <Icon icon={label.icon} size={20} />
        {label.word}
      </span>
    {:else}
      <Icon icon={GLYPHS[outcome.glyph]} size={26} />
    {/if}
  </div>
  <!-- Vertical panning stays the scroller's; horizontal is claimed above. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    onclickcapture={onClickCapture}
    style:transform={`translateX(${offset}px)`}
    style:touch-action="pan-y"
    style:box-shadow={offset === 0 ? undefined : "var(--shadow-lift)"}
    class={[
      "relative bg-surface",
      dragging ? "" : "transition-transform duration-150",
    ]}
  >
    <div class={className}>{@render children()}</div>
  </div>
</div>
