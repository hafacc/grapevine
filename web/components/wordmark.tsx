import type { CSSProperties, ReactElement } from "react";
// The drawing itself, not a copy of its geometry: `docs/mark.svg` is the source
// (web/DESIGN-UI.md, "The mark"), and a second copy is one that can disagree
// about which hexagon is bigger.
import markDrawing from "../../docs/mark.svg";

// A mask, so the bunch takes the theme's accent: an <img> would paint the
// file's own light-theme teal on the dark canvas too, and inlining the SVG would
// put its clip-path ids on the page once per copy.
const markMask: CSSProperties = {
  maskImage: `url(${markDrawing.src})`,
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
};

function Bunch({ className }: { className: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-accent ${className}`}
      style={markMask}
    />
  );
}

// The mark standing on its own — what the splash draws while the session
// restores, and what sits over an empty feed. One source, so it cannot drift
// from the wordmark below.
export function Mark({
  // Only the splash pulses: the same beat over a feed that has finished loading
  // says something is still on its way.
  pulsing = false,
}: {
  pulsing?: boolean;
} = {}): ReactElement {
  return <Bunch className={`h-12 w-12 ${pulsing ? "animate-pulse" : ""}`} />;
}

// The wordmark: the mark beside "grapevine" in the condensed face. One source
// of truth for the lockup — the header, the sign-in screen and the written
// pages all render this.
export default function Wordmark({
  size = "md",
}: {
  size?: "md" | "lg";
}): ReactElement {
  const bunch = size === "lg" ? "h-9 w-9" : "h-[22px] w-[22px]";
  const word = size === "lg" ? "text-2xl" : "text-[22px]";
  return (
    <span className="inline-flex items-center gap-2">
      <Bunch className={bunch} />
      <span className={`font-display font-semibold tracking-[0.01em] ${word}`}>
        grapevine
      </span>
    </span>
  );
}
