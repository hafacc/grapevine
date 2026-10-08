<script lang="ts">
  import { onMount } from "svelte";
  // Side effect only: importing it is what attaches the install listener, at
  // module scope, before anything can be late to it.
  import "../utils/install.svelte";

  // Registers the worker, once the page has loaded. Draws nothing.
  onMount(() => {
    if (!("serviceWorker" in navigator)) return;
    // Never in dev: the dev server serves modules a cache would hand back stale,
    // with no version bump between edits to invalidate them. The file is built
    // there anyway, so flipping this line is all it takes to try it locally.
    if (import.meta.env.DEV) return;
    // Deliberately after load. Registration competes with the first paint's own
    // requests for the same connection, and the worker is of no use on the visit
    // that installs it.
    const start = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((error) => console.warn("service worker", error));
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
  });
</script>
