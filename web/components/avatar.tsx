"use client";

import { type ReactElement, useId } from "react";
import { initials } from "../utils/initials";
import { photoSrc } from "../utils/photos";

// Pointy-top like the mark's berries, and taller than wide like a face.
// Radius 30 in a 64 box, with real rounded corners: the path carries a
// quadratic at each vertex. A wide `stroke-linejoin: round` rounds the outside
// of a join and not the inside, so a hexagon drawn that way has six subtly
// wrong corners at every size.
const HEXAGON =
  "M27.67 59.5 Q32.0 62.0 36.33 59.5 L53.65 49.5 Q57.98 47.0 57.98 42.0 L57.98 22.0 Q57.98 17.0 53.65 14.5 L36.33 4.5 Q32.0 2.0 27.67 4.5 L10.35 14.5 Q6.02 17.0 6.02 22.0 L6.02 42.0 Q6.02 47.0 10.35 49.5 Z";

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
  fill = "soft",
}: {
  name: string;
  photoURL: string | null;
  size?: number;
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
    </span>
  );
}
