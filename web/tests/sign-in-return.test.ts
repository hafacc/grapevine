import { describe, expect, it } from "bun:test";
import { authErrorMessage } from "../utils/auth";
import {
  exchangeFailure,
  readSignInReturn,
  SIGN_IN_TIMED_OUT,
  withoutCode,
} from "../utils/sign-in-return";

const BASE = "https://grapevine.hafa.cc/";

describe("readSignInReturn", () => {
  it("puts a shared screen back after a successful trip to Google", () => {
    const back = readSignInReturn(`${BASE}?code=abc`, "#/item/café bleu");
    expect(back.errorCode).toBeNull();
    // `?code=` stays: supabase-js exchanges it and strips it itself.
    expect(back.cleanedUrl).toBe(`${BASE}?code=abc#/item/caf%C3%A9%20bleu`);
  });

  it("surfaces a refused sign-in and strips it from the URL", () => {
    const back = readSignInReturn(
      `${BASE}?error=access_denied&error_code=provider_error&error_description=nope`,
      "#/item/café bleu",
    );
    expect(back.errorCode).toBe("provider_error");
    expect(back.cleanedUrl).toBe(`${BASE}#/item/caf%C3%A9%20bleu`);
  });

  it("reads an error the implicit flow left in the fragment", () => {
    const back = readSignInReturn(
      `${BASE}#error=access_denied&error_description=nope`,
      null,
    );
    expect(back.errorCode).toBe("access_denied");
    expect(back.cleanedUrl).toBe(BASE);
  });

  // A fragment saved by an attempt that was abandoned must not steer a later,
  // ordinary visit somewhere the visitor did not ask to go.
  it("leaves a page that is not a return alone", () => {
    expect(readSignInReturn(BASE, "#/item/café bleu")).toEqual({
      cleanedUrl: null,
      errorCode: null,
    });
  });

  it("never overrides a screen the URL already names", () => {
    const back = readSignInReturn(`${BASE}?code=abc#/people`, "#/item/café bleu");
    expect(back.cleanedUrl).toBeNull();
  });

  it("ignores a saved value that is not a screen", () => {
    const back = readSignInReturn(`${BASE}?code=abc`, "#access_token=x");
    expect(back.cleanedUrl).toBeNull();
  });
});

// The trip back from Google can fail after the URL says it succeeded: the
// `?code=` is there, and exchanging it is what goes wrong. supabase-js resolves
// `initialize()` with that error and tells nobody else.
describe("a code that could not be exchanged", () => {
  it("is reported under GoTrue's own code", () => {
    expect(exchangeFailure({ code: "flow_state_expired", status: 400 })).toBe(
      "flow_state_expired",
    );
  });

  it("and under one generic code when there is none", () => {
    // A request that never arrived: no code, status 0.
    expect(exchangeFailure({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      "unknown",
    );
    expect(exchangeFailure(new Error("x"))).toBe("unknown");
    expect(exchangeFailure(null)).toBe("unknown");
  });

  it("says something a person can act on for each way it fails", () => {
    expect(authErrorMessage({ code: "flow_state_expired" })).toBe(
      "that took too long. try again.",
    );
    expect(authErrorMessage({ code: "bad_code_verifier" })).toBe(
      "that took too long. try again.",
    );
    expect(authErrorMessage({ code: SIGN_IN_TIMED_OUT })).toBe(
      "couldn't finish signing you in. try again.",
    );
    expect(authErrorMessage({ code: "unknown" })).toBe(
      "something went wrong. try again.",
    );
  });

  it("leaves the URL without the dead code, and the screen in it", () => {
    expect(withoutCode(`${BASE}?code=abc#/item/dune`)).toBe(
      `${BASE}#/item/dune`,
    );
    expect(withoutCode(`${BASE}#/people`)).toBeNull();
  });
});
