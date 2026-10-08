<script lang="ts">
  import { type Attribution, sourceOf } from "grapevine-shared/references";
  import type { MatchRow } from "../utils/references";
  import { confirm } from "./dialog.svelte";
  import AddButton from "./ui/add-button.svelte";
  import Sheet from "./ui/sheet.svelte";

  /**
   * What the indices offered for a name about to be added, as one list in the
   * order `pickShown` chose, and last the name as typed. A name already here
   * without a link is asked about first.
   */
  let {
    typed,
    rows,
    onChoose,
    onTyped,
    onClose,
  }: {
    typed: string;
    rows: readonly MatchRow[];
    onChoose: (row: MatchRow) => void;
    onTyped: () => void;
    onClose: () => void;
  } = $props();

  // The sheet steps aside for the question, so the two are never stacked.
  let asking = $state(false);

  async function choose(row: MatchRow): Promise<void> {
    if (row.kind !== "plain") {
      onChoose(row);
      return;
    }
    asking = true;
    const sure = await confirm({
      title: `is “${row.itemId}” this?`,
      body: row.candidate.description || undefined,
      confirmLabel: "yes",
      cancelLabel: "no",
    });
    asking = false;
    if (sure) onChoose(row);
  }

  // What a source's data owes while it is offered. Only here: a stored result
  // shown later is an insubstantial extract and owes none (OSMF's geocoding
  // guideline).
  const credits = $derived(
    [
      ...new Set(
        rows.map((row) => sourceOf(row.candidate.source)?.attribution ?? null),
      ),
    ].filter((credit): credit is Attribution => credit !== null),
  );
</script>

<Sheet open={!asking} {onClose} title="is it one of these?">
  <ul class="-mx-5">
    {#each rows as row (`${row.candidate.source}:${row.candidate.ref}`)}
      <li>
        <button
          type="button"
          data-match={row.kind}
          onclick={() => void choose(row)}
          class="flex w-full flex-col gap-0.5 px-5 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
        >
          <span class="text-[17px] font-medium [overflow-wrap:anywhere]">
            {row.itemId}
          </span>
          {#if row.candidate.description}
            <span class="text-[15px] text-muted [overflow-wrap:anywhere]">
              {row.candidate.description}
            </span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
  {#each credits as credit (credit.text)}
    <p class="text-[15px] text-faint pt-2">
      <a
        href={credit.href}
        target="_blank"
        rel="noopener noreferrer"
        class="underline-offset-2 hover:underline"
      >
        {credit.text}
      </a>
    </p>
  {/each}
  <div class="pt-3">
    <AddButton label={`none of these — add “${typed}”`} onTap={onTyped} />
  </div>
</Sheet>
