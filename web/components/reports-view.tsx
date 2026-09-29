"use client";

import { type ReactElement, useCallback, useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuFlag,
  LuFlagOff,
  LuLoaderCircle,
  LuTrash2,
} from "react-icons/lu";
import {
  dismissReports,
  fetchReportedNames,
  type ReportedName,
  removeReportedName,
} from "../utils/reports";
import { useGrapevine } from "../utils/store";
import { useDialog } from "./dialog";
import ActionRow from "./ui/action-row";
import CenteredNote from "./ui/centered-note";
import RateRow from "./ui/rate-row";

// Remove on the left, with the danger reveal, since it deletes; dismiss on the
// right. Neither is a verdict on the name, so both are words.
const LABELS = {
  no: { word: "remove", icon: LuTrash2 },
  yes: { word: "dismiss", icon: LuFlagOff },
} as const;

function ReportRow({
  entry,
  busy,
  onRemove,
  onDismiss,
}: {
  entry: ReportedName;
  busy: boolean;
  onRemove: () => void;
  onDismiss: () => void;
}): ReactElement {
  return (
    <RateRow
      subject={entry.itemId}
      value={null}
      labels={LABELS}
      onRate={(next) => (next === -1 ? onRemove() : onDismiss())}
      frameClassName="bg-surface"
    >
      <div
        data-report={entry.itemId}
        className="flex min-h-[64px] items-center gap-2 px-4 py-2.5"
      >
        <div className="min-w-0 flex-grow">
          {/* A name is up to 128 characters with no promise of a space in it. */}
          <p className="text-[17px] font-medium [overflow-wrap:anywhere]">
            {entry.itemId}
          </p>
          <p className="text-[15px] text-muted">
            {entry.reports === 1 ? "1 report" : `${entry.reports} reports`}
          </p>
        </div>
        {busy ? (
          <LuLoaderCircle
            size={20}
            aria-hidden="true"
            className="shrink-0 animate-spin text-muted"
          />
        ) : null}
      </div>
    </RateRow>
  );
}

/**
 * The review queue, for an admin (0014): every reported name, most reported
 * first. Remove deletes the name for everyone; dismiss keeps it and clears its
 * reports. The page puts anybody else on the list, and the server answers them
 * nothing.
 */
export default function ReportsView(): ReactElement {
  const { back } = useGrapevine();
  const { confirm } = useDialog();
  const [names, setNames] = useState<ReportedName[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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
    if (busy !== null) return;
    const sure = await confirm({
      title: `remove "${itemId}"?`,
      body: "every rating that names it is deleted, and nobody can add it again. this can't be undone.",
      confirmLabel: "remove",
      tone: "danger",
    });
    if (sure) await act(itemId, removeReportedName);
  }

  function dismiss(itemId: string): void {
    if (busy !== null) return;
    void act(itemId, dismissReports);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border bg-surface pr-2.5 pl-1">
        <button
          type="button"
          aria-label="back"
          onClick={back}
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm bg-surface text-text focus-visible:outline-offset-[-2px]"
        >
          <LuChevronLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="font-display min-w-0 flex-grow truncate text-[22px] font-semibold text-text">
          names people reported
        </h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <p
          aria-live="polite"
          className={
            failed ? "bg-surface px-4 py-3 text-[16px] text-danger" : "sr-only"
          }
        >
          {failed
            ? "that didn't work. check your connection and try again."
            : ""}
        </p>
        {names === null && !failed ? (
          <p className="bg-surface px-4 py-3 text-[16px] text-muted">
            loading…
          </p>
        ) : null}
        {names !== null && names.length === 0 ? (
          <CenteredNote>nothing is reported.</CenteredNote>
        ) : null}
        {names?.map((entry) => (
          <ReportRow
            key={entry.itemId}
            entry={entry}
            busy={busy === entry.itemId}
            onRemove={() => void remove(entry.itemId)}
            onDismiss={() => dismiss(entry.itemId)}
          />
        ))}
      </div>
    </div>
  );
}

// The people screen's way in, shown only to an admin.
export function ReportsLine(): ReactElement | null {
  const { profile, navigate } = useGrapevine();

  if (!profile?.admin) return null;

  return (
    <ActionRow
      label="names people reported"
      word="reports"
      icon={LuFlag}
      onAct={() => navigate({ kind: "reports" })}
      dataRow="reports"
    />
  );
}
