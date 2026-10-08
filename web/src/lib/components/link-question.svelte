<script lang="ts">
  import { type InviteOwner, TRUST_MEANS } from "../utils/invites";
  import { grapevine } from "../utils/store.svelte";
  import { DAILY_LIMIT_MESSAGE, isDailyLimit } from "../utils/supabase";
  import Avatar from "./avatar.svelte";
  import { alert } from "./dialog.svelte";
  import SiteFooter from "./site-footer.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Button from "./ui/button.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuLoaderCircle } from "./ui/icons";

  /**
   * A live link's question, the same screen for every account that holds one:
   * new, locked, or with a vine already. A full screen rather than a sheet,
   * because a locked account has nothing to lay a sheet over, and because it
   * continues the welcome screen the link was opened on.
   *
   * Asks before it writes, and saying yes is the consent: the link may have been
   * forwarded, or opened while signed in to the wrong account, and the owner's
   * name and face are what the person holding it checks that against.
   */
  let {
    token,
    owner,
    locked,
  }: { token: string; owner: InviteOwner; locked: boolean } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  const name = $derived(owner.displayName || "someone");

  async function add(): Promise<void> {
    const known = new Set(grapevine.friends.map((friend) => friend.uid));
    // The owner's name as asked: answering takes the question, and the owner
    // with it, off the screen.
    const asked = name;
    busy = true;
    error = null;
    try {
      const answered = await grapevine.redeemInvite(token);
      if (answered === null) {
        await alert({
          title: "that link is invalid or expired",
          body: "ask whoever sent it for a new one.",
        });
      } else if (answered === grapevine.user?.uid) {
        await alert({
          title: "that's your own link",
          body: "send it to someone you want in your vine.",
        });
      } else if (known.has(answered)) {
        await alert({ title: `${asked} is already in your vine` });
      }
    } catch (caught) {
      // Kept, not forgotten: a failed write says nothing about the link.
      console.error("invite", caught);
      error = isDailyLimit(caught)
        ? DAILY_LIMIT_MESSAGE
        : "couldn't answer that link. check your connection.";
      busy = false;
    }
  }
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
  <div class="flex justify-end p-4">
    <ThemeButton />
  </div>
  <main
    class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
  >
    <Avatar {name} photoURL={owner.photoURL} size={64} />
    <h1 class="font-heading text-[22px] [overflow-wrap:anywhere]">
      add {name} to your vine?
    </h1>
    {#if locked}
      <p class="text-[15px] font-medium">
        if you decline, your account stays locked until you accept someone's
        link.
      </p>
    {/if}
    <div class="flex w-full gap-3">
      <Button
        variant="secondary"
        size="lg"
        class="flex-1"
        disabled={busy}
        onclick={grapevine.dismissInvite}
      >
        not now
      </Button>
      <Button
        size="lg"
        class="flex-1"
        disabled={busy}
        onclick={() => void add()}
      >
        {#if busy}
          <Icon icon={LuLoaderCircle} class="animate-spin" />
        {:else}
          add
        {/if}
      </Button>
    </div>
    <!-- Under the answer: the face and the question are what somebody
         checks, and this is for whoever wants more before choosing. The
         locked warning sits above, because it changes the answer. -->
    <p class="text-[15px] text-muted">{TRUST_MEANS}</p>
    <p aria-live="polite" class="min-h-5 text-sm leading-5 text-danger">
      {error}
    </p>
  </main>
  <SiteFooter class="px-4 pb-8" />
</div>
