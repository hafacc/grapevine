<script lang="ts" module>
  type FieldNoteTone = "muted" | "danger";

  const TONES: Record<FieldNoteTone, string> = {
    muted: "text-muted",
    danger: "text-danger",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    tone = "muted",
    id,
    children,
  }: {
    tone?: FieldNoteTone;
    // Set where a control points at the note with `aria-describedby`.
    id?: string;
    children: Snippet;
  } = $props();
</script>

<p {id} class={["px-1 text-sm", TONES[tone]]}>
  {@render children()}
</p>
