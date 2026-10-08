<script lang="ts">
  import { desktop } from "../../utils/media.svelte";
  import type { IconData } from "./icons";
  import SwipeRow from "./swipe-row.svelte";

  /**
   * A row that is one action and nothing else: tapped or clicked anywhere, or
   * swiped right at phone width, with the action's word behind the swipe as on
   * the link row. At desktop width there is no side button: the whole row is
   * the button, so a second target for the same thing would be two.
   */
  let {
    label,
    word,
    icon,
    onAct,
    dataRow,
  }: {
    label: string;
    word: string;
    icon: IconData;
    onAct: () => void;
    dataRow: string;
  } = $props();
</script>

{#snippet row()}
  <button
    type="button"
    data-row={dataRow}
    onclick={onAct}
    class="flex min-h-[56px] w-full items-center bg-surface px-4 py-2.5 text-left text-[16px] text-text hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
  >
    {label}
  </button>
{/snippet}

{#if desktop.current}
  {@render row()}
{:else}
  <SwipeRow
    value={null}
    onRate={onAct}
    sides="yes"
    labels={{ yes: { word, icon } }}
  >
    {@render row()}
  </SwipeRow>
{/if}
