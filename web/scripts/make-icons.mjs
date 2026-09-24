// Draws the app mark once and writes every icon the install surfaces want:
//
//   cd web && node scripts/make-icons.mjs
//
// Needs `rsvg-convert` (brew install librsvg) and nothing from npm. Run it when
// the accent changes or the mark does; the outputs are committed, so a checkout
// without librsvg still builds.

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The accent and the colour that sits on it (web/DESIGN-UI.md). The LIGHT
// accent in both themes: a launcher icon has no theme to follow, and the darker
// teal is the one that still reads against a white background.
const ACCENT = "#0f7e75";
const ON_ACCENT = "#ffffff";
// The dark theme's accent, for the one icon that knows which theme it is in.
const DARK_ACCENT = "#3fb3a6";

// Hex grapes — six hexagons in a 3-2-1 bunch, each an outlined hexagon with a
// SAME-SIZE hexagon clipped inside it and pushed toward one vertex, so a rim of
// even width survives on exactly two sides. `docs/mark.svg` is read rather than
// redrawn here: the generator that produced it is not in the repo, and a second
// copy of the geometry is a copy that can disagree about which hexagon is
// bigger.
const MARK_FILE = resolve(web, "../docs/mark.svg");
// Android crops a maskable icon to whatever shape the launcher uses and keeps
// only the middle 80%, a radius of 25.6 on a 64 box. The mark is scaled so its
// farthest corner lands at 24, which survives the tightest crop with nothing
// left to rescale per output.
const SAFE_RADIUS = 24;
const BOX = 64;

const markSource = await readFile(MARK_FILE, "utf8");
const markBody = markSource.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!markBody) throw new Error(`no <svg> element in ${MARK_FILE}`);
const stroke = Number(markSource.match(/stroke-width="([\d.]+)"/)?.[1] ?? 0);

// Only the outlines bound the mark: the lit hexagons are pushed past them and
// clipped back, so their corners are not part of what is drawn.
const outlineGroup = markBody.match(/<g fill="none"[^>]*>([\s\S]*?)<\/g>/)?.[1];
if (!outlineGroup) throw new Error(`no outlined berries in ${MARK_FILE}`);

// Every command in the file is M, L, Q or Z, so the numbers in a `d` run in
// coordinate pairs and each pair is a point on the sharp-cornered hexagon —
// the rounding control points ARE the vertices.
function pointsOf(data) {
  const numbers = (data.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const points = [];
  for (let at = 0; at + 1 < numbers.length; at += 2) {
    points.push([numbers[at], numbers[at + 1]]);
  }
  return points;
}
const berries = [...outlineGroup.matchAll(/\sd="([^"]+)"/g)].map(([, data]) => {
  const points = pointsOf(data);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    data,
    centreX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centreY: (Math.min(...ys) + Math.max(...ys)) / 2,
    width: Math.max(...xs) - Math.min(...xs),
    points,
  };
});
if (berries.length !== 6)
  throw new Error(`expected six berries in ${MARK_FILE}`);

// The smallest circle around every corner, not the middle of the bounding box.
// A 3-2-1 bunch is a downward triangle: its box centre sits below its weight,
// so a box-centred bunch hangs high in a disc. Centring the enclosing circle
// leaves an even gap at all three extremes, which is what reads as centred in a
// circle and in the circle a maskable icon is cut to. Radius is convex in the
// centre, so nested ternary searches find it.
function enclosingCircle(points) {
  const farthest = (x, y) =>
    Math.max(...points.map(([px, py]) => Math.hypot(px - x, py - y)));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const search = (low, high, cost) => {
    for (let step = 0; step < 100; step++) {
      const third = (high - low) / 3;
      if (cost(low + third) < cost(high - third)) high -= third;
      else low += third;
    }
    return (low + high) / 2;
  };
  const bestY = (x) =>
    search(Math.min(...ys), Math.max(...ys), (y) => farthest(x, y));
  const x = search(Math.min(...xs), Math.max(...xs), (x) =>
    farthest(x, bestY(x)),
  );
  const y = bestY(x);
  return { centreX: x, centreY: y, radius: farthest(x, y) + stroke / 2 };
}

const { centreX, centreY, radius } = enclosingCircle(
  berries.flatMap(({ points }) => points),
);
const scale = SAFE_RADIUS / radius;
const shiftX = BOX / 2 - scale * centreX;
const shiftY = BOX / 2 - scale * centreY;

