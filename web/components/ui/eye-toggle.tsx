"use client";

import type { ReactElement } from "react";
import { LuEye, LuEyeOff } from "react-icons/lu";

/**
 * Hides the rows the viewer has already answered — things in the list,
 * attributes on a thing's screen.
 *
 * The icon changes and not only the colour: a toggle whose only state is a tint
 * is unreadable to anyone who cannot see the tint, and this one is load-bearing
 * on two screens.
 */
export default function EyeToggle({
  hiding,
  onToggle,
  label,
}: {
  hiding: boolean;
  onToggle: () => void;
  // What is being hidden differs per screen, so the sentence is the caller's.
  label: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={hiding}
      onClick={onToggle}
      className={`flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm border ${
        hiding
          ? "border-accent bg-accent-soft text-accent-ink"
          : "border-border bg-surface text-muted"
      }`}
    >
      {hiding ? <LuEyeOff size={20} /> : <LuEye size={20} />}
    </button>
  );
}
