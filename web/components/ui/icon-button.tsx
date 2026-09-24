"use client";

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

// `label` is both the tooltip and the accessible name, since the visible
// content is just an icon.
export default function IconButton({
  label,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-sm text-muted transition hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
