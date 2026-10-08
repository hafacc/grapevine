import { onMount } from "svelte";
import { asThemeChoice, THEME_KEY, type ThemeChoice } from "./theme";

const DARK = "(prefers-color-scheme: dark)";

// "system" until `startTheme` has read the stored choice, which is also what a
// prerendered page is drawn with.
let choice = $state<ThemeChoice>("system");
let systemDark = $state(false);
let started = $state(false);

function resolve(): "light" | "dark" {
  if (choice === "system") return systemDark ? "dark" : "light";
  else return choice;
}

/**
 * Puts the resolved theme on `<html>` as a class, which is what
 * `src/app.css` keys the dark palette on, and as `color-scheme`, which is what
 * the browser draws its own controls and scrollbars by.
 */
function apply(): void {
  const root = document.documentElement;
  const resolved = resolve();
  // Every transition is switched off for the swap: a palette that fades in is
  // forty elements each arriving at its own pace.
  const still = document.createElement("style");
  still.textContent =
    "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}";
  document.head.append(still);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  // Read, so the styles above are applied before the transitions come back.
  void window.getComputedStyle(document.body).opacity;
  setTimeout(() => still.remove(), 1);
}

/**
 * Follows the stored choice, the system's preference and other tabs. Called
 * once, while the root layout is being set up. The first paint is not this
 * function's: the script in `src/app.html` has already put the class on.
 */
export function startTheme(): void {
  onMount(() => {
    const query = window.matchMedia(DARK);
    systemDark = query.matches;
    try {
      choice = asThemeChoice(window.localStorage.getItem(THEME_KEY));
    } catch {
      // Storage refused: the system's preference is the choice.
    }
    started = true;
    apply();

    const onSystem = (): void => {
      systemDark = query.matches;
      if (choice === "system") apply();
    };
    // A choice made in another tab of the same browser.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== THEME_KEY) return;
      choice = asThemeChoice(event.newValue);
      apply();
    };
    query.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      query.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  });
}

/** The theme: a three-state choice, and what it comes to on this device. */
export const theme = {
  get choice(): ThemeChoice {
    return choice;
  },
  // Undefined until the stored choice has been read.
  get resolved(): "light" | "dark" | undefined {
    return started ? resolve() : undefined;
  },
  set(next: ThemeChoice): void {
    choice = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Kept for this visit only.
    }
    apply();
  },
};
