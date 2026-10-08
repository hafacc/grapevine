<script lang="ts">
  import { heldLink } from "../utils/invites";
  import { grapevine } from "../utils/store.svelte";
  import DeleteAccountLine from "./delete-account.svelte";
  import Mark from "./mark.svelte";
  import SiteFooter from "./site-footer.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Button from "./ui/button.svelte";

  /**
   * What an account with no connection sees instead of the list (0010): the
   * server refuses every write it could make, so there is nothing here to write
   * with. It unlocks by accepting someone's live link, which `link-question`
   * asks in its place when this device holds one.
   */
  let leaving = $state(false);

  async function leave(): Promise<void> {
    leaving = true;
    try {
      await grapevine.signOut();
    } catch (error) {
      console.error(error);
      leaving = false;
    }
  }

  const link = $derived(
    heldLink(
      grapevine.inviteToken,
      grapevine.inviteFrom,
      grapevine.inviteLookupFailed,
    ),
  );
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
  <div class="flex justify-end p-4">
    <ThemeButton />
  </div>
  <main
    class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
  >
    {#if link === "checking"}
      <Mark pulsing />
    {:else}
      <Mark />
      <h1 class="font-heading text-[22px]">your account is locked</h1>
      <p class="text-[15px] text-muted">
        {link === "dead"
          ? "that link is invalid or expired. ask whoever sent it for a new one."
          : link === "unchecked"
            ? "couldn't check that link. check your connection and try again."
            : "it unlocks when you add someone to your vine with their link. ask someone for theirs."}
      </p>
      {#if link === "unchecked"}
        <Button size="lg" class="w-full" onclick={grapevine.retryInviteLookup}>
          try again
        </Button>
      {/if}
      <Button
        variant="secondary"
        size="lg"
        class="w-full"
        disabled={leaving}
        onclick={() => void leave()}
      >
        sign out
      </Button>
    {/if}
  </main>
  <div class="mx-auto w-full max-w-md">
    <DeleteAccountLine />
  </div>
  <SiteFooter class="px-4 pt-6 pb-8" />
</div>
