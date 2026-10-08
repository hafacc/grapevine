<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";

  // `invalid` reddens the box so it and the message under it read as one object;
  // it lives here rather than beside any one caller because every field that can
  // be complained about is this same input.
  let {
    prefix,
    invalid = false,
    class: className = "",
    value = $bindable(),
    ...rest
    // Its `prefix` (an RDFa attribute, meaningless on an input) is dropped, or
    // the adornment below would be typed as a string and refuse an icon.
  }: Omit<HTMLInputAttributes, "prefix"> & {
    prefix?: Snippet;
    invalid?: boolean;
  } = $props();

  // 16px text: below that iOS Safari zooms the page on focus.
  const base =
    "h-[44px] w-full rounded-sm border bg-surface text-base outline-none transition";
  const tone = $derived(
    invalid
      ? "border-danger focus:border-danger"
      : "border-border focus:border-accent",
  );
</script>

<!-- Always the same tree, adorned or not: an adornment that comes and goes —
     one shown only while the field is empty, say — must not move the input in
     it, or the first keystroke would drop focus to the body. On a phone that
     closes the keyboard after one character. -->
<div class="relative w-full">
  {#if prefix}
    <span
      class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted"
    >
      {@render prefix()}
    </span>
  {/if}
  <input
    aria-invalid={invalid || undefined}
    class={[base, tone, prefix ? "pl-8" : "pl-3.5", "pr-3.5", className]}
    bind:value
    {...rest}
  />
</div>
