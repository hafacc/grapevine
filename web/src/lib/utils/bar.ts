// Four segments, filled from the left, and a value part-fills the one it lands
// in rather than rounding up to it (DESIGN §1 "The bar").
export const SEGMENTS = 4;

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  else if (value > high) return high;
  else return value;
}

/**
 * The one value a thing or an attribute is drawn and ranked by: the core's
 * score as it is.
 *
 * `score` is what the accounts the viewer follows say of the thing, or of it as
 * an example of the attribute, plus the viewer's own fitted departure from
 * that (DESIGN §2.6). The doubt is already inside it: the accounts' mean starts
 * from a flat prior, so a thing one account rated sits a third of the way out
 * and not at the end. So nothing here pulls it toward the middle a second
 * time, and how much stands behind it is not asked: that only breaks ties in
 * the order.
 *
 * Null out when there is nothing to draw: no score, or a number that is not
 * one.
 */
export function barValue(score: number | null): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  else return score;
}

/**
 * Where the fill ends on the bar's own `0..1` scale, or null when there is
 * nothing a bar may draw. The value as it is: no step to round to and no floor
 * below which it is hidden.
 */
export function fillFor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  else return (clamp(value, -1, 1) + 1) / 2;
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
 * accent above it. Read off the fill, so the colour cannot disagree with the
 * length of the thing it colours.
 */
export function fillTone(fill: number): "accent" | "danger" {
  return fill > 0.5 ? "accent" : "danger";
}
