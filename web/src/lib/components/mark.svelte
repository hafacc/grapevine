<script lang="ts">
  import Bunch from "./bunch.svelte";

  // The mark standing on its own — what the splash draws while the session
  // restores, and what sits over an empty feed. One source, so it cannot drift
  // from the wordmark.
  let {
    // Only the splash pulses: the same beat over a feed that has finished loading
    // says something is still on its way.
    pulsing = false,
  }: { pulsing?: boolean } = $props();
</script>

<Bunch class={`h-12 w-12 ${pulsing ? "animate-pulse" : ""}`} />
