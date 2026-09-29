"use client";

import { type Attribution, sourceOf } from "grapevine-shared/references";
import { type ReactElement, useState } from "react";
import type { MatchRow } from "../utils/references";
import { useDialog } from "./dialog";
import AddButton from "./ui/add-button";
import Sheet from "./ui/sheet";

// What a source's data owes while it is offered. Only here: a stored result
// shown later is an insubstantial extract and owes none (OSMF's geocoding
// guideline).
function Credit({
  attribution,
  className = "",
}: {
  attribution: Attribution;
  className?: string;
}): ReactElement {
  return (
    <p className={`text-[15px] text-faint ${className}`}>
      <a
        href={attribution.href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline-offset-2 hover:underline"
      >
        {attribution.text}
      </a>
    </p>
  );
}

/**
 * What the indices offered for a name about to be added, as one list in the
 * order `pickShown` chose, and last the name as typed. A name already here
 * without a link is asked about first.
 */
export default function MatchSheet({
  typed,
  rows,
  onChoose,
  onTyped,
  onClose,
}: {
  typed: string;
  rows: readonly MatchRow[];
  onChoose: (row: MatchRow) => void;
  onTyped: () => void;
  onClose: () => void;
}): ReactElement {
  const { confirm } = useDialog();
  // The sheet steps aside for the question, so the two are never stacked.
  const [asking, setAsking] = useState(false);

  async function choose(row: MatchRow): Promise<void> {
    if (row.kind !== "plain") {
      onChoose(row);
      return;
    }
    setAsking(true);
    const sure = await confirm({
      title: `is “${row.itemId}” this?`,
      body: row.candidate.description || undefined,
      confirmLabel: "yes",
      cancelLabel: "no",
    });
    setAsking(false);
    if (sure) onChoose(row);
  }

  const credits = [
    ...new Set(
      rows.map((row) => sourceOf(row.candidate.source)?.attribution ?? null),
    ),
  ].filter((credit): credit is Attribution => credit !== null);

  return (
    <Sheet open={!asking} onClose={onClose} title="is it one of these?">
      <ul className="-mx-5">
        {rows.map((row) => (
          <li key={`${row.candidate.source}:${row.candidate.ref}`}>
            <button
              type="button"
              data-match={row.kind}
              onClick={() => void choose(row)}
              className="flex w-full flex-col gap-0.5 px-5 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-offset-[-2px]"
            >
              <span className="text-[17px] font-medium [overflow-wrap:anywhere]">
                {row.itemId}
              </span>
              {row.candidate.description ? (
                <span className="text-[15px] text-muted [overflow-wrap:anywhere]">
                  {row.candidate.description}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {credits.map((credit) => (
        <Credit key={credit.text} attribution={credit} className="pt-2" />
      ))}
      <div className="pt-3">
        <AddButton label={`none of these — add “${typed}”`} onTap={onTyped} />
      </div>
    </Sheet>
  );
}
