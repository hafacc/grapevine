// Four segments, filled from the left, and a value part-fills the one it lands
// in rather than rounding up to it (DESIGN §1 "The bar").
export const SEGMENTS = 4;

// The Jeffreys prior's one pseudo-thumb (DESIGN §2.6). It is the scale's unit
// rather than a tunable, which is why the client may know it.
const PRIOR_THUMBS = 1;

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  else if (value > high) return high;
  else return value;
}

/**
 * The one value a thing is drawn and ranked by: high only when the score is
 * high AND much stands behind it.
 *
 * `score` is `s` in `(−1, 1)` and `confidence` is `W`, how many of the viewer's
 * own thumbs the evidence amounts to. With `W` thumbs at rate `(1 + s)/2` plus
 * the prior's pseudo-thumb, the posterior mean on the bar's scale is
 * `s · W / (1 + W)`. The mean rather than a lower quantile, because a quantile
 * would draw a thing with little behind it as strongly disliked; the mean sits
 * near the middle on both sides.
 *
 * `confidence` null is an entry that carries no weight (an attribute's), drawn
 * as its score. Null out when there is nothing to draw: no score, `W = 0` (a
 * thing carried only by an attribute of it, whose own score is the prior), or
 * a number that is not one.
 */
export function cautiousScore(
  score: number | null,
  confidence: number | null,
): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  else if (confidence === null) return score;
  else if (Number.isNaN(confidence) || confidence <= 0) return null;
  else if (confidence === Number.POSITIVE_INFINITY) return score;
  else return (score * confidence) / (PRIOR_THUMBS + confidence);
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
