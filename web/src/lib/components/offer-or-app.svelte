<script lang="ts">
  import type { Snippet } from "svelte";
  import { lookupSettings } from "../utils/lookup";
  import { useMyRatings } from "../utils/ratings.svelte";
  import { grapevine } from "../utils/store.svelte";
  import ImportOffer from "./import-offer.svelte";
  import Mark from "./mark.svelte";
  import PrefilledOffer from "./prefilled-offer.svelte";

  // The prefilled accounts come first: an import goes to a screen of its own
  // and can run for hours, and an offer still waiting would stand in front of
  // it. Each waits for what it reads, since a list drawn first would be a
  // screen that then changes by itself.
  let { children }: { children: Snippet } = $props();

  // Nothing to offer, or nothing known about what there is.
  const noPrefilled = $derived(
    grapevine.prefilledOffer &&
      (grapevine.prefilledRead === "failed" ||
        (grapevine.prefilledRead === "read" &&
          grapevine.prefilled.length === 0)),
  );
  $effect(() => {
    if (noPrefilled) grapevine.answerPrefilledOffer();
  });
  const offeringPrefilled = $derived(grapevine.prefilledOffer && !noPrefilled);

  // The import offer is for an account with no ratings of its own.
  const mine = useMyRatings();
  const rated = $derived(Object.keys(mine.ratings).length > 0);
  // Importing cannot match with lookups off, so it is not offered then.
  const unwanted = $derived(
    grapevine.importOffer && (mine.failed || !lookupSettings().lookUp),
  );
  const answered = $derived(grapevine.importOffer && mine.ready && rated);
  $effect(() => {
    if (unwanted || answered) grapevine.answerImportOffer();
  });
  const offeringImport = $derived(
    grapevine.importOffer && !unwanted && !answered,
  );
</script>

{#if offeringPrefilled}
  {#if grapevine.prefilledRead === "waiting"}
    <div class="flex min-h-dvh items-center justify-center">
      <Mark pulsing />
    </div>
  {:else}
    <PrefilledOffer />
  {/if}
{:else if !offeringImport}
  {@render children()}
{:else if !mine.ready}
  <div class="flex min-h-dvh items-center justify-center">
    <Mark pulsing />
  </div>
{:else}
  <ImportOffer />
{/if}
