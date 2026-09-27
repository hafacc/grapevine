import { describe, expect, it } from "bun:test";
import { forgetHintsSeen } from "../utils/first-run";
import { asksAboutLink, heldLink } from "../utils/invites";
import {
  explainWriteFailure,
  isForbiddenCall,
  lockedAfterUnfriend,
} from "../utils/refusal";
import { DAILY_LIMIT_MESSAGE } from "../utils/supabase";

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

  it("says what it would have when the account is not locked", async () => {
    expect(
      await explainWriteFailure(REFUSED, FALLBACK, answers(false)),
    ).toEqual({ kind: "message", text: FALLBACK });
  });

  it("claims no lock when the lock cannot be checked", async () => {
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
    expect(await lockedAfterUnfriend(answers(false), 0)).toBe(false);
    expect(await lockedAfterUnfriend(answers(true), 3)).toBe(true);
  });

  // The friend is gone either way, so a failed read is not a failed removal.
  it("falls back to the friends left when the check fails", async () => {
    expect(await lockedAfterUnfriend(unreachable, 0)).toBe(true);
    expect(await lockedAfterUnfriend(unreachable, 1)).toBe(false);
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
