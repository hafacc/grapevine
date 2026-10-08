<script lang="ts">
  import { matchesPerson, type PersonRow } from "../utils/people";
  import { grapevine } from "../utils/store.svelte";
  import Avatar from "./avatar.svelte";
  import DeleteAccountLine from "./delete-account.svelte";
  import { confirm, run } from "./dialog.svelte";
  import InstallLine from "./install-line.svelte";
  import LinkRow from "./link-row.svelte";
  import LookupSettingsLines from "./lookup-settings.svelte";
  import MeLine from "./me-line.svelte";
  import ReportsLine from "./reports-line.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuChevronLeft, LuUserMinus } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";
  import SearchField from "./ui/search-field.svelte";

  let query = $state("");

  const matching = $derived(
    query.length === 0
      ? grapevine.friends
      : grapevine.friends.filter((person) => matchesPerson(person, query)),
  );

  async function dropFriend(person: PersonRow): Promise<void> {
    // The last connection locks the account (0010), which is said first. An
    // admin is never locked (0014).
    const last = grapevine.friends.length === 1 && !grapevine.profile?.admin;
    const sure = await confirm({
      title: `remove ${person.displayName || "someone"} from your vine?`,
      body: last
        ? "they're the last person in your vine. your account will be locked until someone sends you a link."
        : "you'll no longer shape each other's lists. to undo it, one of you has to send a link.",
      confirmLabel: "remove",
      tone: "danger",
    });
    if (!sure) return;
    run(
      () => grapevine.unfriend(person.uid),
      "that didn't work. check your connection and try again.",
    );
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
      <MeLine />
      <LinkRow />
      <LookupSettingsLines />
      <ReportsLine />
      <InstallLine />

      {#if matching.length > 0}
        <h2 class="label px-4 pt-4 pb-2 text-[15px] text-muted">your vine</h2>
        {#each matching as person (person.uid)}
          <div>
            <!-- No is the only answer a friend row takes: there is nothing
                 to say yes to, and the word says what no does here. -->
            <RateRow
              subject={person.displayName || "someone"}
              value={null}
              sides="no"
              labels={{ no: { word: "remove", icon: LuUserMinus } }}
              onRate={() => void dropFriend(person)}
              frameClass="bg-surface"
            >
              <!-- A row of the people list: avatar and name. No bar: a person
                   does not have a score. -->
              <div
                data-person={person.uid}
                class="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5"
              >
                <Avatar
                  name={person.displayName}
                  photoURL={person.photoURL}
                  size={40}
                />
                <span
                  class="min-w-0 flex-grow truncate text-[16px] font-medium"
                >
                  {person.displayName || "someone"}
                </span>
              </div>
            </RateRow>
          </div>
        {/each}
      {/if}

      {#if query.length > 0 && matching.length === 0}
        <p class="px-4 py-4 text-[16px] text-muted">
          nobody here by that name. to add someone, send them a link.
        </p>
      {/if}

      <!-- Last, under everything, so it is never where a thumb lands by
           habit; hidden while filtering, which is about other people. -->
      {#if query.length === 0}
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
        placeholder="filter by name"
      />
    </div>
  </div>
</div>
