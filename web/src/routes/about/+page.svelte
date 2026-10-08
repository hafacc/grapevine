<script lang="ts">
  import DocPage, { h2, link, p } from "../../lib/components/doc-page.svelte";
  import { HAFA_URL, REPO_URL } from "../../lib/utils/contact";
</script>

<svelte:head>
  <title>about grapevine</title>
  <meta
    name="description"
    content="Recommendations from people you trust, and people who share your taste."
  />
</svelte:head>

<DocPage title="about grapevine" route="/about/">
  <p class={p}>
    grapevine recommends things from the ratings of your vine, the people you
    trust for honest opinions, and, through them, of people who share your
    taste.
  </p>
  <p class={p}>
    Your vine doesn't have to share your taste: your list weighs each person by
    how well their thumbs have matched yours.
  </p>
  <p class={p}>
    There is no global score or average; two people looking at the same thing
    can see different recommendations.
  </p>

  <h2 class={h2}>rating</h2>
  <p class={p}>
    Search for a thing by name. If nobody has added it yet, add it from the
    search.
  </p>
  <p class={p}>
    <strong>Swipe a row right for yes, left for no.</strong>
    Swipe the same way again to take it back, or the other way to flip it. On a
    wide screen, use the buttons at either end of the row. Open a thing to rate
    its attributes, like <em>cheap</em> or <em>late night</em>, the same way.
  </p>

  <h2 class={h2}>how your list is built</h2>
  <p class={p}>
    People outside your vine have limited impact on your list, which limits the
    effect of bots.
  </p>

  <h2 class={h2}>what others can tell</h2>
  <p class={p}>
    Nothing ever shows who rated what. Your list can still hint at what your
    vine liked, and if your vine is one person it is their thumbs.
  </p>

  <p class={p}>
    A
    <a class={link} href={HAFA_URL}>hafa.cc</a>
    project, free and open source under the
    <a class={link} href={REPO_URL}>MIT license</a>.
  </p>
</DocPage>
