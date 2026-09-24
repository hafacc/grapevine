import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import { ThemeProvider } from "next-themes";
import type { ReactElement, ReactNode } from "react";
import DialogProvider from "../components/dialog";
import LocalStackBadge from "../components/local-stack-badge";
import NameGateProvider from "../components/name-gate";
import Pwa from "../components/pwa";
import ThemeColor from "../components/theme-color";
import { iconHref } from "../utils/icon-href";
import { projectUrl } from "../utils/project";
import { GrapevineProvider } from "../utils/store";
import "./globals.css";

// Self-hosted into the static export by next/font; globals.css wires the two
// variables to --font-sans and --font-display (web/DESIGN-UI.md "Type").
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Semi_Condensed({
  subsets: ["latin"],
  // 500 for chips, the add button and every other display-face label that is
  // not a heading; a weight that is not loaded is drawn synthetically.
  weight: ["500", "600"],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export const metadata: Metadata = {
  title: "grapevine",
  description:
    "Recommendations through the grapevine, from the people you know.",
  // Safari reads none of the manifest for Add to Home Screen; it wants these.
  appleWebApp: { capable: true, title: "grapevine", statusBarStyle: "default" },
  // Named rather than left to convention: an explicit icons.apple replaces the
  // whole icons object, dropping the auto-detected app/icon.svg favicon, and
  // browsers then request /favicon.ico, which the export does not have.
  icons: {
    icon: iconHref("icon.svg", "app/icon.svg"),
    apple: iconHref("apple-touch-icon.png", "public/apple-touch-icon.png"),
  },
};

// The theme colour is for the first paint only, and keyed on the SYSTEM
// preference because static HTML has nothing else to key on — `ThemeColor`
// corrects both to the theme actually resolved as soon as it runs. Values are
// `--color-bg` from globals.css.
//
// `cover` so the page reaches under the home indicator and the rounded corners,
// which is what makes `env(safe-area-inset-*)` non-zero: without it every inset
// in the stylesheet is zero, the bottom bar's padding included.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8eced" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1417" },
  ],
};

// The empty string when this build has no project configured.
const API_ORIGIN = projectUrl();

// Dev only: a service worker left on this origin by a production build treats
// every `/_next/static/` file as immutable, and `next dev` names a chunk for
// the modules in it, not for their contents — so the worker keeps serving
// the first bundle it saw, whatever has been edited since, and a stale bundle
// can fail before hydrating and leave the prerendered splash up for good. It
// is inline because the component that registers the worker is one of the
// files a stale worker serves; the document itself is network-first, so this
// always arrives fresh. One reload, because the page it ran in is still on
// the old bundle.
const DROP_DEV_WORKER = `navigator.serviceWorker&&navigator.serviceWorker.getRegistrations().then(function(held){if(!held.length)return;var controlled=!!navigator.serviceWorker.controller;return Promise.all(held.map(function(one){return one.unregister()})).then(function(){return caches.keys()}).then(function(names){return Promise.all(names.map(function(name){return caches.delete(name)}))}).then(function(){if(controlled)location.reload()})})`;

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable}`}
    >
      {/* Every screen's first act is to sign in and read, and the host costs a
          DNS lookup and a TLS handshake before a byte of that moves. Starting it
          alongside the bundle download matters most on a first visit, where
          nothing was warmed by a previous one. Sign-in, the database, the
          Realtime socket and the recompute are all the project's own origin.

          `crossOrigin` has to MATCH how the request is eventually made or the
          socket lands in the wrong pool and is never reused — the hint then
          costs a connection and saves nothing. The SDK reaches it by CORS
          fetch with no credentials.

          Read at build time, so a build with no project wired up emits no hint
          at all rather than one pointing nowhere. */}
      <head>
        {API_ORIGIN ? (
          <link rel="preconnect" href={API_ORIGIN} crossOrigin="anonymous" />
        ) : null}
        {process.env.NODE_ENV !== "production" ? (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant, and it has to run before any bundle does.
            dangerouslySetInnerHTML={{ __html: DROP_DEV_WORKER }}
          />
        ) : null}
      </head>
      <body>
        {/* A key of its own: local storage is per origin, and next-themes'
            default `theme` would be one setting shared with anything else
            ever served from it. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="grapevine-theme"
        >
          <DialogProvider>
            {/* Inside GrapevineProvider: it reads the profile to know whether
                a name is needed at all. */}
            <GrapevineProvider>
              <NameGateProvider>{children}</NameGateProvider>
              <LocalStackBadge />
              <Pwa />
              <ThemeColor />
            </GrapevineProvider>
          </DialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
