<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import Avatar from "./avatar.svelte";
  import { alert, confirm } from "./dialog.svelte";
  import RenameSheet from "./rename-sheet.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuPencil } from "./ui/icons";

  // Photo, name and sign out on one line, with the theme control beside them:
  // there is no settings screen, so those two live here. The name is the one
  // thing about the account a person may change, and a tap on it is how.
  let renaming = $state(false);
  const profile = $derived(grapevine.profile);

  async function leave(): Promise<void> {
    const sure = await confirm({
      title: "sign out?",
      body: "you can sign back in whenever you like.",
      confirmLabel: "sign out",
    });
    if (!sure) return;
    try {
      await grapevine.signOut();
    } catch (error) {
      console.error(error);
      await alert({
        title: "that didn't work",
        body: "check your connection and try again.",
      });
    }
  }
</script>

{#if profile}
  <div class="flex items-center gap-3.5 bg-surface px-4 py-3.5">
    <Avatar name={profile.displayName} photoURL={profile.photoURL} size={48} />
    <!-- Wrapped rather than cut: the two buttons beside it take most of a
         phone's width, and a name cut to a few letters is nobody's. -->
    <button
      type="button"
      aria-label={`change your name, ${profile.displayName || "you"}`}
      onclick={() => {
        renaming = true;
      }}
      class="flex min-h-[44px] min-w-0 flex-grow items-center gap-2 rounded-sm text-left"
    >
      <span
        class="min-w-0 text-[19px] leading-snug font-medium [overflow-wrap:anywhere]"
      >
        {profile.displayName || "you"}
      </span>
      <Icon
        icon={LuPencil}
        size={16}
        aria-hidden="true"
        class="shrink-0 text-muted"
      />
    </button>
    {#if renaming}
      <RenameSheet
        onClose={() => {
          renaming = false;
        }}
      />
    {/if}
    <ThemeButton />
    <button
      type="button"
      onclick={() => void leave()}
      class="font-display inline-flex h-[44px] shrink-0 items-center justify-center rounded-sm border border-border bg-surface-muted px-4 text-[17px] font-semibold text-text"
    >
      sign out
    </button>
  </div>
{/if}
