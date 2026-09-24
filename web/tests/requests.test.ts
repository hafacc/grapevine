import { describe, expect, it } from "bun:test";
import { type RequestRow, toRequests } from "../utils/requests";

// A row of `connect_requests` with the profile embed the two lists join on.
function row(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    from_id: "me",
    to_id: "them",
    created_at: "2026-09-17T10:00:00.000Z",
    other: {
      id: "them",
      username: "ada",
      display_name: "Ada",
      photo_url: null,
    },
    ...overrides,
  };
}

describe("toRequests", () => {
  it("names the party at the other end of the ask", () => {
    const [outgoing] = toRequests([row()], "to_id");
    expect(outgoing?.other).toEqual({
      uid: "them",
      username: "ada",
      displayName: "Ada",
      photoURL: null,
    });
    const [incoming] = toRequests(
      [
        row({
          from_id: "them",
          to_id: "me",
          other: {
            id: "them",
            username: "ada",
            display_name: "Ada",
            photo_url: null,
          },
        }),
      ],
      "from_id",
    );
    expect(incoming?.from).toBe("them");
    expect(incoming?.other.displayName).toBe("Ada");
  });

  // A target who turns findable off empties the sender's profile join
  // (`profiles_select`) while the ask is still pending, and the ask is still
  // there.
  it("keeps an ask whose recipient can no longer be read", () => {
    const kept = toRequests([row({ other: null })], "to_id");
    expect(kept).toHaveLength(1);
    expect(kept[0]?.from).toBe("me");
    expect(kept[0]?.to).toBe("them");
    // The uid is what the row is addressed by, so it is the one thing the row
    // never loses.
    expect(kept[0]?.other.uid).toBe("them");
  });

  // Nameless, and nothing else: it says nothing about WHY — a sentence about
  // their privacy switch would be the one thing the gate is there to withhold.
  it("leaves such a row with no name, handle or face", () => {
    const [nameless] = toRequests([row({ other: null })], "to_id");
    expect(nameless?.other.displayName).toBe("");
    expect(nameless?.other.username).toBe("");
    expect(nameless?.other.photoURL).toBeNull();
  });

  it("reads an unparseable timestamp as zero rather than NaN", () => {
    const [odd] = toRequests([row({ created_at: "not a date" })], "to_id");
    expect(odd?.createdAt).toBe(0);
  });
});
