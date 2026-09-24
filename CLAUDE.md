# grapevine — contributor notes

[DESIGN.md](./DESIGN.md) is the source of truth for *what* is built and *why*. This file is what a
person or an agent needs to run and check things, and the rules that are easy to break.

Read DESIGN §1 before changing any screen, and `docs/mockups/` for what it looks like.

## Layout

    web/         Next.js app, static export. Bun. The only thing a user touches.
    shared/      Pure TypeScript, zero runtime dependencies, imported where it lives by web/
                 and by both Edge Functions (Deno reads the TypeScript). No generated copy
                 of it exists anywhere. Bun.
    scripts/     build-wasm.sh — wasm-pack, one target argument: `web` for the Edge
                 Functions, `nodejs` for `rust/examples/smoke.mjs`, the only thing that
                 runs the wasm boundary outside Deno.
    rust/        The one Rust crate (`grapevine-core`): DESIGN §2's algorithm, the simulator
                 and the property suite. No I/O. Built to WebAssembly by wasm-pack; neither
                 build output is committed.
    supabase/    config.toml (auth providers, redirect URLs — in the repo, not a console),
                 migrations/ (schema, grants, policies, server-only functions, cron),
                 functions/refresh-recs/ (the per-viewer recompute, Deno),
                 functions/refresh-suggestions/ (DESIGN §5's taste search for the caller),
                 tests/ (pgTAP), seed.sql
    docs/        algorithm-notes.md (the measurements behind the algorithm's constants),
                 mockups/ (static comps of the one view) and mark.svg (the mark). No code
                 reads any of it except make-icons.mjs, which reads mark.svg.

`supabase/` lives at the repo root because the web app and every check point at the one local
stack, and `supabase db push` and `supabase functions deploy` read that directory.

## Commands

Run each from the directory named. **Everything marked (docker) needs Docker, which is not
installed on Erik's machine and is not going to be.** The Supabase CLI (2.117.0, the version CI
pins) is installed, and what it does against the linked project works here: `db query --linked`,
`config diff`, `migration list --linked`, `functions list`. Anything against a local stack, and
`db dump`, wants Docker.

```sh
supabase start                   # (docker) Postgres, GoTrue, PostgREST, Realtime, the Edge
                                 # Runtime and Studio. One stack serves every check below.
supabase db reset                # (docker) every migration, then seed.sql, from zero
supabase db lint                 # (docker) plpgsql_check over the applied migrations
supabase test db                 # (docker) the pgTAP suites. THE runner: CI uses it.
supabase functions serve refresh-recs    # (docker) either function against the local stack
supabase functions serve refresh-suggestions

# The pgTAP suites without Docker: a throwaway PostgreSQL cluster from initdb, every migration,
# the same files, about a second. Needs `initdb`, `pg_ctl` and `psql` on PATH. It stands in for a
# cut-down `auth` schema. pgTAP is the real one: the installed extension, or else pgTAP's source,
# pinned and fetched once into ~/.cache/grapevine/ (so the first run needs the network), and only
# offline with nothing cached a stand-in copying pgTAP's signatures. So a suite that passes here
# and fails under `supabase test db` leaned on the `auth` stand-in or a version difference.
# Use it to develop a suite; believe CI. `throws_ok`'s third argument is the expected error
# MESSAGE, not a description: `throws_ok(sql, '42501', null, 'description')`.
bash supabase/tests/run-local.sh          # all of them
bash supabase/tests/run-local.sh 09_items # one, by prefix

cd web && bun install            # once, and again when web/package.json changes
cd web && bun run dev            # dev server on :3000, against the real project
cd web && bun run dev:local      # dev server on :3001, against the local Supabase stack
cd web && bun run lint           # THE gate: tsc + service-worker tsc + biome
cd web && bun run fmt            # biome format --write
cd web && bun run test           # unit suites
cd web && bun run export         # next build -> web/out/
cd web && bun run check:pwa      # installability, offline, and each written page's own text.
                                 # Drives a real Chrome, needs NO stack: it builds the export,
                                 # serves it itself and signs nothing in. Not in CI.

# Everything below wants the local stack up (docker); the browser ones want `dev:local` too.
# None is in CI. None brings a backend up: each seeds into the running stack and says so if it
# is not there.
cd web && bun run check:signin   # a minted session renders the app, none renders the welcome
                                 # screen, and the claim line claims a handle. NOT the OAuth
                                 # round trip (see "One door").
cd web && bun run check:feed     # the one list: ranking, filtering by name and attribute, the
                                 # add button, what a first rating writes, and every fill a
                                 # multiple of the step `user_recs.error` allows
cd web && bun run seed:local     # a simulated world into the running local stack
cd web && bun run check:search-id      # every `items` row has `search_id === searchFold(id)`,
                                       # importing the one implementation of the folding
cd web && bun run check:recs-function  # the staleness contract: an immediate second call only
                                       # stamps `checked_at`; the viewer's own thumb given,
                                       # turned over or cleared recomputes; a far stranger's
                                       # thumb inside the window does not
cd web && bun run check:recs-parity    # the stored feed against `compute-user` on the same
                                       # dump, to 1e-9. Needs a Rust toolchain too.
cd web && bun run check:suggestions    # taste search against a spread-out world. Also wants
                                       # `supabase functions serve refresh-suggestions`.

cd shared && bun install
cd shared && bun test            # normalizeId, searchFold, confusable skeletons; entries.ts
                                 # (folding, change detection, sanitizing)
cd shared && bun run lint        # tsc + biome

cd rust && cargo test --release                    # unit tests and the property suite, ~7.5 s
cd rust && cargo test --release --features serde   # and the boundary's own deserializer
cd rust && cargo clippy --all-targets -- -D warnings
cd rust && cargo fmt --check

# From anywhere. `web` writes a copy into each function directory, because `functions deploy`
# uploads one directory and the `.wasm` is read by path, not imported.
bash scripts/build-wasm.sh nodejs
bash scripts/build-wasm.sh web
node rust/examples/smoke.mjs                 # 3-user snapshot through the wasm boundary

# The ONLY thing that compiles the Edge Functions (no tsconfig or biome config covers them, and
# deploy's esbuild does not typecheck), so a signature change in `shared/src/entries.ts` can be
# green everywhere else and break only here. Needs the `web` wasm.
deno check supabase/functions/refresh-recs/index.ts supabase/functions/refresh-suggestions/index.ts
deno lint  supabase/functions/refresh-recs/index.ts supabase/functions/refresh-suggestions/index.ts

# The world the seed script and `compute-user` share (`check:recs-parity` hands both one file).
cd rust && cargo run --release --features serde --example dump-world -- --out /tmp/world.json
cd rust && cargo run --release --features serde --example compute-user -- /tmp/world.json u7
```

`rust/` pins its toolchain in `rust/rust-toolchain.toml`. `cargo test` builds the core with no
dependencies: `serde` sits behind a feature (the examples need `--features serde`) and the wasm
bindings behind another. `web`'s `lint` needs nothing built first, so a fresh checkout can run the
gate straight away.

## The algorithm in the crate

DESIGN §2 is the specification and `docs/algorithm-notes.md` the measurements. What a contributor
needs to not undo:

- **The walk pushes a node, not an edge.** The residual lives on directed edges (the walk is
  non-backtracking), but a pop takes every edge's residual waiting at a node at once and writes
  each outgoing edge that sum less what came in along it. A sweep costs `Σ_v deg(v)` pushes;
  popping per edge costs the mean degree times more (12 354 ms against 6.9 ms for one walk at
  2 000 people × 50 friends). The queue pops largest-first to within a factor of two, one bucket
  per binary exponent, FIFO inside — deterministic and tested. Each settling pass starts from the
  last one's residual, which may be negative, so truncation is `Σ|r|·(1 − α)/α`.
- **Do not trim the snapshot to fit a budget.** Unloading the furthest nodes left every viewer with
  a neighbourhood past about a hundred people with no feed, because the boundary rounds skip
  anything already loaded. The budget is `min(reservation, E_max)`, the reservation
  `(SETTLE_MAX_PASSES + 1) × (F + (sweeps + 1) · Σ_v deg(v))` with
  `sweeps = ⌈log₂(F / ε_total)⌉`. `E_max` (`Params::edge_budget`, 10 000 000 pushes for both the
  default and `Params::deep()`) is a CPU backstop: 0.3 s at a pessimistic 30 ns a push, because
  `refresh-recs` may call the core four times in a free invocation's roughly two seconds. The worst
  converged loop measured is 136 ms of `computeUser` in wasm at 2 000 × 50, and none spent more
  than 2.45 M pushes. The loop never starts a pass it cannot pay for at the last pass's price, and
  a pass cut short anyway is thrown away: the last *completed* pass is the answer, with `settled`
  false.
- **Accuracy is relative to the nearest `N_max = 2 000` people, by decision.** `truncation` is the
  residual left inside the loaded set; what walked out is `boundary_residual`, reported and stored
  but not counted against `ε_total` (DESIGN §2.4). **A walk that cannot meet `ε_total` writes no
  feed**: `refresh-recs` answers `200` with the previous `user_recs` row and `recomputed: false`,
  and stamps `checked_at`.
- **The settling loop** walks, recomputes contestedness and alignment, and walks again until no
  score moved by more than `SETTLE_TOLERANCE = 1e-4` (two orders below the bar's smallest step) or
  `SETTLE_MAX_PASSES = 12` (ordinary worlds settle in at most five, a 200-bot mimic clique in
  eight; the movement shrinks over every *two* passes). Reaching the cap is not an error: the
  movement leaves as `UserResult.settle_movement` and the caller decides.
- **`κ = 8` and `L = 2` are load-bearing for that loop.** Alignment divides by `κ + A + D`, so a
  large `κ` is what makes the loop a contraction; past a best-to-worst affinity ratio in the
  thousands it stops settling at all, which is why the clamp keeps it at 7:1
  (`docs/algorithm-notes.md` §3).
- **`ω`'s support factor is `n/(n+1)`, not the Beta(1,1) posterior**: the posterior reads `≈ 4/n`
  on a unanimous item where this reads zero, and that zero stops an account that copies consensus
  earning alignment (DESIGN §2.1, §2.2).
- **There is no learned edge trust — do not rebuild it.** A per-edge fit by descent was never
  shown convex in its parameters (the scores are a resolvent of them) and added three chosen
  constants. It carried DESIGN §2.1's requirement 3, blame the edge into the bot, which was dropped
  rather than rehoused on DESIGN §2.9a's measurement; alignment cannot supply it, because an
  account that copies the viewer maximises agreement. If it comes back, the shape is **Resnick &
  Sami's influence limiter** (RecSys 2007). DESIGN §2.5 has the rest.
- Nothing is `#[ignore]`d. Every entry point returns a `Result`; a non-finite mass is an error,
  and the wasm boundary refuses a result whose truncation says the walk never resolved. Rating
  values and keys are sanitized rather than refused, so one crafted row in reach cannot fail a
  viewer's recompute. `is_normalized_id` does not claim canonicity: NFKC-normality is a database
  `CHECK` and the crate has no Unicode tables.

## The local stack

`supabase start` is the whole of it: Postgres on 54322, the API and the Edge Runtime on 54321,
Studio on 54323, Inbucket on 54324 (unused, since nothing sends mail). `supabase db reset` is the
reproducible database and is also destructive, with no point-in-time recovery on the free tier.

**Signing in locally does not work through the UI, and that is expected.** Google's consent screen
cannot be driven headlessly and the local stack has no Google. A local session is minted against
the stack's fixed JWT secret and written into `localStorage` under supabase-js's storage key, which
is what the browser checks do. Pointing the local stack at a real Google OAuth client would put a
production credential in a development config, and is refused.

## One door: Google

Supabase Auth with **Google as the only provider**: no email link, no password, no anonymous
session, no phone, no mail sender, and nothing configured outside `supabase/config.toml` (which
reaches the project only through `supabase config push`).

- **A profile arrives named**: a trigger on `auth.users` creates it from Google's metadata. The
  name gate is for a Google account that carries no name.
- **PKCE, not implicit.** The implicit flow returns `#access_token=…`, and the fragment belongs to
  the router: the collision looks like a blank screen on first sign-in, i.e. a routing bug. PKCE
  returns `?code=…`, which `detectSessionInUrl` consumes and strips. The client must use
  `flowType: "pkce"`.
- **The trip to Google loses the URL** (`utils/sign-in-return.ts`). The screen a signed-out visitor
  opened (a friend's `#/item/...`) is kept in `sessionStorage` before the redirect and restored on
  return, because `redirectTo` cannot carry a fragment ahead of the `?code=` GoTrue appends. A
  refused or cancelled sign-in comes back as `?error=…&error_description=…`, which supabase-js only
  logs; it is read and stripped before the client is constructed and shown on the welcome screen
  through `authErrorMessage`.
- **Email confirmations stay ON although there is no email door.** A Google session can call
  `updateUser({ email })`; with confirmations off that rewrites `auth.users.email` to an address
  the caller does not own, and the real owner's next Google sign-in links into that account.
  Sign-out is `scope: "local"`: the default revokes every session the account holds.
- **`has_credential()` is vacuous today and stays.** It gates claiming a (permanent) handle, and
  guards against a dashboard toggle turning on anonymous sessions or a second provider, which ships
  no diff. Its body is general so a second door is correct the day it is enabled.
- **The cost**: someone without a Google account, or unwilling to give Google a record of which
  apps they use, cannot sign in or be invited, and there is no door when Google's OAuth is down.
  An email door would need mail sent from an owned domain with mail authentication;
  `grapevine.hafa.cc` sends none.

## Postgres schema

The tables and columns are DESIGN §3.2, the policies §3.3. Access is three mechanisms: a **column
privilege** (the client cannot write this field, so it takes its default), a **table privilege**
(nobody has this verb at all), and a **policy** (which rows this caller may see). Reach for them in
that order — a privilege cannot be got wrong by a later policy, and a table in schema `private`
cannot be reached at all, because PostgREST does not serve it.

The rules below are the ones that are easy to break:

- **`profiles`**: readable by self, a friend, either party of a pending request (the sender only
  while the target stays searchable), and anyone you are suggested to while you stay discoverable
  (`private.is_discoverable`: `searchable` AND `discoverable_by_taste`, also used by the
  `suggestions` policy and `shared_attributes`, so either switch going off hides you at once).
  `searchable` is deliberately NOT a read clause: `or searchable` would authorize a dump of every
  findable account. Handle lookup is `find_by_username(text)` and `profile_by_id(uuid)`: exact
  key, one row. No email or phone column. `username` has no UPDATE (set once by
  `claim_username`) and the table no INSERT (the `auth.users` trigger creates the row).
  `web/utils/switches.ts` couples the two switches so findable is on whenever suggestions are,
  because a request to someone not `searchable` is refused.
- **`friendships`**: both directions stored; a deferred constraint trigger makes a one-sided
  friendship impossible at commit, and the core still checks reciprocity. Insert your own edge, or
  the sender's as the accepter of a pending request; delete from either end.
- **`connect_requests`**: the key is one pending ask per pair (`on conflict do nothing`). Sending
  requires a `searchable` target and spends one write-budget unit, or an insert-delete loop would
  be a Realtime event at the target per round trip. The sender cannot withdraw an ask, by design.
- **`items`**: the id is what somebody typed, normalized. The CLIENT writes `search_id` from
  `searchFold`, deliberately: a trigger would be a second implementation of the stripping, and a
  disagreement is a row nobody can find by its own name; `check:search-id` is what checks it. No
  UPDATE or DELETE for anyone. No url (a phishing surface) and no tag list. Both
  `text_pattern_ops` indexes are needed: the collation is not `C`. `created_by` is readable by
  nobody and is the ONE person reference that does not cascade (`on delete set null`), or deleting
  an account would be impossible.
- **`ratings`**: key `(user_id, item_id, tag)`, owner-only; `tag = ''` is the thing itself.
  `rated_at` is read by nothing (see "What the list is drawn from") and is not the staleness probe
  — `max(rated_at)` cannot see a flip or a clear, which is what `private.ratings_changed` is for.
  `private.neighbourhood` and `private.load_nodes` return ratings nested, item to tag to value, and
  must not build a joined key: text cannot hold the NUL the core joins with.
- **`user_recs`**: owner read, written only by `refresh-recs` as the service role, one row in one
  statement. `feed_hash` stops a same-answer recompute moving `computed_at`. `error` is
  `max(truncation·L, settle_movement)` and deliberately NOT called `truncation`, since either term
  can be the larger; it is here because `user_model` has no client verb and the bar must see it.
- **`user_model`**: NO client verb; the Edge Functions' bookkeeping. `checked_at` (every
  recompute) is what the ten-minute window keys on; `computed_at` moves only when the feed changed.
  `suggestions_at` is taste search's window — "written empty" and "never run" look the same in
  `suggestions` — and a trigger nulls it when `discoverable_by_taste` moves. A rescore carries the
  whole walk report through unchanged, because it walked nothing. The twelve `pair_*` tallies feed
  DESIGN §2.10's priors via 0005.
- **`suggestions`**: owner read, written only by `refresh-suggestions` as the service role — a
  planted row would be a stranger presented as vouched for. Chips come from
  `public.shared_attributes(uuid)`, `security definer`, `search_path = ''`, stored nowhere; in
  `public` because a client must call it, `EXECUTE` revoked from `PUBLIC` and granted to
  `authenticated`. It answers only for someone who asked the viewer or is suggested and still
  discoverable, and returns an empty list otherwise, since an error would separate "no overlap"
  from "not allowed to ask".
- **`private.params`**: the population priors, each field null until its own sample exists and
  merged field by field, so a missing row can only fail to move a number.
- **`private.write_budget`**: every rating insert or update, item, connect request and debug event
  spends one of `private.daily_write_limit()` (the ONLY place the number is written) per account per
  UTC day, via `private.count_write` keyed on `auth.uid()`. Deletes are free; connections with no
  `auth.uid()` are not counted. Past it, SQLSTATE `PT429`, which `isDailyLimit` in
  `web/utils/supabase.ts` turns into a sentence with no number in it.

**Three standing hazards, in the order they will bite.**

- **Postgres grants `EXECUTE` on a new function to `PUBLIC` by default.** `private.neighbourhood`
  returns the raw ratings of up to `N_max` people: a `grant execute` on it, or moving it to a
  schema PostgREST serves, hands every viewer the ratings of everyone within two hops. Schema
  isolation is the mitigation, `alter default privileges ... revoke execute` the belt, and every
  migration gets read with this in mind.
- **Enumeration is the default.** Before adding a clause to a read policy, ask what `select *`
  returns under it.
- **`security definer` means the function's own rights.** Anything in `private` runs as its owner
  and must take an exact key and return at most one row, or it is an enumeration surface with a
  friendly name. That applies equally to `public.find_by_username` and
  `public.shared_attributes`, and more so: `public` is served, so the exact key, the `revoke ...
  from public` and the caller check are the whole of the defence.

**Normalization is one `normalizeId` in `shared/src/index.ts`**, used by the client and both Edge
Functions:

    lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim

NFKC comes after lowercasing, because lowercasing a normalized string can denormalize it and the
last step must be the one the column `CHECK` tests. `"Café  BLEU "` is `café bleu`; `日本` survives.
The `CHECK` refuses: empty after trimming; control characters (nothing in `Cc`/`Cf` except ZWNJ and
ZWJ, which Persian, several Indic scripts and emoji need; the bidi overrides refused by name);
anything not NFKC-normal (`x is nfkc normalized`); and over 128 code points, which the folding
refuses rather than truncates, since a cut can land inside a grapheme cluster or denormalize. The
two lowercasings (`toLowerCase`, and `lower` under a non-`C` collation) can disagree on a handful
of characters; the database is the authority, because its `CHECK` decides whether the row exists.

**Inside the core, a ratable is `item` or `item\0tag`**, joined with a NUL. Postgres text cannot
contain a NUL, so no name anybody can type can forge the join. The join is never stored, queried
or shown.

**Search matches a stored stripped copy, and `searchFold` in `shared/` is the ONLY implementation
of the stripping.** Stripping only at query time would leave the prefix search literal, so a viewer
typing the unaccented name finds nothing and adds the thing twice. Look-alikes NFKC leaves (Latin
`a`, Cyrillic `а`) are met with a confusable skeleton at lookup, which catches the accident of two
people and two keyboards and does not pretend to stop a determined one.

## Conventions worth not rediscovering

- **No server in the request path.** Every user action is a direct PostgREST write under row-level
  security. The two Edge Functions exist because each reads other people's ratings (DESIGN §4), and
  each answers only for the authenticated caller; treat a third as a claim to disprove.
  `accept_connect_request` is a `security invoker` procedure, so every policy still applies. The
  moment `private.neighbourhood` is callable by `authenticated`, a client holds other people's
  ratings.
- **A fresh-identity cost is not a sybil defence.** Google-only changes nothing in DESIGN §2.1: no
  row of that table rests on the cost of an account. Do not write "Google sign-in stops bot farms"
  anywhere.
- **Local-stack mode is `NEXT_PUBLIC_LOCAL_SUPABASE=1` ANDed with `NODE_ENV !== "production"`.**
  The NODE_ENV half folds the branch away in a production bundle; the flag alone compiles to a
  runtime read and ships localhost's address.
- **The project's address is configured in exactly one place, `web/utils/project.ts`.** It is a
  plain module with no `"use client"`, because `app/layout.tsx` is a server component and reads
  the origin at build time for its `preconnect`. Do not add an environment variable beside it.
- **`shared/` reaches `web/` by a tsconfig path alias**, not a `file:` dependency: bun installs one
  of those as symlinks that Turbopack refuses to follow ("Invalid symlink"). The alias is in
  `web/tsconfig.json`, and `next.config.js` sets `turbopack.root` to the repo so a file above
  `web/` is inside the module graph. Nothing needs building.
- **Comments say why, and name the thing that was rejected or the failure prevented.** Not what
  the code does.
- kebab-case filenames; `utils/` for logic and database access, `components/` for UI,
  `components/ui/` for primitives; `"use client"` on anything touching the store, Supabase or a
  browser API.
- **Three routes and no more**: `#/` (the list), `#/item/<id>` and `#/people`; the four written
  pages are static routes the router stays off. A pasted link to a thing gets the list seeded under
  it so Back goes somewhere. `web/tests/router.test.ts` asserts
  that any other fragment names no screen.

## UI design language

Tokens and components are in [`web/DESIGN-UI.md`](./web/DESIGN-UI.md); every new screen follows
it: one 4 px radius, hexagonal avatars, a bar with no word beside it, the swipe. The bar reads as
continuous but is **quantized**: its fill steps in units of `q = error / 2`, where `error` is
`user_recs.error` for the feed on screen, so it can never draw a difference the walk cannot
support. `q` is a required prop, and a bar without one renders "nothing known yet" rather than
picking a default — a default would be a silent claim about precision. Ranking uses the
unquantized score, or the quantum would manufacture ties.

`web/app/globals.css` carries the palette; `--shadow-*` does a second job as the 1 px rule
around a panel.

**Tailwind only emits a utility it has seen, and a missing one fails silently.** A recursive
`content` glob in `tailwind.config.js` does NOT recurse in this build: it matched only the top
level of `components/`, so every primitive under `components/ui` rendered unstyled. The sources are
listed one level at a time as `@source` lines in `globals.css`, `tailwind.config.js` keeps only
`darkMode`, and `web/tests/styles.test.ts` fails when a new directory of components has no line.

## What the list is drawn from

The list reads only the viewer's own feed and ratings, and searches in memory
(`utils/discover.ts`), with the catalog merged in by prefix so a thing that exists is found rather
than made twice. Empty, it is the feed plus everything the viewer has rated, since the feed leaves
out whatever nobody else in reach rated. A thing's suggested rail is filled on the client from the
viewer's own ratings (`shared/src/suggest-attributes.ts`, DESIGN §2.11), and is empty, never
filler, for a viewer who has rated no attributes.

- **Nothing orders by when a thumb was given.** `rated_at` is written because a clock cannot be
  backfilled, but nothing reads it and `/privacy/` does not mention it; using it is its own
  decision, and revisits `/privacy/` in the same commit.
- **The entry's id is what is drawn.** A ratings row can name an id nobody created, and showing it
  is harmless: it has been through the same folding and `CHECK`s.
- **An absent tag is "nothing is known", not "no"** (DESIGN §2.6): the core drops every ratable
  below `W_min` before the function writes it, so the client needs no `W`.
- **Nothing on it is a number.** Typing ranks by the viewer's own `conf` (known to your network
  first), then alphabetically, and never renders `conf`, `score` or any count. A rated row keeps
  its bar and tints its background; a chip carries the attribute itself and no state word. DESIGN
  §4 is why.

## The recompute behind it

`supabase/functions/refresh-recs/` is DESIGN §3.4 step for step.

- **The screen refreshes on open, and the function decides whether that means anything.** It
  returns the cached feed when it was *checked* under ten minutes ago and the viewer has not rated
  since, and when a recompute lands on the same answer, so `computed_at` moves only when there is
  something new; a friend's rating arrives on that window. The staleness check keys on `checked_at`,
  never `computed_at` — otherwise a thumb that did not change the feed, or a walk that never resolves,
  forces a walk on every open. Every stamp is the database's `now()` read *before* the
  neighbourhood, or a thumb given mid-walk would be dated as already read.
- **The feed comes back inline, and the row is the fallback** for a cold start and an offline
  open; one Realtime channel carries the case where something other than this tab rewrote it.
  Nothing but a viewer's own open writes that row. First paint is `localStorage`, in a try/catch,
  under a per-viewer key.
- **The neighbourhood is one call**, `private.neighbourhood(uid, N_max, depth)`, in the shape the
  wasm boundary takes; up to three boundary rounds follow, each `private.load_nodes` on an explicit
  id list. `N_max` counts every node loaded, the rounds included.
- **The CPU ceiling is the thing to respect**: a free invocation is metered on the order of two
  seconds. If it binds, what gives first is `N_max`, then the boundary itself (a core change).
- **The walk is cached, and it is the smallest of the three costs.** `user_model.reach` holds the
  last full walk's masses beside `reach_hash`, a hash of the loaded adjacency; equal means only a
  rescore. A full walk is forced anyway when `private.ratings_changed` moves for anyone whose
  alignment feeds an affinity the walk used, or when consecutive reuses reach
  `REACH_REUSE_MAX = 20`. The walk (1.6–2.4 ms at 2 000 × 12–15 friends) costs less than crossing
  the snapshot into wasm, and far less than the neighbourhood read, so the cache is kept because it
  is nearly free, not because it made the recompute cheap. Applying only ratings changed since
  `checked_at` as deltas would save the read and is deliberately NOT built: it needs a correctness
  argument against drift that nobody can check without real traffic.

The pure half — folding, change detection, sanitizing, which boundary nodes a round takes — is
`shared/src/entries.ts`, with its own test suite.

## Taste search

`supabase/functions/refresh-suggestions/` recomputes the **caller's own five rows and nobody
else's**, called by the people screen on open behind a ten-minute window
(`user_model.suggestions_at`); about 14 ms of search (`docs/algorithm-notes.md` §9). It is a
function rather than SQL because the deep walk is the wasm core. It loads the neighbourhood at the
feed's `N_max = 2 000` (the deep budget's 50 000 bounds the walk; what a search costs is egress),
asks which loaded people may be named, calls `suggestFor`, and replaces the rows in one
transaction. The candidate filters (overlap `A + D ≥ 20`, `ℓ ≥ 1`, not a friend, not dismissed,
not already carried by the live feed) are all in `rust/src/suggest.rs`; DESIGN §5.1 is the rest.

