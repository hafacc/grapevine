// The viewer's plot (DESIGN §2.6), made ready to draw.
//
// The core answers a point per thing and a point per attribute whose inner
// product is how far the viewer departs from their vine for that pair. A dot's
// color is that inner product for the attribute picked: grey where it is
// nothing, teal or red the further it is to either side.
//
// Where a dot sits depends on the rank (`taste-rank.ts`). At two a point is
// already a place, and the two colors meet on a straight line through the
// middle. At any other the core lays the points out (`rust/src/layout.rs`): on
// a line at one, and from three up in the plane, which keeps things that sit
// together together and means nothing else.

export type Point = readonly number[];

export type TastePlot = {
  readonly things: Readonly<Record<string, Point>>;
  readonly attributes: Readonly<Record<string, Point>>;
};

export const NO_PLOT: TastePlot = { things: {}, attributes: {} };

/** The attribute that is liking the thing itself, as the core names it. */
export const LIKING = "";

// More dots than this is a smear on a phone, and laying them out visits every
// pair of them at every step: twice as many is four times the wait and the
// memory. The ones left out are the nearest the centre, where least is said.
export const DOTS = 600;

// As many chips as a thumb will scroll through.
export const CHIPS = 12;

function points(raw: unknown): Record<string, Point> {
  const out: Record<string, Point> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [name, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 6) continue;
    if (!value.every((one) => typeof one === "number" && Number.isFinite(one)))
      continue;
    // A thing may be named `__proto__`, and assigning that sets no key.
    Object.defineProperty(out, name, {
      value: [...(value as number[])],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * The plot out of whatever the core or the device's cache holds: every point
 * that is one to six finite numbers, and nothing else. A list cached by an
 * earlier version of the app has no plot, which is an empty one.
 */
export function readPlot(raw: unknown): TastePlot {
  if (typeof raw !== "object" || raw === null) return NO_PLOT;
  const { things, attributes } = raw as {
    things?: unknown;
    attributes?: unknown;
  };
  return { things: points(things), attributes: points(attributes) };
}

const length = (point: Point): number => Math.hypot(...point);

const inner = (one: Point, other: Point): number =>
  one.reduce((sum, value, index) => sum + value * (other[index] ?? 0), 0);

export type Thing = {
  readonly id: string;
  // The thing's own point, scaled so that all but the furthest hundredth of
  // the things drawn are within one of the centre.
  readonly point: Point;
  // The viewer has thumbed the thing itself.
  readonly own: boolean;
};

export type Chosen = {
  readonly things: readonly Thing[];
  // Liking first, then the viewer's own attributes, the ones that color the
  // dots most first.
  readonly chips: readonly string[];
  // Per chip, the way its teal side faces: a unit vector.
  readonly facing: Readonly<Record<string, Point>>;
};

export const NOTHING: Chosen = { things: [], chips: [], facing: {} };

/** The things a viewer has thumbed: what `choose` and `trimPlot` call rated. */
export function ratedThings(
  ratings: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Set<string> {
  return new Set(
    Object.entries(ratings)
      .filter(([, said]) => Object.hasOwn(said, LIKING))
      .map(([id]) => id),
  );
}

type Placed = {
  readonly id: string;
  readonly point: Point;
  readonly own: boolean;
};

// A plot's things with anything said of them, the viewer's own apart from the
// rest, each the furthest from the centre first. Ids break a tie, so two
// computations of one list draw the same dots.
function furthest(
  plot: TastePlot,
  rated: ReadonlySet<string>,
): { mine: Placed[]; others: Placed[] } {
  const all = Object.entries(plot.things)
    .map(([id, point]) => ({ id, point, own: rated.has(id) }))
    .filter(({ point }) => length(point) > 0)
    .sort(
      (one, other) =>
        length(other.point) - length(one.point) || (one.id < other.id ? -1 : 1),
    );
  return {
    mine: all.filter(({ own }) => own),
    others: all.filter(({ own }) => !own),
  };
}

/**
 * A plot cut down to what a map could draw of it: as many of the viewer's own
 * things and as many of the rest as fit one map each, and every attribute.
 * What is held and cached is this, not a point for every thing a followed
 * account ever rated, which can be tens of thousands.
 */
export function trimPlot(
  plot: TastePlot,
  rated: ReadonlySet<string>,
): TastePlot {
  const { mine, others } = furthest(plot, rated);
  const things: Record<string, Point> = {};
  for (const { id, point } of [
    ...mine.slice(0, DOTS),
    ...others.slice(0, DOTS),
  ])
    Object.defineProperty(things, id, {
      value: point,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return { things, attributes: plot.attributes };
}

/**
 * What of a plot the map draws: its things and its chips.
 *
 * `rated` is the things the viewer thumbed, which come first; the rest fill
 * what is left of `DOTS`. Of either, the ones furthest from the centre. `used`
 * is the attributes the viewer has put on anything.
 */
export function choose(
  plot: TastePlot,
  rated: ReadonlySet<string>,
  used: ReadonlySet<string>,
): Chosen {
  const { mine, others } = furthest(plot, rated);
  const kept = mine.slice(0, DOTS);
  const drawn = [...others.slice(0, DOTS - kept.length), ...kept];
  if (drawn.length === 0) return NOTHING;
  const lengths = drawn.map(({ point }) => length(point)).sort((a, b) => a - b);
  const reach = lengths[Math.floor(lengths.length * 0.99)] ?? 0;
  const scale = reach > 0 ? 1 / reach : 0;
  const things = drawn.map(({ id, point, own }) => ({
    id,
    point: point.map((value) => value * scale),
    own,
  }));

  const facing: Record<string, Point> = {};
  const sized = Object.entries(plot.attributes)
    .map(([name, point]) => ({ name, point, size: length(point) }))
    .filter(({ size }) => size > 0);
  for (const { name, point, size } of sized)
    facing[name] = point.map((value) => value / size);
  const attributes = sized
    .filter(({ name }) => name !== LIKING && used.has(name))
    .sort(
      (one, other) => other.size - one.size || (one.name < other.name ? -1 : 1),
    )
    .slice(0, CHIPS)
    .map(({ name }) => name);
  const chips = Object.hasOwn(facing, LIKING)
    ? [LIKING, ...attributes]
    : attributes;
  return { things, chips, facing };
}

/**
 * How far a thing is onto the teal side of a chip, from −1 to 1: its inner
 * product with the way the chip faces, with less than half the reach of the
 * things already counting as all the way.
 */
export function shade(thing: Thing, facing: Point): number {
  return Math.max(-1, Math.min(1, inner(thing.point, facing) / 0.45));
}

/** Whether the things' own points are places, or have to be laid out. */
export function flat(chosen: Chosen): boolean {
  return chosen.things.every(({ point }) => point.length === 2);
}

export type Dot = {
  readonly thing: Thing;
  // On a square from −1 to 1 each way, up being up.
  readonly x: number;
  readonly y: number;
};

/**
 * The things of a rank-two plot where their own two numbers put them, turned
 * so that liking points straight up: higher is liked more. A turn changes no
 * inner product, so a chip still splits the dots along a straight line.
 */
export function placeFlat(chosen: Chosen): Dot[] {
  const liking = Object.hasOwn(chosen.facing, LIKING)
    ? chosen.facing[LIKING]
    : undefined;
  const angle = liking
    ? Math.PI / 2 - Math.atan2(liking[1] ?? 0, liking[0] ?? 0)
    : 0;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return chosen.things.map((thing) => {
    const [x, y] = [thing.point[0] ?? 0, thing.point[1] ?? 0];
    const far = Math.max(Math.hypot(x, y), 1);
    return {
      thing,
      x: (x * cos - y * sin) / far,
      y: (x * sin + y * cos) / far,
    };
  });
}

/** The things at the places a layout gave them, by id. */
export function placeAt(
  chosen: Chosen,
  places: Readonly<Record<string, Point>>,
): Dot[] {
  return chosen.things.flatMap((thing) => {
    const place = Object.hasOwn(places, thing.id) ? places[thing.id] : null;
    const [x, y] = [place?.[0], place?.[1]];
    if (typeof x !== "number" || typeof y !== "number") return [];
    else if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    else return [{ thing, x, y }];
  });
}

/** The things' own points by id: what a layout is asked to place. */
export function pointsOf(chosen: Chosen): Record<string, Point> {
  const out: Record<string, Point> = {};
  for (const { id, point } of chosen.things)
    Object.defineProperty(out, id, {
      value: point,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return out;
}

/**
 * The dot a step from `from` in one of the four directions lands on: the
 * nearest that lies more that way than to either side. How a keyboard walks
 * the map.
 */
export function step(
  dots: readonly Dot[],
  from: { readonly x: number; readonly y: number },
  [across, up]: readonly [number, number],
): Dot | null {
  let best: Dot | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const dot of dots) {
    const [dx, dy] = [dot.x - from.x, dot.y - from.y];
    const along = dx * across + dy * up;
    const aside = Math.abs(dx * up - dy * across);
    if (along <= 1e-9 || aside > along) continue;
    const gap = Math.hypot(dx, dy);
    if (gap < bestGap) {
      best = dot;
      bestGap = gap;
    }
  }
  return best;
}

/** The dot nearest a point of the square, if one is within `within` of it. */
export function nearest(
  dots: readonly Dot[],
  x: number,
  y: number,
  within: number,
): Dot | null {
  let best: Dot | null = null;
  let bestGap = within;
  for (const dot of dots) {
    const gap = Math.hypot(dot.x - x, dot.y - y);
    if (gap <= bestGap) {
      best = dot;
      bestGap = gap;
    }
  }
  return best;
}
