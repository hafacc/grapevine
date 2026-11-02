/// <reference lib="webworker" />

import init, { computeUserTensor, layOut } from "grapevine-core";
import wasmUrl from "grapevine-core/wasm?url";

// The core runs here and not on the page: a list over forty followed accounts
// is tens of milliseconds of arithmetic, more for accounts with thousands of
// thumbs, and laying a map out is a few hundred. On the page that is a swipe
// that does not answer.

/** A list to compute, or a plot's points to lay out. */
export type TasteAsk =
  | {
      readonly snapshot: unknown;
      readonly viewer: string;
      readonly rank: number;
    }
  | { readonly points: unknown };

export type TasteRequest = TasteAsk & { readonly id: number };

export type TasteResponse =
  | { readonly id: number; readonly result: unknown }
  | {
      readonly id: number;
      readonly error: string;
      // The core is gone: it failed to load, or trapped, which leaves the
      // module in no state to be called again. Not set for a refusal.
      readonly fatal: boolean;
    };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const ready = init({ module_or_path: wasmUrl });

scope.addEventListener("message", (event: MessageEvent<TasteRequest>) => {
  const request = event.data;
  const { id } = request;
  void ready
    .then(() => {
      const result =
        "points" in request
          ? layOut(request.points)
          : computeUserTensor(request.snapshot, request.viewer, request.rank);
      scope.postMessage({ id, result } satisfies TasteResponse);
    })
    .catch((error: unknown) => {
      // What the core refuses, it throws as a sentence; anything else thrown
      // is the module failing.
      const fatal = typeof error !== "string";
      scope.postMessage({
        id,
        error: String(error),
        fatal,
      } satisfies TasteResponse);
    });
});

// A core that failed to load will fail every ask the same way. Closing is
// what lets the page make a new worker, which fetches the module again.
ready.catch(() => {
  scope.close();
});
