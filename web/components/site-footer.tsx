import Link from "next/link";
import { Fragment, type ReactElement } from "react";
import { REPO_URL } from "../utils/contact";

const PAGES = [
  { href: "/how/", label: "how it works" },
  { href: "/about/", label: "about" },
  { href: "/privacy/", label: "privacy" },
  { href: "/help/", label: "help" },
] as const;

export type DocRoute = (typeof PAGES)[number]["href"];

// Carried by the two surfaces a stranger can reach without signing in — the
// welcome screen and these pages themselves.
export default function SiteFooter({
  current,
  className = "",
}: {
  current?: DocRoute;
  className?: string;
}): ReactElement {
  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-2 text-sm text-muted ${className}`}
    >
      {PAGES.map(({ href, label }, index) => (
        <Fragment key={href}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {href === current ? (
            <span>{label}</span>
          ) : (
            <Link href={href} className="hover:text-text">
              {label}
            </Link>
          )}
        </Fragment>
      ))}
      <span aria-hidden="true">·</span>
      <a href={REPO_URL} className="hover:text-text">
        source
      </a>
    </footer>
  );
}
