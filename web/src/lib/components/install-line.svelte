<script lang="ts">
  import { install } from "../utils/install.svelte";
  import ActionRow from "./ui/action-row.svelte";
  import { LuDownload } from "./ui/icons";

  // Offered, never raised: Chrome's own banner is held in `install.svelte.ts` so
  // that installing is something a person goes and does, from here. Silent on a
  // browser that will neither prompt nor install by hand, and silent once it is
  // installed.
</script>

{#if install.ready}
  <ActionRow
    label="keep grapevine on your home screen"
    word="install"
    icon={LuDownload}
    onAct={() => void install.prompt()}
    dataRow="install"
  />
{:else if install.byHand}
  <p class="bg-surface px-4 py-3 text-[16px] text-muted">
    to keep grapevine on your home screen: share, then add to home screen
  </p>
{/if}
