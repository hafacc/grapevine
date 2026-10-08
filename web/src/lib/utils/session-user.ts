// The SDK's own `User` is deliberately not handed out.
export type SessionUser = {
  readonly uid: string;
};

type SessionLike = {
  readonly user: { readonly id: string };
} | null;

/**
 * The next `SessionUser`, which is the previous object whenever it is the same
 * account.
 *
 * The SDK announces the same session over and over — `SIGNED_IN` each time the
 * tab becomes visible, `TOKEN_REFRESHED` hourly — and a fresh object for each
 * would re-run every effect keyed on the user: the store would drop the
 * profile, show the splash and remount every screen whenever somebody came
 * back to the tab.
 */
export function nextSessionUser(
  previous: SessionUser | null,
  session: SessionLike,
): SessionUser | null {
  if (!session) return null;
  if (previous && previous.uid === session.user.id) {
    return previous;
  } else {
    return { uid: session.user.id };
  }
}
