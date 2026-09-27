"use client";

import { type ReactElement, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { confirmsDeletion, DELETE_WORD } from "../utils/auth";
import { useGrapevine } from "../utils/store";
import Button from "./ui/button";
import Input from "./ui/input";
import Sheet from "./ui/sheet";

// Not the shared confirm: that one confirms on Enter and focuses its confirm
// button, so a stray keypress would be enough. Here the button stays disabled
// until the word is typed, and nothing else in the sheet can delete.
export default function DeleteAccountLine(): ReactElement {
  const { deleteAccount } = useGrapevine();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const armed = confirmsDeletion(typed);

  function close(): void {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setFailed(false);
  }

  async function submit(): Promise<void> {
    if (!armed || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      // Success signs this device out, which unmounts the whole screen.
      await deleteAccount();
    } catch (error) {
      console.error(error);
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-8 block w-full border-y border-border bg-danger-tint px-4 py-3 text-left text-[16px] text-danger-ink focus-visible:outline-offset-[-2px]"
      >
        delete your account
      </button>
      <Sheet
        open={open}
        onClose={close}
        dismissable={!busy}
        title="delete your account?"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2 text-[15px] text-muted">
            <p>
              your profile, ratings, vine, link and list are removed now, and
              cannot be brought back.
            </p>
            <p>names of things you added stay, attributed to nobody.</p>
          </div>
          <Input
            aria-label={`type ${DELETE_WORD} to confirm`}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={`type ${DELETE_WORD} to confirm`}
          />
          <p
            aria-live="polite"
            className={`min-h-5 text-sm leading-5 ${failed ? "text-danger" : "text-muted"}`}
          >
            {failed
              ? "that didn't work. check your connection and try again."
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              cancel
            </Button>
            <Button
              type="submit"
              variant="dangerSolid"
              disabled={!armed || busy}
            >
              {busy ? (
                <LuLoaderCircle className="animate-spin" />
              ) : (
                "delete account"
              )}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  );
}
