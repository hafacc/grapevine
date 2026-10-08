<script lang="ts">
  import barlowRegular from "@fontsource/barlow/files/barlow-latin-400-normal.woff2?url";
  import barlowMedium from "@fontsource/barlow/files/barlow-latin-500-normal.woff2?url";
  import barlowSemibold from "@fontsource/barlow/files/barlow-latin-600-normal.woff2?url";
  import condensedMedium from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-500-normal.woff2?url";
  import condensedSemibold from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2?url";
  import type { Snippet } from "svelte";
  import "../app.css";
  import DialogHost from "../lib/components/dialog-host.svelte";
  import InviteGate from "../lib/components/invite-gate.svelte";
  import LocalStackBadge from "../lib/components/local-stack-badge.svelte";
  import Pwa from "../lib/components/pwa.svelte";
  import ThemeColor from "../lib/components/theme-color.svelte";
  import { projectUrl } from "../lib/utils/project";
  import { startGrapevine } from "../lib/utils/store.svelte";
  import { startTheme } from "../lib/utils/theme.svelte";

  let { children }: { children: Snippet } = $props();

  // The faces a first paint needs, fetched alongside the stylesheet that names
  // them rather than after it has been read.
  const FIRST_PAINT_FONTS: readonly string[] = [
    condensedSemibold,
    condensedMedium,
    barlowSemibold,
    barlowMedium,
    barlowRegular,
  ];

  // The empty string when this build has no project configured.
  const API_ORIGIN = projectUrl();

  startTheme();
  startGrapevine();
</script>

<svelte:head>
  {#each FIRST_PAINT_FONTS as font (font)}
    <link
      rel="preload"
      href={font}
      as="font"
      type="font/woff2"
      crossorigin="anonymous"
    />
  {/each}
  <!-- Every screen's first act is to sign in and read, and the host costs a
       DNS lookup and a TLS handshake before a byte of that moves. Starting it
       alongside the bundle download matters most on a first visit, where
       nothing was warmed by a previous one. Sign-in, the database, the
       Realtime socket and the recompute are all the project's own origin.

       `crossorigin` has to MATCH how the request is eventually made or the
       socket lands in the wrong pool and is never reused — the hint then
       costs a connection and saves nothing. The SDK reaches it by CORS
       fetch with no credentials.

       Read at build time, so a build with no project wired up emits no hint
       at all rather than one pointing nowhere. -->
  {#if API_ORIGIN}
    <link rel="preconnect" href={API_ORIGIN} crossorigin="anonymous" />
  {/if}
</svelte:head>

{@render children()}
<DialogHost />
<InviteGate />
<LocalStackBadge />
<Pwa />
<ThemeColor />
