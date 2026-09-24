"use client";

import type { ReactElement } from "react";
import type { IconType } from "react-icons";
import { LuMinus, LuThumbsDown, LuThumbsUp } from "react-icons/lu";
import { type SwipeDirection, swipeOutcome } from "../../utils/swipe";
import type { RatingValue } from "../../utils/types";

/**
 * One end of a row at desktop width, welded to it with no gap and no radius: no
 * on the left, yes on the right.
 *
 * It replaces the swipe and nothing else — the rest of the desktop is the phone
 * layout in a column. The side matching the viewer's current rating goes muted
 * with a minus, because pressing it clears, which is the same rule the swipe
 * follows.
 */
export default function SideButton({
  side,
  subject,
  value,
  onRate,
  noGlyph: NoGlyph = LuThumbsDown,
}: {
  side: SwipeDirection;
  subject: string;
  value: RatingValue | null;
  onRate: (next: RatingValue | null) => void;
  noGlyph?: IconType;
}): ReactElement {
  const outcome = swipeOutcome(value, side);
  const clears = outcome.next === null;
  const yes = side === "right";
  const tone = clears
    ? "bg-surface-muted text-muted"
    : yes
      ? "bg-accent-soft text-accent-ink"
      : "bg-danger-soft text-danger-ink";
  return (
    <button
      type="button"
      aria-label={`${yes ? "yes" : "no"} to ${subject}`}
      aria-pressed={clears}
      onClick={() => onRate(outcome.next)}
      className={`flex w-[56px] shrink-0 items-center justify-center focus-visible:outline-offset-[-2px] ${tone}`}
    >
      {clears ? (
        <LuMinus size={20} />
      ) : yes ? (
        <LuThumbsUp size={20} />
      ) : (
        <NoGlyph size={20} />
      )}
    </button>
  );
}
