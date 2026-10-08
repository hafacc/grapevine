<script lang="ts">
  import { usingLocalStack } from "../utils/project";

  // Says which backend this build is talking to, because the difference is
  // otherwise invisible and its symptoms look like bugs: a local stack starts
  // empty, so a real account's friends, requests and recommendations are all
  // simply absent. Folded out of production entirely by the `DEV` half of
  // `usingLocalStack`.
</script>

{#if usingLocalStack()}
  <div
    class="pointer-events-none fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded-sm bg-danger px-3 py-1 text-xs font-semibold text-white shadow-card"
  >
    Local stack — nothing here is your real account
  </div>
{/if}
