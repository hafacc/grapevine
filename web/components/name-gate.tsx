"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { useGrapevine } from "../utils/store";
import { validateDisplayName } from "../utils/username";
import Button from "./ui/button";
import Input from "./ui/input";
import Sheet from "./ui/sheet";

// One sheet, for one rare account: Google supplies a name with the identity, so
// this opens only for a Google account that carries none at all. Everyone else
// arrives named and never sees it.
//
// There is no "hold this action until they have a name" path, and there cannot
// usefully be one: `Sheet` is a modal portal over a scrim, so from the moment a
// nameless profile is ready nothing behind it can be tapped. The gate is the
// screen, not a wrapper other screens call into.
export default function NameGateProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { profile, profileReady, updateDisplayName } = useGrapevine();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without it they land in the app permanently nameless, and every screen that
  // puts their name in front of someone else shows a blank. So there is no way
  // out but the field: the scrim and Escape close nothing.
  const open = profileReady && !profile?.displayName;

  const invalid = name ? validateDisplayName(name) : null;
  const problem = invalid ?? error;

  async function submit(): Promise<void> {
    if (validateDisplayName(name)) return;
    setBusy(true);
    setError(null);
    try {
      await updateDisplayName(name.trim());
    } catch (caught) {
      console.error(caught);
      setError("couldn't save that. check your connection.");
    }
    setBusy(false);
  }

  return (
    <>
      {children}
      <Sheet
        open={open}
        onClose={() => undefined}
        dismissable={false}
        title="what should we call you?"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            autoComplete="name"
            autoFocus
            invalid={Boolean(invalid)}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="your name"
          />

          {/* One line, under the field and over the button, saying why anyone
              is being asked at all — sign-in carries a name for everybody else.
              Rendered whether or not it has anything to say, because a bottom
              sheet grows UPWARD: a message that APPEARS rather than swapping
              shoves the field out from under the thumb typing into it. One line
              is enough for both — every string this slot can hold measures one
              at the sheet's 350px, which is what the budget in
              `tests/auth-copy.test.ts` keeps true. */}
          <p
            aria-live="polite"
            className={`min-h-5 text-sm leading-5 ${problem ? "text-danger" : "text-muted"}`}
          >
            {problem ?? "google didn't share a name. type one."}
          </p>

          <Button
            type="submit"
            size="lg"
            disabled={busy || Boolean(validateDisplayName(name))}
          >
            {busy ? <LuLoaderCircle className="animate-spin" /> : "continue"}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
