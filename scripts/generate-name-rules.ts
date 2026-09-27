// Writes the allow-list for names and attributes (DESIGN §3.2) from a pinned
// Unicode version: `shared/src/name-tables.ts`, which the client reads, and a
// new migration replacing `private.is_normalized_id`, which the column CHECKs
// call. Both are built by `shared/src/name-rules.ts`, so they cannot disagree.
//
//   bun scripts/generate-name-rules.ts <NNNN_name>
//
// The argument names the migration to write. A recorded migration is frozen,
// so regenerating (a new Unicode version, a change to EXTRA below) writes the
// next number, never over an old one. The Unicode files are fetched once into
// ~/.cache/grapevine/unicode-<version>/.
//
// The version is 15.1 because Postgres 17, which the project runs, carries
// 15.1's normalization tables: nothing allowed here is a character its
// `is nfkc normalized` has never heard of.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "15.1.0";
const ROOT = join(import.meta.dir, "..");
const CACHE = join(homedir(), ".cache", "grapevine", `unicode-${VERSION}`);
const SOURCES: Readonly<Record<string, string>> = {
  "IdentifierStatus.txt": `security/${VERSION}/IdentifierStatus.txt`,
  "ScriptExtensions.txt": `${VERSION}/ucd/ScriptExtensions.txt`,
  "Scripts.txt": `${VERSION}/ucd/Scripts.txt`,
  "PropertyValueAliases.txt": `${VERSION}/ucd/PropertyValueAliases.txt`,
  "DerivedGeneralCategory.txt": `${VERSION}/ucd/extracted/DerivedGeneralCategory.txt`,
  "DerivedJoiningType.txt": `${VERSION}/ucd/extracted/DerivedJoiningType.txt`,
  "DerivedCombiningClass.txt": `${VERSION}/ucd/extracted/DerivedCombiningClass.txt`,
  "DerivedCoreProperties.txt": `${VERSION}/ucd/DerivedCoreProperties.txt`,
  "emoji-data.txt": `${VERSION}/ucd/emoji/emoji-data.txt`,
};

// What a name may hold beyond UTS #39's Identifier_Status=Allowed, which is
// letters, marks and digits plus ' - . : · ‐ ’ and a few script-specific
// marks. Ordinary punctuation, the brackets and quotes titles are written
// with, and four currency signs. Deliberately not here: < > [ ] { } \ ^ ` | ~ =
// and the rest of the symbols, and every emoji and pictograph.
const EXTRA: readonly number[] = [
  0x20, // space
  ...[0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x28, 0x29, 0x2a, 0x2b, 0x2c], // ! " # $ % & ( ) * + ,
  ...[0x2f, 0x3b, 0x3f, 0x40], // / ; ? @
  ...[0xa1, 0xa3, 0xa5, 0xab, 0xbb, 0xbf], // ¡ £ ¥ « » ¿
  ...[0x2013, 0x2014, 0x2018, 0x201c, 0x201d, 0x201e, 0x20ac], // – — ‘ “ ” „ €
  ...[0x3001, 0x3002], // 、 。
  ...Array.from({ length: 10 }, (_, offset) => 0x3008 + offset), // 〈〉《》「」『』【】
  ...[0x060c, 0x061b, 0x061f], // Arabic comma, semicolon, question mark
  ...[0x0964, 0x0965], // danda, double danda
  // ZWNJ and ZWJ, which UTS #39 leaves to context: `name-rules.ts` admits
  // them only where RFC 5892 does.
  0x200c,
  0x200d,
];

const CODE_POINTS = 0x110000;

async function source(name: string): Promise<string> {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    mkdirSync(CACHE, { recursive: true });
    const response = await fetch(
      `https://www.unicode.org/Public/${SOURCES[name]}`,
    );
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    writeFileSync(path, await response.text());
  }
  return readFileSync(path, "utf8");
}

// Every `low..high ; value` line of a UCD file, the value's fields split.
async function* entries(
  name: string,
): AsyncGenerator<[number, number, string[]]> {
  for (const line of (await source(name)).split("\n")) {
    const data = line.split("#")[0]?.trim();
    if (!data) continue;
    const [range, ...fields] = data.split(";").map((field) => field.trim());
    const [low, high] = (range as string).split("..");
    const first = Number.parseInt(low as string, 16);
    yield [first, high === undefined ? first : Number.parseInt(high, 16), fields];
  }
}

async function property(name: string, value?: string): Promise<Set<number>> {
  const found = new Set<number>();
  for await (const [low, high, fields] of entries(name)) {
    if (value !== undefined && fields[0] !== value) continue;
    for (let codePoint = low; codePoint <= high; codePoint++)
      found.add(codePoint);
  }
  return found;
}

async function values(name: string): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  for await (const [low, high, fields] of entries(name))
    for (let codePoint = low; codePoint <= high; codePoint++)
      found.set(codePoint, fields[0] as string);
  return found;
}

