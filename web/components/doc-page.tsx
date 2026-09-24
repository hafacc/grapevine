import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import SiteFooter, { type DocRoute } from "./site-footer";
import ThemeButton from "./theme-button";
import Wordmark from "./wordmark";

// The four written pages — how it works, about, privacy, help — share one
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

// For a block whose whole point is being lifted off the canvas, such as
// Privacy's promises. Kept scarce deliberately.
export function Card({ children }: { children: ReactNode }): ReactElement {
  return (
    // The first child's own top margin would sit inside the card as an empty
    // band above it.
    <div className="mt-6 rounded-sm bg-surface p-5 shadow-card [&>:first-child]:mt-0">
      {children}
    </div>
  );
}

// A diagram and the sentence under it. The explainer's diagrams are inline SVG
// drawn from the palette tokens, so they follow the theme and need no image
// request — and the caption is what a reader with images off, or a screen
// reader past the figure's label, still gets.
export function Figure({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}): ReactElement {
  return (
    // Edge to edge on a phone: a diagram is drawn at a fixed width, and every
    // pixel of gutter around it is a pixel off the size of its labels.
    <figure className="-mx-4 mt-6 sm:mx-0">
      <div className="border-y border-border bg-surface px-2 py-5 sm:rounded-sm sm:border-x sm:px-4">
        {children}
      </div>
      <figcaption className="mt-2 px-4 text-[14px] leading-5 text-muted sm:px-0">
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * The formulas behind a section of the explainer, folded away.
 *
 * Shut by default and never the only place a claim is made: the prose above one
 * of these has to stand on its own, because most readers will not open it. What
 * is inside is quoted from DESIGN.md §2 unchanged, so the two cannot drift into
 * saying different things.
 */
// `of` names the part, because a page with seven of these otherwise reads out
// as seven disclosures called "the math" with nothing to tell them apart.
export function TheMath({
  of,
  children,
}: {
  of: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details className="mt-5 rounded-sm border border-border bg-surface px-4 py-3">
      <summary className="label cursor-pointer text-[15px] text-accent-ink">
        the math: {of}
      </summary>
      <div className="mt-3 space-y-3 text-[16px] text-muted">{children}</div>
    </details>
  );
}

export function Formula({ children }: { children: ReactNode }): ReactElement {
  return (
    <pre className="overflow-x-auto font-mono text-[14px] leading-6 text-text">
      {children}
    </pre>
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
