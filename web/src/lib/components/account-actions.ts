import { grapevine } from "../utils/store.svelte";
import type { Account } from "../utils/types";
import { confirm, run } from "./dialog.svelte";

// What an account row's two sides do, for every screen that lists accounts.

const OFFLINE = "that didn't work. check your connection and try again.";

/** Follows an account that needs no link: a prefilled one, or a follower. */
export function addToVine(account: Account): void {
  run(() => grapevine.follow(account), OFFLINE);
}

/** Unfollows, after saying what that costs. */
export async function removeFromVine(account: Account): Promise<void> {
  // Following no other person locks the account, which is said first. A
  // prefilled account is not a person, and an admin is never locked.
  const people = grapevine.following.filter((entry) => !entry.prefilled);
  const last =
    !account.prefilled && people.length === 1 && !grapevine.profile?.admin;
  const followsBack = grapevine.followers.some(
    (entry) => entry.uid === account.uid,
  );
  const sure = await confirm({
    title: `remove ${account.displayName || "someone"} from your vine?`,
    body: last
      ? "they're the last person in your vine. your account will be locked until someone sends you a link."
      : account.prefilled || followsBack
        ? "their ratings will no longer shape your list."
        : "their ratings will no longer shape your list. to add them again, you'll need their link.",
    confirmLabel: "remove",
    tone: "danger",
  });
  if (!sure) return;
  run(() => grapevine.unfollow(account), OFFLINE);
}

/** Stops somebody following the viewer, after asking. */
export async function removeFollower(account: Account): Promise<void> {
  const sure = await confirm({
    title: `stop ${account.displayName || "someone"} following you?`,
    body: "your ratings will no longer shape their list.",
    confirmLabel: "remove",
    tone: "danger",
  });
  if (!sure) return;
  run(() => grapevine.removeFollower(account), OFFLINE);
}
