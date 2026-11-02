<script lang="ts">
  import { saveRatingsFile } from "../utils/export";
  import { run } from "./dialog.svelte";
  import ActionRow from "./ui/action-row.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuCheck, LuFileDown } from "./ui/icons";

  // One tap downloads the viewer's own ratings, with no screen of its own;
  // the row then says so, as the copy button does.
  let saved = $state(false);
  let busy = $state(false);

  function save(): void {
    if (busy) return;
    busy = true;
    run(async () => {
      try {
        await saveRatingsFile();
        saved = true;
      } finally {
        busy = false;
      }
    }, "couldn't save your ratings. check your connection and try again.");
  }
</script>

{#if saved}
  <p
    data-row="export"
    aria-live="polite"
    class="flex min-h-[56px] w-full items-center gap-2 bg-surface px-4 py-2.5 text-[16px]"
  >
    <span class="min-w-0 flex-grow">saved to your downloads</span>
    <Icon
      icon={LuCheck}
      size={20}
      aria-hidden="true"
      class="shrink-0 text-accent-ink"
    />
  </p>
{:else}
  <ActionRow
    label="save your ratings to a file"
    word="save"
    icon={LuFileDown}
    onAct={save}
    dataRow="export"
  />
{/if}
