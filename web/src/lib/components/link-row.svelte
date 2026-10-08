<script lang="ts">
  import { onMount } from "svelte";
  import { inviteUrl } from "../utils/invites";
  import { desktop } from "../utils/media.svelte";
  import { grapevine } from "../utils/store.svelte";
  import { alert, confirm, run } from "./dialog.svelte";
  import Icon from "./ui/icon.svelte";
  import IconButton from "./ui/icon-button.svelte";
  import {
    LuCheck,
    LuCopy,
    LuLink,
    LuLoaderCircle,
    LuRefreshCw,
    LuShare2,
    LuUnlink,
  } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";

  // The one way to make a friend: a link, handed over somewhere else. One per
  // person, with no expiry and no limit on uses. The link itself is never drawn:
  // it is a bearer secret, and copying or sharing is all anybody does with it.
  // The row swipes like any other, with words and icons rather than thumbs,
  // since neither side is a rating: off, right turns it on; on, left turns it
  // off and right replaces it, each asking first.
  let busy = $state(false);
  let copied = $state(false);
  let canShare = $state(false);
  const myLink = $derived(grapevine.myLink);
  const on = $derived(myLink !== null && myLink !== undefined);

  // Feature-tested rather than sniffed: a phone's share sheet is how a link
  // gets to one person, and a desktop mostly has none.
  onMount(() => {
    canShare = typeof navigator.share === "function";
  });

  function make(): void {
    busy = true;
    copied = false;
    run(async () => {
      try {
        await grapevine.setInviteLink();
      } finally {
        busy = false;
      }
    }, "couldn't make a link. check your connection and try again.");
  }

  async function replace(): Promise<void> {
    const sure = await confirm({
      title: "make a new link?",
      body: "the one you have stops working. people it added stay.",
      confirmLabel: "new link",
      tone: "danger",
    });
    if (sure) make();
  }

  async function turnOff(): Promise<void> {
    const sure = await confirm({
      title: "turn your link off?",
      body: "it stops working for anyone who has it. people it added stay.",
      confirmLabel: "turn off",
      tone: "danger",
    });
    if (!sure) return;
    copied = false;
    run(
      () => grapevine.turnOffLink(),
      "that didn't work. check your connection and try again.",
    );
  }

  function url(): string {
    return inviteUrl(window.location.origin, myLink ?? "");
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url());
      copied = true;
    } catch (error) {
      // Refused: an insecure origin or a denied permission. There is no field
      // to select by hand, so it is said.
      console.error(error);
      await alert({
        title: "couldn't copy your link",
        body: "try another browser.",
      });
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ url: url() });
    } catch (error) {
      // Closing the share sheet rejects too, and is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error(error);
      }
    }
  }
</script>

{#if myLink === undefined}
  <p class="bg-surface px-4 py-3 text-[16px] text-muted">loading…</p>
{:else}
  <div>
    <RateRow
      subject="your link"
      value={null}
      sides={on ? "both" : "yes"}
      labels={on
        ? {
            no: { word: "turn off", icon: LuUnlink },
            yes: { word: "new link", icon: LuRefreshCw },
          }
        : { yes: { word: "turn on", icon: LuLink } }}
      onRate={(next) => {
        if (busy) return;
        else if (!on) make();
        else if (next === 1) void replace();
        else void turnOff();
      }}
      frameClass="bg-surface"
    >
      <div
        data-link={on ? "on" : "off"}
        class="flex min-h-[64px] items-center gap-2 px-4 py-2.5"
      >
        <div class="min-w-0 flex-grow">
          <p class="text-[16px]">
            {#if busy}
              <Icon icon={LuLoaderCircle} class="animate-spin text-muted" />
            {:else if on}
              your link is on
            {:else}
              <span class="text-muted">your link is off</span>
            {/if}
          </p>
          <!-- The one swipe on a phone nothing else explains; at desktop
               width the side buttons say it. -->
          {#if !desktop.current}
            <p class="text-[15px] text-muted">
              {on ? "swipe to turn off or make a new one" : "swipe to turn on"}
            </p>
          {/if}
        </div>
        {#if on && canShare}
          <IconButton label="share your link" onclick={() => void share()}>
            <Icon icon={LuShare2} size={20} aria-hidden="true" />
          </IconButton>
        {/if}
        {#if on}
          <IconButton
            label={copied ? "copied" : "copy your link"}
            onclick={() => void copy()}
            class={copied ? "text-accent-ink" : ""}
          >
            <Icon
              icon={copied ? LuCheck : LuCopy}
              size={20}
              aria-hidden="true"
            />
          </IconButton>
        {/if}
      </div>
    </RateRow>
  </div>
{/if}
