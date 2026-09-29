/**
 * The public indices a thing can be linked to, and how the add button looks a
 * name up in them (DESIGN §1.2, §3.2 `item_refs`).
 *
 * A source is a key, the pattern its ids must match, how a link is built from
 * an id, what attribution it needs, and an adapter that turns what
 * was typed into requests and their answers into candidates. Adding a source is
 * one entry here, its adapter, and one row of `private.ref_sources`; the
 * database checks an id against that row's copy of the same pattern, and
 * `tests/references.test.ts` checks the two copies agree.
 *
 * Pure: nothing here fetches. The browser sends the requests (`web/utils/
 * lookup.ts`), straight to the index, and hands the answers back.
 */

import { normalizeId } from "./index.ts";
import { foldQuery, matchTerm } from "./search.ts";

export type SourceKey = "wikidata" | "osm";

/** A thing's link: which index, and its id there. */
export type Reference = {
  readonly source: SourceKey;
  readonly ref: string;
};

/** One thing an index offered for what was typed. */
export type Candidate = Reference & {
  // What the thing would be called here, as an id, best first. A place has
  // longer spellings to fall back on when another link already holds the
  // shorter; a Wikipedia title has one.
  readonly names: readonly string[];
  // One line, shown beside the name and stored nowhere.
  readonly description: string;
  // Folded text every typed word must be found in: the name, the description,
  // and for Wikipedia the redirects that led to the page.
  readonly matchText: string;
};

export type LookupRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** Rounded before it is sent (`roundPosition`). */
export type Position = { readonly lat: number; readonly lon: number };

// Shown once under the offered rows while any of this source's is among
// them. Not on a linked thing: a stored result shown later owes none (OSMF's
// geocoding guideline).
export type Attribution = {
  readonly text: string;
  readonly href: string;
};

export type Source = {
  readonly key: SourceKey;
  // The link's words, and what `/privacy/` calls it.
  readonly label: string;
  // Anchored, and the same text in JavaScript and in Postgres: the database
  // compiles its own copy. It must never admit `/`, `?`, `#` or `:`, because a
  // link is this id spliced into a fixed URL.
  readonly pattern: string;
  readonly link: (ref: string) => string;
  readonly attribution: Attribution | null;
  // How many of the rows shown are kept for this source before others fill
  // the rest (`pickShown`).
  readonly share: number;
  // Whether it can use the viewer's rough position.
  readonly usesPosition: boolean;
  readonly requests: (
    typed: string,
    near: Position | null,
  ) => readonly LookupRequest[];
  // One answer per request, null for one that failed.
  readonly parse: (answers: readonly unknown[]) => readonly Candidate[];
  // A second question, about the candidates whose every word matched: what
  // is asked, and which of them are kept. A source without one keeps them all.
  readonly check?: {
    readonly requests: (
      candidates: readonly Candidate[],
    ) => readonly LookupRequest[];
    readonly keep: (
      candidates: readonly Candidate[],
      answers: readonly unknown[],
    ) => readonly Candidate[];
  };
  // Whether one folded typed word is found in a candidate's `matchText`.
  readonly wordMatches: (word: string, matchText: string) => boolean;
};

// Wikimedia's policy asks a browser client to name itself this way, since it
// cannot set `User-Agent`.
const WIKI_HEADERS = {
  "Api-User-Agent":
    "grapevine (https://grapevine.hafa.cc/; support@grapevine.hafa.cc)",
};

const PER_REQUEST = 8;

/**
 * An index's title as a name, or null when it cannot be one.
 *
 * `™ ® ©` go, since nobody types them, and so does `#` at the front of a word,
 * which search reads as "attributes only". Whatever else `normalizeId` refuses
 * is not offered.
 */
