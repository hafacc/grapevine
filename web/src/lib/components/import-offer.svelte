<script lang="ts">
  import { grapevine } from "../utils/store.svelte";
  import Mark from "./mark.svelte";
  import SiteFooter from "./site-footer.svelte";
  import ThemeButton from "./theme-button.svelte";
  import Button from "./ui/button.svelte";

  /**
   * Asked once of an account that has just accepted a link and has rated
   * nothing: a full screen, as the link's own question is, after the offer of
   * the prefilled accounts.
   */
</script>

<div class="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col">
  <div class="flex justify-end p-4">
    <ThemeButton />
  </div>
  <main
    class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 text-center"
  >
    <Mark />
    <h1 class="font-heading text-[22px]">rated things somewhere else?</h1>
    <p class="text-[17px]">
      import your ratings from another app, like imdb, letterboxd, netflix,
      goodreads or spotify, and your list starts out yours.
    </p>
    <div class="flex w-full gap-3">
      <Button
        variant="secondary"
        size="lg"
        class="flex-1"
        onclick={grapevine.answerImportOffer}
      >
        not now
      </Button>
      <Button
        size="lg"
        class="flex-1"
        onclick={() => {
          grapevine.answerImportOffer();
          grapevine.navigate({ kind: "import" });
        }}
      >
        import
      </Button>
    </div>
    <p class="text-[15px] text-muted">
      it's on the people screen whenever you want it.
    </p>
  </main>
  <SiteFooter class="px-4 pb-8" />
</div>
