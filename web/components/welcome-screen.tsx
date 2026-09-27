"use client";

import type { ReactElement } from "react";
import { TRUST_MEANS } from "../utils/invites";
import { useGrapevine } from "../utils/store";
import AuthPanel from "./auth-panel";
import Avatar from "./avatar";
import SiteFooter from "./site-footer";
import ThemeButton from "./theme-button";
import Wordmark from "./wordmark";

// Everyone who belongs here was invited by a person, so there is nobody to
// persuade. The page confirms that this is the thing their friend meant and gets
// out of the way: one screen, one object to act on, nothing to scroll past. The
// smallness is the argument — a feature list would be selling something the
// visitor was already given.
//
// It never touches the fragment, so someone who opened a link to a screen while
// signed out lands on that screen the moment the door opens, off the stack the
// store already seeded.
export default function WelcomeScreen(): ReactElement {
  // A friending link names its owner here, before sign-in: the link is the
  // authority to see their name and photo, and the question after sign-in
  // (`invite-gate.tsx`) is the consent. Nothing is said about a link until the
  // lookup answers. A dead one is said here, before anybody goes through Google
  // for it, and names nobody: the lookup answered nothing to name.
  const { inviteFrom } = useGrapevine();
  const from = inviteFrom ? inviteFrom.displayName || "someone" : null;
  return (
    // The app's column, unruled: the theme control sits at its edge rather than
    // the screen's (DESIGN-UI, "Layout").
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
      <div className="flex justify-end p-4">
        <ThemeButton />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Wordmark size="lg" />
          <p className="max-w-xs text-[0.9375rem] text-muted">
            what to eat, watch, read and more, from the people you trust
          </p>
        </div>

        {inviteFrom ? (
          <div className="flex items-center gap-3 text-left">
            <Avatar
              name={inviteFrom.displayName}
              photoURL={inviteFrom.photoURL}
              size={48}
            />
            <p className="text-[17px] font-medium [overflow-wrap:anywhere]">
              sign in to add {from} to your vine
            </p>
          </div>
        ) : inviteFrom === null ? (
          <p className="max-w-xs text-[17px] font-medium">
            this link is invalid or expired. ask whoever sent it for a new one.
          </p>
        ) : null}

        {/* The card AND the line under it, because that line is also where a
            problem with the field is said — one node, so the two can never
            disagree about how tall they are. */}
        <AuthPanel
          label={inviteFrom ? "continue with google" : "sign in"}
          notice={
            inviteFrom
              ? TRUST_MEANS
              : "grapevine is invite-only. ask someone for the link to their vine."
          }
        />
      </main>

      <SiteFooter className="px-4 pb-8" />
    </div>
  );
}
