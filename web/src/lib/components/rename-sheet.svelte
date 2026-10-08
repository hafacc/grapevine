<script lang="ts">
  import { validateDisplayName } from "../utils/display-name";
  import { grapevine } from "../utils/store.svelte";
  import Button from "./ui/button.svelte";
  import { focusOnMount } from "./ui/focus";
  import Icon from "./ui/icon.svelte";
  import { LuLoaderCircle } from "./ui/icons";
  import Input from "./ui/input.svelte";
  import Sheet from "./ui/sheet.svelte";

  // The name friends see, changed from the viewer's own row. The name gate is the
  // same field for an account that arrived with no name; this one can be walked
  // away from, because there is already a name to keep.
  //
  // Mounted only while open, so the field starts from the current name each time
  // rather than from whatever was typed and abandoned last time.
  let { onClose }: { onClose: () => void } = $props();

  let name = $state(grapevine.profile?.displayName ?? "");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const invalid = $derived(validateDisplayName(name));
  const problem = $derived((name ? invalid : null) ?? error);
  const unchanged = $derived(name.trim() === grapevine.profile?.displayName);

  async function submit(): Promise<void> {
    if (invalid) return;
    if (unchanged) {
      onClose();
      return;
    }
    busy = true;
    error = null;
    try {
      await grapevine.updateDisplayName(name.trim());
      onClose();
    } catch (caught) {
      console.error(caught);
      // Null when the account turned out to be locked: the locked screen
      // replaces this sheet, and the name was never changed.
      error = await grapevine.explainFailure(
        caught,
        "couldn't save that. check your connection.",
      );
    }
    busy = false;
  }
</script>

<Sheet open {onClose} title="your name">
  <form
    class="flex flex-col gap-3"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <Input
      autocomplete="given-name"
      {@attach focusOnMount}
      invalid={Boolean(name && invalid)}
      bind:value={name}
      placeholder="your name"
    />
    <!-- Reserved whether or not it has anything to say, for the reason the
         name gate gives: a bottom sheet grows upward, and a line that
         appears would shove the field out from under the thumb. -->
    <p
      aria-live="polite"
      class={[
        "min-h-5 text-sm leading-5",
        problem ? "text-danger" : "text-muted",
      ]}
    >
      {problem ?? "what your vine sees. anything you like."}
    </p>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={onClose}>cancel</Button>
      <Button type="submit" disabled={busy || Boolean(invalid)}>
        {#if busy}
          <Icon icon={LuLoaderCircle} class="animate-spin" />
        {:else}
          save
        {/if}
      </Button>
    </div>
  </form>
</Sheet>
