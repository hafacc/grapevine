"use client";

import { type ReactElement, useEffect, useState } from "react";
import { FaGoogle } from "react-icons/fa";
import { LuLoaderCircle } from "react-icons/lu";
import { authErrorMessage } from "../utils/auth";
import { useGrapevine } from "../utils/store";
import { useDialog } from "./dialog";
import Button from "./ui/button";

// Remedy-shaped: `authErrorMessage` ends at "something went wrong. try again."
// for most codes, which tells nobody what to do differently. Its specific cases
// still speak.
function shownMessage(caught: unknown): string {
  const mapped = authErrorMessage(caught);
  return mapped === "something went wrong. try again."
    ? "couldn't get you in. try that again."
    : mapped;
}

// The door — the whole of it, and there is only one. Nothing here says sign in
// or sign up: the same tap works whether or not we have met this account, so
// there is no question to answer and no wrong door to pick.
//
// It owns the CARD as well as the button, so that the standing notice under the
// card and the error that replaces it are one node rather than the same string
// synchronised into two components. `notice` is what that line says when
// nothing is wrong.
export default function AuthPanel({
  notice,
}: {
  notice: string;
}): ReactElement {
  const { configured, signIn, signInError } = useGrapevine();
  const { alert } = useDialog();
  const [busy, setBusy] = useState(false);
  // Seeded from the round trip, because a refused or cancelled Google sign-in
  // comes back as a page load rather than as a rejected promise, and otherwise
  // shows the door again as though nothing had been tried.
  const [error, setError] = useState<string | null>(() =>
    signInError === null ? null : shownMessage({ code: signInError }),
  );
  // And followed: a code exchange that failed or never answered is known only
  // after this screen is already up.
  useEffect(() => {
    if (signInError !== null) setError(shownMessage({ code: signInError }));
  }, [signInError]);

  async function run(): Promise<void> {
    if (!configured) {
      await alert({
        title: "sign-in isn't set up yet",
        body: "create a supabase project, enable google sign-in, and give this build its URL and anon key to continue.",
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (caught) {
      console.error(caught);
      setError(shownMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* No heading and no label. A single Continue button is self-evidently
          the way in, and "no sign-up, no password" is said by the absence of a
          toggle and a password field rather than by a line claiming it. */}
      <div className="w-full max-w-sm rounded-sm bg-surface p-6 text-left shadow-panel">
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={run}
        >
          {busy ? (
            <LuLoaderCircle className="animate-spin" />
          ) : (
            <>
              <FaGoogle />
              continue with google
            </>
          )}
        </Button>
      </div>
      {/* The card's caption, and the height belongs to the slot rather than to
          the copy: the notice's own two lines are reserved whether it or an
          error is speaking, so a problem appearing, changing or clearing never
          moves the card above it. The page is a centred column, so anything
          that changes height here re-centres and shifts the door itself.

          One line of error is a budget rather than a hope, pinned by
          `tests/auth-copy.test.ts`. */}
      <p
        aria-live="polite"
        className={`max-w-sm min-h-10 text-sm leading-5 ${error ? "text-danger" : "text-muted"}`}
      >
        {error ?? notice}
      </p>
    </>
  );
}
