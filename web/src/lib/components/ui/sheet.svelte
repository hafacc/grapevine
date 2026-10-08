<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";

  // With `dismissable` false there is no drag handle either, since a handle is a
  // promise that the sheet can be pulled away.
  let {
    open,
    onClose,
    dismissable = true,
    title,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    dismissable?: boolean;
    title?: string;
    children: Snippet;
  } = $props();

  // The sheet is moved onto <body>, which is not decoration: `fixed` resolves
  // against the viewport only while no ancestor is a containing block, and a
  // transform, a filter, `backdrop-filter` or `will-change` makes one — a sheet
  // opened from inside such an ancestor collapses into it. A modal must not be
  // positioned by whatever happens to contain the button that opened it.
  // Events still reach the caller: Svelte listens on the document as well as
  // on the app's own root.
  const onBody: Attachment<HTMLElement> = (node) => {
    document.body.append(node);
    return () => node.remove();
  };

  $effect(() => {
    if (!open) return;
    const close = onClose;
    const canDismiss = dismissable;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && canDismiss) close();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

{#if open}
  <div
    {@attach onBody}
    class="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
  >
    {#if dismissable}
      <button
        type="button"
        aria-label="dismiss"
        onclick={onClose}
        class="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      ></button>
    {:else}
      <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]"></div>
    {/if}
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="relative flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-sm bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-panel sm:max-w-md sm:rounded-sm sm:pb-5"
    >
      {#if dismissable}
        <span
          class="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-sm bg-surface-hover sm:hidden"
        ></span>
      {/if}
      {#if title}
        <h2 class="font-display mb-4 text-[22px] leading-tight font-semibold">
          {title}
        </h2>
      {/if}
      {@render children()}
    </div>
  </div>
{/if}