- **A row carries no level of agreement**, only the attributes the two agree on against the grain,
  because "lots in common" is not a reason to accept a stranger. No chips is a normal outcome. Read
  DESIGN §5.2 before touching it: it is the one thing that widens what is said about somebody else.
- **Discoverability is reciprocal.** Off means you are named to nobody and your own list is written
  empty — by the function, before it loads anything. Other viewers' rows naming you stay, hidden by
  `private.is_discoverable` until you switch back on.
- **A dismissal is a preference** in `user_prefs`; the screen filters on it at once
  (`visibleSuggestions`) and the next search honours it.
- **The default seeded world (40 users, 60 items) suggests nobody**: everyone is within two hops
  and overlaps are far under twenty. `check:suggestions` seeds a larger, spread-out world (see its
  `WORLD` flags), which gives about 85 of 150 people somebody.

**`κ` and `a₀(d)` are running tallies**: each recompute reports partial sums into `user_model`'s
`pair_*` columns and 0005 pools them into `private.params` under DESIGN §2.10's `N_min = 200`.
`rust/src/priors.rs::estimate_priors` is the batch version the simulator uses, and
`rust/tests/priors.rs` checks the tallies agree with it.

**Three statements run on a schedule, all inside the database (0005), and nothing else anywhere
does**: the priors pooling, the diagnostics TTL sweep and the write-budget sweep. The last two are
not optional: they are what stops a free project pausing after seven days without database
activity. There is deliberately no scheduled GitHub workflow — GitHub disables one after 60 days of
repository inactivity and nothing goes red.

