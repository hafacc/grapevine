<script lang="ts">
  import type { Snippet } from "svelte";
  import Mark from "./mark.svelte";

  // The mark, a line and a muted line, in the middle of the screen: what an
  // import says while it works and when it has stopped.
  let {
    line,
    under,
    extra,
    working = false,
    children,
  }: {
    line: string;
    under?: string;
    extra?: string;
    working?: boolean;
    children?: Snippet;
  } = $props();
</script>

<div
  aria-live="polite"
  class="flex flex-grow flex-col items-center justify-center gap-5 px-8 text-center"
>
  <Mark pulsing={working} />
  <p class="text-[17px] leading-[1.55]">{line}</p>
  {#if under}
    <p class="text-[15px] text-muted">{under}</p>
  {/if}
  {#if extra}
    <p class="text-[15px] text-muted">{extra}</p>
  {/if}
  {@render children?.()}
</div>
