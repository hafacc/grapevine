<script lang="ts" module>
  // *plain* is an attribute; *match* is one a search matched; *yes* and *no*
  // are one the viewer has answered; *add* is a suggested attribute they can
  // apply. Nothing here is a state word — a chip carries the attribute itself and
  // its tone.
  export type ChipTone = "plain" | "match" | "yes" | "no" | "add";

  const TONES: Record<ChipTone, string> = {
    plain: "bg-surface-muted border-border text-muted",
    match: "bg-surface border-accent text-accent-ink",
    yes: "bg-accent-soft border-accent text-accent-ink",
    no: "bg-danger-soft border-danger text-danger-ink",
    add: "bg-surface border-accent border-dashed text-accent-ink",
  };

  // The tone is the whole of what a rated chip says, and a tone is not something
  // every reader can see. Said where only a reader who needs it meets it, the way
  // the bar says its own, so no word reaches the screen.
  const ANSWERED: Partial<Record<ChipTone, string>> = {
    yes: "you said yes",
    no: "you said no",
  };
</script>

<script lang="ts">
  /**
   * An attribute, as a chip.
   *
   * The text is the attribute itself — there is no display name to look up — so
   * it is letters and punctuation with spaces in it, in any script and either
   * direction. It is therefore bounded and clipped rather than assumed short, and
   * it sets no `direction`: the browser's own bidi handling is right here and an
   * override would be the bug.
   */
  let {
    label,
    tone = "plain",
    onTap,
  }: {
    label: string;
    tone?: ChipTone;
    // A chip is a button only when it does something.
    onTap?: () => void;
  } = $props();

  const answered = $derived(ANSWERED[tone]);
  const shared = $derived([
    "font-display inline-flex h-[28px] max-w-[220px] shrink-0 items-center rounded-sm border px-3 text-[15px] font-medium whitespace-nowrap",
    TONES[tone],
  ]);
</script>

<!-- The ellipsis on a span of its own: `text-overflow` applies to a block's own
     text, and a flex container's text is an anonymous item it never reaches, so
     on the chip itself the label is cut mid-letter. -->
{#snippet content()}
  <span class="min-w-0 truncate">{label}</span>
  {#if answered}
    <span class="sr-only">: {answered}</span>
  {/if}
{/snippet}

{#if onTap}
  <button type="button" onclick={onTap} class={shared}>
    {@render content()}
  </button>
{:else}
  <span class={shared}>{@render content()}</span>
{/if}
