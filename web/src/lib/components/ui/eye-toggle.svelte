<script lang="ts">
  import Icon from "./icon.svelte";
  import { LuEye, LuEyeOff } from "./icons";

  /**
   * Hides the rows the viewer has already answered — things in the list,
   * attributes on a thing's screen.
   *
   * The icon changes and not only the color: a toggle whose only state is a tint
   * is unreadable to anyone who cannot see the tint, and this one is load-bearing
   * on two screens.
   */
  let {
    hiding,
    onToggle,
    label,
  }: {
    hiding: boolean;
    onToggle: () => void;
    // What is being hidden differs per screen, so the sentence is the caller's.
    label: string;
  } = $props();
</script>

<button
  type="button"
  aria-label={label}
  aria-pressed={hiding}
  onclick={onToggle}
  class={[
    "flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm border",
    hiding
      ? "border-accent bg-accent-soft text-accent-ink"
      : "border-border bg-surface text-muted",
  ]}
>
  <Icon icon={hiding ? LuEyeOff : LuEye} size={20} />
</button>
