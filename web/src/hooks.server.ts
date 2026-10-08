import type { Handle } from "@sveltejs/kit/hooks";
import { dev } from "$app/env";
import { iconHref } from "./lib/server/icon-href";

// Dev only: a service worker left on this origin by a production build treats
// every file under `/_app/immutable/` as immutable, and would go on serving the
// first bundle it saw, whatever has been edited since. It is inline because the
// component that registers the worker is one of the files a stale worker
// serves; the document itself is network-first, so this always arrives fresh.
// One reload, because the page it ran in is still on the old bundle.
const DROP_DEV_WORKER = `<script>navigator.serviceWorker&&navigator.serviceWorker.getRegistrations().then(function(held){if(!held.length)return;var controlled=!!navigator.serviceWorker.controller;return Promise.all(held.map(function(one){return one.unregister()})).then(function(){return caches.keys()}).then(function(names){return Promise.all(names.map(function(name){return caches.delete(name)}))}).then(function(){if(controlled)location.reload()})})</script>`;

// `src/app.html` carries no comments of its own, because every byte of it is
// sent with every page. What is in it, and why:
//
// - `viewport-fit=cover`, so the page reaches under the home indicator and the
//   rounded corners, which is what makes `env(safe-area-inset-*)` non-zero:
//   without it every inset in the stylesheet is zero, the bottom bar's padding
//   included.
// - Two theme colors, for the first paint only, and keyed on the SYSTEM
//   preference because static HTML has nothing else to key on —
//   `theme-color.svelte` corrects both to the theme actually resolved as soon
//   as it runs. Values are `--color-bg` from app.css.
// - The `apple-mobile-web-app-*` tags: Safari reads none of the manifest for
//   Add to Home Screen; it wants these.
// - The two icons by name, or browsers request /favicon.ico, which the export
//   does not have.
// - The script, which puts the stored theme on <html> before anything is
//   painted: applied by the bundle instead, a dark choice on a light system
//   would flash light on every load. `theme.svelte.ts` takes over from there
//   and reads the same key. All of it inside the `try`, so its names are not
//   globals.
// - The same script holds Chrome's offer to install. Chrome can make it before
//   a single module has loaded, and does not make it twice; `install.svelte.ts`
//   picks it up from `window.grapevineInstallPrompt`.
//
// And the parts of it that are only known while a page is rendered, which for
// this site is at build time: each icon's address with its file's hash, and
// the script above in dev.
const FILLED: Readonly<Record<string, string>> = {
  "%grapevine.icon%": iconHref("icon.svg"),
  "%grapevine.apple-touch-icon%": iconHref("apple-touch-icon.png"),
  "%grapevine.dev%": dev ? DROP_DEV_WORKER : "",
};

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace(/%grapevine\.[a-z-]+%/g, (name) => FILLED[name] ?? name),
  });
