"use client";

import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";
import type { IconType } from "react-icons";
import { LuMinus, LuThumbsDown, LuThumbsUp } from "react-icons/lu";
import {
  glyphSide,
  type SwipeDirection,
  swipeOutcome,
} from "../../utils/swipe";
import type { RatingValue } from "../../utils/types";

// How far the row travels, and — at half of it — how far it has to go before
// letting go rates. A title bar or an attribute row is shallower, so the caller
// may say 96.
const TRAVEL = 104;

// Enough movement to be a swipe rather than a tap or the start of a scroll.
const ENGAGE = 8;

const GLYPHS = {
  up: LuThumbsUp,
  down: LuThumbsDown,
  minus: LuMinus,
} as const satisfies Record<string, IconType>;

const REVEALS = {
  yes: "bg-accent",
  no: "bg-danger",
  clear: "bg-clear",
} as const;

/**
 * A row that is rated by being swiped, which on a phone is the only way to rate
 * anything.
 *
 * The row moves horizontally and does nothing else: no rotation and no vertical
 * travel. This is a choice between two sides, not a card being thrown away, and
 * the borrowed card-deck motion would say the opposite.
 *
 * A drag is claimed only once it is more horizontal than vertical, so a swipe
 * that begins as a scroll stays a scroll and the list underneath keeps working.
 */
export default function SwipeRow({
  value,
  onRate,
  travel = TRAVEL,
  sides = "both",
  noGlyph = LuThumbsDown,
  className = "",
  children,
}: {
  value: RatingValue | null;
  onRate: (next: RatingValue | null) => void;
  travel?: number;
  // "no" moves only leftwards, for a row with nothing to say yes to; "yes"
  // only rightwards, for a switch that is off and has nothing to say no to.
  sides?: "both" | "no" | "yes";
  noGlyph?: IconType;
  // The row's own look, fill included. It goes on a layer inside the moving
  // card rather than on the card, whose `surface` is what stops the reveal
  // showing through: two background utilities on one element leave which of
  // them wins to the order of the stylesheet.
  className?: string;
  children: ReactNode;
}): ReactElement {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; engaged: boolean } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY, engaged: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const from = start.current;
    if (!from) return;
    const across = event.clientX - from.x;
    const down = event.clientY - from.y;
    if (!from.engaged) {
      // A gesture that reads as vertical is the scroller's, and giving it back
      // means letting go of it for good rather than watching for a later turn.
      if (Math.abs(down) > Math.abs(across)) {
        start.current = null;
        return;
      }
      if (Math.abs(across) < ENGAGE) return;
      from.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    setOffset(
      Math.max(
        sides === "yes" ? 0 : -travel,
        Math.min(sides === "no" ? 0 : travel, across),
      ),
    );
  }

  function onPointerEnd(): void {
    const engaged = start.current?.engaged ?? false;
    start.current = null;
    setDragging(false);
    if (engaged && Math.abs(offset) >= travel / 2) {
      const direction: SwipeDirection = offset > 0 ? "right" : "left";
      onRate(swipeOutcome(value, direction).next);
    }
    setOffset(0);
  }

  const direction: SwipeDirection = offset >= 0 ? "right" : "left";
  const outcome = swipeOutcome(value, direction);
  const Glyph = outcome.glyph === "down" ? noGlyph : GLYPHS[outcome.glyph];
  return (
    <div className={`relative ${REVEALS[outcome.reveal]}`}>
      <div
        aria-hidden="true"
        className={`absolute inset-0 flex items-center px-[30px] text-white ${
          glyphSide(direction) === "left" ? "justify-start" : "justify-end"
        }`}
      >
        <Glyph size={26} />
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{
          transform: `translateX(${offset}px)`,
          // Vertical panning stays the scroller's; horizontal is claimed above.
          touchAction: "pan-y",
          boxShadow: offset === 0 ? undefined : "var(--shadow-lift)",
        }}
        className={`relative bg-surface ${dragging ? "" : "transition-transform duration-150"}`}
      >
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}
