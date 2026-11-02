// The front door of the stack `supabase/tests/serve-local.sh` serves: the one
// origin supabase-js is given, standing where the real stack's gateway does.
//
//   /rest/v1/*       PostgREST, path prefix removed
//   /auth/v1/user    who a bearer token says it is, if this stack signed it
//   /auth/v1/logout  nothing to revoke
//
// Everything else is a 404 and means it: there is no GoTrue to issue or refresh
// a session, no Realtime socket and no Edge Runtime. A test signs its own
// session (`web/e2e/local-session.ts`), and these two auth calls are the ones
// supabase-js makes with a session it was handed.
//
// Plain node with no dependency, and configured by `serve-local.sh` alone
// through GATEWAY_PORT, REST_PORT and JWT_SECRET: it is started before anything
// under `web/` has been installed.

import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const REST_PORT = Number(process.env.REST_PORT ?? 54399);
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const REST_PREFIX = "/rest/v1";

// Every origin, because the app is served from a dev server on another port
// and the real gateway answers the same way.
function cors(request) {
  return {
    "access-control-allow-origin": request.headers.origin ?? "*",
    "access-control-allow-headers":
      request.headers["access-control-request-headers"] ?? "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "content-range,content-profile",
    "access-control-max-age": "600",
  };
}

function answer(request, response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...cors(request),
  });
  response.end(body === undefined ? "" : JSON.stringify(body));
}

/** The claims of an unexpired HS256 token this stack's secret signed, or null. */
function verifiedClaims(token) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const expected = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const live =
      typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
    return live && typeof claims.sub === "string" ? claims : null;
  } catch {
    return null;
  }
}

function toPostgrest(request, response, url) {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: REST_PORT,
      method: request.method,
      path: url.pathname.slice(REST_PREFIX.length) + url.search,
      headers: { ...request.headers, host: `127.0.0.1:${REST_PORT}` },
    },
    (answered) => {
      response.writeHead(answered.statusCode ?? 502, {
        ...answered.headers,
        ...cors(request),
      });
      answered.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    answer(request, response, 502, { message: String(error) });
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://gateway");
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors(request));
    response.end();
  } else if (
    url.pathname === REST_PREFIX ||
    url.pathname.startsWith(`${REST_PREFIX}/`)
  ) {
    toPostgrest(request, response, url);
  } else if (url.pathname === "/auth/v1/user") {
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    const claims = verifiedClaims(token);
    if (claims === null) {
      answer(request, response, 401, { message: "invalid JWT" });
    } else {
      answer(request, response, 200, {
        id: claims.sub,
        aud: "authenticated",
        role: "authenticated",
        email: claims.email,
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
      });
    }
  } else if (url.pathname === "/auth/v1/logout") {
    response.writeHead(204, cors(request));
    response.end();
  } else {
    answer(request, response, 404, {
      message: "not served by serve-local.sh",
    });
  }
});

server.listen(GATEWAY_PORT, "127.0.0.1", () => {
  console.log(`gateway on 127.0.0.1:${GATEWAY_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
