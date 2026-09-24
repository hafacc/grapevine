"use client";

import type { ReactElement } from "react";
import AuthPanel from "./auth-panel";
import SiteFooter from "./site-footer";
import ThemeButton from "./theme-button";
import Wordmark from "./wordmark";

// Everyone who belongs here was invited by a person, so there is nobody to
// persuade. The page confirms that this is the thing their friend meant and gets
// out of the way: one screen, one object to act on, nothing to scroll past. The
// smallness is the argument — a feature list would be selling something the
// visitor was already given.
//
// Pure render, deliberately: it never touches the fragment, so someone who
// opened a link to a screen while signed out lands on that screen the moment the
// door opens, off the stack the store already seeded.
export default function WelcomeScreen(): ReactElement {
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
            what to eat, watch and read — from the people you already know.
          </p>
        </div>

        {/* The card AND the line under it, because that line is also where a
            problem with the field is said — one node, so the two can never
            disagree about how tall they are. */}
        <AuthPanel notice="nothing here is public, and nothing ever shows who rated what." />
      </main>

      <SiteFooter className="px-4 pb-8" />
    </div>
  );
}
