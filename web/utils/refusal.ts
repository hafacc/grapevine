import { DAILY_LIMIT_MESSAGE, errorCode, isDailyLimit } from "./supabase";

// A write refused outright (0010): the account is locked, which the server is
// asked to confirm rather than assumed.
export function isRefused(error: unknown): boolean {
  return errorCode(error) === "42501";
}

// `refresh-recs` answers a locked caller with this. functions-js puts the
// response on `context` rather than a code.
export function isForbiddenCall(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const context = (error as { context?: unknown }).context;
  return (
    typeof context === "object" &&
    context !== null &&
    (context as { status?: unknown }).status === 403
  );
}

export type WriteFailure =
  // The locked screen takes over, which says it better than a message would.
  | { readonly kind: "locked" }
  | { readonly kind: "message"; readonly text: string };

/**
 * What to tell somebody whose write failed. `checkLocked` is only asked on a
 * refusal, and a failed check falls back to `fallback`.
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
  else return { kind: "message", text: fallback };
}

/**
 * Whether the account is locked after an unfriending that went through. The
 * server's answer when it gives one; otherwise what 0010 would decide from the
 * friends left, since the removal itself did happen.
 */
export async function lockedAfterUnfriend(
  checkLocked: () => Promise<boolean>,
  friendsLeft: number,
): Promise<boolean> {
  try {
    return await checkLocked();
  } catch (error) {
    console.error("locked", error);
    return friendsLeft === 0;
  }
}