## The written pages

Four statically exported routes — `/how/`, `/about/`, `/privacy/`, `/help/` — each a plain server
component importing no store and needing no session, so the full text sits in the exported HTML.
`components/doc-page.tsx` is the shell. `check:pwa` greps one sentence out of each exported page,
and its list is four on purpose: a page list that shrinks silently is how a page goes missing.

`/how/` is the explainer, and **nothing on it may claim more than DESIGN §2 does**. Each section
has an inline SVG diagram (`components/how-diagrams.tsx`, palette tokens only) and a `<details>`
quoting DESIGN's formulas unchanged; the prose above stands on its own. **It is the only place the
swipe directions are explained** — the empty feed deliberately teaches no gesture — so if that
sentence leaves `/how/`, it leaves the product. The priors are population estimates, so numbers on
it are stated against the chosen `W_min`, `L` and `α`, never as ratios of prior-dependent ones.

`/privacy/` says the uncomfortable parts out loud because DESIGN §4 does: **with exactly one friend
your feed is that friend's ratings** (word for word — it is the `check:pwa` needle); that friction,
not secrecy, stands between a feed and knowing who; that a thing's name is public text that can
never change; that Google is the only way in and the site loads no trackers. It carries the promise
of **no counts and no attribution**. It must **not** say a thumb is stored without a clock or that
rating order cannot be reconstructed: `ratings.rated_at` exists.

