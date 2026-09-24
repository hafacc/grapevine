"use client";

import type { ReactElement, ReactNode } from "react";

type FieldNoteTone = "muted" | "danger";

const TONES: Record<FieldNoteTone, string> = {
  muted: "text-muted",
  danger: "text-danger",
};

export default function FieldNote({
  tone = "muted",
  id,
  children,
}: {
  tone?: FieldNoteTone;
  // Set where a control points at the note with `aria-describedby`.
  id?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p id={id} className={`px-1 text-sm ${TONES[tone]}`}>
      {children}
    </p>
  );
}
