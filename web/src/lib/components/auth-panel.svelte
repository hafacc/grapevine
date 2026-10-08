<script lang="ts" module>
  import { authErrorMessage } from "../utils/auth";

  // Remedy-shaped: `authErrorMessage` ends at "something went wrong. try again."
  // for most codes, which tells nobody what to do differently. Its specific cases
  // still speak.
  function shownMessage(caught: unknown): string {
    const mapped = authErrorMessage(caught);
    return mapped === "something went wrong. try again."
      ? "couldn't get you in. try that again."
      : mapped;
  }
</script>

<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import { alert } from "./dialog.svelte";
  import Button from "./ui/button.svelte";
  import Icon from "./ui/icon.svelte";
  import { FaGoogle, LuLoaderCircle } from "./ui/icons";

  // The door — the whole of it, and there is only one. Its label is the
  // caller's: without a link it only lets back in someone who already has an
  // account, so it says *sign in*; with one it also makes an account, so it says
  // *continue with google*.
  //
  // It owns the CARD as well as the button, so that the standing notice under the
  // card and the error that replaces it are one node rather than the same string
  // synchronized into two components. `notice` is what that line says when
  // nothing is wrong.
  let { label, notice = "" }: { label: string; notice?: string } = $props();

  let busy = $state(false);
  // Seeded from the round trip, because a refused or cancelled Google sign-in
  // comes back as a page load rather than as a rejected promise, and otherwise
  // shows the door again as though nothing had been tried.
  let error = $state<string | null>(
    grapevine.signInError === null
      ? null
      : shownMessage({ code: grapevine.signInError }),
  );
  // And followed: a code exchange that failed or never answered is known only
  // after this screen is already up.
  $effect(() => {
    const code = grapevine.signInError;
    if (code !== null) error = shownMessage({ code });
  });

  async function run(): Promise<void> {
    if (!grapevine.configured) {
      await alert({
        title: "sign-in isn't set up yet",
        body: "create a supabase project, enable google sign-in, and give this build its URL and anon key to continue.",
      });
      return;
    }
    busy = true;
    error = null;
    try {
      await grapevine.signIn();
    } catch (caught) {
      console.error(caught);
      error = shownMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

<!-- No heading and no label. A single button is self-evidently the way
     in, and "no sign-up, no password" is said by the absence of a toggle
     and a password field rather than by a line claiming it. -->
<div class="w-full max-w-sm rounded-sm bg-surface p-6 text-left shadow-panel">
  <Button type="button" size="lg" class="w-full" disabled={busy} onclick={run}>
    {#if busy}
      <Icon icon={LuLoaderCircle} class="animate-spin" />
    {:else}
      <Icon icon={FaGoogle} />
      {label}
    {/if}
  </Button>
</div>
<!-- The card's caption, and the height belongs to the slot rather than to
     the copy: the notice's own two lines are reserved whether it or an
     error is speaking, so a problem appearing, changing or clearing never
     moves the card above it. The page is a centered column, so anything
     that changes height here re-centers and shifts the door itself.

     One line of error is a budget rather than a hope, pinned by
     `tests/auth-copy.test.ts`. -->
<p
  aria-live="polite"
  class={[
    "max-w-sm min-h-10 text-sm leading-5",
    error ? "text-danger" : "text-muted",
  ]}
>
  {error ?? notice}
</p>
