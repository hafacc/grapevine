"use client";

import type { ButtonHTMLAttributes, ReactElement } from "react";

// DESIGN-UI, "Buttons". `dangerSolid` is the dialog's destructive confirm.
type ButtonVariant = "primary" | "secondary" | "dangerSolid" | "ghost";
type ButtonSize = "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-on hover:opacity-90",
  secondary:
    "border border-border bg-surface-muted text-text hover:bg-surface-hover",
  dangerSolid: "bg-danger text-white hover:opacity-90",
  ghost: "text-muted hover:bg-surface-hover hover:text-text",
};

const SIZES: Record<ButtonSize, string> = {
  md: "h-[44px] px-4 text-[17px]",
  lg: "h-[44px] px-5 text-[17px]",
};

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): ReactElement {
  return (
    <button
      type={type}
      className={`font-display inline-flex items-center justify-center gap-1.5 rounded-sm font-semibold tracking-[0.02em] transition disabled:pointer-events-none disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
