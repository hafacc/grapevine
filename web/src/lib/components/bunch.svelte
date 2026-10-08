<script lang="ts">
  // The drawing itself, not a copy of its geometry: `docs/mark.svg` is the source
  // (web/DESIGN-UI.md, "The mark"), and a second copy is one that can disagree
  // about which hexagon is bigger. Never inlined into the bundle: every copy
  // on a screen points at the one file.
  import markDrawing from "../../../../docs/mark.svg?no-inline";

  // The bunch at whatever size `class` gives it. A mask, so it takes the
  // theme's accent: an <img> would paint the file's own light-theme teal on the
  // dark canvas too, and inlining the SVG would put its clip-path ids on the
  // page once per copy.
  let { class: className }: { class: string } = $props();
</script>

<span
  aria-hidden="true"
  class={["inline-block shrink-0 bg-accent", className]}
  style:mask-image={`url(${markDrawing})`}
  style:mask-size="contain"
  style:mask-repeat="no-repeat"
  style:mask-position="center"
></span>
