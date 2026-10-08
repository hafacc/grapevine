// The only way to open the install dialog yourself, and Chrome hands it over
// once.
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let waiting = $state.raw<InstallPrompt | null>(null);

// Safari offers no equivalent event: an iPhone installs through Share → Add to
// Home Screen and nothing can trigger that from a page. Detected so the menu
// can say how instead of offering a button that cannot work. `MSStream` rules
// out old Edge, which lied about being iOS.
function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // An iPad reports a MACINTOSH user agent by default, and has done since
  // iPadOS 13 — so the obvious test misses every iPad and the row simply
  // vanishes for them, on a device where Add to Home Screen is right there. A
  // Mac with a touchscreen is what tells them apart, and there is no such Mac.
  const touch = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return (
    (/iPad|iPhone|iPod/.test(ua) || touch) &&
    !("MSStream" in window) &&
    /Safari/.test(ua) &&
    !/CriOS|FxiOS/.test(ua)
  );
}

// Already installed, so there is nothing to offer. Both halves are needed: the
// media query answers on Android and desktop, `standalone` is Safari's own.
function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

// Chrome can fire `beforeinstallprompt` before any module has loaded, and does
// not replay it, so the first listener is the script in `src/app.html`, which
// holds the event on `window`. It is always held, so installing only happens
// when someone asks: Chrome shows its own banner whenever it likes, which is
// nagging where we mean to offer. What it caught is taken here, and the
// listeners below, at module scope and not in an effect, catch a later one.
if (typeof window !== "undefined") {
  waiting =
    (window.grapevineInstallPrompt as InstallPrompt | undefined) ?? null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    waiting = event as InstallPrompt;
  });
  window.addEventListener("appinstalled", () => {
    waiting = null;
  });
}

/** Whether grapevine can be installed from here, and the way to do it. */
export const install = {
  // A real prompt is available, so the control can be a button.
  get ready(): boolean {
    return !isInstalled() && waiting !== null;
  },
  // No prompt will ever come, but it CAN be installed by hand.
  get byHand(): boolean {
    return !isInstalled() && isApple();
  },
  async prompt(): Promise<void> {
    const held = waiting;
    if (!held) return;
    try {
      await held.prompt();
    } catch (error) {
      // Refused rather than shown — no user gesture behind the call, say —
      // which leaves the event unspent, so it is kept and the row stays.
      console.warn("install", error);
      return;
    }
    // Shown, so it is spent: a second `prompt()` on the same event throws,
    // and only a fresh `beforeinstallprompt` can offer again.
    waiting = null;
  },
};
