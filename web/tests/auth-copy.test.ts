import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

// Every surface that can report a sign-in failure reserves its message slot at
// the height of its own standing copy and swaps the text, so a line that runs
// one longer than the reservation pushes the button under it — the exact jump
// the reserved height is there to remove. Nothing but a budget keeps the copy
// short; this is the budget.
//
// 42 characters: the narrowest slot is 342px (the line under the door's card,
// at 390px less the page's px-6) and the sheets are ~350px. A count is a proxy
// for a width, so anything landing near the cap wants looking at in a browser
// rather than trusting to the number.
const BUDGET = 42;

// One door means one shared slot: `authErrorMessage` is what the welcome card
// and the name sheet both render, so its lines are the ones that have to fit.
//
// Read rather than imported: it lives in a "use client" module that pulls in
// supabase-js, and a copy-length check should not need a browser to run. Scanning
// the source also picks up a line added later, which is the half of this that a
// fixed list would miss.
const AUTH = readFileSync("utils/auth.ts", "utf8");

function literals(source: string): string[] {
  return [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
    .map((match) => match[1])
    // Prose, as against an error code, a mode or a class name — every line the
    // slot can show is a sentence, and nothing else here has a space in it.
    .filter((text) => text.includes(" "));
}

// Everything from a top-level declaration to the bare `}` that ends it. The
// terminator has to be the WHOLE line: a destructured parameter list closes
// with `}: {` in the first column too, which cut a component's body off at its
// own signature and left the scan below finding nothing.
function body(source: string, declaration: string): string {
  const after = source.split(declaration)[1];
  if (!after) throw new Error(`no ${declaration} in source`);
  const lines = after.split("\n");
  const end = lines.findIndex((line) => line === "}" || line === "};");
  if (end < 0) throw new Error(`${declaration} never closes`);
  return lines.slice(0, end).join("\n");
}

describe("the sign-in message slot's copy budget", () => {
  const collect = (): string[] =>
    literals(body(AUTH, "export function authErrorMessage"));

  it("finds authErrorMessage's lines", () => {
    expect(collect().length).toBeGreaterThan(2);
  });

  it("keeps authErrorMessage's lines to one rendered line", () => {
    // Reported as a list so a failure names the line that is too long
    // instead of a number that is too big.
    expect(collect().filter((line) => line.length > BUDGET)).toEqual([]);
  });
});
