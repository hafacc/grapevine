import { describe, expect, it } from "bun:test";
import { nextSessionUser } from "../utils/session-user";

describe("nextSessionUser", () => {
  const session = (id: string) => ({ user: { id } });

  // SIGNED_IN on every tab focus and TOKEN_REFRESHED hourly re-announce the same
  // account; a new object each time re-ran every effect keyed on it.
  it("keeps the same object when the same account is announced again", () => {
    const first = nextSessionUser(null, session("u1"));
    expect(nextSessionUser(first, session("u1"))).toBe(first);
  });

  it("gives a new one for a different account", () => {
    const first = nextSessionUser(null, session("u1"));
    const changed = nextSessionUser(first, session("u2"));
    expect(changed).not.toBe(first);
    expect(changed).toEqual({ uid: "u2" });
  });

  it("is null without a session", () => {
    expect(nextSessionUser({ uid: "u1" }, null)).toBeNull();
  });
});
