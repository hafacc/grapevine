<script lang="ts">
  import DocPage, {
    h2,
    link,
    list,
    p,
  } from "../../lib/components/doc-page.svelte";
  import { CONTACT_EMAIL, ISSUES_URL } from "../../lib/utils/contact";
</script>

<svelte:head>
  <title>help — grapevine</title>
  <meta
    name="description"
    content="Rating, your vine, and where to reach a person."
  />
</svelte:head>

<DocPage title="help" route="/help/">
  <h2 class={h2}>rating</h2>
  <ul class={list}>
    <li>Swipe a row right for yes, left for no.</li>
    <li>Swipe the same way again to undo.</li>
    <li>Type in the field at the bottom to search, or to add a new thing.</li>
    <li>
      Adding a thing offers matches from Wikipedia and OpenStreetMap. Turn it
      off on the people screen.
    </li>
    <li>Open a thing to rate its attributes the same way.</li>
    <li>The eye hides what you've already rated.</li>
    <li>Report a bad name at the bottom of its screen.</li>
  </ul>

  <h2 class={h2}>searching</h2>
  <ul class={list}>
    <li>Type several words: “starbucks quiet” puts quiet starbucks first.</li>
    <li>Start a word with ! to see the lowest-rated first.</li>
    <li>Start it with @ to look at names only, # at attributes only.</li>
  </ul>

  <h2 class={h2}>your vine</h2>
  <ul class={list}>
    <li>grapevine is invite-only. To join, open someone's link.</li>
    <li>Tap your avatar to see your vine.</li>
    <li>
      Copy your link and send it to someone. When they open it and confirm,
      you're in each other's vines.
    </li>
    <li>Turn your link off, or replace it, at any time.</li>
    <li>Swipe someone's row to remove them from your vine.</li>
    <li>
      Remove the last person and your account is locked until someone sends you
      a link.
    </li>
    <li>Change your name on your own row.</li>
  </ul>

  <h2 class={h2}>a recommendation is wrong</h2>
  <p class={p}>
    <strong>Thumb it down.</strong>
    That teaches grapevine whose taste matches yours.
  </p>

  <h2 class={h2}>my list is empty</h2>
  <p class={p}>
    Your list is built from your vine's thumbs, so add someone to it. A new
    rating can take a few minutes to reach you.
  </p>

  <h2 class={h2}>contact</h2>
  <ul class={list}>
    <li>
      Bugs and questions:
      <a class={link} href={ISSUES_URL}>GitHub issues</a>
    </li>
    <li>
      Anything private:
      <a class={link} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </li>
  </ul>
</DocPage>
