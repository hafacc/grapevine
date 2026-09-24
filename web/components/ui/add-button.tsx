"use client";

import type { ReactElement } from "react";
import { LuPlus } from "react-icons/lu";

/**
 * The line above the field that adds whatever was typed.
 *
 * Deliberately the quietest thing on the screen: it is available on every
 * keystroke rather than only when nothing matched — identity is by folded name,
 * so an add that collides is a find — and it must not compete with the results
 * it sits over.
 */
export default function AddButton({
  label,
  onTap,
}: {
  label: string;
  onTap: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onTap}
      className="font-display flex h-[40px] w-full items-center gap-2 rounded-sm border border-dashed border-border bg-surface px-3 text-left text-[15px] font-medium whitespace-nowrap text-muted"
    >
      <LuPlus size={16} aria-hidden="true" className="shrink-0" />
      {/* Its own span, for the reason the chip's label is: an ellipsis never
          reaches the text of a flex container. */}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
