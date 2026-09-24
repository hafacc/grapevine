"use client";

import { supabase } from "./supabase";

// A CHECK caps this, so the client has to as well or the write is simply refused
// and the diagnosis is lost along with the failure it described.
const MAX_DETAIL = 2_000;

// These failures throw nothing, so the state that made the decision is all
// there is to report.
export type DebugDetail = Readonly<Record<string, string | number | boolean>>;

// Slicing the encoded string would be the obvious cap and would store JSON that
// no reader can parse. An oversized payload is a bug in the caller, so the head
// is kept only as a lead — short enough that escaping it can't breach the cap.
function encodeDetail(detail: DebugDetail): string {
  const encoded = JSON.stringify(detail);
  return encoded.length <= MAX_DETAIL
    ? encoded
    : JSON.stringify({
        oversized: encoded.length,
        head: encoded.slice(0, 200),
      });
}

// Swallows its own errors: a diagnostic that can fail the thing it is
// diagnosing is worse than no diagnostic. Best-effort by nature — this write
// goes to the same database that may be what's broken.
//
// Two arguments and no more. The uid, the clock and the expiry are the server's,
// which is why this is a function call and not an insert: `private.debug_events`
// has no client write verb of any kind, and an event cannot be lodged as having
// happened at a time of the caller's choosing. A signed-out visitor holds no
// EXECUTE grant, so there is nothing to check here either.
export function recordDebugEvent(kind: string, detail: DebugDetail): void {
  void supabase()
    .rpc("record_debug_event", { p_kind: kind, p_detail: encodeDetail(detail) })
    .then(({ error }) => {
      if (error) console.warn("debug", error);
    });
}

// Tells the network apart from the tab from us. Read at the moment of failure:
// `visibilityState` is worthless a second later.
export function clientState(): DebugDetail {
  return {
    online: navigator.onLine,
    visibility: document.visibilityState,
    sinceLoad: Math.round(performance.now()),
    ua: navigator.userAgent.slice(0, 180),
  };
}