export function titleToName(title: string): string | null {
  return normalizeId(
    title
      .replace(/[™®©]/gu, "")
      .replace(/(^|\s)#+/gu, "$1")
      .replace(/\s+/gu, " "),
  );
}

/**
 * Text a typed word is looked for in, folded as a query is, and folded again
 * with punctuation as a break: `searchFold` drops punctuation, which joins
 * `moby-dick` into one word, while `moby dick` is typed as two. Holding both
 * spellings finds either way of typing it, and `joes` still finds `joe's`.
 */
function wordsOf(text: string): string {
  const joined = foldQuery(text);
  const broken = foldQuery(text.replace(/\p{P}/gu, " "));
  return joined === broken ? joined : `${joined} ${broken}`;
}

type WikiPage = {
  title?: unknown;
  index?: unknown;
  description?: unknown;
  pageprops?: { wikibase_item?: unknown; disambiguation?: unknown };
};
type WikiAnswer = {
  query?: {
    pages?: WikiPage[];
    redirects?: { from?: unknown; to?: unknown }[];
  };
};

function wikiCandidates(answer: unknown): Candidate[] {
  const query = (answer as WikiAnswer | null)?.query;
  const pages = Array.isArray(query?.pages) ? [...query.pages] : [];
  const redirects = Array.isArray(query?.redirects) ? query.redirects : [];
  pages.sort((left, right) => Number(left.index) - Number(right.index));
  const found: Candidate[] = [];
  for (const page of pages) {
    const ref = page.pageprops?.wikibase_item;
    if (typeof ref !== "string" || typeof page.title !== "string") continue;
    if (page.pageprops?.disambiguation !== undefined) continue;
    const name = titleToName(page.title);
    if (name === null) continue;
    // Lower case, as everything on screen is.
    const description =
      typeof page.description === "string"
        ? page.description.toLowerCase()
        : "";
    const from = redirects
      .filter((redirect) => redirect.to === page.title)
      .map((redirect) => wordsOf(String(redirect.from ?? "")));
    found.push({
      source: "wikidata",
      ref,
      names: [name],
      description,
      matchText: [wordsOf(name), wordsOf(description), ...from].join(" "),
    });
  }
  return found;
}

/**
 * Full-text search and the search box's completion, interleaved and without
 * repeats. The first finds words anywhere in a title; the second forgives a
 * typo and a half-typed last word, and reports the redirect a page was reached
 * by.
 */
function parseWikipedia(answers: readonly unknown[]): Candidate[] {
  const [search, prefix] = answers.map(wikiCandidates);
  const merged: Candidate[] = [];
  const seen = new Set<string>();
  const longest = Math.max(search?.length ?? 0, prefix?.length ?? 0);
  for (let index = 0; index < longest; index += 1) {
    for (const candidate of [prefix?.[index], search?.[index]]) {
      if (candidate === undefined || seen.has(candidate.ref)) continue;
      seen.add(candidate.ref);
      merged.push(candidate);
    }
  }
  return merged;
}

function wikipediaRequests(typed: string): LookupRequest[] {
  const common = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=pageprops%7Cdescription&ppprop=wikibase_item%7Cdisambiguation&redirects=1`;
  const text = encodeURIComponent(typed);
  return [
    {
      url: `${common}&generator=search&gsrsearch=${text}&gsrnamespace=0&gsrlimit=${PER_REQUEST}`,
      headers: WIKI_HEADERS,
    },
    {
      url: `${common}&generator=prefixsearch&gpssearch=${text}&gpsnamespace=0&gpslimit=${PER_REQUEST}`,
      headers: WIKI_HEADERS,
    },
  ];
}

// What a thing is, as Wikidata's "instance of" (P31) says it. Only these are
// offered: a thing somebody would say yes or no to. Anything else is not —
// a landform, a person who is not a performer, a list, an event, an idea — and
// neither is a candidate whose kind could not be read. Adding the name as
// typed still works for all of them.
const RATEABLE_INSTANCE: ReadonlySet<string> = new Set([
  // Books, comics and what is printed.
  "Q7725634", // literary work
  "Q571", // book
  "Q8261", // novel
  "Q47461344", // written work
  "Q1667921", // novel series
  "Q277759", // book series
  "Q725377", // graphic novel
  "Q1004", // comic
  "Q14406742", // comic book series
  "Q21198342", // manga series
  "Q41298", // magazine
  "Q1002697", // periodical
  "Q11032", // newspaper
  // Film, television, radio, podcasts.
  "Q11424", // film
  "Q20650540", // anime film
  "Q506240", // television film
  "Q29168811", // animated feature film
  "Q202866", // animated film
  "Q93204", // documentary film
  "Q24856", // film series
  "Q13593818", // film trilogy
  "Q5398426", // television series
  "Q526877", // web series
  "Q1259759", // miniseries
  "Q581714", // animated series
  "Q63952888", // anime television series
  "Q15416", // television program
  "Q21191270", // television series episode
  "Q1555508", // radio program
  "Q3511312", // radio drama series
  "Q24634210", // podcast show
  "Q24633474", // audio podcast
  // Music and the stage.
  "Q482994", // album
  "Q208569", // studio album
  "Q209939", // live album
  "Q222910", // compilation album
  "Q169930", // extended play
  "Q134556", // single
  "Q7366", // song
  "Q105543609", // musical work/composition
  "Q2743", // musical play
  "Q58483083", // dramatico-musical work
  "Q25379", // play
  "Q7777570", // theatrical production
  // Games, software, franchises, art.
  "Q7889", // video game
  "Q7058673", // video game series
  "Q192851", // arcade video game
  "Q209163", // expansion add-on
  "Q131436", // board game
  "Q1783817", // cooperative board game
  "Q142714", // card game
  "Q196600", // media franchise
  "Q7397", // software
  "Q620615", // mobile app
  "Q35127", // website
  "Q3305213", // painting
  // Brands, companies and chains.
  "Q431289", // brand
  "Q2519914", // brand name
  "Q10429667", // car brand
  "Q15075508", // beer brand
  "Q4830453", // business
  "Q783794", // company
  "Q891723", // public company
  "Q1589009", // privately held company
  "Q6881511", // enterprise
  "Q507619", // retail chain
  "Q18043413", // supermarket chain
  "Q18534542", // restaurant chain
  "Q18509232", // fast food restaurant chain
  "Q18654742", // pizzeria chain
  "Q76212517", // café chain
  "Q43229", // organization
  "Q13235160", // manufacturer
  "Q2363097", // coffee roaster
  "Q131734", // brewery
  "Q156362", // winery
  // Places people go.
  "Q11707", // restaurant
  "Q1751429", // fast food restaurant
  "Q1501212", // pizzeria
  "Q30022", // café
  "Q274393", // bakery
  "Q187456", // bar
  "Q212198", // pub
  "Q622425", // nightclub
  "Q213441", // shop
  "Q200764", // bookstore
  "Q216107", // department store
  "Q37654", // market
  "Q28142754", // food market
  "Q2080521", // market hall
  "Q33506", // museum
  "Q207694", // art museum
  "Q43501", // zoo
  "Q2281788", // public aquarium
  "Q194195", // amusement park
  "Q2416723", // theme park
  "Q740326", // water park
  "Q22698", // park
  "Q22746", // urban park
  "Q167346", // botanical garden
  "Q27686", // hotel
  "Q41253", // movie theater
  "Q8719053", // music venue
  "Q1060829", // concert hall
  "Q24354", // theatre building
  "Q570116", // tourist attraction
  "Q17431399", // national museum
  "Q588140", // science museum
  "Q16735822", // history museum
  "Q1007870", // art gallery
  "Q2319498", // architectural landmark
  "Q16970", // church building
  "Q163687", // basilica
  "Q120560", // minor basilica
  "Q2977", // cathedral
  "Q44539", // temple
  "Q32815", // mosque
  "Q23413", // castle
  "Q16560", // palace
  "Q12518", // tower
  "Q4989906", // monument
  // Performers: a band, and a person below by what they do.
  "Q215380", // musical group
  "Q5741069", // rock band
  "Q2088357", // musical ensemble
  "Q216337", // boy band
  "Q641066", // girl group
  "Q9212979", // musical duo
  "Q18510489", // comedy troupe
]);

// A food, a drink or a product model is usually a class of its own on
// Wikidata — pizza is a subclass of food, not an instance of it — so for these
// "subclass of" (P279) counts as well. Not for a kind of place: a subclass of
// restaurant is "ramen shop", which is nowhere.
const RATEABLE_CLASS: ReadonlySet<string> = new Set([
  "Q2095", // food
  "Q8195619", // human food
  "Q19861951", // type of food or dish
  "Q746549", // dish
  "Q1778821", // cuisine
  "Q41415", // soup
  "Q98826752", // noodle dish
  "Q182940", // dessert
  "Q3712597", // dessert with spoon
  "Q13276", // cake
  "Q13266", // cookie
  "Q477248", // pastry
  "Q2251745", // baked good
  "Q7802", // bread
  "Q10943", // cheese
  "Q28803", // sandwich
  "Q9266", // salad
  "Q178359", // sauce
  "Q2596997", // condiment
  "Q185583", // candy
  "Q195", // chocolate
  "Q13233", // ice cream
  "Q749316", // snack
  "Q13030962", // convenience food
  "Q16323605", // food brand
  "Q40050", // drink
  "Q2647467", // non-alcoholic beverage
  "Q19359564", // hot beverage
  "Q154", // alcoholic beverage
  "Q134768", // cocktail
  "Q282", // wine
  "Q44", // beer
  "Q56139", // liquor
  "Q8486", // coffee
  "Q37756327", // coffee drink
  "Q6097", // tea
  "Q2640574", // plant milk
  "Q2424752", // product
  "Q10929058", // product model
  "Q3231690", // car model
  "Q19723451", // smartphone model
  "Q71266741", // smartphone model series
  "Q811701", // model series
  "Q8076", // video game console
  "Q581105", // consumer electronics
  "Q22645", // smartphone
  "Q155972", // tablet computer
  "Q726235", // e-book reader
  "Q212920", // home appliance
  "Q211841", // coffeemaker
  "Q1521410", // kitchenware
  "Q154038", // cookware and bakeware
]);

// A person is offered only as a performer: somebody whose own performing is
// what is listened to or watched. An author, a director or an actor is rated
// through their work.
const HUMAN = "Q5";
const PERFORMER: ReadonlySet<string> = new Set([
  "Q177220", // singer
  "Q488205", // singer-songwriter
  "Q639669", // musician
  "Q2252262", // rapper
  "Q130857", // disc jockey
  "Q36834", // composer
  "Q855091", // guitarist
  "Q386854", // drummer
  "Q486748", // pianist
  "Q1278335", // instrumentalist
  "Q15981151", // jazz musician
  "Q245068", // comedian
  "Q18545066", // stand-up comedian
]);

export type WikidataClaim = {
  rank?: unknown;
  mainsnak?: { datavalue?: { value?: { id?: unknown } } };
};
type WikidataAnswer = {
  entities?: Record<string, { claims?: Record<string, WikidataClaim[]> }>;
};

function claimed(
  claims: Record<string, WikidataClaim[]> | undefined,
  property: string,
): string[] {
  const values = claims?.[property];
  if (!Array.isArray(values)) return [];
  return values
    .filter((claim) => claim.rank !== "deprecated")
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter((id): id is string => typeof id === "string");
}

/** Whether Wikidata's claims make this a thing somebody would rate. */
export function isRateable(
  claims: Record<string, WikidataClaim[]> | undefined,
): boolean {
  const instanceOf = claimed(claims, "P31");
  if (instanceOf.some((id) => RATEABLE_INSTANCE.has(id))) return true;
  if (
    [...instanceOf, ...claimed(claims, "P279")].some((id) =>
      RATEABLE_CLASS.has(id),
    )
  )
    return true;
  return (
    instanceOf.includes(HUMAN) &&
    claimed(claims, "P106").some((id) => PERFORMER.has(id))
  );
}

function wikidataKindRequests(
  candidates: readonly Candidate[],
): LookupRequest[] {
  const ids = candidates.map((candidate) => candidate.ref).join("%7C");
  return [
    {
      url: `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims&ids=${ids}`,
      headers: WIKI_HEADERS,
    },
  ];
}

function keepRateable(
  candidates: readonly Candidate[],
  answers: readonly unknown[],
): Candidate[] {
  const entities = (answers[0] as WikidataAnswer | null)?.entities;
  if (entities === undefined || entities === null) return [];
  return candidates.filter((candidate) =>
    isRateable(entities[candidate.ref]?.claims),
  );
}

type PhotonProperties = Partial<
  Record<
    | "osm_type"
    | "osm_key"
    | "osm_value"
    | "name"
    | "housenumber"
    | "street"
    | "locality"
    | "district"
    | "city"
    | "state"
    | "country",
    unknown
  >
> & { osm_id?: unknown };

const OSM_TYPES: Readonly<Record<string, string>> = {
  N: "n",
  W: "w",
  R: "r",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Where a place is, for its name: its neighbourhood and its city, or the two
 * nearest to it of city, state and country when it has no neighbourhood.
 * Nothing that repeats the name, or repeats itself.
 */
export function placeQualifier(place: PhotonProperties): string[] {
  const name = (text(place.name) ?? "").toLowerCase();
  const differs = (value: string | null, taken: readonly string[]) =>
    value !== null &&
    value.toLowerCase() !== name &&
    !taken.some((other) => other.toLowerCase() === value.toLowerCase());
  const neighbourhood = [text(place.locality), text(place.district)].find(
    (value) => differs(value, []),
  );
  const wider = [text(place.city), text(place.state), text(place.country)];
  const parts: string[] = neighbourhood ? [neighbourhood] : [];
  for (const value of wider) {
    if (parts.length === 2) break;
    if (value !== null && differs(value, parts)) parts.push(value);
  }
  return parts;
}

// What OpenStreetMap calls a place somebody would rate: somewhere to eat,
// drink, shop, stay, see or play. Keys not here — a village, a street, a
// peak, a river, a building with no use named — are not offered.
const RATEABLE_PLACE: Readonly<Record<string, ReadonlySet<string> | "any">> = {
  shop: "any",
  craft: new Set(["brewery", "winery", "distillery", "confectionery"]),
  amenity: new Set([
    "restaurant",
    "cafe",
    "bar",
    "pub",
    "fast_food",
    "food_court",
    "ice_cream",
    "biergarten",
    "nightclub",
    "theatre",
    "cinema",
    "arts_centre",
    "marketplace",
    "library",
    "casino",
  ]),
  tourism: new Set([
    "attraction",
    "museum",
    "gallery",
    "zoo",
    "aquarium",
    "theme_park",
    "hotel",
    "hostel",
    "guest_house",
    "camp_site",
  ]),
  leisure: new Set([
    "park",
    "garden",
    "water_park",
    "golf_course",
    "miniature_golf",
    "bowling_alley",
    "amusement_arcade",
    "escape_game",
    "fitness_centre",
    "sports_centre",
    "stadium",
  ]),
};

function isRateablePlace(properties: PhotonProperties): boolean {
  const values = RATEABLE_PLACE[String(properties.osm_key)];
  return values === "any" || values?.has(String(properties.osm_value)) === true;
}

function placeCandidate(properties: PhotonProperties): Candidate | null {
  const type = OSM_TYPES[String(properties.osm_type)];
  const id = properties.osm_id;
  const rawName = text(properties.name);
  if (type === undefined || rawName === null) return null;
  if (!isRateablePlace(properties)) return null;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const ref = `${type}${id}`;
  const parts = placeQualifier(properties);
  const street = text(properties.street);
  const house = text(properties.housenumber);
  const spell = (extra: readonly string[]) => {
    const inside = [...extra, ...parts];
    return titleToName(
      inside.length > 0 ? `${rawName} (${inside.join(", ")})` : rawName,
    );
  };
  const names = [
    spell([]),
    street ? spell([street]) : null,
    street && house ? spell([`${house} ${street}`]) : null,
  ].filter(
    (name, index, all): name is string =>
      name !== null && all.indexOf(name) === index,
  );
  const first = names[0];
  if (first === undefined) return null;
  const kind = text(properties.osm_value)?.replaceAll("_", " ") ?? null;
  const where = [street, text(properties.city) ?? text(properties.state)]
    .filter((value) => value !== null)
    .join(", ");
  const description = [kind, where]
    .filter((value) => value !== null && value.length > 0)
    .join(" · ")
    .toLowerCase();
  return {
    source: "osm",
    ref,
    names,
    description,
    // Every area it is in, so `joe's pizza new york` finds it whichever the
    // qualifier named.
    matchText: [
      wordsOf(first),
      wordsOf(description),
      ...[
        properties.locality,
        properties.district,
        properties.city,
        properties.state,
        properties.country,
      ].map((value) => wordsOf(text(value) ?? "")),
    ].join(" "),
  };
}

