<script lang="ts">
  import { page } from "$app/state";

  // What an address that is no page draws. The exported `404.html` is this,
  // which is what Pages answers such an address with.
  const missing = $derived(page.status === 404);
</script>

<svelte:head>
  <title>
    {missing ? "404: This page could not be found." : "grapevine"}
  </title>
</svelte:head>

<div class="flex min-h-dvh items-center justify-center gap-5 px-6">
  <h1 class="border-r border-border py-2 pr-5 text-2xl font-medium">
    {page.status}
  </h1>
  <p class="text-sm">
    {missing ? "This page could not be found." : page.error?.message}
  </p>
</div>