function table(codePoints: Iterable<number>): string {
  const sorted = [...new Set(codePoints)].sort(
    (left, right) => left - right,
  );
  const ranges: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const low = sorted[index] as number;
    let high = low;
    while (sorted[index + 1] === high + 1) {
      high++;
      index++;
    }
    index++;
    ranges.push(
      low === high ? low.toString(16) : `${low.toString(16)}-${high.toString(16)}`,
    );
  }
  return ranges.join(" ");
}

async function main(): Promise<void> {
  const migration = process.argv[2];
  if (!migration || !/^\d{4}_[a-z0-9_]+$/.test(migration))
    throw new Error("usage: generate-name-rules.ts <NNNN_migration_name>");

  const allowedStatus = new Set<number>();
  for await (const [low, high, fields] of entries("IdentifierStatus.txt"))
    if (fields[0] === "Allowed")
      for (let codePoint = low; codePoint <= high; codePoint++)
        allowedStatus.add(codePoint);
  const category = await values("DerivedGeneralCategory.txt");
  const joining = await values("DerivedJoiningType.txt");
  const virama = await property("DerivedCombiningClass.txt", "9");
  const ignorable = await property(
    "DerivedCoreProperties.txt",
    "Default_Ignorable_Code_Point",
  );
  const pictographic = await property("emoji-data.txt", "Extended_Pictographic");
  const emojiPresentation = await property("emoji-data.txt", "Emoji_Presentation");

  const shortScript = new Map<string, string>();
  for (const line of (await source("PropertyValueAliases.txt")).split("\n")) {
    const fields = line.split("#")[0]?.split(";").map((field) => field.trim());
    if (fields?.[0] === "sc")
      shortScript.set(fields[2] as string, fields[1] as string);
  }
  const extensions = new Map<number, string[]>();
  for await (const [low, high, fields] of entries("Scripts.txt"))
    for (let codePoint = low; codePoint <= high; codePoint++)
      extensions.set(codePoint, [shortScript.get(fields[0] as string) as string]);
  const scriptOf = new Map(
    [...extensions].map(([codePoint, codes]) => [codePoint, codes[0] as string]),
  );
  for await (const [low, high, fields] of entries("ScriptExtensions.txt"))
    for (let codePoint = low; codePoint <= high; codePoint++)
      extensions.set(codePoint, (fields[0] as string).split(/\s+/));

  const keptFormat = new Set([0x200c, 0x200d]);
  const allowed = new Set<number>();
  for (let codePoint = 0; codePoint < CODE_POINTS; codePoint++) {
    if (!allowedStatus.has(codePoint) && !EXTRA.includes(codePoint)) continue;
    const general = category.get(codePoint) ?? "Cn";
    const kept = keptFormat.has(codePoint);
    if (!kept && (general.startsWith("C") || ignorable.has(codePoint))) continue;
    if (pictographic.has(codePoint) || emojiPresentation.has(codePoint)) continue;
    // An upper-case letter can never be in an id, which is lower case.
    if (general === "Lu" || general === "Lt") continue;
    const character = String.fromCodePoint(codePoint);
    if (character.normalize("NFKC") !== character)
      throw new Error(`U+${codePoint.toString(16)} is not NFKC-stable`);
    allowed.add(codePoint);
  }

  const inCategory = (prefix: string) =>
    [...allowed].filter((codePoint) =>
      (category.get(codePoint) ?? "Cn").startsWith(prefix),
    );
  const ofJoining = (...types: string[]) =>
    [...allowed].filter((codePoint) =>
      types.includes(joining.get(codePoint) ?? "U"),
    );

  const common: number[] = [];
  const scripts = new Map<string, number[]>();
  const recommended = new Set<string>();
  for (const codePoint of allowed) {
    const script = scriptOf.get(codePoint) ?? "Zzzz";
    if (script !== "Zyyy" && script !== "Zinh") recommended.add(script);
  }
  for (const codePoint of allowed) {
    if (codePoint === 0x20) continue;
    const codes = (extensions.get(codePoint) ?? ["Zzzz"]).filter(
      (code) => code !== "Zyyy" && code !== "Zinh",
    );
    if (codes.length === 0) {
      common.push(codePoint);
      continue;
    }
    const usable = codes.filter((code) => recommended.has(code));
    if (usable.length === 0)
      throw new Error(`U+${codePoint.toString(16)} is in no allowed script`);
    for (const code of usable) {
      const list = scripts.get(code) ?? [];
      list.push(codePoint);
      scripts.set(code, list);
    }
  }

  const tables = [
    ["ALLOWED", table(allowed)],
    ["MARK", table(inCategory("M"))],
    ["BASE", table([...inCategory("L"), ...inCategory("N")])],
    ["VIRAMA", table([...allowed].filter((codePoint) => virama.has(codePoint)))],
    ["JOIN_LEFT", table(ofJoining("L", "D"))],
    ["JOIN_RIGHT", table(ofJoining("R", "D"))],
    ["JOIN_TRANSPARENT", table(ofJoining("T"))],
    ["COMMON", table(common)],
  ] as const;
  const scriptEntries = [...scripts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, list]) => `  ${code}: "${table(list)}",`);
  writeFileSync(
    join(ROOT, "shared", "src", "name-tables.ts"),
    [
      `// Written by scripts/generate-name-rules.ts from Unicode ${VERSION}. Do not edit.`,
      "// Each table is hexadecimal code points and ranges, over the allow-list.",
      "",
      `export const UNICODE_VERSION = "${VERSION}";`,
      "",
      ...tables.map(([name, value]) => `export const ${name} = "${value}";`),
      "",
      "// Each recommended script's letters, marks and punctuation: whatever",
      "// lists the script among its Script_Extensions.",
      "export const SCRIPTS: Readonly<Record<string, string>> = {",
      ...scriptEntries,
      "};",
      "",
    ].join("\n"),
  );

  // In the package's own formatting, so its lint passes on a fresh write.
  Bun.spawnSync(["bun", "run", "fmt"], { cwd: join(ROOT, "shared") });

  const { nameRules, pgEscape } = await import(
    "../shared/src/name-rules.ts"
  );
  writeFileSync(
    join(ROOT, "supabase", "migrations", `${migration}.sql`),
    migrationSql(migration, nameRules(pgEscape)),
  );
}