function parsePhoton(answers: readonly unknown[]): Candidate[] {
  const features = (answers[0] as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const candidate = placeCandidate(
      ((feature as { properties?: unknown } | null)?.properties ??
        {}) as PhotonProperties,
    );
    if (candidate === null || seen.has(candidate.ref)) continue;
    seen.add(candidate.ref);
    found.push(candidate);
  }
  return found;
}

/** Two decimals, about a kilometre: the most a place search is sent. */
export function roundPosition(position: Position): Position {
  const round = (value: number) => Math.round(value * 100) / 100;
  return { lat: round(position.lat), lon: round(position.lon) };
}

function photonRequests(typed: string, near: Position | null): LookupRequest[] {
  const where =
    near === null
      ? ""
      : (() => {
          const { lat, lon } = roundPosition(near);
          return `&lat=${lat}&lon=${lon}`;
        })();
  return [
    {
      url: `https://photon.komoot.io/api/?q=${encodeURIComponent(typed)}&limit=${PER_REQUEST}&lang=en${where}`,
      headers: {},
    },
  ];
}

const OSM_PATHS: Readonly<Record<string, string>> = {
  n: "node",
  w: "way",
  r: "relation",
};

export const SOURCES: readonly Source[] = [
  {
    key: "wikidata",
    label: "Wikipedia",
    pattern: "^Q[1-9][0-9]{0,11}$",
    // Wikidata's id outlives a renamed article; this redirects to the current
    // English one.
    link: (ref) =>
      `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${ref}`,
    attribution: null,
    share: 3,
    usesPosition: false,
    requests: (typed) => wikipediaRequests(typed),
    parse: parseWikipedia,
    check: { requests: wikidataKindRequests, keep: keepRateable },
    // Forgiving, as the list's search is: a typo, or a word half typed.
    wordMatches: (word, matchText) =>
      matchTerm(word, matchText, { loose: false, typos: true, whole: true }) !==
      null,
  },
  {
    key: "osm",
    label: "OpenStreetMap",
    pattern: "^[nwr][1-9][0-9]{0,14}$",
    link: (ref) =>
      `https://www.openstreetmap.org/${OSM_PATHS[ref[0] ?? ""]}/${ref.slice(1)}`,
    // ODbL §4.3.
    attribution: {
      text: "© OpenStreetMap contributors",
      href: "https://www.openstreetmap.org/copyright",
    },
    share: 2,
    usesPosition: true,
    requests: photonRequests,
    parse: parsePhoton,
    // Whole words only: Photon's own fuzzing returns far-off look-alikes
    // (`tirmisu` finds `timiș`), and a forgiving filter lets them through.
    wordMatches: (word, matchText) => matchText.split(" ").includes(word),
  },
];

