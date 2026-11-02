<script lang="ts">
  import TasteMapSheet from "./taste-map-sheet.svelte";
  import ActionRow from "./ui/action-row.svelte";
  import { LuChartScatter } from "./ui/icons";

  // There is no settings screen, so the map hangs here with the other rows
  // about the viewer. Mounted only while open: laying a plot out is work
  // nobody has asked for until they do.
  let open = $state(false);
</script>

<ActionRow
  label="see how your taste differs"
  word="map"
  icon={LuChartScatter}
  onAct={() => {
    open = true;
  }}
  dataRow="taste-map"
/>
{#if open}
  <TasteMapSheet
    onClose={() => {
      open = false;
    }}
  />
{/if}
