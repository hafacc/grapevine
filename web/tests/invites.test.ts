import { describe, expect, it } from "bun:test";
import {
  inviteUrl,
  isInviteToken,
  readInviteArrival,
} from "../utils/invites";
import { screenForHash } from "../utils/store";

const TOKEN = "q7Vb0T3kz_P-8rWm2cYxNf4aLhJd6sUoE1iGvK9tRyZ";

describe("readInviteArrival", () => {
  it("takes the token and leaves the list", () => {
    const arrival = readInviteArrival(
      `https://grapevine.hafa.cc/#/invite/${TOKEN}`,
    );
    expect(arrival.token).toBe(TOKEN);
    expect(arrival.cleanedUrl).toBe("https://grapevine.hafa.cc/#/");
  });

  it("round-trips the link it makes", () => {
    const url = inviteUrl("https://grapevine.hafa.cc", TOKEN);
    expect(readInviteArrival(url).token).toBe(TOKEN);
  });

  it("tolerates a trailing slash a chat app added", () => {
    expect(
      readInviteArrival(`https://grapevine.hafa.cc/#/invite/${TOKEN}/`).token,
    ).toBe(TOKEN);
  });

  // Out of the address either way, so a bearer secret, even a mangled one,
  // does not sit in history. Kept, so the screen can say it is invalid, but
  // never sent to the server.
  it("takes a malformed token out of the address and keeps it as invalid", () => {
    for (const bad of ["short", "has space here and more text", "%E0%A4%A"]) {
      const arrival = readInviteArrival(`https://x.test/#/invite/${bad}`);
      expect(arrival.token).not.toBeNull();
      expect(isInviteToken(arrival.token ?? "")).toBe(false);
      expect(arrival.cleanedUrl).toBe("https://x.test/#/");
    }
    expect(isInviteToken(TOKEN)).toBe(true);
  });

  it("keeps nothing from an empty link", () => {
    expect(readInviteArrival("https://x.test/#/invite/").token).toBeNull();
  });

  it("leaves any other address alone", () => {
    for (const href of [
      "https://x.test/",
      "https://x.test/#/people",
      "https://x.test/#/item/invite",
      "https://x.test/?code=abc",
    ]) {
      expect(readInviteArrival(href)).toEqual({
        token: null,
        cleanedUrl: null,
      });
    }
  });

  // It is not one of the three screens: the router never sees it, and a
  // fragment it is somehow handed names no screen.
  it("is not a screen", () => {
    expect(screenForHash(`#/invite/${TOKEN}`)).toBeNull();
  });
});
