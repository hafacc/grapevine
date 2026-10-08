<script lang="ts">
  import Icon from "./icon.svelte";
  import { LuSearch } from "./icons";

  /**
   * The only text input in the product, and it is always at the bottom: on the
   * list it searches and adds, on a thing's screen it filters attributes and adds
   * one, on the people screen it filters people and asks a handle to connect.
   *
   * With a query the border and the magnifier take the accent, so the screen says
   * it is filtered without a word for it.
   */
  let {
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (next: string) => void;
    // Also the field's accessible name: what it searches differs per screen, and
    // saying it twice is what would drift.
    placeholder: string;
  } = $props();

  const filled = $derived(value.length > 0);
</script>

<!-- The focus ring goes round the label, which is the box a reader sees, and is
     drawn over its border rather than outside it: offset outward, the border and
     the ring read as two rectangles. -->
<label
  class={[
    "flex h-[44px] min-w-0 flex-grow items-center gap-3 rounded-sm border bg-surface px-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-accent",
    filled ? "border-accent" : "border-border",
  ]}
>
  <span
    aria-hidden="true"
    class={["flex shrink-0", filled ? "text-accent-ink" : "text-muted"]}
  >
    <Icon icon={LuSearch} size={18} />
  </span>
  <span class="sr-only">{placeholder}</span>
  <!-- Marked as a search box every way the browsers and the password
       managers read one: a plain text field with no name is what they
       guess is a login, and offer passwords for. -->
  <input
    type="search"
    name="search"
    enterkeyhint="search"
    {value}
    {placeholder}
    oninput={(event) => onChange(event.currentTarget.value)}
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    data-1p-ignore="true"
    data-lpignore="true"
    data-bwignore="true"
    data-form-type="other"
    class="min-w-0 flex-grow appearance-none border-0 bg-transparent text-[16px] text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
  />
</label>
