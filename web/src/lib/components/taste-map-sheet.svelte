<script lang="ts">
  import { useCell } from "../utils/cell.svelte";
  import { useMyRatings } from "../utils/ratings.svelte";
  import { placePoints, refreshMyRecs } from "../utils/recs";
  import { useMyRecs } from "../utils/recs.svelte";
  import { grapevine } from "../utils/store.svelte";
  import {
    choose,
    type Dot,
    flat,
    LIKING,
    nearest,
    placeAt,
    placeFlat,
    pointsOf,
    ratedThings,
    shade,
    step,
  } from "../utils/taste-map";
  import {
    currentRank,
    LEAST_RANK,
    MOST_RANK,
    rankCell,
    setRank,
  } from "../utils/taste-rank";
  import LoadFailure from "./load-failure.svelte";
  import Chip from "./ui/chip.svelte";
  import Icon from "./ui/icon.svelte";
  import {
    LuChevronDown,
    LuChevronUp,
    LuLoaderCircle,
    LuThumbsUp,
  } from "./ui/icons";
  import Sheet from "./ui/sheet.svelte";

  // The viewer's map (`taste-map.ts`): every thing a dot that never moves, and
  // a row of chips that recolors them. For the chip picked, a dot is grey where
  // the viewer makes of the thing what their vine does, and turns teal or red
  // the further it lies to either side. No line and no axes are drawn: where
  // the dots sit is a look at them, and a ruler would claim more.
  let { onClose }: { onClose: () => void } = $props();

  const recs = useMyRecs();
  const mine = useMyRatings();

  const rated = $derived(ratedThings(mine.ratings));
  const used = $derived(
    new Set(
      Object.values(mine.ratings).flatMap((said) =>
        Object.keys(said).filter((attribute) => attribute !== LIKING),
      ),
    ),
  );
  const chosen = $derived(choose(recs.plot, rated, used));

  // Where the dots sit: at once for a plot whose points are places, and from
  // the core's layout for one whose points have a third number. Null is "not
  // laid out yet"; the layout is asked for again only when the things change.
  let dots = $state<readonly Dot[] | null>(null);
  let unplaced = $state(false);
  $effect(() => {
    const now = chosen;
    unplaced = false;
    if (flat(now)) {
      dots = placeFlat(now);
      return;
    }
    dots = null;
    let stale = false;
    placePoints(pointsOf(now)).then(
      (places) => {
        if (!stale) dots = placeAt(now, places);
      },
      (failure: unknown) => {
        console.error("taste map: layout failed", failure);
        if (!stale) unplaced = true;
      },
    );
    return () => {
      stale = true;
    };
  });

  let asked = $state(LIKING);
  // The chip asked for, while the list still has it.
  const chip = $derived(
    chosen.chips.includes(asked) ? asked : (chosen.chips[0] ?? LIKING),
  );
  const facing = $derived(
    Object.hasOwn(chosen.facing, chip) ? chosen.facing[chip] : undefined,
  );
  let picked = $state<string | null>(null);
  const pick = $derived(dots?.find((dot) => dot.thing.id === picked) ?? null);

  // How many numbers each thing has (`taste-rank.ts`). More of them lets the
  // map tell more kinds of thing apart, and changes the list with it, so a
  // change asks for the list again; the dots follow when it arrives.
  const rank = useCell(rankCell);
  $effect(() => {
    currentRank();
  });
  let turning = $state(false);
  // The list could not be computed again at the rank asked for, and the rank
  // is back where the list on screen is.
  let unturned = $state(false);

  function turn(by: number): void {
    if (turning) return;
    const before = rank.current;
    if (!setRank(before + by)) return;
    picked = null;
    turning = true;
    unturned = false;
    void refreshMyRecs()
      .catch((failure: unknown) => {
        console.error("taste map: recomputing failed", failure);
        setRank(before);
        unturned = true;
      })
      .finally(() => {
        turning = false;
      });
  }

  // The square the dots are laid out on, with room for the ones at its edge.
  const EDGE = 1.1;

  function fill(across: number): string {
    const tone = across > 0 ? "var(--color-accent)" : "var(--color-danger)";
    const share = Math.round(Math.abs(across) * 100);
    return `color-mix(in srgb, ${tone} ${share}%, var(--color-faint))`;
  }

  function tap(event: MouseEvent & { currentTarget: HTMLElement }): void {
    // Enter or space, which has no place on the map: it opens the dot the
    // arrows walked to.
    if (event.detail === 0) {
      if (pick) open(pick.thing.id);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 2 * EDGE - EDGE;
    const y = EDGE - ((event.clientY - box.top) / box.height) * 2 * EDGE;
    // A fingertip, not a pixel: the dot nearest the tap, within reach of it.
    picked = nearest(dots ?? [], x, y, 0.14)?.thing.id ?? null;
  }

  const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };

  // The map by keyboard: each arrow moves to the nearest dot that way.
  function walk(event: KeyboardEvent): void {
    const way = Object.hasOwn(ARROWS, event.key) ? ARROWS[event.key] : null;
    if (!way) return;
    event.preventDefault();
    const next = step(dots ?? [], pick ?? { x: 0, y: 0 }, way);
    if (next) picked = next.thing.id;
  }

  function open(id: string): void {
    onClose();
    grapevine.navigate({ kind: "item", id });
  }
