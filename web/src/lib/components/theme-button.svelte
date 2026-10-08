<script lang="ts">
  import { nextThemeChoice, themeLabel } from "../utils/theme";
  import { theme } from "../utils/theme.svelte";
  import Icon from "./ui/icon.svelte";
  import IconButton from "./ui/icon-button.svelte";
  import { LuMonitor, LuMoon, LuSun } from "./ui/icons";

  // "system" until the stored choice has been read, so the prerendered markup
  // and the first draw in the browser match.
  const current = $derived(theme.choice);
  const icon = $derived(
    current === "dark" ? LuMoon : current === "light" ? LuSun : LuMonitor,
  );
</script>

<IconButton
  label={`${themeLabel(current)} theme`}
  onclick={() => theme.set(nextThemeChoice(current))}
>
  <Icon {icon} />
</IconButton>
