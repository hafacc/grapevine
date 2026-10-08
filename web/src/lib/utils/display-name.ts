// The characters `profiles_display_name_plain` refuses (0009): control
// characters, and the bidirectional marks and overrides, one of which in a name
// reverses the rest of the line it is drawn in. Refused in the field so the
// write does not fail at the database. Ranges rather than a regex, because a
// regex literal with control characters in it is what a linter rightly flags.
const REFUSED: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function refused(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return REFUSED.some(([low, high]) => codePoint >= low && codePoint <= high);
}

// Null when valid, or a human-readable reason. Anything else goes: a name is
// what its owner wants to be called, and nobody is found by it.
export function validateDisplayName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1) return "type a name.";
  if (name.length > 50) return "at most 50 characters.";
  if ([...name].some(refused)) return "that has a character a name can't hold.";
  return null;
}
