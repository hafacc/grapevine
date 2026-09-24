"use client";

import type { ReactElement } from "react";
import { LuSearch } from "react-icons/lu";

/**
 * The only text input in the product, and it is always at the bottom: on the
 * list it searches and adds, on a thing's screen it filters attributes and adds
 * one, on the people screen it filters people and asks a handle to connect.
 *
 * With a query the border and the magnifier take the accent, so the screen says
 * it is filtered without a word for it.
 */
export default function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  // Also the field's accessible name: what it searches differs per screen, and
  // saying it twice is what would drift.
  placeholder: string;
}): ReactElement {
  const filled = value.length > 0;
  // The focus ring goes round the label, which is the box a reader sees, and is
  // drawn over its border rather than outside it: offset outward, the border and
  // the ring read as two rectangles.
  return (
    <label
      className={`flex h-[44px] min-w-0 flex-grow items-center gap-3 rounded-sm border bg-surface px-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-1 has-[input:focus-visible]:outline-accent ${
        filled ? "border-accent" : "border-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex shrink-0 ${filled ? "text-accent-ink" : "text-muted"}`}
      >
        <LuSearch size={18} />
      </span>
      <span className="sr-only">{placeholder}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-grow border-0 bg-transparent text-[16px] text-text outline-none placeholder:text-muted"
      />
    </label>
  );
}
