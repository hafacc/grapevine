"use client";

import type { ReactElement } from "react";
import { useGrapevine } from "../utils/store";
import Avatar from "./avatar";

/**
 * The viewer's own avatar, which is the only way to the people screen, with the
 * badge that says a connect request is waiting. The list's top bar and a
 * thing's title bar both carry it, so a request is never out of sight.
 */
export default function AvatarButton({
  // Drawn on an `accent-soft` bar — a thing rated yes — where the avatar's own
  // `accent-soft` fill would vanish into it.
  onAccent = false,
}: {
  onAccent?: boolean;
} = {}): ReactElement {
  const { navigate, profile, incomingRequests } = useGrapevine();
  return (
    <button
      type="button"
      aria-label="you and your friends"
      onClick={() => navigate({ kind: "people" })}
      className="flex h-[44px] w-[44px] shrink-0 items-center justify-center focus-visible:outline-offset-[-2px]"
    >
      <Avatar
        name={profile?.displayName ?? ""}
        photoURL={profile?.photoURL ?? null}
        badge={incomingRequests.length > 0}
        fill={onAccent ? "surface" : "soft"}
      />
    </button>
  );
}
