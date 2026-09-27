"use client";

import { type ReactElement, useEffect, useRef } from "react";
import { useGrapevine } from "../utils/store";
import { useDialog } from "./dialog";

/**
 * Says what is wrong with a link this device was handed, once signed in to an
 * account with a vine: a dead link, or the viewer's own. A live one is asked by
 * `link-question`, in place of the screen.
 */
export default function InviteGate(): ReactElement | null {
  const {
    user,
    profile,
    profileReady,
    myLink,
    inviteToken,
    inviteFrom,
    dismissInvite,
  } = useGrapevine();
  const { alert } = useDialog();
  // One answer per token, including under React's doubled development effects.
  const answering = useRef<string | null>(null);

  // A locked account is told about a dead link on the locked screen instead.
  const ready = Boolean(user && profileReady && profile && !profile.locked);

  useEffect(() => {
    if (!ready || !inviteToken || inviteFrom === undefined) return;
    if (answering.current === inviteToken) return;
    if (inviteFrom === null) {
      answering.current = inviteToken;
      dismissInvite();
      void alert({
        title: "that link is invalid or expired",
        body: "ask whoever sent it for a new one.",
      });
    } else if (inviteToken === myLink) {
      answering.current = inviteToken;
      dismissInvite();
      void alert({
        title: "that's your own link",
        body: "send it to someone you want in your vine.",
      });
    }
  }, [ready, inviteToken, inviteFrom, myLink, alert, dismissInvite]);

  return null;
}
