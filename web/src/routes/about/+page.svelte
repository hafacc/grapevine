<script lang="ts">
  import DocPage, { h2, link, p } from "../../lib/components/doc-page.svelte";
  import { HAFA_URL, REPO_URL } from "../../lib/utils/contact";
</script>

<svelte:head>
  <title>about grapevine</title>
  <meta
    name="description"
    content="Learns your taste from your ratings and the people and critics you follow."
  />
</svelte:head>

<DocPage title="about grapevine" route="/about/">
  <p class={p}>
    grapevine learns your taste. Rate things and follow people and critics you
    trust for honest opinions, and your list ranks what you'd like.
  </p>
  <p class={p}>
    Your vine is everyone you follow. They don't have to share your taste: your
    list starts from what they say, and your own ratings move it from there.
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
    its attributes, like <em>cheap</em> or <em>late night</em>, the same way:
    how good an example of it the thing is.
  </p>

  <h2 class={h2}>how your list is built</h2>
  <p class={p}>
    Your list comes from your ratings and your vine's, and nobody else's. Search
    for what you want, like <em>fantasy book</em>, and the ones you'd like come
    first.
  </p>

  <h2 class={h2}>what others can tell</h2>
  <p class={p}>
    Anyone who follows you can read your ratings. Only people you send your link
    to, and people you follow, can follow you, and you can remove them.
  </p>

  <p class={p}>
    A
    <a class={link} href={HAFA_URL}>hafa.cc</a>
    project, free and open source under the
    <a class={link} href={REPO_URL}>MIT license</a>.
  </p>
</DocPage>
