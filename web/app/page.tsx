"use client";

import type { ReactElement } from "react";
import EntityView from "../components/entity-view";
import FeedView from "../components/feed-view";
import PeopleView from "../components/people-view";
import Button from "../components/ui/button";
import WelcomeScreen from "../components/welcome-screen";
import { Mark } from "../components/wordmark";
import { useGrapevine } from "../utils/store";
import type { Screen } from "../utils/types";

// Three screens (DESIGN §1). Each one fills the height it is given and carries
// its own top bar, its own scroller and its own bottom field, so there is no
// frame here to keep in step with three layouts.
function CurrentScreen({ screen }: { screen: Screen }): ReactElement {
  switch (screen.kind) {
    case "list":
      return <FeedView />;
    case "item":
      return <EntityView itemId={screen.id} />;
    case "people":
      return <PeopleView />;
  }
}

// Reload rather than a retry button: the store has already retried and given up,
// and a reload is what re-runs auth from scratch, which covers the likeliest
// causes. A client cannot talk a server out of a refusal, so this is disclosure.
function StaleDataNotice(): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
      <p className="min-w-0 flex-1 text-[15px] text-muted">
        grapevine stopped receiving updates, so this screen may be out of date.
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

// In place of the splash once the profile gate has given up — the splash claims
// something is still on its way. Deliberately BEHIND the gate: the other reading
// of an unanswered profile is "no profile", which is onboarding and an overwrite.
// Nothing here is terminal: a late answer opens the gate and this unmounts itself.
function Unreachable(): ReactElement {
  const { signOut } = useGrapevine();

  async function doSignOut() {
    try {
      await signOut();
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-heading text-[19px]">
        can't reach grapevine right now
      </h1>
      <p className="text-[15px] text-muted">
        nothing is lost — this device just can't get through to grapevine. check
        your connection and try again.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => window.location.reload()}>
          try again
        </Button>
        {/* A session the server refuses outright — a disabled account, a
            revoked token — lands here too, and reloading hits the same wall. */}
        <Button variant="ghost" onClick={doSignOut}>
          sign out
        </Button>
      </div>
    </div>
  );
}

function Splash(): ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Mark pulsing />
    </div>
  );
}

export default function Page(): ReactElement {
  const {
    authReady,
    listenersLost,
    user,
    profileReady,
    profileUnreachable,
    screen,
  } = useGrapevine();

  if (!authReady) return <Splash />;
  if (!user) return <WelcomeScreen />;
  if (!profileReady) return profileUnreachable ? <Unreachable /> : <Splash />;

  // The whole app is one 720 px column at desktop width, bars and all, with a
  // rule down each side and the bare canvas beyond it (DESIGN-UI, "Layout").
  // A bar that spanned the screen would put the back button and the avatar a
  // screen's width away from the list they act on.
  return (
    <div className="mx-auto flex h-dvh w-full max-w-[720px] flex-col md:border-x md:border-border">
      {listenersLost ? <StaleDataNotice /> : null}
      {/* A flex column, because a screen fills the height it is given: one says
          so with `h-full` and another with `flex-1`, and both need a parent
          that has a height to give. */}
      <div className="flex min-h-0 flex-grow flex-col">
        <CurrentScreen screen={screen} />
      </div>
    </div>
  );
}
