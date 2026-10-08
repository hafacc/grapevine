<script lang="ts">
  import { onMount } from "svelte";
  import {
    type LookupSettings,
    lookupSettings,
    saveLookupSetting,
  } from "../utils/lookup";
  import type { IconData } from "./ui/icons";
  import { LuMapPin, LuMapPinOff, LuSearch, LuSearchX } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";

  // Per device: what this browser sends when a thing is added (`/privacy/`).
  // Read after mount: storage is not there while a page is prerendered.
  let settings = $state.raw<LookupSettings>({
    lookUp: true,
    useLocation: true,
  });
  onMount(() => {
    settings = lookupSettings();
  });

  function change(which: keyof LookupSettings, on: boolean): void {
    saveLookupSetting(which, on);
    settings = { ...settings, [which]: on };
  }
</script>

<!-- A switch drawn as the link row is: what is so, on one line, and a swipe (at
     desktop width a worded button) that changes it. No swipe hint of its own:
     the link row's, just above, teaches the gesture. -->
{#snippet settingRow(
  which: keyof LookupSettings,
  subject: string,
  saidOn: string,
  saidOff: string,
  iconOn: IconData,
  iconOff: IconData,
)}
  {@const on = settings[which]}
  <div>
    <RateRow
      {subject}
      value={null}
      sides={on ? "no" : "yes"}
      labels={on
        ? { no: { word: "turn off", icon: iconOff } }
        : { yes: { word: "turn on", icon: iconOn } }}
      onRate={() => change(which, !on)}
      frameClass="bg-surface"
    >
      <p
        data-setting={subject}
        class={[
          "flex min-h-[56px] items-center px-4 py-2.5 text-[16px]",
          on ? "" : "text-muted",
        ]}
      >
        {on ? saidOn : saidOff}
      </p>
    </RateRow>
  </div>
{/snippet}

<div>
  {@render settingRow(
    "lookUp",
    "lookups",
    "lookups are on",
    "lookups are off",
    LuSearch,
    LuSearchX,
  )}
  <!-- Gone while lookups are off: it would change nothing. -->
  {#if settings.lookUp}
    {@render settingRow(
      "useLocation",
      "your location",
      "lookups use your location",
      "lookups don't use your location",
      LuMapPin,
      LuMapPinOff,
    )}
  {/if}
</div>
