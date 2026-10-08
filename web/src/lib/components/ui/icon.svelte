<script lang="ts">
  import type { SVGAttributes } from "svelte/elements";
  import type { IconData } from "./icons";

  // A glyph from `icons.ts`, drawn in the current text color. `size` is a
  // number of pixels or any CSS length, and defaults to the text's own size.
  let {
    icon,
    size = "1em",
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
    icon: IconData;
    size?: number | string;
  } = $props();
</script>

<!-- biome-ignore lint/a11y/noSvgWithoutTitle: a glyph is named by the control it sits in, or hidden by its caller. -->
<svg
  stroke="currentColor"
  fill={icon.stroked ? "none" : "currentColor"}
  stroke-width={icon.stroked ? "2" : "0"}
  viewBox={icon.viewBox}
  stroke-linecap={icon.stroked ? "round" : undefined}
  stroke-linejoin={icon.stroked ? "round" : undefined}
  {...rest}
  height={size}
  width={size}
  xmlns="http://www.w3.org/2000/svg"
>
  {#each icon.nodes as [tag, attributes], index (index)}
    <svelte:element
      this={tag}
      xmlns="http://www.w3.org/2000/svg"
      {...attributes}
    />
  {/each}
</svg>
