"use client";

import { type ReactElement, useCallback, useEffect, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import {
  dismissReports,
  fetchReportedNames,
  type ReportedName,
  removeReportedName,
} from "../utils/reports";
import { useGrapevine } from "../utils/store";
import { useDialog } from "./dialog";
import Button from "./ui/button";
import Sheet from "./ui/sheet";

// The review queue, for an admin (0014): every reported name, most reported
// first. Remove deletes the name for everyone; dismiss keeps it and clears its
// reports.
function ReportsSheet({ onClose }: { onClose: () => void }): ReactElement {
  const { confirm } = useDialog();
  const [names, setNames] = useState<ReportedName[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // The sheet steps aside for the question, so the two are never stacked.
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setNames(await fetchReportedNames());
      setFailed(false);
    } catch (error) {
      console.error("reports", error);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    itemId: string,
    write: (id: string) => Promise<void>,
  ): Promise<void> {
    setBusy(itemId);
    try {
      await write(itemId);
      setNames(
        (current) =>
          current?.filter((entry) => entry.itemId !== itemId) ?? null,
      );
    } catch (error) {
      console.error("review", error);
      setFailed(true);
    }
    setBusy(null);
  }

  async function remove(itemId: string): Promise<void> {
    setAsking(true);
    const sure = await confirm({
      title: `remove "${itemId}"?`,
      body: "every rating that names it is deleted, and nobody can add it again. this can't be undone.",
      confirmLabel: "remove",
      tone: "danger",
    });
    setAsking(false);
    if (sure) await act(itemId, removeReportedName);
  }

  return (
    <Sheet open={!asking} onClose={onClose} title="reported names">
      <div className="flex flex-col gap-3">
        {names === null && !failed ? (
          <p className="text-[15px] text-muted">loading…</p>
        ) : null}
        {names !== null && names.length === 0 ? (
          <p className="text-[15px] text-muted">nothing is reported.</p>
        ) : null}
        {names && names.length > 0 ? (
          <ul className="-mx-5 border-y border-border">
            {names.map((entry) => (
              <li
                key={entry.itemId}
                className="flex items-center gap-2 border-b border-border px-5 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-grow">
                  <p className="text-[16px] font-medium [overflow-wrap:anywhere]">
                    {entry.itemId}
                  </p>
                  <p className="text-sm text-muted">
                    {entry.reports === 1
                      ? "1 report"
                      : `${entry.reports} reports`}
                  </p>
                </div>
                {busy === entry.itemId ? (
                  <LuLoaderCircle className="animate-spin text-muted" />
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      className="shrink-0"
                      disabled={busy !== null}
                      onClick={() => void act(entry.itemId, dismissReports)}
                    >
                      dismiss
                    </Button>
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      disabled={busy !== null}
                      onClick={() => void remove(entry.itemId)}
                    >
                      remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p aria-live="polite" className="min-h-5 text-sm leading-5 text-danger">
          {failed
            ? "that didn't work. check your connection and try again."
            : ""}
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>done</Button>
        </div>
      </div>
    </Sheet>
  );
}

// Shown only to an admin. The server answers nobody else either way.
export default function ReportsLine(): ReactElement | null {
  const { profile } = useGrapevine();
  const [open, setOpen] = useState(false);

  if (!profile?.admin) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <p className="min-w-0 flex-grow text-[16px] text-muted">
        names people reported
      </p>
      <Button
        variant="secondary"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        reports
      </Button>
      {open ? <ReportsSheet onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
