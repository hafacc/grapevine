"use client";

import type { ReactElement, ReactNode } from "react";
import type { IconType } from "react-icons";
import { useIsDesktop } from "../../utils/media";
import type { RatingValue } from "../../utils/types";
import SideButton from "./side-buttons";
import SwipeRow from "./swipe-row";

/**
 * Anything that can be rated in place: swiped at phone width, and at desktop
 * width the same row between the two buttons welded to its ends (DESIGN §1.8).
 *
 * The list and a thing's own screen both draw rows this way, and the rule for
 * which of the two a viewer gets lives here alone — in two copies it is the
 * kind of thing that stays in step until the day somebody changes one.
 */
export default function RateRow({
  subject,
  value,
  onRate,
  travel,
  sides = "both",
  noGlyph,
  frameClassName = "",
  contentClassName = "",
  children,
}: {
  // What the side buttons name, since a button with a glyph and no text says
  // nothing about which row it belongs to.
  subject: string;
  value: RatingValue | null;
  onRate: (next: RatingValue | null) => void;
  travel?: number;
  // "no" is a row with only the one answer: a swipe left, or at desktop width
  // the left button alone. "yes" is the mirror of it.
  sides?: "both" | "no" | "yes";
  // What the no side draws in place of the thumb, for a row where no is not a
  // rating.
  noGlyph?: IconType;
  // The whole row, side buttons included: its rule and, where the row carries
  // the viewer's own answer as a colour, its fill.
  frameClassName?: string;
  // Only the part a swipe moves, which is why padding belongs here: at desktop
  // width it must not push the buttons apart.
  contentClassName?: string;
  children: ReactNode;
}): ReactElement {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <div className={`flex shrink-0 items-stretch ${frameClassName}`}>
        {sides === "yes" ? null : (
          <SideButton
            side="left"
            subject={subject}
            value={value}
            onRate={onRate}
            noGlyph={noGlyph}
          />
        )}
        <div className={`min-w-0 flex-grow ${contentClassName}`}>
          {children}
        </div>
        {sides === "no" ? null : (
          <SideButton
            side="right"
            subject={subject}
            value={value}
            onRate={onRate}
          />
        )}
      </div>
    );
  } else {
    return (
      <div className="shrink-0">
        <SwipeRow
          value={value}
          onRate={onRate}
          travel={travel}
          sides={sides}
          noGlyph={noGlyph}
          className={`${frameClassName} ${contentClassName}`}
        >
          {children}
        </SwipeRow>
      </div>
    );
  }
}
