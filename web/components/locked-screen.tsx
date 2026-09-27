"use client";

import { type ReactElement, useState } from "react";
import { heldLink } from "../utils/invites";
import { useGrapevine } from "../utils/store";
import DeleteAccountLine from "./delete-account";
import SiteFooter from "./site-footer";
import ThemeButton from "./theme-button";
import Button from "./ui/button";
import { Mark } from "./wordmark";

/**
 * What an account with no connection sees instead of the list (0010): the
 * server refuses every write it could make, so there is nothing here to write
 * with. It unlocks by accepting someone's live link, which `link-question`
 * asks in its place when this device holds one.
 */
export default function LockedScreen(): ReactElement {
  const {
    inviteToken,
    inviteFrom,
    inviteLookupFailed,
    retryInviteLookup,
    signOut,
  } = useGrapevine();
  const [leaving, setLeaving] = useState(false);

  async function leave(): Promise<void> {
    setLeaving(true);
    try {
      await signOut();
    } catch (error) {
      console.error(error);
      setLeaving(false);
    }
  }

  const link = heldLink(inviteToken, inviteFrom, inviteLookupFailed);
  let content: ReactElement;
  if (link === "checking") {
    content = <Mark pulsing />;
  } else {
    content = (
      <>
        <Mark />
        <h1 className="font-heading text-[22px]">your account is locked</h1>
        <p className="text-[15px] text-muted">
          {link === "dead"
            ? "that link is invalid or expired. ask whoever sent it for a new one."
            : link === "unchecked"
              ? "couldn't check that link. check your connection and try again."
              : "it unlocks when you add someone to your vine with their link. ask someone for theirs."}
        </p>
        {link === "unchecked" ? (
          <Button size="lg" className="w-full" onClick={retryInviteLookup}>
            try again
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={leaving}
          onClick={() => void leave()}
        >
          sign out
        </Button>
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
      <div className="flex justify-end p-4">
        <ThemeButton />
      </div>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        {content}
      </main>
      <div className="mx-auto w-full max-w-md">
        <DeleteAccountLine />
      </div>
      <SiteFooter className="px-4 pt-6 pb-8" />
    </div>
  );
}
