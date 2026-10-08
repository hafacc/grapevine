<script lang="ts">
  import { activeDialog, closeDialog } from "./dialog.svelte";
  import Button from "./ui/button.svelte";
  import { focusOnMount } from "./ui/focus";
  import Sheet from "./ui/sheet.svelte";

  const active = $derived(activeDialog());
  const danger = $derived(
    active?.kind === "confirm" && active.options.tone === "danger",
  );
  const primaryLabel = $derived(
    active?.kind === "confirm"
      ? (active.options.confirmLabel ?? "confirm")
      : (active?.options.okLabel ?? "ok"),
  );

  // Enter confirms; Escape/backdrop dismissal is handled by the Sheet.
  $effect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Enter") closeDialog(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

{#if active}
  <Sheet open onClose={() => closeDialog(false)} title={active.options.title}>
    {#if active.options.body}
      <div class="text-[0.9375rem] text-muted">{active.options.body}</div>
    {/if}
    <div class="flex justify-end gap-2 pt-5">
      {#if active.kind === "confirm"}
        <Button variant="ghost" onclick={() => closeDialog(false)}>
          {active.options.cancelLabel ?? "cancel"}
        </Button>
      {/if}
      <Button
        variant={danger ? "dangerSolid" : "primary"}
        {@attach focusOnMount}
        onclick={() => closeDialog(true)}
      >
        {primaryLabel}
      </Button>
    </div>
  </Sheet>
{/if}