</script>

<Sheet open {onClose} title="how your taste differs">
  {#if mine.failed || recs.failed}
    <!-- An empty map after a failed read is not "nothing to show yet". -->
    <div class="flex flex-col gap-2">
      {#if mine.failed}
        <LoadFailure subject="your ratings" />
      {/if}
      {#if recs.failed}
        <LoadFailure subject="your recommendations" />
      {/if}
    </div>
  {:else if unplaced}
    <LoadFailure subject="your map" />
  {:else if (chosen.things.length === 0 || !facing) && !recs.ready}
    <!-- No computation has finished yet: an empty map is not an answer. -->
    <div class="flex min-h-[120px] items-center justify-center text-muted">
      <Icon
        icon={LuLoaderCircle}
        size={24}
        aria-hidden="true"
        class="animate-spin"
      />
    </div>
  {:else if chosen.things.length === 0 || !facing}
    <p class="text-[16px] text-muted">
      nothing to show yet. rate a few things your vine has rated.
    </p>
  {:else}
    <p class="mb-3 text-[15px] text-muted">
      each dot is a thing. teal is more than your vine makes of it, red is less.
      tap one to see it.
    </p>
    <div class="relative rounded-sm bg-bg shadow-card">
      <button
        type="button"
        data-taste-map
        aria-label="your map. tap a dot to see the thing, or use the arrow keys"
        onclick={tap}
        onkeydown={walk}
        class="relative block w-full rounded-sm"
      >
        {#if dots === null || turning}
          <span
            class="absolute inset-0 flex items-center justify-center text-muted"
          >
            <Icon
              icon={LuLoaderCircle}
              size={24}
              aria-hidden="true"
              class="animate-spin"
            />
          </span>
        {/if}
        <svg
          viewBox={`${-EDGE} ${-EDGE} ${2 * EDGE} ${2 * EDGE}`}
          aria-hidden="true"
          class={["block h-auto w-full", turning ? "opacity-40" : ""]}
        >
          {#each dots ?? [] as dot (dot.thing.id)}
            <circle
              cx={dot.x}
              cy={-dot.y}
              r={dot.thing.own ? 0.019 : 0.013}
              style:fill={fill(shade(dot.thing, facing))}
            />
          {/each}
          {#if pick}
            <circle
              cx={pick.x}
              cy={-pick.y}
              r="0.045"
              fill="none"
              stroke="var(--color-text)"
              stroke-width="0.01"
            />
          {/if}
        </svg>
      </button>
      <!-- The rank, and the two buttons that move it. -->
      <div
        data-taste-rank={rank.current}
        class="absolute top-1 right-1 flex flex-col items-center text-muted"
      >
        <button
          type="button"
          aria-label="more detail"
          disabled={rank.current >= MOST_RANK || turning}
          onclick={() => turn(1)}
          class="flex h-[44px] w-[44px] items-center justify-center rounded-sm disabled:opacity-30"
        >
          <Icon icon={LuChevronUp} size={20} aria-hidden="true" />
        </button>
        <span class="text-[15px] font-medium tabular-nums" aria-live="polite">
          <span class="sr-only">detail</span>
          {rank.current}
        </span>
        <button
          type="button"
          aria-label="less detail"
          disabled={rank.current <= LEAST_RANK || turning}
          onclick={() => turn(-1)}
          class="flex h-[44px] w-[44px] items-center justify-center rounded-sm disabled:opacity-30"
        >
          <Icon icon={LuChevronDown} size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
    {#if unturned}
      <div class="mt-3">
        <LoadFailure subject="your recommendations" />
      </div>
    {/if}
    <div class="mt-3 flex gap-2 overflow-x-auto pb-0.5">
      {#each chosen.chips as name (name)}
        {#if name === LIKING}
          <button
            type="button"
            aria-label="liked"
            aria-pressed={chip === name}
            onclick={() => {
              asked = name;
            }}
            class={[
              "inline-flex h-[28px] shrink-0 items-center rounded-sm border px-3",
              chip === name
                ? "border-accent bg-surface text-accent-ink"
                : "border-border bg-surface-muted text-muted",
            ]}
          >
            <Icon icon={LuThumbsUp} size={16} aria-hidden="true" />
          </button>
        {:else}
          <Chip
            label={name}
            tone={chip === name ? "match" : "plain"}
            onTap={() => {
              asked = name;
            }}
          />
        {/if}
      {/each}
    </div>
    <div
      aria-live="polite"
      class="mt-3 flex min-h-[44px] items-center justify-between gap-3"
    >
      {#if pick}
        <span class="min-w-0 text-[16px] font-medium [overflow-wrap:anywhere]">
          {pick.thing.id}
        </span>
        <button
          type="button"
          onclick={() => open(pick.thing.id)}
          class="min-h-[44px] shrink-0 rounded-sm px-2 text-[16px] font-medium text-accent-ink"
        >
          open
        </button>
      {/if}
    </div>
  {/if}
</Sheet>
