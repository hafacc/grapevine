<script lang="ts">
  import Icon from "./icon.svelte";
  import { LuLoaderCircle, LuPlus } from "./icons";

  /**
   * The line above the field that adds whatever was typed.
   *
   * Deliberately the quietest thing on the screen: it is available on every
   * keystroke rather than only when nothing matched — identity is by folded name,
   * so an add that collides is a find — and it must not compete with the results
   * it sits over.
   */
  let {
    label,
    onTap,
    disabled = false,
    busy = false,
  }: {
    label: string;
    onTap?: () => void;
    disabled?: boolean;
    // Looking the name up: the tap has landed, and a second one does nothing.
    busy?: boolean;
  } = $props();
</script>

<button
  type="button"
  onclick={busy ? undefined : onTap}
  {disabled}
  aria-busy={busy}
  class="font-display flex h-[40px] w-full items-center gap-2 rounded-sm border border-dashed border-border bg-surface px-3 text-left text-[15px] font-medium whitespace-nowrap text-muted disabled:pointer-events-none disabled:opacity-50"
>
  {#if busy}
    <Icon
      icon={LuLoaderCircle}
      size={16}
      aria-hidden="true"
      class="shrink-0 animate-spin"
    />
  {:else}
    <Icon icon={LuPlus} size={16} aria-hidden="true" class="shrink-0" />
  {/if}
  <!-- Its own span, for the reason the chip's label is: an ellipsis never
       reaches the text of a flex container. -->
  <span class="min-w-0 truncate">{label}</span>
</button>
