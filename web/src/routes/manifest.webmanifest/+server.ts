import { iconHref } from "../../lib/server/icon-href";

// `scope` deliberately covers the whole app, so the written pages open inside
// an installed grapevine too rather than bouncing out to a browser tab.
const MANIFEST = {
  name: "grapevine",
  short_name: "grapevine",
  description: "what to eat, watch, read and more, from the people you trust",
  start_url: "/",
  scope: "/",
  display: "standalone",
  // `--color-bg`, and the same value `src/app.html` gives the light theme
  // color: these two are what the launcher paints behind the app before a
  // pixel of it has run, and a disagreement between them is a flash.
  // The LIGHT one in both themes — a manifest has one color and no media
  // query, and `theme-color.svelte` corrects the address bar as soon as it
  // runs.
  background_color: "#e8eced",
  theme_color: "#e8eced",
  icons: [
    {
      src: iconHref("icon-192.png"),
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: iconHref("icon-512.png"),
      sizes: "512x512",
      type: "image/png",
    },
    // Full-bleed, with the mark inside the safe circle: Android crops a
    // non-maskable icon to whatever shape the launcher uses, which would take
    // the edges off the disc.
    {
      src: iconHref("icon-maskable-512.png"),
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

// Written out with the pages: a static export has no request to vary on.
export const prerender = true;

export function GET(): Response {
  return new Response(JSON.stringify(MANIFEST), {
    headers: { "content-type": "application/manifest+json" },
  });
}
