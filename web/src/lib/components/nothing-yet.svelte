<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import Button from "./ui/button.svelte";
  import CenteredNote from "./ui/centered-note.svelte";

  // Everyone but an admin arrives with somebody in their vine, so this is for an
  // admin with no vine yet, or a vine that has rated nothing yet.
</script>

<CenteredNote>
  nothing here yet. search to add something, or add people to your vine.
  {#snippet action()}
    <Button
      onclick={() => grapevine.navigate({ kind: "people" })}
      class="h-[44px] w-full text-[17px]"
    >
      add to your vine
    </Button>
  {/snippet}
</CenteredNote>
