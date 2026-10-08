<script lang="ts">
  import Bunch from "./bunch.svelte";

  // The wordmark: the mark beside "grapevine" in the condensed face. One source
  // of truth for the lockup — the header, the sign-in screen and the written
  // pages all render this.
  let { size = "md" }: { size?: "md" | "lg" } = $props();

  const bunch = $derived(size === "lg" ? "h-9 w-9" : "h-[22px] w-[22px]");
  const word = $derived(size === "lg" ? "text-2xl" : "text-[22px]");
</script>

<span class="inline-flex items-center gap-2">
  <Bunch class={bunch} />
  <span class={["font-display font-semibold tracking-[0.01em]", word]}>
    grapevine
  </span>
</span>