## Icons

`web/scripts/make-icons.mjs` reads `docs/mark.svg` and writes `app/icon.svg` plus the four PNGs in
`web/public/`. It needs `rsvg-convert` (`brew install librsvg`); the outputs are committed. Run it
when the accent or the mark changes.

The mark is **hex grapes**: six hexagons in a 3-2-1 bunch, no stem, each an outlined hexagon with a
**same-size** hexagon clipped inside it and pushed toward one vertex, so a rim of even width
survives on exactly two sides. A *smaller* inner hexagon leaves a rim on three sides and reads as a
ring. Hexagons have real rounded corners rather than a rounded pen stroke; a notification badge sits
on a hexagon's upper-right vertex. **Nothing in the mark may be `<text>`**: every renderer that
draws it (a favicon tab, an OS launcher, a PNG converter) has no webfont and substitutes whatever
grotesque it has.

## Supabase setup (do once)

**Status**: the project exists and this checkout is linked to it (the ref is in `supabase/.temp/`,
not committed); `web/utils/project.ts` carries its URL and anon key. Steps 1–6 are done: the Google
OAuth client and a `config push`, `pg_cron`, migrations `0001`–`0007`, both Edge Functions. **Step 7
is not**, and waits on the repository. Until the first `web.yml` run pushes `config.toml` again, the
project differs from the file in three ways: the redirect list is `http://localhost:*/**`, the phone
provider is on, and `site_url` is not `grapevine.hafa.cc`. `supabase config diff` shows all three.
The consent screen's privacy-policy URL (step 2) also predates `grapevine.hafa.cc`, and is changed
by hand in the Google Cloud console. Nothing below is needed to run against the local stack.

