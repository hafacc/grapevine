"use client";

import type { ReactElement } from "react";
import type { IconType } from "react-icons";
import { useIsDesktop } from "../../utils/media";
import SwipeRow from "./swipe-row";

/**
 * A row that is one action and nothing else: tapped or clicked anywhere, or
 * swiped right at phone width, with the action's word behind the swipe as on
 * the link row. At desktop width there is no side button: the whole row is
 * the button, so a second target for the same thing would be two.
 */
export default function ActionRow({
  label,
  word,
  icon,
  onAct,
  dataRow,
}: {
  label: string;
  word: string;
  icon: IconType;
  onAct: () => void;
  dataRow: string;
}): ReactElement {
  const desktop = useIsDesktop();
  const row = (
    <button
      type="button"
      data-row={dataRow}
      onClick={onAct}
      className="flex min-h-[56px] w-full items-center bg-surface px-4 py-2.5 text-left text-[16px] text-text hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
    >
      {label}
    </button>
  );
  if (desktop) {
    return row;
  } else {
    return (
      <SwipeRow
        value={null}
        onRate={onAct}
        sides="yes"
        labels={{ yes: { word, icon } }}
      >
        {row}
      </SwipeRow>
    );
  }
}
