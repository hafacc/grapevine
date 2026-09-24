import type { ReactElement } from "react";

// *plain* is an attribute; *match* is the one a search matched; *yes* and *no*
// are one the viewer has answered; *add* is a suggested attribute they can
// apply. Nothing here is a state word — a chip carries the attribute itself and
// its tone.
export type ChipTone = "plain" | "match" | "yes" | "no" | "add";

const TONES: Record<ChipTone, string> = {
  plain: "bg-surface-muted border-border text-muted",
  match: "bg-surface border-accent text-accent-ink",
  yes: "bg-accent-soft border-accent text-accent-ink",
  no: "bg-danger-soft border-danger text-danger-ink",
  add: "bg-surface border-accent border-dashed text-accent-ink",
};

// The tone is the whole of what a rated chip says, and a tone is not something
// every reader can see. Said where only a reader who needs it meets it, the way
// the bar says its own, so no word reaches the screen.
const ANSWERED: Partial<Record<ChipTone, string>> = {
  yes: "you said yes",
  no: "you said no",
};

/**
 * An attribute, as a chip.
 *
 * The text is the attribute itself — there is no display name to look up — so
 * it is arbitrary Unicode with spaces in it, in any script and either
 * direction. It is therefore bounded and clipped rather than assumed short, and
 * it sets no `direction`: the browser's own bidi handling is right here and an
 * override would be the bug.
 */
export default function Chip({
  label,
  tone = "plain",
  onTap,
}: {
  label: string;
  tone?: ChipTone;
  // A chip is a button only when it does something.
  onTap?: () => void;
}): ReactElement {
  const answered = ANSWERED[tone];
  const shared = `font-display inline-flex h-[28px] max-w-[220px] shrink-0 items-center rounded-sm border px-3 text-[15px] font-medium whitespace-nowrap ${TONES[tone]}`;
  // The ellipsis on a span of its own: `text-overflow` applies to a block's own
  // text, and a flex container's text is an anonymous item it never reaches, so
  // on the chip itself the label is cut mid-letter.
  const content = (
    <>
      <span className="min-w-0 truncate">{label}</span>
      {answered ? <span className="sr-only">: {answered}</span> : null}
    </>
  );
  if (onTap) {
    return (
      <button type="button" onClick={onTap} className={shared}>
        {content}
      </button>
    );
  } else {
    return <span className={shared}>{content}</span>;
  }
}
