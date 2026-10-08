// What is stored is "system" | "light" | "dark"; the toggle cycles through them.
export type ThemeChoice = "system" | "light" | "dark";

// A key of its own: local storage is per origin, and a bare `theme` would be
// one setting shared with anything else ever served from it. `src/app.html`
// reads the same key before the first paint.
export const THEME_KEY = "grapevine-theme";

const THEME_ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function asThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function nextThemeChoice(current: ThemeChoice): ThemeChoice {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
}

export function themeLabel(current: ThemeChoice): string {
  return THEME_LABEL[current];
}
