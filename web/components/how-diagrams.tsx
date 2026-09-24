import type { ReactElement, ReactNode } from "react";

// The eight diagrams of /how/. Inline SVG drawn from the palette tokens rather
// than images: they follow the theme with everything else, cost no request, and
// survive the explainer being read with no network — which, for the one page
// that explains what the app does with your ratings, is the point.
//
// Each carries `role="img"` and a label, and the caption under it (Figure, in
// doc-page) says the same thing in a sentence. Nothing here is the only place a
// claim is made.

function Diagram({
  label,
  height,
  children,
}: {
  label: string;
  height: number;
  children: ReactNode;
}): ReactElement {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 320 ${height}`}
      className="mx-auto block h-auto w-full max-w-[400px]"
    >
      {children}
    </svg>
  );
}

// A thumb, drawn as a triangle. Filled when it is the thumb someone actually
// gave.
function Thumb({
  x,
  y,
  up,
  given,
}: {
  x: number;
  y: number;
  up: boolean;
  given: boolean;
}): ReactElement {
  const points = up
    ? `${x},${y - 5} ${x + 5},${y + 4} ${x - 5},${y + 4}`
    : `${x},${y + 5} ${x + 5},${y - 4} ${x - 5},${y - 4}`;
  return (
    <polygon
      points={points}
      className={given ? "fill-accent" : "fill-border"}
    />
  );
}

// In viewBox units, which a phone draws at a little over one pixel each (the
// figure is edge to edge there), so these are the smallest sizes on the page
// and are kept at the interface's own floor or near it.
const LABEL = "font-display fill-muted text-[13px] font-semibold";
const NAME = "fill-text text-[14px]";
const NOTE = "fill-muted text-[13px]";
const CHIP = "font-display text-[14px] font-medium";

export function ThumbsDiagram(): ReactElement {
  return (
    <Diagram
      label="A thing with a thumb on it, the bar beside its name, and two of its attributes as chips"
      height={94}
    >
      <rect
        x="4"
        y="6"
        width="312"
        height="36"
        rx="4"
        className="fill-surface stroke-border"
      />
      <text x="16" y="30" className={NAME}>
        café bleu
      </text>
      {/* The bar, no word beside it — the same four segments section 5 draws. */}
      {[0, 1, 2, 3].map((segment) => (
        <rect
          key={segment}
          x={250 + segment * 16}
          y="20"
          width="12"
          height="8"
          rx="1"
          className={segment <= 2 ? "fill-accent" : "fill-track"}
        />
      ))}

      {/* An attribute is a chip carrying the attribute and nothing else: the
          fill is the viewer's own thumb, and there is no glyph and no word for
          a state. */}
      <rect
        x="4"
        y="58"
        width="62"
        height="26"
        rx="4"
        className="fill-accent-soft stroke-accent"
      />
      <text
        x="35"
        y="76"
        textAnchor="middle"
        className={`${CHIP} fill-accent-ink`}
      >
        cheap
      </text>

      <rect
        x="74"
        y="58"
        width="54"
        height="26"
        rx="4"
        className="fill-danger-soft stroke-danger"
      />
      <text
        x="101"
        y="76"
        textAnchor="middle"
        className={`${CHIP} fill-danger-ink`}
      >
        loud
      </text>

      <rect
        x="136"
        y="58"
        width="92"
        height="26"
        rx="4"
        className="fill-surface-muted stroke-border"
      />
      <text x="182" y="76" textAnchor="middle" className={`${CHIP} fill-muted`}>
        late night
      </text>
    </Diagram>
  );
}

export function WalkDiagram(): ReactElement {
  const person = "fill-surface stroke-accent";
  return (
    <Diagram
      label="A walk out from you through friends, halving at every step, with a swarm behind one friend sharing that friend's share"
      height={190}
    >
      <g className="stroke-border" strokeWidth="1">
        <line x1="34" y1="78" x2="76" y2="34" />
        <line x1="34" y1="78" x2="78" y2="78" />
        <line x1="34" y1="78" x2="76" y2="122" />
        <line x1="100" y1="30" x2="150" y2="30" />
        <line x1="174" y1="30" x2="224" y2="30" />
      </g>

      <circle cx="22" cy="78" r="16" className="fill-accent" />
      <text
        x="22"
        y="82"
        textAnchor="middle"
        className="font-display fill-accent-on text-[13px] font-semibold"
      >
        you
      </text>

      <circle cx="88" cy="30" r="12" className={person} />
      <circle cx="90" cy="78" r="12" className={person} />
      <circle cx="88" cy="126" r="12" className={person} />
      <text x="88" y="12" textAnchor="middle" className={LABEL}>
        1
      </text>

      <circle cx="162" cy="30" r="10" className={person} />
      <text x="162" y="12" textAnchor="middle" className={LABEL}>
        ½
      </text>
      <circle cx="236" cy="30" r="8" className={person} />
      <text x="236" y="12" textAnchor="middle" className={LABEL}>
        ¼
      </text>
      <text x="252" y="35" className={NOTE}>
        …
      </text>

      <rect
        x="118"
        y="98"
        width="198"
        height="52"
        rx="6"
        className="fill-surface-muted stroke-border"
        strokeDasharray="3 3"
      />
      <g className="fill-surface stroke-border">
        <circle cx="140" cy="118" r="7" />
        <circle cx="162" cy="132" r="7" />
        <circle cx="184" cy="114" r="7" />
        <circle cx="206" cy="130" r="7" />
        <circle cx="228" cy="118" r="7" />
      </g>
      <line
        x1="100"
        y1="126"
        x2="133"
        y2="118"
        className="stroke-border"
        strokeWidth="1"
      />
      <text x="120" y="170" className={LABEL}>
        however many, together
      </text>
      <text x="120" y="185" className={LABEL}>
        ≤ the one friend
      </text>
    </Diagram>
  );
}

export function ContestedDiagram(): ReactElement {
  const gauge = (x: number, lit: number): ReactElement[] =>
    [0, 1, 2, 3].map((segment) => (
      <rect
        key={segment}
        x={x + segment * 14}
        y="64"
        width="12"
        height="5"
        rx="1"
        className={segment < lit ? "fill-accent" : "fill-border"}
      />
    ));
  return (
    <Diagram
      label="Agreeing about a thing everyone likes counts for nothing; agreeing about a split one counts"
      height={100}
    >
      <rect
        x="4"
        y="6"
        width="150"
        height="88"
        rx="6"
        className="fill-surface stroke-border"
      />
      <text x="16" y="26" className={NAME}>
        everyone agrees
      </text>
      <g>
        <Thumb x={22} y={46} up given />
        <Thumb x={44} y={46} up given />
        <Thumb x={66} y={46} up given />
        <Thumb x={88} y={46} up given />
        <Thumb x={110} y={46} up given />
      </g>
      {gauge(16, 0)}
      <text x="16" y="86" className={LABEL}>
        counts for nothing
      </text>

      <rect
        x="166"
        y="6"
        width="150"
        height="88"
        rx="6"
        className="fill-surface stroke-border"
      />
      <text x="178" y="26" className={NAME}>
        people are split
      </text>
      <g>
        <Thumb x={184} y={46} up given />
        <Thumb x={206} y={46} up={false} given />
        <Thumb x={228} y={46} up given />
        <Thumb x={250} y={46} up={false} given />
        <Thumb x={272} y={46} up given />
      </g>
      {gauge(178, 4)}
      <text x="178" y="86" className={LABEL}>
        counts
      </text>
    </Diagram>
  );
}

// What a thumbs-down changes and what it does not. Drawn as two pairs of bars
// rather than one before/after, because the "not" is the half that matters: the
// friendship the account arrived along does not narrow (DESIGN §2.5).
export function BlameDiagram(): ReactElement {
  const bar = (
    x: number,
    y: number,
    width: number,
    tone: string,
  ): ReactElement => (
    <rect x={x} y={y} width={width} height="18" className={tone} />
  );
  return (
    <Diagram
      label="After three thumbs-down, how much that account's thumbs count with you shrinks, while the friendship it arrived along is exactly as wide as it was"
      height={146}
    >
      <text x="4" y="14" className={LABEL}>
        how much that account's thumbs count with you
      </text>
      {bar(4, 22, 210, "fill-accent-soft stroke-accent")}
      <text x="10" y="36" className={NOTE}>
        before
      </text>
      {bar(4, 48, 54, "fill-danger-soft stroke-danger")}
      {/* Beside the bar rather than in it: the bar is the point, and it is
          too short to hold the words. */}
      <text x="66" y="62" className={NOTE}>
        after three thumbs-down
      </text>

      <text x="4" y="94" className={LABEL}>
        how much of you that friendship carries
      </text>
      {bar(4, 102, 150, "fill-surface-muted stroke-border")}
      <text x="10" y="116" className={NOTE}>
        before
      </text>
      {bar(4, 122, 150, "fill-surface-muted stroke-border")}
      <text x="10" y="136" className={NOTE}>
        after — the same
      </text>
    </Diagram>
  );
}

export function BarDiagram(): ReactElement {
  return (
    <Diagram
      label="The bar, and the counts and names that are never shown"
      height={116}
    >
      <rect
        x="4"
        y="6"
        width="312"
        height="36"
        rx="6"
        className="fill-surface stroke-border"
      />
      <text x="16" y="30" className={NAME}>
        café bleu
      </text>
      {/* Nothing beside it: no word, no number, and a fill that steps in units
          of the error the rebuild reported rather than in pixels. */}
      {[0, 1, 2, 3].map((segment) => (
        <rect
          key={segment}
          x={250 + segment * 16}
          y="20"
          width="12"
          height="8"
          rx="1"
          className={segment <= 2 ? "fill-accent" : "fill-track"}
        />
      ))}

      {/* `end` is how far the strike runs: a rule drawn past the words it
          crosses out reads as a rule rather than a deletion. */}
      {[
        { text: "4 friends liked this", y: 64, end: 118 },
        { text: "82% · 41 ratings", y: 86, end: 100 },
        { text: "rated by Ana, Bo and 2 others", y: 108, end: 178 },
      ].map(({ text, y, end }) => (
        <g key={text}>
          <text x="16" y={y} className={NOTE}>
            {text}
          </text>
          <line
            x1="12"
            y1={y - 4}
            x2={end}
            y2={y - 4}
            className="stroke-danger"
            strokeWidth="1"
          />
        </g>
      ))}
    </Diagram>
  );
}

export function OneFriendDiagram(): ReactElement {
  return (
    <Diagram
      label="With one friend your feed is that friend's thumbs; with several it says only that someone close to you liked a thing"
      height={118}
    >
      <rect
        x="4"
        y="6"
        width="150"
        height="106"
        rx="6"
        className="fill-surface stroke-border"
      />
      <circle cx="30" cy="34" r="11" className="fill-accent" />
      <circle cx="78" cy="34" r="9" className="fill-surface stroke-accent" />
      <line
        x1="41"
        y1="34"
        x2="69"
        y2="34"
        className="stroke-border"
        strokeWidth="1"
      />
      <text x="16" y="70" className={LABEL}>
        one friend
      </text>
      <text x="16" y="88" className={NOTE}>
        your feed is
      </text>
      <text x="16" y="103" className={NOTE}>
        their thumbs
      </text>

      <rect
        x="166"
        y="6"
        width="150"
        height="106"
        rx="6"
        className="fill-surface stroke-border"
      />
      <circle cx="192" cy="34" r="11" className="fill-accent" />
      <g className="fill-surface stroke-accent">
        <circle cx="240" cy="18" r="8" />
        <circle cx="252" cy="38" r="8" />
        <circle cx="232" cy="52" r="8" />
      </g>
      <g className="stroke-border" strokeWidth="1">
        <line x1="203" y1="32" x2="232" y2="20" />
        <line x1="203" y1="34" x2="244" y2="38" />
        <line x1="201" y1="42" x2="224" y2="50" />
      </g>
      <text x="178" y="70" className={LABEL}>
        a few friends
      </text>
      <text x="178" y="88" className={NOTE}>
        someone close to
      </text>
      <text x="178" y="103" className={NOTE}>
        you liked it
      </text>
    </Diagram>
  );
}

// The ruler everything in §2.9 is quoted against. It is `W` — reach times
// alignment — not the friend-unit of §2.4's normalization: an ordinary friend's
// thumb sits at 0.62 of it and a perfectly aligned friend at 2, so calling the
// scale "friend-units" would collide with the unit part 2 sets up.
export function FriendUnitsDiagram(): ReactElement {
  const at = (value: number): number => 20 + (value / 3) * 284;
  // A mark past the middle hangs its label from the right edge rather than
  // from its tick, so the two longest cannot run off the 320-unit box; `drop`
  // pushes a label below the one to its left, which is the only way the
  // longest of them fits on lines wide enough to read. The number sits on the
  // tick itself either way.
  const marks: readonly {
    value: number;
    lines: readonly string[];
    above: boolean;
    drop: number;
  }[] = [
    { value: 0.5, lines: ["display floor"], above: true, drop: 0 },
    {
      value: 0.62,
      lines: ["one fresh friend's thumb"],
      above: false,
      drop: 0,
    },
    { value: 2, lines: ["one well-aligned friend"], above: true, drop: 0 },
    {
      value: 2.7,
      lines: [
        "a swarm behind one friend, when",
        "that friend has no other route to you",
      ],
      above: false,
      drop: 24,
    },
  ];
  return (
    <Diagram
      label="How much is behind a recommendation, on one scale: the display floor, a fresh friend's thumb, a well-aligned friend, and a swarm behind one friend that has no other route to you"
      height={184}
    >
      <line
        x1="20"
        y1="56"
        x2="304"
        y2="56"
        className="stroke-border"
        strokeWidth="1"
      />
      {marks.map(({ value, lines, above, drop }) => {
        const trailing = at(value) > 160;
        const anchor = trailing ? "end" : "start";
        const textX = trailing ? 316 : at(value) - 4;
        return (
          <g key={value}>
            <line
              x1={at(value)}
              y1={above ? 44 : 56}
              x2={at(value)}
              y2={above ? 56 : 68}
              className="stroke-accent"
              strokeWidth="2"
            />
            {drop > 0 ? (
              <line
                x1={at(value)}
                y1={86}
                x2={at(value)}
                y2={86 + drop}
                className="stroke-border"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            ) : null}
            {lines.map((line, index) => (
              <text
                key={line}
                x={textX}
                y={above ? 38 : 100 + drop + index * 15}
                textAnchor={anchor}
                className={LABEL}
              >
                {line}
              </text>
            ))}
            <text
              x={at(value)}
              y={above ? 24 : 82}
              textAnchor="middle"
              className="font-display fill-accent-ink text-[13px] font-semibold"
            >
              {value}
            </text>
          </g>
        );
      })}
      <text x="20" y="162" className={NOTE}>
        how much is behind a recommendation —
      </text>
      <text x="20" y="177" className={NOTE}>
        reach times alignment
      </text>
    </Diagram>
  );
}

export function ComputeDiagram(): ReactElement {
  const steps: readonly { title: string; note: string }[] = [
    {
      title: "your neighbourhood",
      note: "outward over friendships, ≤ 2 000 people",
    },
    {
      title: "the walk, solved",
      note: "pushed until under 0.02 is still in flight",
    },
    { title: "your feed", note: "written where only you can read it" },
  ];
  return (
    <Diagram
      label="One viewer's recompute: load the neighbourhood, solve the walk within an error budget, write that viewer's feed"
      height={172}
    >
      {steps.map(({ title, note }, index) => {
        const y = 6 + index * 60;
        return (
          <g key={title}>
            <rect
              x="4"
              y={y}
              width="312"
              height="46"
              rx="6"
              className="fill-surface stroke-border"
            />
            <text x="16" y={y + 20} className={NAME}>
              {title}
            </text>
            <text x="16" y={y + 37} className={NOTE}>
              {note}
            </text>
            {index < steps.length - 1 ? (
              <polygon
                points={`156,${y + 58} 162,${y + 49} 150,${y + 49}`}
                className="fill-border"
              />
            ) : null}
          </g>
        );
      })}
    </Diagram>
  );
}