const BY_KEY = new Map(SOURCES.map((source) => [source.key, source]));

export function sourceOf(key: string): Source | null {
  return BY_KEY.get(key as SourceKey) ?? null;
}

/** Whether this is a reference the database would take. */
export function isReference(source: string, ref: string): boolean {
  const known = sourceOf(source);
  return known !== null && new RegExp(known.pattern, "u").test(ref);
}

/** The link, or null for a reference that is not one. */
export function referenceUrl(reference: Reference): string | null {
  return isReference(reference.source, reference.ref)
    ? (sourceOf(reference.source)?.link(reference.ref) ?? null)
    : null;
}

/** The words that must all be found, folded the way `matchText` is. */
export function typedWords(typed: string): string[] {
  return foldQuery(typed).split(" ").filter(Boolean);
}

/** Every typed word is found in the candidate, by its source's rule. */
export function isGoodMatch(typed: string, candidate: Candidate): boolean {
  const source = sourceOf(candidate.source);
  const words = typedWords(typed);
  return (
    source !== null &&
    words.length > 0 &&
    words.every((word) => source.wordMatches(word, candidate.matchText))
  );
}

export const MAX_SHOWN = 5;

// How many of one source's good matches its `check` is asked about: enough
// that five survive a filter that drops half, few enough to answer quickly.
export const MAX_CHECKED = 10;

/** The candidates a source's `check` is asked about, best first. */
export function toCheck(
  typed: string,
  candidates: readonly Candidate[],
): Candidate[] {
  return candidates
    .filter((candidate) => isGoodMatch(typed, candidate))
    .slice(0, MAX_CHECKED);
}

/**
 * What is offered: each source's good matches in its own order, each source's
 * `share` first in registry order, then whatever is left, at most `MAX_SHOWN`.
 */
export function pickShown(
  typed: string,
  bySource: ReadonlyMap<SourceKey, readonly Candidate[]>,
): Candidate[] {
  const good = SOURCES.map((source) =>
    (bySource.get(source.key) ?? []).filter((candidate) =>
      isGoodMatch(typed, candidate),
    ),
  );
  const first = good.flatMap((candidates, index) =>
    candidates.slice(0, SOURCES[index]?.share ?? 0),
  );
  const rest = good.flatMap((candidates, index) =>
    candidates.slice(SOURCES[index]?.share ?? 0),
  );
  return [...first, ...rest].slice(0, MAX_SHOWN);
}
