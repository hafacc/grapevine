<script lang="ts" module>
  const PAGES = [
    { href: "/about/", label: "about" },
    { href: "/privacy/", label: "privacy" },
    { href: "/help/", label: "help" },
  ] as const;

  export type DocRoute = (typeof PAGES)[number]["href"];
</script>

<script lang="ts">
  import { REPO_URL } from "../utils/contact";

  // Carried by the two surfaces a stranger can reach without signing in — the
  // welcome screen and these pages themselves.
  let {
    current,
    class: className = "",
  }: { current?: DocRoute; class?: string } = $props();
</script>

<footer
  class={[
    "flex flex-wrap items-center justify-center gap-x-2 text-sm text-muted",
    className,
  ]}
>
  {#each PAGES as { href, label }, index (href)}
    {#if index > 0}
      <span aria-hidden="true">·</span>
    {/if}
    {#if href === current}
      <span>{label}</span>
    {:else}
      <a {href} class="hover:text-text">{label}</a>
    {/if}
  {/each}
  <span aria-hidden="true">·</span>
  <a href={REPO_URL} class="hover:text-text">source</a>
</footer>