type Rules = {
  whole: string;
  refused: readonly string[];
  singleScriptWords: readonly string[];
  latinOrCommon: string;
  latinPlusOne: string;
};

function migrationSql(migration: string, rules: Rules): string {
  const literal = (pattern: string) => `'${pattern.replaceAll("'", "''")}'`;
  const version = migration.slice(0, 4);
  return `-- Names and attributes hold ordinary letters, numbers and punctuation, and no
-- word mixes scripts (DESIGN §3.2). Written by scripts/generate-name-rules.ts
-- from Unicode ${VERSION}; do not edit by hand. \`shared/src/name-rules.ts\` builds
-- these patterns and \`isNormalizedId\` compiles the same ones for the client.
--
-- Every earlier rule stands. What is new, read off the patterns below:
--
--   * the whole id is on an allow-list: UTS #39's Identifier_Status=Allowed
--     (letters, marks and digits of the scripts in use today) plus space,
--     ordinary punctuation and $ € £ ¥ %. No emoji, no pictographs, no
--     invisible or default-ignorable characters, nothing from a historic or
--     specialist script;
--   * a combining mark sits on a letter or digit, at most four on one, and
--     never the same one twice in a row;
--   * ZWJ only after a virama and ZWNJ only after a virama or between two
--     joining letters (RFC 5892's contexts), which is where Indic scripts and
--     Persian need them;
--   * each space-separated word is one script, or Latin with one other, or
--     Latin with Han and the Japanese kana, with Han and Bopomofo, or with Han
--     and Hangul (UTS #39's "moderately restrictive"). Latin never shares a
--     word with Cyrillic or Greek, which is where its look-alikes are.
--
-- As in 0008, replacing the function is the whole change, and Postgres does not
-- re-check existing rows when a function a CHECK calls changes, so this refuses
-- to apply over a row that would now fail, and names it. The file applies in
-- one transaction, so a refusal leaves the old function in place.

create or replace function private.is_normalized_id(candidate text) returns boolean
  language sql immutable set search_path = ''
as $$
  select candidate is not null
     and char_length(candidate) between 1 and 128
     and candidate is nfkc normalized
     and candidate = lower(candidate)
     and candidate = btrim(candidate)
     and candidate !~ '\\s\\s'
     and candidate ~ ${literal(rules.whole)}
${rules.refused.map((pattern) => `     and candidate !~ ${literal(pattern)}`).join("\n")}
     and not exists (
       select from regexp_split_to_table(candidate, ' ') as word
       where ${rules.singleScriptWords.map((pattern) => `word !~ ${literal(pattern)}`).join("\n         and ")}
         and regexp_replace(word, ${literal(rules.latinOrCommon)}, '', 'g')
           !~ ${literal(rules.latinPlusOne)})
$$;

do $$
declare
  offender text;
begin
  select id into offender from public.items
    where not private.is_normalized_id(id) limit 1;
  if offender is null then
    select coalesce(nullif(tag, ''), item_id) into offender from public.ratings
      where not private.is_normalized_id(item_id)
         or (tag <> '' and not private.is_normalized_id(tag))
      limit 1;
  end if;
  if offender is not null then
    raise exception 'an existing id is no longer allowed: %', offender
      using hint = 'decide what happens to it before applying ${version}';
  end if;
end $$;
`;
}

await main();
