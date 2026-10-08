<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import ActionRow from "./ui/action-row.svelte";
  import { LuFlag } from "./ui/icons";

  // The people screen's way in to the reported names, shown only to an admin.
</script>

{#if grapevine.profile?.admin}
  <ActionRow
    label="names people reported"
    word="reports"
    icon={LuFlag}
    onAct={() => grapevine.navigate({ kind: "reports" })}
    dataRow="reports"
  />
{/if}
