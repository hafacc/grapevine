<script lang="ts" module>
  import { LuFlagOff, LuTrash2 } from "./ui/icons";

  // Remove on the left, with the danger reveal, since it deletes; dismiss on the
  // right. Neither is a verdict on the name, so both are words.
  const LABELS = {
    no: { word: "remove", icon: LuTrash2 },
    yes: { word: "dismiss", icon: LuFlagOff },
  } as const;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import {
    dismissReports,
    fetchReportedNames,
    type ReportedName,
    removeReportedName,
  } from "../utils/reports";
  import { grapevine } from "../utils/store.svelte";
  import { confirm } from "./dialog.svelte";
  import CenteredNote from "./ui/centered-note.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuChevronLeft, LuLoaderCircle } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";

  /**
   * The review queue, for an admin (0014): every reported name, most reported
   * first. Remove deletes the name for everyone; dismiss keeps it and clears its
   * reports. The page puts anybody else on the list, and the server answers them
   * nothing.
   */
  let names = $state.raw<ReportedName[] | null>(null);
  let failed = $state(false);
  let busy = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      names = await fetchReportedNames();
      failed = false;
    } catch (error) {
      console.error("reports", error);
      failed = true;
    }
  }

  onMount(() => {
    void load();
  });

  async function act(
    itemId: string,
    write: (id: string) => Promise<void>,
  ): Promise<void> {
    busy = itemId;
    try {
      await write(itemId);
      names = names?.filter((entry) => entry.itemId !== itemId) ?? null;
    } catch (error) {
      console.error("review", error);
      failed = true;
    }
    busy = null;
  }

  async function remove(itemId: string): Promise<void> {
    if (busy !== null) return;
    const sure = await confirm({
      title: `remove "${itemId}"?`,
      body: "every rating that names it is deleted, and nobody can add it again. this can't be undone.",
      confirmLabel: "remove",
      tone: "danger",
    });
    if (sure) await act(itemId, removeReportedName);
  }

  function dismiss(itemId: string): void {
    if (busy !== null) return;
    void act(itemId, dismissReports);
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <header
    class="flex h-[56px] shrink-0 items-center gap-1 border-b border-border bg-surface pr-2.5 pl-1"
  >
    <button
      type="button"
      aria-label="back"
      onclick={grapevine.back}
      class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm bg-surface text-text focus-visible:outline-offset-[-2px]"
    >
      <Icon icon={LuChevronLeft} size={20} aria-hidden="true" />
    </button>
    <h1
      class="font-display min-w-0 flex-grow truncate text-[22px] font-semibold text-text"
    >
      names people reported
    </h1>
  </header>
  <div class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
    <p
      aria-live="polite"
      class={failed ? "bg-surface px-4 py-3 text-[16px] text-danger" : "sr-only"}
    >
      {failed ? "that didn't work. check your connection and try again." : ""}
    </p>
    {#if names === null && !failed}
      <p class="bg-surface px-4 py-3 text-[16px] text-muted">loading…</p>
    {/if}
    {#if names !== null && names.length === 0}
      <CenteredNote>nothing is reported.</CenteredNote>
    {/if}
    {#each names ?? [] as entry (entry.itemId)}
      <RateRow
        subject={entry.itemId}
        value={null}
        labels={LABELS}
        onRate={(next) =>
          next === -1 ? void remove(entry.itemId) : dismiss(entry.itemId)}
        frameClass="bg-surface"
      >
        <div
          data-report={entry.itemId}
          class="flex min-h-[64px] items-center gap-2 px-4 py-2.5"
        >
          <div class="min-w-0 flex-grow">
            <!-- A name is up to 128 characters with no promise of a space in it. -->
            <p class="text-[17px] font-medium [overflow-wrap:anywhere]">
              {entry.itemId}
            </p>
            <p class="text-[15px] text-muted">
              {entry.reports === 1 ? "1 report" : `${entry.reports} reports`}
            </p>
          </div>
          {#if busy === entry.itemId}
            <Icon
              icon={LuLoaderCircle}
              size={20}
              aria-hidden="true"
              class="shrink-0 animate-spin text-muted"
            />
          {/if}
        </div>
      </RateRow>
    {/each}
  </div>
</div>
