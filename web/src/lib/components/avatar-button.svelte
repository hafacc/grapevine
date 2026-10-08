<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import Avatar from "./avatar.svelte";

  /**
   * The viewer's own avatar, which is the only way to the people screen. The
   * list's top bar and a thing's title bar both carry it.
   */
  let {
    // Drawn on an `accent-soft` bar — a thing rated yes — where the avatar's own
    // `accent-soft` fill would vanish into it.
    onAccent = false,
  }: { onAccent?: boolean } = $props();
</script>

<button
  type="button"
  aria-label="you and your vine"
  onclick={() => grapevine.navigate({ kind: "people" })}
  class="flex h-[44px] w-[44px] shrink-0 items-center justify-center focus-visible:outline-offset-[-2px]"
>
  <Avatar
    name={grapevine.profile?.displayName ?? ""}
    photoURL={grapevine.profile?.photoURL ?? null}
    fill={onAccent ? "surface" : "soft"}
  />
</button>