1. **Create a project**, free tier. Its URL and **anon** key go in `web/utils/project.ts` as
   `PROJECT_URL` and `PROJECT_ANON_KEY` (a blank one disables sign-in).
2. **A Google OAuth client**, Web application. Its only authorized redirect URI is
   `https://<project-ref>.supabase.co/auth/v1/callback`: Supabase receives the provider's redirect
   and bounces to `site_url`. Do **not** add `http://localhost:54321/auth/v1/callback` (see "The
   local stack").
   - The consent screen needs a privacy-policy URL (`https://grapevine.hafa.cc/privacy/`) before it
     can leave testing. Its authorized domain is `hafa.cc`, which covers the subdomain.
   - The client id and secret reach the project as `SUPABASE_AUTH_GOOGLE_CLIENT_ID` and
     `SUPABASE_AUTH_GOOGLE_SECRET`, which `config.toml` reads. Never committed.
3. **`supabase link --project-ref <ref>`**, `supabase db push`, then **`supabase config push
   --project-ref <ref>`**. `db push` applies migrations only; the auth half of `config.toml` —
   Google only, anonymous off, email signup off, email changes confirmed at both addresses,
   `site_url`, the redirect allow-list — reaches the project only through `config push`, which
   needs both Google variables in the environment (run with them unset, it pushes an empty
   client). Run `supabase config diff` first: a non-interactive push does not ask. Then **prove
   it** — `signInAnonymously()` and `signInWithOtp()` must both fail against the deployed project.
4. **`site_url` is `https://grapevine.hafa.cc/`, with the trailing slash**, exactly what the client
   sends (`origin + "/"`). A `redirectTo` matching neither it nor an `additional_redirect_urls` glob
   is NOT refused: Supabase sends the person to `site_url`, so from a dev server a wrong allow-list
   looks like sign-in landing on production. The list is `http://localhost:3000/**` only — it is
   pushed to production, so it names the one port somebody signs in on (`bun run dev`);
   `dev:local` needs none, because local sessions are minted.
5. **`pg_cron` must be enabled** for `0005` to apply.
6. **Realtime** carries `user_recs`, `connect_requests` and `friendships`, added to the publication
   by `0006`, which also restricts it to `insert, update` (a DELETE event cannot be bounded by RLS;
   0006 says why). RLS applies to Realtime, so nobody receives another viewer's row.
7. **Repository secrets and one variable** — the whole of what the deploy is given:
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (secrets) — `link`, `db push`, `config push`,
     `functions deploy`.
   - `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET` (secrets) — `config push`.
   - `SUPABASE_PROJECT_REF` (a **variable**) — out of the file so a second project needs no diff.

   `web.yml` refuses to start if any of the five is empty. These are long-lived secrets (Supabase
   has no workload identity federation): rotate them, and never put one in anything the client
   bundles.
8. **Free tier**: 500 MB of database and 5 GB of egress a month (roughly one to three thousand
   users, DESIGN §3.8), and no point-in-time recovery.

## Backups

**Not set up, and optional until there are real users.** Once there are, it is not optional: the
free tier has no point-in-time recovery and `db push` has no undo. The procedure:

- **Nightly, from Erik's Mac**, a launchd agent (`~/Library/LaunchAgents/`, a
  `StartCalendarInterval`, which runs a missed slot on wake) runs `pg_dump` against the session
  pooler (`supabase/.temp/pooler-url`), with the database password from the login Keychain,
  written twice: `--schema-only`, and `--data-only --schema=public --schema=private --schema=auth`.
  `pg_dump` must be 17 or later (`brew install postgresql@17`): an older one refuses the project's
  17 server. `supabase db dump` is the same thing but wants Docker.
