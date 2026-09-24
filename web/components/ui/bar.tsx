import type { ReactElement } from "react";
import { fillFor, fillTone, segmentFills } from "../../utils/bar";

// One stable key per segment, since the four are positions rather than data.
const SEGMENT_KEYS: readonly string[] = ["first", "second", "third", "fourth"];

const NOTHING: readonly number[] = SEGMENT_KEYS.map(() => 0);

/**
 * What the viewer's own feed makes of a thing or one of its attributes.
 *
 * `quantum` is required and has no default: a bar handed none draws an empty
 * track and says nothing known yet, because a default step would be a silent
 * claim about how accurate the walk behind the feed was. The step never reaches
 * the screen as text, and ordering happens elsewhere on the unquantized score,
 * so rounding here cannot manufacture a tie.
 *
 * No word beside it and no number ever (DESIGN §4). `role="img"` with a
 * sentence for a label, because four unlabelled boxes are nothing to a reader
 * who cannot see them.
 */
export default function Bar({
  subject,
  score,
  quantum,
}: {
  // What the score is about, so a label read out of context names the thing.
  subject: string;
  score: number;
  quantum: number | null;
}): ReactElement {
  const fill = fillFor(score, quantum);
  const fills = fill === null ? NOTHING : segmentFills(fill);
  const lit =
    fill !== null && fillTone(fill) === "accent" ? "accent" : "danger";
  return (
    <span
      role="img"
      aria-label={
        fill === null ? "nothing known yet" : `how ${subject} scores for you`
      }
      className="flex shrink-0 gap-1"
    >
      {SEGMENT_KEYS.map((name, index) => (
        <span
          key={name}
          className="relative block h-[9px] w-[15px] overflow-hidden rounded-xs border border-track-edge bg-track"
        >
          <span
            className={`absolute inset-0 ${lit === "accent" ? "bg-accent" : "bg-danger"}`}
            style={{ width: `${(fills[index] ?? 0) * 100}%` }}
          />
        </span>
      ))}
    </span>
  );
}
