<script lang="ts">
  import { onMount } from "svelte";
  import { lookupSettings } from "../utils/lookup";
  import { grapevine } from "../utils/store.svelte";
  import Button from "./ui/button.svelte";
  import CenteredNote from "./ui/centered-note.svelte";

  // Everyone but an admin arrives with somebody in their vine, so this is for an
  // admin with no vine yet, or a vine that has rated nothing yet.

  // Read after mount: storage is not there while a page is prerendered.
  let canImport = $state(false);
  onMount(() => {
    canImport = lookupSettings().lookUp;
  });
</script>

<CenteredNote>
  nothing here yet. search to add something, or add people to your vine.
  {#snippet action()}
    <div class="flex w-full flex-col gap-2.5">
      <Button
        onclick={() => grapevine.navigate({ kind: "people" })}
        class="h-[44px] w-full text-[17px]"
      >
        add to your vine
      </Button>
      {#if canImport}
        <Button
          variant="secondary"
          onclick={() => grapevine.navigate({ kind: "import" })}
          class="h-[44px] w-full text-[17px]"
        >
          import ratings
        </Button>
      {/if}
    </div>
  {/snippet}
</CenteredNote>