- **Encrypted before it lands**, `openssl enc -aes-256-cbc -pbkdf2` under a second Keychain
  passphrase: the `auth` half holds everybody's email address.
- **Kept 30 days**, then deleted by the same script. The change that sets backups up must add to
  `/privacy/`'s "leaving" section that a deleted account's rows survive in them for up to 30 days.
- **Restore-tested**, monthly and after any migration: build a cluster the way `run-local.sh` does,
  load the `public` and `private` data with `set session_replication_role = replica` (the stand-in
  `auth.users` has too few columns for the real rows), and compare row counts per table against
  `supabase db query --linked`.

## Deployment

**Deploying is manual.** A push to `main` runs `ci.yml` and nothing else. `.github/workflows/web.yml`
(`workflow_dispatch` only, refusing any ref but `main`) does the whole deploy, in an order that is
not negotiable:

    CI gate (ci.yml, reused by workflow_call)
      → Supabase: refuse an empty secret or a ref other than main
                  + db push --dry-run + config diff (printed, read-only)
                  + db push + config push + functions deploy --use-api
        → GitHub Pages: bun export, upload web/out
          → deploy-pages

A GitHub Release deploys nothing: it would run on its tag, and the `github-pages` environment
accepts main only, so migrations would apply and the Pages job would then be refused.

