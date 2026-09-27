"use client";

import type { ReactElement } from "react";
import { useGrapevine } from "../utils/store";
import Avatar from "./avatar";

/**
 * The viewer's own avatar, which is the only way to the people screen. The
 * list's top bar and a thing's title bar both carry it.
 */
export default function AvatarButton({
  // Drawn on an `accent-soft` bar — a thing rated yes — where the avatar's own
  // `accent-soft` fill would vanish into it.
  onAccent = false,
}: {
  onAccent?: boolean;
} = {}): ReactElement {
  const { navigate, profile } = useGrapevine();
  return (
    <button
      type="button"
      aria-label="you and your vine"
      onClick={() => navigate({ kind: "people" })}
      className="flex h-[44px] w-[44px] shrink-0 items-center justify-center focus-visible:outline-offset-[-2px]"
    >
      <Avatar
        name={profile?.displayName ?? ""}
        photoURL={profile?.photoURL ?? null}
        fill={onAccent ? "surface" : "soft"}
      />
    </button>
  );
}
