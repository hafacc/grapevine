<script lang="ts">
  import { byName, findAccounts } from "../utils/people";
  import { grapevine } from "../utils/store.svelte";
  import type { Account } from "../utils/types";
  import { addToVine, removeFollower, removeFromVine } from "./account-actions";
  import AccountRow from "./account-row.svelte";
  import DeleteAccountLine from "./delete-account.svelte";
  import ExportLine from "./export-line.svelte";
  import InstallLine from "./install-line.svelte";
  import LinkRow from "./link-row.svelte";
  import LookupSettingsLines from "./lookup-settings.svelte";
  import MeLine from "./me-line.svelte";
  import ReportsLine from "./reports-line.svelte";
  import TasteMapLine from "./taste-map-line.svelte";
  import ActionRow from "./ui/action-row.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuChevronLeft, LuFileUp, LuX } from "./ui/icons";
  import SearchField from "./ui/search-field.svelte";

  let query = $state("");

  const searching = $derived(query.trim().length > 0);
  // Every prefilled account, to browse as well as to search for.
  const critics = $derived([...grapevine.prefilled].sort(byName));
  const inVine = $derived(
    new Set(grapevine.following.map((account) => account.uid)),
  );
  const followsYou = $derived(
    new Set(grapevine.followers.map((account) => account.uid)),
  );
  // Everybody the viewer may see at all, and nobody else: the search asks the
  // server nothing, so it can never become a lookup of a person.
  const found = $derived(
    searching
      ? findAccounts(query, [
          ...grapevine.following,
          ...grapevine.followers,
          ...grapevine.prefilled,
        ])
      : [],
  );

  // What a found row's left side does: an account in the vine leaves it, as
  // under *your vine*; otherwise somebody following stops, as under *following
  // you*.
  function removing(account: Account): (() => void) | undefined {
    if (inVine.has(account.uid)) return () => void removeFromVine(account);
    else if (followsYou.has(account.uid))
      return () => void removeFollower(account);
    else return undefined;
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
      you and your vine
    </h1>
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <!-- Not filled: the section headings sit on the canvas (DESIGN-UI),
         and the rows bring their own surface. -->
    <div>
      {#if searching}
        {#each found as { account, matchedTags } (account.uid)}
          <AccountRow
            {account}
            {matchedTags}
            following={inVine.has(account.uid)}
            onAdd={inVine.has(account.uid)
              ? undefined
              : () => addToVine(account)}
            onRemove={removing(account)}
            removeIcon={inVine.has(account.uid) ? undefined : LuX}
          />
        {:else}
          <p class="px-4 py-4 text-[16px] text-muted">
            nobody here by that name. to add someone, ask for their link.
          </p>
        {/each}
      {:else}
        <MeLine />
        <LinkRow />
        <LookupSettingsLines>
          <!-- Gone while lookups are off, as the location row is: an import
               matches through them. -->
          <ActionRow
            label="import ratings from another app"
            word="import"
            icon={LuFileUp}
            onAct={() => grapevine.navigate({ kind: "import" })}
            dataRow="import"
          />
          <ExportLine />
        </LookupSettingsLines>
        <TasteMapLine />
        <ReportsLine />
        <InstallLine />

        {#if grapevine.following.length > 0}
          <h2 class="label px-4 pt-4 pb-2 text-[15px] text-muted">your vine</h2>
          {#each grapevine.following as account (account.uid)}
            <AccountRow
              {account}
              onRemove={() => void removeFromVine(account)}
            />
          {/each}
        {/if}

        {#if grapevine.followers.length > 0}
          <h2 class="label px-4 pt-4 pb-2 text-[15px] text-muted">
            following you
          </h2>
          {#each grapevine.followers as account (account.uid)}
            <!-- Somebody already in the viewer's vine has nothing to add. -->
            <AccountRow
              {account}
              following={inVine.has(account.uid)}
              onAdd={inVine.has(account.uid)
                ? undefined
                : () => addToVine(account)}
              onRemove={() => void removeFollower(account)}
              removeIcon={LuX}
            />
          {/each}
        {/if}

        {#if critics.length > 0}
          <h2 class="label px-4 pt-4 pb-2 text-[15px] text-muted">critics</h2>
          {#each critics as account (account.uid)}
            <AccountRow
              {account}
              following={inVine.has(account.uid)}
              onAdd={inVine.has(account.uid)
                ? undefined
                : () => addToVine(account)}
              onRemove={inVine.has(account.uid)
                ? () => void removeFromVine(account)
                : undefined}
            />
          {/each}
        {/if}

        <!-- Last, under everything, so it is never where a thumb lands by
             habit. -->
        <DeleteAccountLine />
      {/if}
    </div>
  </div>

  <div
    class="shrink-0 border-t border-border bg-surface px-4 pt-2.5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
  >
    <div class="flex flex-col gap-2.5">
      <SearchField
        value={query}
        onChange={(next) => {
          query = next;
        }}
        placeholder="find people and critics"
      />
    </div>
  </div>
</div>
