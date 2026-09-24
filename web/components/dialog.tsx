"use client";

import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DAILY_LIMIT_MESSAGE, isDailyLimit } from "../utils/supabase";
import Button from "./ui/button";
import Sheet from "./ui/sheet";

// In-app confirm/alert replacing the browser's confirm()/alert(). The async
// API mirrors how a native action sheet (iOS) / dialog (Android) would be
// awaited, and the UI is a bottom sheet on mobile, a centered card on desktop.

type DialogTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type AlertOptions = {
  title: string;
  body?: ReactNode;
  okLabel?: string;
};

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}

// Run a fire-and-forget async action (accepting an ask, removing a friend, a
// delete) so a policy refusing the write, or the network never answering,
// surfaces as a dialog instead of an unhandled rejection + a button that
// silently does nothing. Returns a void-returning handler suitable for onClick.
export function useAction(): (
  action: () => Promise<unknown>,
  message?: string,
) => void {
  const { alert } = useDialog();
  return useCallback(
    (action, message = "something went wrong. please try again.") => {
      action().catch((error: unknown) => {
        console.error(error);
        void alert({
          title: "that didn't work",
          body: isDailyLimit(error) ? DAILY_LIMIT_MESSAGE : message,
        });
      });
    },
    [alert],
  );
}

type ActiveDialog =
  | {
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (confirmed: boolean) => void;
    }
  | { kind: "alert"; options: AlertOptions; resolve: () => void };

export default function DialogProvider({
  children,
}: PropsWithChildren): ReactElement {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setActive({ kind: "confirm", options, resolve });
      }),
    [],
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        setActive({ kind: "alert", options, resolve });
      }),
    [],
  );

  const close = useCallback((confirmed: boolean) => {
    setActive((current) => {
      if (current?.kind === "confirm") current.resolve(confirmed);
      else if (current?.kind === "alert") current.resolve();
      return null;
    });
  }, []);

  // Enter confirms; Escape/backdrop dismissal is handled by the Sheet.
  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Enter") close(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {active ? <DialogView active={active} onClose={close} /> : null}
    </DialogContext.Provider>
  );
}

function DialogView({
  active,
  onClose,
}: {
  active: ActiveDialog;
  onClose: (confirmed: boolean) => void;
}): ReactElement {
  const danger = active.kind === "confirm" && active.options.tone === "danger";
  const primaryLabel =
    active.kind === "confirm"
      ? (active.options.confirmLabel ?? "confirm")
      : (active.options.okLabel ?? "ok");

  return (
    <Sheet open onClose={() => onClose(false)} title={active.options.title}>
      {active.options.body ? (
        <div className="text-[0.9375rem] text-muted">{active.options.body}</div>
      ) : null}
      <div className="flex justify-end gap-2 pt-5">
        {active.kind === "confirm" ? (
          <Button variant="ghost" onClick={() => onClose(false)}>
            {active.options.cancelLabel ?? "cancel"}
          </Button>
        ) : null}
        <Button
          variant={danger ? "dangerSolid" : "primary"}
          autoFocus
          onClick={() => onClose(true)}
        >
          {primaryLabel}
        </Button>
      </div>
    </Sheet>
  );
}
