import { describe, expect, it } from "bun:test";
import { forgetHintsSeen } from "../src/lib/utils/first-run";
import { asksAboutLink, heldLink } from "../src/lib/utils/invites";
import {
  explainWriteFailure,
  isForbiddenCall,
  lockedAfterUnfriend,
  NAME_REMOVED_MESSAGE,
} from "../src/lib/utils/refusal";
import { reportFailed } from "../src/lib/utils/reports";
import { DAILY_LIMIT_MESSAGE } from "../src/lib/utils/supabase";

const FALLBACK = "couldn't save that just now. try again.";
const REFUSED = { code: "42501", message: "accept a link first" };
const OWNER = { displayName: "ana", photoURL: null };

function answers(locked: boolean): () => Promise<boolean> {
  return () => Promise.resolve(locked);
}

async function unreachable(): Promise<boolean> {
  throw new TypeError("Failed to fetch");
}

describe("explainWriteFailure", () => {
  it("hands a refusal from a locked account to the locked screen", async () => {
    expect(await explainWriteFailure(REFUSED, FALLBACK, answers(true))).toEqual(
      { kind: "locked" },
    );
  });

  it("reads a refusal from an unlocked account as a removed name", async () => {
    expect(
      await explainWriteFailure(REFUSED, FALLBACK, answers(false)),
    ).toEqual({ kind: "message", text: NAME_REMOVED_MESSAGE });
  });

  it("claims neither when the lock cannot be checked", async () => {
    expect(await explainWriteFailure(REFUSED, FALLBACK, unreachable)).toEqual({
      kind: "message",
      text: FALLBACK,
    });
  });

  it("asks about the lock only on a refusal", async () => {
    let asked = 0;
    const counting = async (): Promise<boolean> => {
      asked += 1;
      return true;
    };
    expect(
      await explainWriteFailure({ code: "PT429" }, FALLBACK, counting),
    ).toEqual({ kind: "message", text: DAILY_LIMIT_MESSAGE });
    expect(
      await explainWriteFailure(new TypeError("offline"), FALLBACK, counting),
    ).toEqual({ kind: "message", text: FALLBACK });
    expect(asked).toBe(0);
  });
});

describe("isForbiddenCall", () => {
  it("recognizes the function refusing a locked caller", () => {
    expect(isForbiddenCall({ context: { status: 403 } })).toBe(true);
    expect(isForbiddenCall({ context: { status: 500 } })).toBe(false);
    expect(isForbiddenCall({ status: 403 })).toBe(false);
    expect(isForbiddenCall(null)).toBe(false);
  });
});

describe("lockedAfterUnfriend", () => {
  it("takes the server's answer", async () => {
    expect(await lockedAfterUnfriend(answers(false), 0, false)).toBe(false);
    expect(await lockedAfterUnfriend(answers(true), 3, false)).toBe(true);
  });

  // The friend is gone either way, so a failed read is not a failed removal.
  it("falls back to the friends left when the check fails", async () => {
    expect(await lockedAfterUnfriend(unreachable, 0, false)).toBe(true);
    expect(await lockedAfterUnfriend(unreachable, 1, false)).toBe(false);
    expect(await lockedAfterUnfriend(unreachable, 0, true)).toBe(false);
  });
});

describe("heldLink", () => {
  it("waits on a lookup still out, and stops waiting on one that failed", () => {
    expect(heldLink("token", undefined, false)).toBe("checking");
    expect(heldLink("token", undefined, true)).toBe("unchecked");
  });

  it("names a dead link and no link", () => {
    expect(heldLink("token", null, false)).toBe("dead");
    expect(heldLink(null, undefined, true)).toBe("none");
  });
});

describe("asksAboutLink", () => {
  it("waits for the viewer's own link before asking", () => {
    expect(asksAboutLink("theirs", OWNER, false, undefined)).toBe(false);
    expect(asksAboutLink("theirs", OWNER, false, null)).toBe(true);
    expect(asksAboutLink("mine", OWNER, false, "mine")).toBe(false);
  });

  it("always asks a locked account", () => {
    expect(asksAboutLink("theirs", OWNER, true, undefined)).toBe(true);
  });

  it("asks nothing about a link with no known owner", () => {
    expect(asksAboutLink("theirs", undefined, true, null)).toBe(false);
    expect(asksAboutLink("theirs", null, true, null)).toBe(false);
    expect(asksAboutLink(null, OWNER, true, null)).toBe(false);
  });
});

describe("reportFailed", () => {
  it("counts reporting a name twice as done", () => {
    expect(reportFailed({ code: "23505" })).toBe(false);
    expect(reportFailed(null)).toBe(false);
  });

  it("passes every other failure on", () => {
    expect(reportFailed(REFUSED)).toBe(true);
    expect(reportFailed({ code: "PT429" })).toBe(true);
  });
});

describe("forgetHintsSeen", () => {
  it("forgets every account's hint and nothing else", () => {
    const map = new Map([
      ["grapevine:hint-seen:one", "1"],
      ["grapevine:hint-seen:two", "1"],
      ["grapevine-theme", "dark"],
    ]);
    const storage = {
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
      clear: () => map.clear(),
    };
    forgetHintsSeen(storage);
    expect([...map.keys()]).toEqual(["grapevine-theme"]);
  });
});
