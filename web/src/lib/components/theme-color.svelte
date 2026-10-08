<script lang="ts">
  import { theme } from "../utils/theme.svelte";

  // What the browser paints around the app — Android's status bar, an installed
  // window's title bar. Draws nothing.
  //
  // `src/app.html` declares two of these keyed on `prefers-color-scheme`, which
  // is right for the first paint and wrong from then on: the theme is a
  // THREE-state choice, so someone who picked Dark on a light system would get a
  // dark app under a light bar. The static pair stays for the paint before this
  // runs; from there both are set to whatever the app actually resolved to, so
  // whichever one the media query picks is the same answer.
  $effect(() => {
    const resolved = theme.resolved;
    if (!resolved) return;
    const color = resolved === "dark" ? "#0e1417" : "#e8eced";
    for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
      tag.setAttribute("content", color);
    }
  });
</script>