**The database goes first**, so the site never publishes a frontend expecting a policy or function
that is not live; if that job fails, Pages never runs. Migrations and both functions deploy every
time. **And `bun export` runs in the gate too**: otherwise a build failure would land after `db
push` had applied forward-only migrations, leaving the database ahead of a site stuck on the last
good version, with nothing on the free tier to roll back with. The deploy job builds the `web` wasm
itself rather than downloading anything. `supabase functions deploy` uploads only the modules an
entry point imports; the `.wasm` ships because `config.toml`'s `static_files` names it for each
function.

`automerge.yml` merges Dependabot pull requests once `ci.yml` passes; it deploys nothing.

### Migrations

**Migrations are append-only once recorded.** A migration whose version appears in `supabase
migration list --linked` is frozen: never edit, rename, reorder or delete it. `db push` skips
recorded versions, so an edit reaches every fresh stack (CI, `run-local.sh`) and never the project,
and the two diverge silently. Every change, including a fix to one that just shipped, is a new
file with the next number. SQL is not applied to the project by hand; if an emergency forces it,
the same SQL lands as the next migration in the same change and is recorded with `supabase
migration repair --status applied <version>`. A migration runs against real data with no undo, so
one that drops or rewrites a column is reviewed as the irreversible thing it is, and `supabase db
reset` belongs nowhere near the project.

