import type { MetadataRoute } from "next";
import { iconHref } from "../utils/icon-href";

// A static export has no request to vary on.
export const dynamic = "force-static";

// `scope` deliberately covers the whole app, so the written pages open inside
// an installed grapevine too rather than bouncing out to a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "grapevine",
    short_name: "grapevine",
    description:
      "Recommendations from the people you know, weighted by whose taste has matched yours.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // `--color-bg`, and the same value `layout.tsx` gives the light theme
    // colour: these two are what the launcher paints behind the app before a
    // pixel of it has run, and a disagreement between them is a flash.
    // The LIGHT one in both themes — a manifest has one colour and no media
    // query, and `ThemeColor` corrects the address bar as soon as it runs.
    background_color: "#e8eced",
    theme_color: "#e8eced",
    icons: [
      {
        src: iconHref("icon-192.png", "public/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: iconHref("icon-512.png", "public/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
      },
      // Full-bleed, with the mark inside the safe circle: Android crops a
      // non-maskable icon to whatever shape the launcher uses, which would take
      // the edges off the disc.
      {
        src: iconHref("icon-maskable-512.png", "public/icon-maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
