<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import { alert } from "./dialog.svelte";

  /**
   * Says what is wrong with a link this device was handed, once signed in to an
   * account with a vine: a dead link, or the viewer's own. A live one is asked by
   * `link-question`, in place of the screen. Draws nothing itself.
   */

  // One answer per token.
  let answering: string | null = null;

  // A locked account is told about a dead link on the locked screen instead.
  const ready = $derived(
    Boolean(
      grapevine.user &&
        grapevine.profileReady &&
        grapevine.profile &&
        !grapevine.profile.locked,
    ),
  );

  $effect(() => {
    const { inviteToken, inviteFrom, myLink } = grapevine;
    if (!ready || !inviteToken || inviteFrom === undefined) return;
    if (answering === inviteToken) return;
    if (inviteFrom === null) {
      answering = inviteToken;
      grapevine.dismissInvite();
      void alert({
        title: "that link is invalid or expired",
        body: "ask whoever sent it for a new one.",
      });
    } else if (inviteToken === myLink) {
      answering = inviteToken;
      grapevine.dismissInvite();
      void alert({
        title: "that's your own link",
        body: "send it to someone you want in your vine.",
      });
    }
  });
</script>