function mark(colour) {
  const painted = markBody.replaceAll(ACCENT, colour);
  if (painted === markBody && colour !== ACCENT) {
    throw new Error(`${MARK_FILE} is not drawn in ${ACCENT}`);
  }
  return `<g transform="translate(${shiftX.toFixed(3)} ${shiftY.toFixed(3)}) scale(${scale.toFixed(4)})">${painted}</g>`;
}

// Below about 18 px the rim closes up and the lit berries read as one white
// triangle, so the favicon is the SOLID bunch web/DESIGN-UI.md asks for there:
// the six outline hexagons out of `docs/mark.svg`, filled and spread apart so
// a gap survives between neighbours — filled where they stand they touch and
// merge into that same triangle.
//
// Sized in whole pixels of a 16 px tab, where one pixel is 4 units: each berry
// 4 px across its flats and 1 px apart, so the bunch is 14 px wide with a pixel
// either side. Every berry's upright sides then land on pixel edges at 32 px
// (a 16 px tab on a 2× screen) and the top and bottom rows' do at 16 px too;
// the middle row is offset half a pitch and cannot, whatever the sizes.
const BERRY_WIDTH = 16;
const BERRY_GAP = 4;
// A triangle centred by its box looks high and one centred by its weight looks
// low; a quarter of the way from the first to the second reads as level.
const OPTICAL_DROP = 0.25;

function solidMark() {
  const [first, second] = berries;
  const pitch = Math.abs(second.centreX - first.centreX);
  const lattice = (BERRY_WIDTH + BERRY_GAP) / pitch;
  const markX =
    (Math.min(...berries.map(({ centreX }) => centreX)) +
      Math.max(...berries.map(({ centreX }) => centreX))) /
    2;
  const rows = berries.map(({ centreY }) => centreY);
  const top = Math.min(...rows);
  const bottom = Math.max(...rows);
  const weight = rows.reduce((sum, row) => sum + row, 0) / rows.length;
  const middle = (top + bottom) / 2;
  const markY = middle - OPTICAL_DROP * (middle - weight);
  return berries
    .map(({ data, centreX: berryX, centreY: berryY, width }) => {
      const size = BERRY_WIDTH / width;
      const toX = BOX / 2 + (berryX - markX) * lattice;
      const toY = BOX / 2 + (berryY - markY) * lattice;
      let at = 0;
      const moved = data.replace(/-?\d*\.?\d+/g, (number) =>
        (at++ % 2 === 0
          ? toX + (Number(number) - berryX) * size
          : toY + (Number(number) - berryY) * size
        ).toFixed(2),
      );
      return `<path d="${moved}"/>`;
    })
    .join("");
}

// The browser tab, and nothing else reads `app/icon.svg`: every install surface
// takes one of the PNGs below. No disc behind it, unlike them: a disc that fits
// in 16 px leaves the bunch 9 px wide and each berry a blot, where on its own it
// takes 14. The tab strip is the background instead, so the accent follows the
// theme the way it does in the app — the light theme's teal is 2.4:1 on Chrome's
// dark tab strip.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">
  <style>path{fill:${ACCENT}}@media (prefers-color-scheme:dark){path{fill:${DARK_ACCENT}}}</style>
  ${solidMark()}
</svg>
`;

// Flat fill: the palette has no gradients.
const disc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">
  <circle cx="32" cy="32" r="32" fill="${ACCENT}" />
  ${mark(ON_ACCENT)}
</svg>
`;

// Full-bleed, because Android crops a maskable icon to whatever shape the
// launcher uses and would take the edges off the disc. Apple's touch icon is
// the same square: iOS rounds it itself, and composites a transparent one on
// black.
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">
  <rect width="${BOX}" height="${BOX}" fill="${ACCENT}" />
  ${mark(ON_ACCENT)}
</svg>
`;

const OUTPUTS = [
  { source: disc, size: 192, path: "public/icon-192.png" },
  { source: disc, size: 512, path: "public/icon-512.png" },
  { source: square, size: 512, path: "public/icon-maskable-512.png" },
  { source: square, size: 180, path: "public/apple-touch-icon.png" },
];

await writeFile(resolve(web, "app/icon.svg"), favicon);

for (const { source, size, path } of OUTPUTS) {
  const rendered = spawnSync(
    "rsvg-convert",
    ["-w", String(size), "-h", String(size), "-o", resolve(web, path)],
    { input: source },
  );
  if (rendered.status !== 0) {
    throw new Error(
      `rsvg-convert failed for ${path}: ${rendered.stderr ?? rendered.error}`,
    );
  }
  console.log(`  ${path} (${size}×${size})`);
}
