// Four segments, filled from the left, and a value part-fills the one it lands
// in rather than rounding up to it (DESIGN §1 "The bar").
export const SEGMENTS = 4;

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  else if (value > high) return high;
  else return value;
}

/**
 * Where the fill ends on the bar's own `0..1` scale, or null when there is
 * nothing a bar may honestly draw.
 *
 * `score` is `s_u(x)` in `(−1, 1)` and `quantum` is `user_recs.error / 2` — the
 * error already carries `L` and is on the score's own scale, so the halving is
 * all that is left to do, and the halving is there because the bar maps a width
 * of 2 onto a width of 1.
 *
 * Null rather than a fill computed without a step: a bar whose resolution is
 * pixels claims a precision the walk does not have, so a feed that reported no
 * usable error says nothing known yet instead. That decision is here rather
 * than in the component so that it is the one the tests can reach.
 */
export function fillFor(score: number, quantum: number | null): number | null {
  if (quantum === null || !Number.isFinite(quantum) || quantum <= 0)
    return null;
  if (!Number.isFinite(score)) return null;
  const fraction = (clamp(score, -1, 1) + 1) / 2;
  return clamp(Math.round(fraction / quantum) * quantum, 0, 1);
}

/** How full each segment is, left to right, given a fill on the `0..1` scale. */
export function segmentFills(fill: number): readonly number[] {
  const spread = clamp(fill, 0, 1) * SEGMENTS;
  return Array.from({ length: SEGMENTS }, (_unused, index) =>
    clamp(spread - index, 0, 1),
  );
}

/**
 * Which of the two colours the fill takes: danger at or below the midpoint,
 * accent above it.
 *
 * Read off the quantized fill and not the raw score, so the colour cannot
 * disagree with the length of the thing it colours.
 */
export function fillTone(fill: number): "accent" | "danger" {
  return fill > 0.5 ? "accent" : "danger";
}