`ci.yml`'s `database` job fails a push or pull request that modifies, deletes or renames an
existing file under `supabase/migrations/`. `0001`–`0007` are recorded.

### The domain (do once, by hand)

**The site is `https://grapevine.hafa.cc/`, served from the root of its own origin**, not
`hafa.cc/grapevine/`. So the export has no base path: `next.config.js` sets none, `start_url`, the
manifest `scope` and the worker's scope are all `/`, and `check:pwa` serves the export at the root.
The `grapevine-` cache prefix and `grapevine-theme` key are kept for the day something else is
served from this origin.

`support@grapevine.hafa.cc` is on Cloudflare Email Routing, which puts MX and SPF records at
`grapevine` itself, and a `CNAME` cannot share its name with any other record (RFC 1034 §3.6.2), so
the name uses the apex form: `A` and `AAAA` records to GitHub Pages, as `kip.hafa.cc` does. Every
record is **DNS only (grey cloud)**: a proxied one answers with Cloudflare's addresses, GitHub's DNS
check rejects it, and Enforce HTTPS never becomes available.

    grapevine  A     185.199.108.153
    grapevine  A     185.199.109.153
    grapevine  A     185.199.110.153
    grapevine  A     185.199.111.153
    grapevine  AAAA  2606:50c0:8000::153
    grapevine  AAAA  2606:50c0:8001::153
    grapevine  AAAA  2606:50c0:8002::153
    grapevine  AAAA  2606:50c0:8003::153
    grapevine  MX / TXT   whatever Email Routing adds for the subdomain — no CNAME, ever

Then, in order:

1. **The records above**, and Email Routing's for the subdomain.
2. **Confirm the org's domain verification** reads *verified* under the `hafacc` org's Settings →
   Pages. It verified `hafa.cc`, which covers immediate subdomains; nothing to add.
3. **The first `web.yml` run**, which turns Pages on with GitHub Actions as its source.
4. **Settings → Pages → Custom domain: `grapevine.hafa.cc`**, Save, and wait for the DNS check. That
   field is the only place the domain is set: a `CNAME` file is ignored when a custom Actions
   workflow deploys, so the repo carries none.
5. **Enforce HTTPS**, once GitHub offers it — usually within the hour, up to 24 hours. `hafa.cc` has
   no `CAA` record; if one is ever added it must allow `letsencrypt.org`.

Once the custom domain is set, `hafa.cc/grapevine/` and `hafacc.github.io/grapevine/` answer with a
301 to `grapevine.hafa.cc`.

Sources: GitHub's Pages docs on [custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site),
Cloudflare's [Email Routing subdomains](https://developers.cloudflare.com/email-routing/setup/subdomains/).

### Release runbook

1. The pre-deploy checklist below, green, on the commit that is going out.
2. That commit on `main` on GitHub, and `ci.yml` green on it.
3. Actions → **deploy web** → Run workflow, on `main`. Read the `db push --dry-run` and `config
   diff` lines in the `supabase` job's log: they are the list of what it changed.
4. The hand checks below, against the deployed site.
5. Optionally a GitHub Release on that commit, as a marker.

### Pre-deploy checklist

From the repo root, the gate in the order CI runs it, then the published artifact:

```sh
(cd rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings)
(cd rust && cargo test --release && cargo test --release --features serde)
bash scripts/build-wasm.sh nodejs && node rust/examples/smoke.mjs
bash scripts/build-wasm.sh web
deno check supabase/functions/refresh-recs/index.ts supabase/functions/refresh-suggestions/index.ts
deno lint  supabase/functions/refresh-recs/index.ts supabase/functions/refresh-suggestions/index.ts
supabase start && supabase db lint && supabase test db   # (docker); else run-local.sh, weaker
(cd shared && bun install --frozen-lockfile && bun run lint && bun test)
(cd web && bun install --frozen-lockfile && bun run lint && bun run test)
(cd web && bun run export && bun run check:pwa)          # (chrome)
(cd web && bun run check:signin && bun run check:feed)   # (docker + chrome), dev:local up
```

**The checks nobody runs.** Of the seven check scripts in `web/scripts/`, only `check:pwa` needs
no stack, so it is the only one run here, and CI runs none. So `check:recs-parity`,
`check:recs-function`, `check:suggestions` and `check:feed` run on no machine that exists. A
`checks` job in `ci.yml` is writable (the `database` job already runs Docker), but nobody here can
run it once before committing it; closing the gap is that job, watched through its first green run
by whoever has Docker.

By hand, against the deployed site:

- **Sign in.** Google's consent screen cannot be automated, so redirect-URL mismatches, a stale
  OAuth client and the PKCE/fragment collision otherwise fail in production, on a real person.
- `web/utils/project.ts` carries a real project URL and anon key.
- `supabase/config.toml` — anonymous off, email signup off, no second factor, Google the only
  external provider, no SMTP section — and the deployed project agrees.
- **From a Google session, `supabase.auth.updateUser({ email: "someone-else@example.com" })` must
  not change `auth.users.email`** (`double_confirm_changes` and `enable_confirmations`, delivered
  only by `config push`).
- **Both** functions answer 401 to a POST with no `Authorization` header and to one carrying only
  the anon key: `verify_jwt = false`, so nothing in front refuses it for them.
- The repo is public and Pages-eligible (`actions/configure-pages` with `enablement: true` only
  turns Pages on for a repo that may have it).
- The Google consent screen's privacy-policy URL resolves to `/privacy/`.
- `http://grapevine.hafa.cc/` redirects to `https://`, and Pages shows the custom domain with
  Enforce HTTPS ticked.
