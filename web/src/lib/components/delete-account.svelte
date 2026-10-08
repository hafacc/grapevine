<script lang="ts">
  import { confirmsDeletion, DELETE_WORD } from "../utils/auth";
  import { grapevine } from "../utils/store.svelte";
  import Button from "./ui/button.svelte";
  import Icon from "./ui/icon.svelte";
  import { LuLoaderCircle } from "./ui/icons";
  import Input from "./ui/input.svelte";
  import Sheet from "./ui/sheet.svelte";

  // Not the shared confirm: that one confirms on Enter and focuses its confirm
  // button, so a stray keypress would be enough. Here the button stays disabled
  // until the word is typed, and nothing else in the sheet can delete.
  let open = $state(false);
  let typed = $state("");
  let busy = $state(false);
  let failed = $state(false);

  const armed = $derived(confirmsDeletion(typed));

  function close(): void {
    if (busy) return;
    open = false;
    typed = "";
    failed = false;
  }

  async function submit(): Promise<void> {
    if (!armed || busy) return;
    busy = true;
    failed = false;
    try {
      // Success signs this device out, which unmounts the whole screen.
      await grapevine.deleteAccount();
    } catch (error) {
      console.error(error);
      failed = true;
      busy = false;
    }
  }
</script>

<button
  type="button"
  onclick={() => {
    open = true;
  }}
  class="mt-8 block w-full border-y border-border bg-danger-tint px-4 py-3 text-left text-[16px] text-danger-ink focus-visible:outline-offset-[-2px]"
>
  delete your account
</button>
<Sheet {open} onClose={close} dismissable={!busy} title="delete your account?">
  <form
    class="flex flex-col gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <div class="flex flex-col gap-2 text-[15px] text-muted">
      <p>
        your profile, ratings, vine, link and list are removed now, and cannot
        be brought back.
      </p>
      <p>names of things you added stay, attributed to nobody.</p>
    </div>
    <Input
      aria-label={`type ${DELETE_WORD} to confirm`}
      autocapitalize="none"
      autocomplete="off"
      spellcheck="false"
      name="confirm-delete"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      bind:value={typed}
      placeholder={`type ${DELETE_WORD} to confirm`}
    />
    <p
      aria-live="polite"
      class={["min-h-5 text-sm leading-5", failed ? "text-danger" : "text-muted"]}
    >
      {failed ? "that didn't work. check your connection and try again." : ""}
    </p>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" disabled={busy} onclick={close}>cancel</Button>
      <Button type="submit" variant="dangerSolid" disabled={!armed || busy}>
        {#if busy}
          <Icon icon={LuLoaderCircle} class="animate-spin" />
        {:else}
          delete account
        {/if}
      </Button>
    </div>
  </form>
</Sheet>
