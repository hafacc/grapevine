import { grapevine } from "../utils/store.svelte";

// In-app confirm/alert replacing the browser's confirm()/alert(). The async
// API mirrors how a native action sheet (iOS) / dialog (Android) would be
// awaited, and the UI is a bottom sheet on mobile, a centered card on desktop.
// `dialog-host.svelte`, in the root layout, is what draws it.

type DialogTone = "default" | "danger";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type AlertOptions = {
  title: string;
  body?: string;
  okLabel?: string;
};

export type ActiveDialog =
  | {
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (confirmed: boolean) => void;
    }
  | { kind: "alert"; options: AlertOptions; resolve: () => void };

let active = $state.raw<ActiveDialog | null>(null);

/** The dialog showing, for the host to draw. */
export function activeDialog(): ActiveDialog | null {
  return active;
}

/** Asks a yes-or-no question and answers what was chosen. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    active = { kind: "confirm", options, resolve };
  });
}

/** Says something and waits for it to be dismissed. */
export function alert(options: AlertOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    active = { kind: "alert", options, resolve };
  });
}

/** Answers the dialog showing and takes it down. */
export function closeDialog(confirmed: boolean): void {
  const current = active;
  active = null;
  if (current?.kind === "confirm") current.resolve(confirmed);
  else if (current?.kind === "alert") current.resolve();
}

// Run a fire-and-forget async action (a report, removing a friend, a
// delete) so a policy refusing the write, or the network never answering,
// surfaces as a dialog instead of an unhandled rejection + a button that
// silently does nothing.
// A refusal from a locked account says nothing here: the locked screen
// replaces whatever the action was on.
export function run(
  action: () => Promise<unknown>,
  message = "something went wrong. please try again.",
): void {
  action().catch(async (error: unknown) => {
    console.error(error);
    const body = await grapevine.explainFailure(error, message);
    if (body !== null) void alert({ title: "that didn't work", body });
  });
}
