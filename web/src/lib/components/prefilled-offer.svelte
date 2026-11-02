<script lang="ts">
  import { desktop } from "../utils/media.svelte";
  import { byName } from "../utils/people";
  import { grapevine } from "../utils/store.svelte";
  import { addToVine, removeFromVine } from "./account-actions";
  import AccountRow from "./account-row.svelte";
  import Mark from "./mark.svelte";
  import SiteFooter from "./site-footer.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Button from "./ui/button.svelte";

  /**
   * Asked once of an account that has just accepted a link: every prefilled
   * account, each a row that adds it, on a full screen drawn as the import
   * offer is, which comes next. Not before the link, because a locked account
   * cannot follow one, and following one does not unlock.
   */
  const accounts = $derived([...grapevine.prefilled].sort(byName));
  const inVine = $derived(
    new Set(grapevine.following.map((account) => account.uid)),
  );
  const added = $derived(accounts.some((account) => inVine.has(account.uid)));
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
  <div class="flex justify-end p-4">
    <ThemeButton />
  </div>
  <main
    class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
  >
    <Mark />
    <h1 class="font-heading text-[22px]">add some critics?</h1>
    <p class="text-[17px]">
      {desktop.current
        ? "their picks shape your list too."
        : "their picks shape your list too. swipe one right to add it."}
    </p>
    <div
      class="w-full overflow-hidden rounded-sm bg-surface text-left shadow-card"
    >
      {#each accounts as account (account.uid)}
        <AccountRow
          {account}
          following={inVine.has(account.uid)}
          onAdd={inVine.has(account.uid) ? undefined : () => addToVine(account)}
          onRemove={inVine.has(account.uid)
            ? () => void removeFromVine(account)
            : undefined}
        />
      {/each}
    </div>
    <Button
      variant={added ? "primary" : "secondary"}
      size="lg"
      class="w-full"
      onclick={grapevine.answerPrefilledOffer}
    >
      {added ? "done" : "not now"}
    </Button>
    <p class="text-[15px] text-muted">
      they're on the people screen whenever you want them.
    </p>
  </main>
  <SiteFooter class="px-4 pb-8" />
</div>
