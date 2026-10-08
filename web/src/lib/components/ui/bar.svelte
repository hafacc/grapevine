<script lang="ts">
  import { fillFor, fillTone, segmentFills } from "../../utils/bar";

  // One stable key per segment, since the four are positions rather than data.
  const SEGMENT_KEYS: readonly string[] = [
    "first",
    "second",
    "third",
    "fourth",
  ];

  const NOTHING: readonly number[] = SEGMENT_KEYS.map(() => 0);

  /**
   * What the viewer's own feed makes of a thing or one of its attributes.
   *
   * `score` is what to draw on `−1..1`: an item's `cautiousScore`, an
   * attribute's own score. Null is nothing known yet, drawn as an empty track.
   *
   * No word beside it and no number ever (DESIGN §4). `role="img"` with a
   * sentence for a label, because four unlabelled boxes are nothing to a reader
   * who cannot see them.
   */
  let {
    subject,
    score,
  }: {
    // What the score is about, so a label read out of context names the thing.
    subject: string;
    score: number | null;
  } = $props();

  const fill = $derived(fillFor(score));
  const fills = $derived(fill === null ? NOTHING : segmentFills(fill));
  const lit = $derived(
    fill !== null && fillTone(fill) === "accent" ? "accent" : "danger",
  );
</script>

<span
  role="img"
  aria-label={fill === null
    ? "nothing known yet"
    : `how ${subject} scores for you`}
  class="flex shrink-0 gap-1"
>
  {#each SEGMENT_KEYS as name, index (name)}
    <span
      class="relative block h-[9px] w-[15px] overflow-hidden rounded-xs border border-track-edge bg-track"
    >
      <span
        class={["absolute inset-0", lit === "accent" ? "bg-accent" : "bg-danger"]}
        style:width={`${(fills[index] ?? 0) * 100}%`}
      ></span>
    </span>
  {/each}
</span>
