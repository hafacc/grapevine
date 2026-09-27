"use client";

import { type ReactElement, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { validateDisplayName } from "../utils/display-name";
import { useGrapevine } from "../utils/store";
import Button from "./ui/button";
import Input from "./ui/input";
import Sheet from "./ui/sheet";

// The name friends see, changed from the viewer's own row. The name gate is the
// same field for an account that arrived with no name; this one can be walked
// away from, because there is already a name to keep.
//
// Mounted only while open, so the field starts from the current name each time
// rather than from whatever was typed and abandoned last time.
export default function RenameSheet({
  onClose,
}: {
  onClose: () => void;
}): ReactElement {
  const { profile, updateDisplayName, explainFailure } = useGrapevine();
  const [name, setName] = useState(profile?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = validateDisplayName(name);
  const problem = (name ? invalid : null) ?? error;
  const unchanged = name.trim() === profile?.displayName;

  async function submit(): Promise<void> {
    if (invalid) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateDisplayName(name.trim());
      onClose();
    } catch (caught) {
      console.error(caught);
      // Null when the account turned out to be locked: the locked screen
      // replaces this sheet, and the name was never changed.
      setError(
        await explainFailure(
          caught,
          "couldn't save that. check your connection.",
        ),
      );
    }
    setBusy(false);
  }

  return (
    <Sheet open onClose={onClose} title="your name">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          autoComplete="given-name"
          autoFocus
          invalid={Boolean(name && invalid)}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="your name"
        />
        {/* Reserved whether or not it has anything to say, for the reason the
            name gate gives: a bottom sheet grows upward, and a line that
            appears would shove the field out from under the thumb. */}
        <p
          aria-live="polite"
          className={`min-h-5 text-sm leading-5 ${problem ? "text-danger" : "text-muted"}`}
        >
          {problem ?? "what your vine sees. anything you like."}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            cancel
          </Button>
          <Button type="submit" disabled={busy || Boolean(invalid)}>
            {busy ? <LuLoaderCircle className="animate-spin" /> : "save"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
