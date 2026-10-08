<script lang="ts">
  import type { Snippet } from "svelte";
  import Mark from "../mark.svelte";

  /**
   * What a screen says when its list has nothing in it: the mark over one line,
   * in the middle of the space the rows would fill. One look for every empty
   * list, so an empty search and an empty feed read as the same kind of fact.
   */
  let { children, action }: { children: Snippet; action?: Snippet } = $props();
</script>

<div
  class="flex flex-grow flex-col items-center justify-center gap-5 px-8 text-center"
>
  <Mark />
  <p class="text-[17px] leading-[1.55] [overflow-wrap:anywhere]">
    {@render children()}
  </p>
  {@render action?.()}
</div>
