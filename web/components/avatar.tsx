"use client";

import { type ReactElement, useId } from "react";
import { initials } from "../utils/initials";
import { photoSrc } from "../utils/photos";

// Flat-top, radius 30 in a 64 box, with real rounded corners: the path carries
// a quadratic at each vertex. A wide `stroke-linejoin: round` rounds the
// outside of a join and not the inside, so a hexagon drawn that way has six
// subtly wrong corners at every size.
const HEXAGON =
  "M59.5 27.67 Q62.0 32.0 59.5 36.33 L49.5 53.65 Q47.0 57.98 42.0 57.98 L22.0 57.98 Q17.0 57.98 14.5 53.65 L4.5 36.33 Q2.0 32.0 4.5 27.67 L14.5 10.35 Q17.0 6.02 22.0 6.02 L42.0 6.02 Q47.0 6.02 49.5 10.35 Z";

// The badge is pointy-top, so it meets the avatar at a vertex rather than at
// the corner of a bounding box that is not there.
const BADGE_HEXAGON =
  "M13.92 3.2 Q16.0 2.0 18.08 3.2 L26.05 7.8 Q28.12 9.0 28.12 11.4 L28.12 20.6 Q28.12 23.0 26.05 24.2 L18.08 28.8 Q16.0 30.0 13.92 28.8 L5.95 24.2 Q3.88 23.0 3.88 20.6 L3.88 11.4 Q3.88 9.0 5.95 7.8 Z";

/**
 * A person, as a hexagon.
 *
 * `size` is a number rather than a class because the shape is drawn rather than
 * styled — the SVG takes it directly, and there is no Tailwind literal to keep
 * in step with it. Sizes are 36 in a bar, 40 in a people row, 48 on the
 * viewer's own row.
 */
export default function Avatar({
  name,
  photoURL,
  size = 36,
  badge = false,
  fill = "soft",
}: {
  name: string;
  photoURL: string | null;
  size?: number;
  // The one badge in the product: a connect request is waiting.
  badge?: boolean;
  // Behind the initials. `surface` only where the avatar sits on `accent-soft`.
  fill?: "soft" | "surface";
}): ReactElement {
  // A URL that fails `photoSrc`'s origin check falls back to the initials, same
  // as no photo at all.
  const src = photoURL === null ? null : photoSrc(photoURL);
  const clip = `hex-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      {src ? (
        // biome-ignore lint/performance/noImgElement: static export, no next/image loader
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `url(#${clip})` }}
        />
      ) : null}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="relative block"
      >
        {src ? (
          <defs>
            <clipPath id={clip}>
              {/* The photo is an HTML element, so the clip is in its own pixels
                  rather than the viewBox's. */}
              <path d={HEXAGON} transform={`scale(${size / 64})`} />
            </clipPath>
          </defs>
        ) : null}
        <path
          d={HEXAGON}
          className={`stroke-border ${
            src
              ? "fill-none"
              : fill === "surface"
                ? "fill-surface"
                : "fill-accent-soft"
          }`}
          strokeWidth={2}
        />
        {src ? null : (
          <text
            x="32"
            y="41"
            textAnchor="middle"
            fontSize="26"
            fontWeight="600"
            className="font-display fill-accent-ink"
          >
            {initials(name)}
          </text>
        )}
      </svg>
      {badge ? (
        <span className="absolute" style={{ left: "68%", top: "-4%" }}>
          <svg width={15} height={15} viewBox="0 0 32 32" className="block">
            <title>a request is waiting</title>
            {/* The stroke is the surface punching the badge out of whatever it
                overlaps, not an outline. */}
            <path
              d={BADGE_HEXAGON}
              className="fill-accent stroke-surface"
              strokeWidth={4}
            />
          </svg>
        </span>
      ) : null}
    </span>
  );
}
