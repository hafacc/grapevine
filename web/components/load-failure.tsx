"use client";

import type { ReactElement } from "react";
import Button from "./ui/button";

/**
 * A read that failed, said out loud on the screen that was waiting for it.
 *
 * The same shape as `StaleDataNotice` and `Unreachable` in `app/page.tsx`, and
 * for the same reason: a client cannot talk a server out of a refusal, so this
 * is disclosure and a reload rather than a retry button that cannot win. The
 * alternative is worse than silence — an empty list drawn as "you have nothing
 * yet", which reads as a fact about the viewer rather than about the network.
 *
 * `subject` finishes "grapevine couldn't load …", so it is a noun phrase in the
 * second person: "your recommendations", "your ratings".
 */
export default function LoadFailure({
  subject,
}: {
  subject: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-[15px] text-muted">
        grapevine couldn't load {subject}, so this screen is incomplete. nothing
        is lost.
      </p>
      <Button
        variant="secondary"
        onClick={() => window.location.reload()}
        className="shrink-0"
      >
        reload
      </Button>
    </div>
  );
}
