import { DAILY_LIMIT_MESSAGE, errorCode, isDailyLimit } from "./supabase";

// A write refused outright: either the account is locked, or the
// row names a thing that was removed. The code does not tell the two apart, so
// the lock is asked of the server.
export function isRefused(error: unknown): boolean {
  return errorCode(error) === "42501";
}

export const NAME_REMOVED_MESSAGE = "that name was removed.";

export type WriteFailure =
  // The locked screen takes over, which says it better than a message would.
  | { readonly kind: "locked" }
  | { readonly kind: "message"; readonly text: string };

/**
 * What to tell somebody whose write failed. `checkLocked` is only asked on a
 * refusal, and a failed check falls back to `fallback`: saying "removed" about
 * an account that is in fact locked would send them looking for the wrong fix.
 */
export async function explainWriteFailure(
  error: unknown,
  fallback: string,
  checkLocked: () => Promise<boolean>,
): Promise<WriteFailure> {
  if (isDailyLimit(error)) {
    return { kind: "message", text: DAILY_LIMIT_MESSAGE };
  } else if (!isRefused(error)) {
    return { kind: "message", text: fallback };
  }
  let locked: boolean;
  try {
    locked = await checkLocked();
  } catch (checkError) {
    console.error("locked", checkError);
    return { kind: "message", text: fallback };
  }
  if (locked) return { kind: "locked" };
  else return { kind: "message", text: NAME_REMOVED_MESSAGE };
}

/**
 * Whether the account is locked after an unfollowing that went through. The
 * server's answer when it gives one; otherwise what it would decide from the
 * people still followed, since the unfollowing itself did happen.
 */
export async function lockedAfterUnfollow(
  checkLocked: () => Promise<boolean>,
  peopleLeft: number,
  admin: boolean,
): Promise<boolean> {
  try {
    return await checkLocked();
  } catch (error) {
    console.error("locked", error);
    return peopleLeft === 0 && !admin;
  }
}
