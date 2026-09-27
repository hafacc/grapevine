import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import SiteFooter, { type DocRoute } from "./site-footer";
import ThemeButton from "./theme-button";
import Wordmark from "./wordmark";

// The three written pages — about, privacy, help — share one
// chrome and a dozen element classes. They are the only long-text surfaces in
// grapevine, and deliberately the only ones that set prose on the bare canvas:
// a card here means controls and lists everywhere else, so a wall of one behind
// two thousand words would read as a form.
//
// Nothing below touches the store, the database or a session. These are STATIC
// exported routes, not fragment screens, so every word sits in the exported HTML
// for a reader — or a reviewer — with JavaScript off.

export const link = "font-semibold text-accent-ink break-words";

export function H2({ children }: { children: ReactNode }): ReactElement {
  return (
    <h2 className="font-display mt-10 text-[22px] leading-tight font-semibold">
      {children}
    </h2>
  );
}

export function P({ children }: { children: ReactNode }): ReactElement {
  return <p className="mt-4">{children}</p>;
}

export function List({ children }: { children: ReactNode }): ReactElement {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-faint">
      {children}
    </ul>
  );
}

export default function DocPage({
  title,
  updated,
  route,
  children,
}: {
  title: string;
  updated?: string;
  route: DocRoute;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The text's own column, so the wordmark and the theme control line
          up with the page rather than the screen's edges. */}
      <header className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
        <Link href="/" aria-label="grapevine home" className="rounded-sm">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-24 leading-7 text-text sm:pt-10">
        <h1 className="font-display text-3xl leading-tight font-semibold sm:text-4xl">
          {title}
        </h1>
        {updated ? (
          <p className="mt-2 text-sm tabular-nums text-muted">
            last updated: {updated}
          </p>
        ) : null}
        {children}
        <SiteFooter current={route} className="mt-16" />
      </main>
    </div>
  );
}
