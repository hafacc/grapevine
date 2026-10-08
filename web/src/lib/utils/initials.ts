// The scripts a name is likely to mix. A name written twice — "Chen Wei 陈伟"
// — has its initials taken from one writing of it, not one letter from each.
const SCRIPTS: readonly RegExp[] = [
  /\p{Script=Latin}/u,
  /\p{Script=Han}/u,
  /\p{Script=Hiragana}|\p{Script=Katakana}/u,
  /\p{Script=Hangul}/u,
  /\p{Script=Cyrillic}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Arabic}/u,
  /\p{Script=Hebrew}/u,
  /\p{Script=Devanagari}/u,
  /\p{Script=Thai}/u,
];

function sameScript(first: string, other: string): boolean {
  const script = SCRIPTS.find((pattern) => pattern.test(first));
  return script === undefined || script.test(other);
}

/**
 * The letters an avatar with no photo is drawn with: the first word's first
 * letter and the last word's, among the words written in the same script as
 * the first.
 *
 * Not lower-cased with the rest of the interface: a person's own display name
 * from Google is the one place a capital letter belongs.
 */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const [firstWord] = words;
  if (firstWord === undefined) return "?";
  const first = [...firstWord][0] ?? "";
  const kin = words.filter((word) => sameScript(first, [...word][0] ?? ""));
  const lastWord = kin.length > 1 ? kin.at(-1) : undefined;
  const last = lastWord === undefined ? "" : ([...lastWord][0] ?? "");
  return `${first}${last}`;
}
