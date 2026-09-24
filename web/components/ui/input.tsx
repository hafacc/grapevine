"use client";

import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";

// `invalid` reddens the box so it and the message under it read as one object;
// it lives here rather than beside any one caller because every field that can
// be complained about is this same input.
export default function Input({
  prefix,
  invalid = false,
  className = "",
  ...props
  // `ComponentPropsWithRef` rather than `InputHTMLAttributes` so a caller can
  // hold the element — React 19 passes `ref` through as an ordinary prop. Its
  // `prefix` (an RDFa attribute, meaningless on an input) is dropped, or the
  // adornment below would be typed as a string and refuse an icon.
}: Omit<ComponentPropsWithRef<"input">, "prefix"> & {
  prefix?: ReactNode;
  invalid?: boolean;
}): ReactElement {
  // 16px text: below that iOS Safari zooms the page on focus.
  const base =
    "h-[44px] w-full rounded-sm border bg-surface text-base outline-none transition";
  const tone = invalid
    ? "border-danger focus:border-danger"
    : "border-border focus:border-accent";
  // Always the same tree, adorned or not. Branching on `prefix` would give the
  // input two different positions in the element tree, so an adornment that
  // comes and goes — one shown only while the field is empty, say — would
  // REMOUNT the input on the first keystroke and drop focus to the body. On a
  // phone that closes the keyboard after one character.
  return (
    <div className="relative w-full">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">
          {prefix}
        </span>
      ) : null}
      <input
        aria-invalid={invalid || undefined}
        className={`${base} ${tone} ${prefix ? "pl-8" : "pl-3.5"} pr-3.5 ${className}`}
        {...props}
      />
    </div>
  );
}
