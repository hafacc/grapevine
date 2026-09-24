"use client";

import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

// With `dismissable` false there is no drag handle either, since a handle is a
// promise that the sheet can be pulled away.
//
// It renders through a PORTAL onto <body>, which is not decoration: `fixed`
// resolves against the viewport only while no ancestor is a containing block,
// and a transform, a filter, `backdrop-filter` or `will-change` makes one — a
// sheet opened from inside such an ancestor collapses into it. A modal must not
// be positioned by whatever happens to contain the button that opened it.
// Events still reach the caller — a portal moves the DOM node, not the React
// tree.
export default function Sheet({
  open,
  onClose,
  dismissable = true,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  dismissable?: boolean;
  title?: ReactNode;
  children: ReactNode;
}): ReactNode {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && dismissable) onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, dismissable]);

  // `document` is absent while the static export is rendered; `open` is false
  // there anyway, so this only guards the type.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {dismissable ? (
        <button
          type="button"
          aria-label="dismiss"
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        />
      ) : (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className="relative flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-sm bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-panel sm:max-w-md sm:rounded-sm sm:pb-5"
      >
        {dismissable ? (
          <span className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-sm bg-surface-hover sm:hidden" />
        ) : null}
        {title ? (
          <h2 className="font-display mb-4 text-[22px] leading-tight font-semibold">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
