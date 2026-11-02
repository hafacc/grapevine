<script lang="ts">
  import { accountChips } from "../utils/people";
  import type { Account } from "../utils/types";
  import Avatar from "./avatar.svelte";
  import Chip from "./ui/chip.svelte";
  import type { IconData } from "./ui/icons";
  import { LuUserMinus, LuUserPlus } from "./ui/icons";
  import RateRow from "./ui/rate-row.svelte";

  /**
   * One account, wherever one is listed: a face, a name, and a prefilled
   * account's handle and tags, as a thing's row shows its attributes. No bar,
   * since an account does not have a score, and no page behind it: what the
   * row does is all on its two sides.
   *
   * A side with no action is not offered, so a swipe that would do nothing has
   * nowhere to go.
   */
  let {
    account,
    following = false,
    matchedTags = [],
    onAdd,
    onRemove,
    removeIcon = LuUserMinus,
  }: {
    account: Account;
    // Tints the row as a thing the viewer said yes to is tinted.
    following?: boolean;
    // The tags a query read, which go first in the match tone.
    matchedTags?: readonly string[];
    onAdd?: () => void;
    onRemove?: () => void;
    removeIcon?: IconData;
  } = $props();

  const name = $derived(account.displayName || "someone");
  const chips = $derived(accountChips(account, matchedTags));
  const sides = $derived(
    onAdd && onRemove ? "both" : onAdd ? "yes" : ("no" as const),
  );
</script>

<RateRow
  subject={name}
  value={null}
  {sides}
  labels={{
    yes: { word: "add", icon: LuUserPlus },
    no: { word: "remove", icon: removeIcon },
  }}
  onRate={(next) => {
    if (next === 1) onAdd?.();
    else onRemove?.();
  }}
  frameClass={following ? "bg-accent-tint" : "bg-surface"}
>
  <div
    data-account={account.uid}
    class="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5"
  >
    <Avatar {name} photoURL={account.photoURL} size={40} />
    <span class="flex min-w-0 flex-grow flex-col">
      <span class="truncate text-[16px] font-medium">{name}</span>
      {#if account.handle}
        <span class="truncate text-[14px] text-muted">@{account.handle}</span>
      {/if}
      {#if chips.length > 0}
        <span class="mt-2 flex flex-wrap gap-2">
          {#each chips as tag (tag)}
            <Chip
              label={tag}
              tone={matchedTags.includes(tag) ? "match" : "plain"}
            />
          {/each}
        </span>
      {/if}
    </span>
  </div>
</RateRow>
