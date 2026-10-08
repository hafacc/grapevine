<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";

  // `label` is both the tooltip and the accessible name, since the visible
  // content is just an icon.
  let {
    label,
    class: className = "",
    type = "button",
    children,
    ...rest
  }: HTMLButtonAttributes & { label: string } = $props();
</script>

<button
  {type}
  aria-label={label}
  title={label}
  class={[
    "grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted transition hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50",
    className,
  ]}
  {...rest}
>
  {@render children?.()}
</button>
