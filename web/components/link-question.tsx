"use client";

import { type ReactElement, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { type InviteOwner, TRUST_MEANS } from "../utils/invites";
import { useGrapevine } from "../utils/store";
import { DAILY_LIMIT_MESSAGE, isDailyLimit } from "../utils/supabase";
import Avatar from "./avatar";
import { useDialog } from "./dialog";
import SiteFooter from "./site-footer";
import ThemeButton from "./theme-button";
import Button from "./ui/button";

/**
 * A live link's question, the same screen for every account that holds one:
 * new, locked, or with a vine already. A full screen rather than a sheet,
 * because a locked account has nothing to lay a sheet over, and because it
 * continues the welcome screen the link was opened on.
 *
 * Asks before it writes, and saying yes is the consent: the link may have been
 * forwarded, or opened while signed in to the wrong account, and the owner's
 * name and face are what the person holding it checks that against.
 */
export default function LinkQuestion({
  token,
  owner,
  locked,
}: {
  token: string;
  owner: InviteOwner;
  locked: boolean;
}): ReactElement {
  const { user, friends, redeemInvite, dismissInvite } = useGrapevine();
  const { alert } = useDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = owner.displayName || "someone";

  async function add(): Promise<void> {
    const known = new Set(friends.map((friend) => friend.uid));
    setBusy(true);
    setError(null);
    try {
      const answered = await redeemInvite(token);
      if (answered === null) {
        await alert({
          title: "that link is invalid or expired",
          body: "ask whoever sent it for a new one.",
        });
      } else if (answered === user?.uid) {
        await alert({
          title: "that's your own link",
          body: "send it to someone you want in your vine.",
        });
      } else if (known.has(answered)) {
        await alert({ title: `${name} is already in your vine` });
      }
    } catch (caught) {
      // Kept, not forgotten: a failed write says nothing about the link.
      console.error("invite", caught);
      setError(
        isDailyLimit(caught)
          ? DAILY_LIMIT_MESSAGE
          : "couldn't answer that link. check your connection.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
      <div className="flex justify-end p-4">
        <ThemeButton />
      </div>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <Avatar name={name} photoURL={owner.photoURL} size={64} />
        <h1 className="font-heading text-[22px] [overflow-wrap:anywhere]">
          add {name} to your vine?
        </h1>
        {locked ? (
          <p className="text-[15px] font-medium">
            if you decline, your account stays locked until you accept someone's
            link.
          </p>
        ) : null}
        <div className="flex w-full gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            disabled={busy}
            onClick={dismissInvite}
          >
            not now
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={busy}
            onClick={() => void add()}
          >
            {busy ? <LuLoaderCircle className="animate-spin" /> : "add"}
          </Button>
        </div>
        {/* Under the answer: the face and the question are what somebody
            checks, and this is for whoever wants more before choosing. The
            locked warning sits above, because it changes the answer. */}
        <p className="text-[15px] text-muted">{TRUST_MEANS}</p>
        <p aria-live="polite" className="min-h-5 text-sm leading-5 text-danger">
          {error}
        </p>
      </main>
      <SiteFooter className="px-4 pb-8" />
    </div>
  );
}
