<script lang="ts">
  import EntityView from "../lib/components/entity-view.svelte";
  import FeedView from "../lib/components/feed-view.svelte";
  import LinkQuestion from "../lib/components/link-question.svelte";
  import LockedScreen from "../lib/components/locked-screen.svelte";
  import Mark from "../lib/components/mark.svelte";
  import PeopleView from "../lib/components/people-view.svelte";
  import ReportsView from "../lib/components/reports-view.svelte";
  import Button from "../lib/components/ui/button.svelte";
  import WelcomeScreen from "../lib/components/welcome-screen.svelte";
  import { asksAboutLink } from "../lib/utils/invites";
  import { grapevine } from "../lib/utils/store.svelte";

  const screen = $derived(grapevine.screen);
  const locked = $derived(Boolean(grapevine.profile?.locked));
  // A link to the viewer's own vine is not asked; `invite-gate` says so.
  const asked = $derived(
    grapevine.inviteToken !== null &&
      grapevine.inviteFrom &&
      asksAboutLink(
        grapevine.inviteToken,
        grapevine.inviteFrom,
        locked,
        grapevine.myLink,
      )
      ? { token: grapevine.inviteToken, owner: grapevine.inviteFrom }
      : null,
  );

  async function doSignOut(): Promise<void> {
    try {
      await grapevine.signOut();
    } catch (error) {
      console.error(error);
    }
  }
</script>

<svelte:head>
  <title>grapevine</title>
  <meta
    name="description"
    content="what to eat, watch, read and more, from the people you trust"
  />
</svelte:head>

{#snippet splash()}
  <div class="flex min-h-dvh items-center justify-center">
    <Mark pulsing />
  </div>
{/snippet}

{#if !grapevine.authReady}
  {@render splash()}
{:else if !grapevine.user}
  <WelcomeScreen />
{:else if !grapevine.profileReady}
  {#if grapevine.profileUnreachable}
    <!-- In place of the splash once the profile gate has given up — the splash
         claims something is still on its way. Deliberately BEHIND the gate: the
         other reading of an unanswered profile is "no profile", which is
         onboarding and an overwrite. Nothing here is terminal: a late answer
         opens the gate and this goes by itself. -->
    <div
      class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 class="font-heading text-[19px]">can't reach grapevine right now</h1>
      <p class="text-[15px] text-muted">
        nothing is lost — this device just can't get through to grapevine. check
        your connection and try again.
      </p>
      <div class="flex gap-2">
        <Button variant="secondary" onclick={() => window.location.reload()}>
          try again
        </Button>
        <!-- A session the server refuses outright — a disabled account, a
             revoked token — lands here too, and reloading hits the same wall. -->
        <Button variant="ghost" onclick={doSignOut}>sign out</Button>
      </div>
    </div>
  {:else}
    {@render splash()}
  {/if}
{:else if asked}
  <LinkQuestion token={asked.token} owner={asked.owner} {locked} />
{:else if locked}
  <LockedScreen />
{:else}
  <!-- The whole app is one 720 px column at desktop width, bars and all, with a
       rule down each side and the bare canvas beyond it (DESIGN-UI, "Layout").
       A bar that spanned the screen would put the back button and the avatar a
       screen's width away from the list they act on. -->
  <div
    class="mx-auto flex h-dvh w-full max-w-[720px] flex-col md:border-x md:border-border"
  >
    {#if grapevine.listenersLost}
      <!-- Reload rather than a retry button: the store has already retried
           and given up, and a reload is what re-runs auth from scratch, which
           covers the likeliest causes. A client cannot talk a server out of a
           refusal, so this is disclosure. -->
      <div
        class="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5"
      >
        <p class="min-w-0 flex-1 text-[15px] text-muted">
          grapevine stopped receiving updates, so this screen may be out of
          date.
        </p>
        <Button
          variant="secondary"
          onclick={() => window.location.reload()}
          class="shrink-0"
        >
          reload
        </Button>
      </div>
    {/if}
    <!-- A flex column, because a screen fills the height it is given: one
         says so with `h-full` and another with `flex-1`, and both need a
         parent that has a height to give.

         Four screens (DESIGN §1). Each one fills the height it is given and
         carries its own title bar and its own scroller, so there is no frame
         here to keep in step with four layouts. -->
    <div class="flex min-h-0 flex-grow flex-col">
      {#if screen.kind === "item"}
        <EntityView itemId={screen.id} />
      {:else if screen.kind === "people"}
        <PeopleView />
      {:else if screen.kind === "reports" && grapevine.profile?.admin}
        <ReportsView />
      {:else}
        <!-- The list, and for the moment before the store puts anybody who
             is not an admin there. -->
        <FeedView />
      {/if}
    </div>
  </div>
{/if}
