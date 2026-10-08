<script lang="ts" module>
  // The three written pages — about, privacy, help — share one
  // chrome and a dozen element classes. They are the only long-text surfaces in
  // grapevine, and deliberately the only ones that set prose on the bare canvas:
  // a card here means controls and lists everywhere else, so a wall of one behind
  // two thousand words would read as a form.
  //
  // Nothing below touches the store, the database or a session. These are
  // PRERENDERED routes, not fragment screens, so every word sits in the exported
  // HTML for a reader — or a reviewer — with JavaScript off.

  export const link = "font-semibold text-accent-ink break-words";
  export const h2 =
    "font-display mt-10 text-[22px] leading-tight font-semibold";
  export const p = "mt-4";
  export const list = "mt-4 list-disc space-y-2 pl-5 marker:text-faint";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import SiteFooter, { type DocRoute } from "./site-footer.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Wordmark from "./wordmark.svelte";

  let {
    title,
    updated,
    route,
    children,
  }: {
    title: string;
    updated?: string;
    route: DocRoute;
    children: Snippet;
  } = $props();
</script>

<div class="flex min-h-dvh flex-col">
  <!-- The text's own column, so the wordmark and the theme control line
       up with the page rather than the screen's edges. -->
  <header class="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
    <a href="/" aria-label="grapevine home" class="rounded-sm">
      <Wordmark />
    </a>
    <div class="ml-auto flex items-center gap-1">
      <ThemeButton />
    </div>
  </header>

  <main
    class="mx-auto w-full max-w-2xl px-4 pt-6 pb-24 leading-7 text-text sm:pt-10"
  >
    <h1 class="font-display text-3xl leading-tight font-semibold sm:text-4xl">
      {title}
    </h1>
    {#if updated}
      <p class="mt-2 text-sm tabular-nums text-muted">
        last updated: {updated}
      </p>
    {/if}
    {@render children()}
    <SiteFooter current={route} class="mt-16" />
  </main>
</div>
