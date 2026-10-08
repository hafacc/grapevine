# grapevine — contributor notes

[DESIGN.md](./DESIGN.md) is the source of truth for *what* is built and *why*. This file is what a
person or an agent needs to run and check things, and the rules that are easy to break.

Read DESIGN §1 before changing any screen.

## Layout

    web/         SvelteKit app (Svelte 5), static export. Bun. The only thing a user
                 touches. `src/routes/` is the app at `/` and the three written pages,
                 `src/lib/components/` the UI (`ui/` the primitives), `src/lib/utils/`
                 logic and database access, `static/` the icons, `sw/` the service
                 worker.
    shared/      Pure TypeScript, zero runtime dependencies, imported where it lives by web/
                 and by the Edge Function (Deno reads the TypeScript). No generated copy
                 of it exists anywhere. Bun.
    scripts/     build-wasm.sh — wasm-pack, one target argument: `web` for the Edge
                 Function, `nodejs` for `rust/examples/smoke.mjs`, the only thing that
                 runs the wasm boundary outside Deno. generate-name-rules.ts — the
                 allow-list for names, from pinned Unicode data, written into
                 `shared/src/name-tables.ts` and a new migration (see "Normalization").
    rust/        The one Rust crate (`grapevine-core`): DESIGN §2's algorithm, the simulator
                 and the property suite. No I/O. Built to WebAssembly by wasm-pack; neither
                 build output is committed.
    supabase/    config.toml (auth providers, redirect URLs — in the repo, not a console),
                 migrations/ (schema, grants, policies, server-only functions, cron),
                 functions/refresh-recs/ (the per-viewer recompute, Deno),
                 tests/ (pgTAP), seed.sql
    docs/        witness-model.md (the proofs, and the prototype's measurements behind every
                 choice), algorithm-notes.md (the built core's measurements) and mark.svg
                 (the mark). No code reads any of it except make-icons.mjs, which reads
                 mark.svg.

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
supabase functions serve refresh-recs    # (docker) the function against the local stack

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
cd web && bun run lint           # THE gate: svelte-kit sync + svelte-check +
                                 # service-worker tsc + biome
cd web && bun run fmt            # biome format --write
cd web && bun run test           # unit suites
cd web && bun run export         # vite build -> web/out/
cd web && bun run check:pwa      # installability, offline, and each written page's own text.
                                 # Drives a real Chrome, needs NO stack: it builds the export,
                                 # serves it itself and signs nothing in. Not in CI.

# Everything below wants the local stack up (docker); the browser ones want `dev:local` too.
# None is in CI. None brings a backend up: each seeds into the running stack and says so if it
# is not there.
cd web && bun run check:signin   # a minted session renders the app, none renders the welcome
                                 # screen, a tap on your name renames you, and a link made by
                                 # one account names its owner signed out and is answered by
                                 # another. NOT the OAuth round trip (see "One door").
cd web && bun run check:feed     # the one list: ranking, filtering by name and attribute, the
                                 # add button, what a first rating writes, and every bar's fill
                                 # the value it draws
cd web && bun run seed:local     # a simulated world into the running local stack
cd web && bun run check:search-id      # every `items` row has `search_id === searchFold(id)`,
                                       # importing the one implementation of the folding
cd web && bun run check:recs-function  # the staleness contract: a second call inside the
                                       # window writes nothing; the viewer's own new thumb
                                       # recomputes them and nobody else; past the window a
                                       # recompute that finds nothing new moves `checked_at`
                                       # and not `computed_at`. Also: `user_model` carries
                                       # DESIGN §3.2's columns, a uid in the body is ignored,
                                       # and a call with no session is a 401.
cd web && bun run check:recs-parity    # the stored feed against `compute-user` on the same
                                       # dump, to 1e-9. Needs a Rust toolchain too.

cd shared && bun install
cd shared && bun test            # normalizeId, searchFold, confusable skeletons; entries.ts
                                 # (folding, change detection, sanitizing); search.ts;
                                 # snapshot-cache.ts; suggest-attributes.ts; name-rules.ts
cd shared && bun run lint        # tsc + biome

cd rust && cargo test --release                    # unit tests and the property suites
cd rust && cargo test --release --features serde   # and the boundary's own deserializer
cd rust && cargo clippy --all-targets -- -D warnings
cd rust && cargo fmt --check

# From anywhere. `web` writes a copy into the function's directory, because `functions deploy`
# uploads one directory and the `.wasm` is read by path, not imported.
bash scripts/build-wasm.sh nodejs
bash scripts/build-wasm.sh web
node rust/examples/smoke.mjs                 # 3-user snapshot through the wasm boundary

# The ONLY thing that compiles the Edge Function (no tsconfig or biome config covers it, and
# deploy's esbuild does not typecheck), so a signature change in `shared/src/entries.ts` can be
# green everywhere else and break only here. Needs the `web` wasm.
deno check supabase/functions/refresh-recs/index.ts
deno lint  supabase/functions/refresh-recs/index.ts

# The world the seed script and `compute-user` share (`check:recs-parity` hands both one file).
cd rust && cargo run --release --features serde --example dump-world -- --out /tmp/world.json
cd rust && cargo run --release --features serde --example compute-user -- /tmp/world.json u7
```

`rust/` pins its toolchain in `rust/rust-toolchain.toml`. `cargo test` builds the core with no
dependencies: `serde` sits behind a feature (the examples need `--features serde`) and the wasm
bindings behind another. `web`'s `lint` needs nothing built first, so a fresh checkout can run the
gate straight away: `svelte-kit sync` writes the generated `tsconfig` the others extend. `web` is on
TypeScript 6, because `svelte-check` does not run on 7 alone; `shared/` stays on 7, and is checked by
both. Biome lints and formats `.svelte` files, script and markup, and sorts their imports. Its
formatter strips the leading whitespace inside a `<pre>` or a `<textarea>` (no file has either), and
refuses a file whose `{@const}` carries a type annotation.

**`web`'s `dev`, `lint`, `fmt`, `test` and `export` need no Node.** Each tool's bin file asks for
`node` in its shebang, so the scripts call them as `bun --bun <tool>`, and `vite.config.ts` runs the
service worker's `tsc` with `process.execPath`; CI installs bun and nothing else. A tool added to a
script without `--bun` runs under whatever Node is on PATH, or fails where there is none. The
`check:*` scripts that drive Chrome are run with `node`.

## The algorithm in the crate

DESIGN §2 is the specification, including the order the core computes in; `docs/witness-model.md`
holds the proofs and the prototype's measurements, `docs/algorithm-notes.md` the built core's. What
a contributor needs to not undo:

- **One pass, no loop.** `rust/src/witness/` is one pass per step: base rates, direct reliability,
  the chains (a max-product search, strongest first), own history, `κ_a` per attribute, scores,
  certainty, facts. Nothing iterates to a fixed point and nothing is cached between calls; there is
  nothing to rescore.
- **The core departs from the prototype's choices on purpose.** The prototype read population
  statistics over everyone reached, capped per-attribute reliability at the head only and snapped
  sharp priors to its grid; each of those breaks a claim of DESIGN §2 (`docs/witness-model.md`
  §1.4, §1.7, §1.8). Both docs' numbers were measured on code since removed from the repository.
- **A region is one voice, capped at its head; keep it exact.** Everyone reached through one
  directly trusted person is averaged into that person's region; nobody's reliability exceeds the
  head's; later thumbs raise nobody past their own chain; a region's say on the starting point is
  its *strongest* rater's, never the sum. The other way round, each of these lets an attack through
  (DESIGN §2.10's list). `tests/witness_sybil.rs` runs every plan.
- **Both exposures are structural.** A later thumb of `v`'s own history is a reaction with
  probability `1/(people v trusts)`; every thumb in a chain link, with `1/(v's connections nearer
  the viewer)`. Counting all of `v`'s connections for a link lets a clique of bots hide its
  exposure.
- **Per-attribute reliability takes the same caps.** Centred on the person's capped reliability
  off the attribute, capped again the same way; anyone whose every shared thing carries the
  attribute reads at their overall reliability and does not vote on `κ_a`. Capping only at the
  head lets a copier of the viewer reach it through any attribute. `κ_a` is chosen per region, over
  the circle and that region, from `{1, 2, 4, …, 1024}`.
- **Population statistics are the circle's** (`witness/circle.rs`): the viewer and the people they
  trust directly. Base rates, which attributes a thing carries, the fact reliability and the
  attributes' base rates are read over it, because nobody behind an accepted connection can be in
  it; read over everyone reached, two hundred bots behind one connection move a thing past the
  bound. Two things add one region and only for that region: `κ_a`, and the base rate a thumb's
  evidence is judged against (`witness/score.rs`). Reliabilities are always learned against the
  circle alone. Chains reach only people the loader read who are connected to the viewer; an
  unloaded person is on the boundary with the strength a chain would reach them at.
- **The parameter table is three numbers** (`params.rs`): `a₀ = 0.65`, `κ = 8`, `L = 2`.
  `private.params` replaces `κ` and `a₀` field by field (`PriorEstimate::merge` reads `kappa` and
  `a0_d1`); everything else is learned or structural. `N_max = 2 000` is the loader's
  (`MAX_LOADED_NODES` in `refresh-recs`): the core computes over whatever snapshot it is handed.
- **Scores are strictly inside `(−1, 1)`** and every sum runs in a fixed order, so one snapshot gives
  bit-identical results. A posterior under a sharp prior (large `κ_a`) is integrated over a window at
  the prior's own scale; everywhere else it is the measured 16-point grid.
- **Order is one bit.** `Snapshot::stamps` orders thumbs; the boundary gives `±2` for a thumb
  given after the viewer's own and `±1` otherwise (0015), and `to_snapshot` turns that into stamps
  relative to the viewer. No clock ever reaches the core. Between two people who are not the
  viewer the order is not known and not asked for.
- **No floor.** Every ratable any reached person rated has an entry; certainty (`W`) moves where
  it ranks and how far its bar reaches (below), it never hides it.
- Nothing is `#[ignore]`d. Every entry point returns a `Result`; a non-finite score or certainty
  is an error, never a result. Rating values and keys are sanitized rather than refused, so one
  crafted row in reach cannot fail a viewer's recompute. `is_normalized_id` does not claim
  canonicity: NFKC-normality is a database `CHECK` and the crate has no Unicode tables.

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

- **A profile arrives named**: a trigger on `auth.users` creates it from Google's metadata, and
  calls a Google account that carries no name `unknown` (0010). Nothing asks for a name.
- **PKCE, not implicit.** The implicit flow returns `#access_token=…`, and the fragment belongs to
  the router: the collision looks like a blank screen on first sign-in, i.e. a routing bug. PKCE
  returns `?code=…`, which `detectSessionInUrl` consumes and strips. The client must use
  `flowType: "pkce"`.
- **The trip to Google loses the URL** (`utils/sign-in-return.ts`). The screen a signed-out visitor
  opened (a friend's `#/item/...`) is kept in `sessionStorage` before the redirect and restored on
  return, because `redirectTo` cannot carry a fragment ahead of the `?code=` GoTrue appends. A
  refused or cancelled sign-in comes back as `?error=…&error_description=…`, which supabase-js only
  logs; it is read and stripped before the client is constructed and shown on the welcome screen
  through `authErrorMessage`. A friending link's token (`#/invite/<token>`, `utils/invites.ts`)
  is in the fragment because a fragment reaches no server (not the host's logs, not a `Referer`)
  and the OAuth return writes only the query; it is taken out of the address on arrival and kept
  in `sessionStorage` the same way, so it survives the trip and never sits in history.
- **Email confirmations stay ON although there is no email door.** A Google session can call
  `updateUser({ email })`; with confirmations off that rewrites `auth.users.email` to an address
  the caller does not own, and the real owner's next Google sign-in links into that account.
  Sign-out is `scope: "local"`: the default revokes every session the account holds.
- **`has_credential()` is vacuous today and stays.** It gates making a link and redeeming one, and
  guards against a dashboard toggle turning on anonymous sessions or a second provider, which ships
  no diff. Its body is general so a second door is correct the day it is enabled.
- **No anonymous accounts, although a link would be the natural place for one** (DESIGN §3.6):
  the per-account write budget multiplies by accounts that cost a click (and Supabase's remedy, a
  CAPTCHA, is a third-party script `/privacy/` says the site does not load); `linkIdentity` fails
  for a Google account that already has a grapevine account, stranding the anonymous one with the
  new friendship; an unconverted account is a friend nobody can sign back into and nothing
  deletes; and `has_credential()` would stop being vacuous. None of that is a sybil argument.
- **Invite-only, enforced after the fact** (0010, DESIGN §3.6). Any Google sign-in creates an
  account, because the OAuth round trip carries nothing of ours to GoTrue and a "before user
  created" hook would have no token to check. So an account with **no connection is locked**,
  whether it never joined or removed its last one: `private.is_unlocked()` reads `friendships`
  (nothing stores the lock), `private.count_write` (the trigger every counted write goes through)
  refuses a locked caller with `42501`, `private.refuse_if_locked` does the same for its name
  update and clearing a thumb, and `refresh-recs` answers it `403`. Losing the last connection
  deletes the account's link (a trigger on `friendships`), so a link's owner is never locked.
  Redeeming a live link writes a friendship, which is the unlock. Nothing deletes a locked
  account. The client asks
  `account_locked()` with the profile and shows `components/locked-screen.svelte` (*your account is
  locked*) instead of the list, unless the device holds a live link. The people screen warns
  before the last connection goes. An admin (see "Admins") is never locked, which is how the
  first account makes the first link. **Anything new a client can
  write must go through `count_write` or check `private.is_unlocked()`**, or a locked account
  can write it.
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

- **`profiles`**: readable by self and a friend, and nobody else; a link's holder sees a name
  and photo through `invite_owner`, not this table. There are no handles and no lookup of a
  stranger by anything: nothing on this table may become a read clause that does not name a live
  relationship. No email or phone column. `display_name`
  defaults to Google's first name, is the owner's to change, and a `CHECK` refuses control
  characters and bidi marks; the table has no INSERT (the `auth.users` trigger creates the row).
- **`friendships`**: both directions stored; a deferred constraint trigger makes a one-sided
  friendship impossible at commit, and the core still checks reciprocity. No client inserts one:
  `redeem_invite` writes both halves as its owner. Delete from either end. There is no taste
  search, discoverability switch, `user_prefs` or connect request (0011); a link is the
  only way to a friend.
- **`invite_links`**: a person's friending link, at most one (`owner_id` is the key), with no
  expiry and no limit on uses. The token is stored as itself so the owner can copy it again:
  `token` and `created_at` are selectable, `owner_id` is not, and the select policy admits the
  owner's own row only, so filtering on somebody else's token finds nothing. No insert or update
  grant; DELETE is turning it off. `set_invite_link()` mints the token (32 bytes from two
  `gen_random_uuid()`s, base64url) over the owner's row, so the old one stops working at once,
  and spends a write. `invite_owner(text)` answers one exact token with a name and a photo and
  no id, and is **the one thing `anon` may call**: the link is the authority to see them, and
  the welcome screen shows them. `redeem_invite(text)` spends a write even on a miss, then writes
  both friendship rows as `security definer`. A dead link — off, replaced, mangled — names
  nobody and says *invalid or expired*, on the welcome screen before any trip to Google; a
  malformed token never reaches the server (`isInviteToken`).
- **Deleting an account is `public.delete_account()`** (0012): no argument, deletes the
  caller's `auth.users` row, and the cascade does the rest (17 and 24 pin it). Anything new that
  names a person needs `on delete cascade` from `profiles`, or deletion either fails or leaves
  it behind; a uuid kept outside a foreign key (an array, a column with no FK like
  `debug_events.user_id`) needs clearing in that function by hand. It also leaves
  `private.deleted_identities`: an HMAC of each identity's `provider:provider_id` under the
  Vault secret `identity_fingerprint_key`, with that UTC day's spent budget, which a trigger on
  `auth.identities` hands to a new account from the same identity that day (25 pins it). Swept
  after its day. `run-local.sh` stands in a plain-text Vault.
  Replacing or turning off a link keeps the friendships it made.
- **`items`**: the id is what somebody typed, normalized. The CLIENT writes `search_id` from
  `searchFold`, deliberately: a trigger would be a second implementation of the stripping, and a
  disagreement is a row nobody can find by its own name; `check:search-id` is what checks it. No
  UPDATE or DELETE for anyone. No URL is stored (a phishing surface) and no tag list: a thing's
  link is `item_refs (source, ref)`, the id checked against `private.ref_sources`' pattern, and
  the URL built from it by `shared/src/references.ts`. Never store coordinates there: that is
  what keeps OpenStreetMap's share-alike out of reach. Both
  `text_pattern_ops` indexes are needed: the collation is not `C`. `created_by` is readable by
  nobody and is the ONE person reference that does not cascade (`on delete set null`), or deleting
  an account would be impossible; its partial index (0017) keeps that set-null off a catalog scan.
- **`reports`**: a signed-in person reports a thing's name from its screen. INSERT of
  `item_id` only (`user_id` defaults to the caller), one per person per name, one write spent,
  no SELECT/UPDATE/DELETE for any client — see "Reports" for review and removal.
- **`private.admins`**: one row per admin, no client grant, written by hand ("Admins").
- **`ratings`**: key `(user_id, item_id, tag)`, owner-only, less thumbs on a removed name awaiting
  the purge (see "Reports"); `tag = ''` is the thing itself.
  `rated_at` leaves the database only as the order bit (below), and is not the staleness probe
  — `max(rated_at)` cannot see a flip or a clear, which is what `private.ratings_changed` is for.
  `private.neighbourhood` and `private.load_nodes(viewer, ids)` return ratings nested, item to tag
  to value — `±2` for a thumb given after the viewer's own on the same thing (0015) — and must not
  build a joined key: text cannot hold the NUL the core joins with. `load_nodes` aggregates `json`
  and casts to `jsonb` once, with merge joins off so the viewer's own thumbs are hashed once
  (0017): nested `jsonb_object_agg` was two thirds of a full load.
- **`user_recs`**: owner read, written only by `refresh-recs` as the service role, one row in one
  statement: `computed_at`, `entries`, `feed_hash`. `feed_hash` stops a same-answer recompute
  moving `computed_at`. An entry is a score and a certainty (`conf`, DESIGN §2.6's `W`), stored
  apart, for every rated thing in reach; the client combines them (see "UI design language").
  The app reads it through `public.my_feed()`, never the table, so a removed name is left out.
- **`user_model`**: NO client verb; the Edge Function's bookkeeping: `computed_at`, `checked_at`,
  `nodes_touched`, `rating_count`, `recomputed`, `priors_at` and the twelve `pair_*` tallies.
  `checked_at` (every recompute) is what the ten-minute window keys on; `computed_at` moves only
  when the feed changed. `nodes_touched` is the core's `reached`. The `pair_*` tallies feed DESIGN
  §2.9's priors via 0005. Nothing the core computes about any other person is stored here: a
  column that keeps a reliability, a chain or a reach between calls is a cache DESIGN §4 refuses.
- **`private.params`**: the population priors, each field null until its own sample exists and
  merged field by field, so a missing row can only fail to move a number.
- **`private.snapshot_cache`** (0016): one row per viewer, the neighbourhood their last refresh
  loaded, gzipped, plus `members` (who it loaded) for the delta and the purges. The service role
  may SELECT it and nothing else; every write is `private.save_snapshot_cache`, every delete a
  purge or the cron. It holds up to `N_max` people's thumbs at rest, so it is the table the
  enumeration and `security definer` hazards below matter most for: `private.snapshot_delta`
  takes the viewer and returns only that viewer's cache and delta, and nothing that returns a blob
  or `members` may ever be callable by a client. `private.ratings_cleared` (a tombstone per
  cleared thumb, written by a trigger, none for a deleted account) and
  `private.ratings_changed.friends_changed_at` are what make a clear and a friendship visible to
  the delta.
- **`private.write_budget`**: every rating insert or update, item, report, link turned
  on, replaced or redeemed (`private.spend_write` for the redeem) and debug event
  spends one of `private.daily_write_limit()` (the ONLY place the number is written) per account per
  UTC day, via `private.count_write` keyed on `auth.uid()`. Deletes are free; connections with no
  `auth.uid()` are not counted. Past it, SQLSTATE `PT429`, which `isDailyLimit` in
  `web/src/lib/utils/supabase.ts` turns into a sentence with no number in it.

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
  friendly name. That applies equally to `public.invite_owner` and `public.redeem_invite`, and
  more so: `public` is served, so the exact key, the `revoke ...
  from public` and the caller check are the whole of the defence.

**Normalization is one `normalizeId` in `shared/src/index.ts`**, used by the client and the Edge
Function:

    lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim

NFKC comes after lowercasing, because lowercasing a normalized string can denormalize it and the
last step must be the one the column `CHECK` tests. `"Café  BLEU "` is `café bleu`; `日本` survives.
The `CHECK` refuses: empty after trimming; anything not NFKC-normal (`x is nfkc normalized`); a
word starting with `!`, `#` or `@`, which search reads as operators (migration 0008, DESIGN §1
"Search"); over 128 code points, which the folding refuses rather than
truncates, since a cut can land inside a grapheme cluster or denormalize; and, since 0008,
anything off the allow-list:

- **Characters**: UTS #39's `Identifier_Status=Allowed` (letters, marks and digits of the scripts
  in use today), plus space, `! " # $ % & ( ) * + , / ; ? @`, `¡ ¿ « » – — ‘ “ ” „`, CJK's
  `、 。` and brackets, the Arabic comma, semicolon and question mark, the dandas, and `€ £ ¥`.
  So no emoji, pictograph, other symbol, invisible or default-ignorable character.
- **Marks**: on a letter or digit, at most four on one, never the same one twice running.
- **ZWJ and ZWNJ** only in RFC 5892's contexts: after a virama, and ZWNJ also between two joining
  letters. That is where Indic scripts and Persian need them.
- **Scripts, per space-separated word**: one script, or Latin plus one other that is not Cyrillic
  or Greek, or Latin with Han and kana, Han and Bopomofo, or Han and Hangul (UTS #39's
  "moderately restrictive"). `café кафе` is fine; `cаfé` with a Cyrillic `а` is refused.

**The allow-list is generated, and the client and the database run the same patterns.**
`scripts/generate-name-rules.ts <NNNN_name>` reads Unicode 15.1's data (Postgres 17's version),
writes the tables to `shared/src/name-tables.ts`, and writes the migration replacing
`private.is_normalized_id`. `shared/src/name-rules.ts` builds the regular expressions from those
tables in two escapings, one per engine, which is why neither side uses `\p{…}`: JavaScript's
follows the engine's Unicode version, and Postgres has none. `shared/tests/name-rules.test.ts`
fails if the newest migration defining the function no longer holds the client's patterns. To
change the list, edit the generator and write the NEXT migration; like 0008, it must
refuse to apply over an existing row the new list would refuse, and name it. The two lowercasings
(`toLowerCase`, and `lower` under a non-`C` collation) can disagree on a handful of characters;
the database is the authority, because its `CHECK` decides whether the row exists.

**Inside the core, a ratable is `item` or `item\0tag`**, joined with a NUL. Postgres text cannot
contain a NUL, so no name anybody can type can forge the join. The join is never stored, queried
or shown.

**Search matches a stored stripped copy, and `searchFold` in `shared/` is the ONLY implementation
of the stripping.** Stripping only at query time would leave the prefix search literal, so a viewer
typing the unaccented name finds nothing and adds the thing twice. Look-alikes NFKC leaves (Latin
`a`, Cyrillic `а`) cannot share a word (above); a whole word in Cyrillic imitating a Latin one can
still be written, and is met with a confusable skeleton at lookup, which catches the accident of
two people and two keyboards and does not pretend to stop a determined one.

## Conventions worth not rediscovering

- **No server in the request path.** Every user action is a direct PostgREST write under row-level
  security. The one Edge Function exists because it reads other people's ratings (DESIGN §4), and
  answers only for the authenticated caller; treat a second as a claim to disprove. The
  moment `private.neighbourhood` is callable by `authenticated`, a client holds other people's
  ratings.
- **A fresh-identity cost is not a sybil defence.** Google-only changes nothing in DESIGN §2.1: no
  row of that table rests on the cost of an account. Do not write "Google sign-in stops bot farms"
  anywhere.
- **Local-stack mode is `VITE_LOCAL_SUPABASE=1` ANDed with `import.meta.env.DEV`.** Vite replaces
  the `DEV` half with a literal, which folds the branch away in a production bundle; the flag
  alone would leave a build one variable away from localhost. The condition is written out at each
  of its uses in `project.ts`, because a bundler folds `false && …` where it stands and need not
  look inside a function; `check:pwa` fails an export that carries the local address or key.
- **The project's address is configured in exactly one place, `web/src/lib/utils/project.ts`.** It
  is a plain module that touches nothing of the browser, because the root layout reads the origin
  while the pages are prerendered, for its `preconnect`, and `bun test` reads it too. Do not add an
  environment variable beside it.
- **`shared/` reaches `web/` by an alias**, not a `file:` dependency, which bun installs as a tree
  of symlinks. It is declared twice, and both are needed: `resolve.alias` in `web/vite.config.ts`
  for the bundler, and `paths` in `web/tsconfig.json` for the type checker and `bun test`.
  `server.fs.allow` there is the repo, so the dev server may read a file above `web/`. Nothing
  needs building.
- **The app's screens are not SvelteKit's routes.** SvelteKit routes `/` and the three written
  pages; the four screens live in the fragment and are `web/src/lib/utils/router.ts`'s. It keeps
  its entries in `history.state` beside SvelteKit's own keys, merged and never replaced, and calls
  the browser's `pushState` and `replaceState` through `utils/history.ts`. Do not turn on
  SvelteKit's hash router or make a screen a route.
- **State is runes in `.svelte.ts` modules, and logic is plain `.ts`.** `store.svelte.ts` is the
  one store, a module of `$state` that `startGrapevine()` (called by the root layout) keeps in
  step with the session; `ratings.ts`, `recs.ts` and `references.ts` hold their shared values in
  plain cells (`cell.ts`) so `bun test` can import them, and each has a `.svelte.ts` beside it
  with the reader a component uses. A reader's fields are read off it where they are used —
  `recs.failed`, never copied out — or they stop following changes. Anything that outlives a tap
  reads its props first and keeps what it read: a prop read after an `await` is the parent's value
  then, which may be another thing's or nothing.
- **Comments say why, and name the thing that was rejected or the failure prevented.** Not what
  the code does.
- kebab-case filenames; under `web/src/lib/`, `utils/` for logic and database access,
  `components/` for UI, `components/ui/` for primitives. Everything is prerendered, so nothing
  touches `window`, storage or Supabase while a component is being set up: that goes in `onMount`
  or an `$effect`.
- **Four routes and no more**: `#/` (the list), `#/item/<id>`, `#/people` and `#/reports` (an
  admin's review queue; anybody else who opens it is put on the list, as for a fragment that names
  no screen, once the profile says they are not an admin); the three written pages are static
  routes the router stays off. A pasted link to a thing gets the list seeded under it so Back goes
  somewhere, and one to `#/reports` the list and the people screen. `web/tests/router.test.ts` asserts
  that any other fragment names no screen. `#/invite/<token>` is not a route: the store takes the
  token out of the address before the router reads it (`utils/invites.ts`). A live one is asked
  on one full screen, `components/link-question.svelte`, in place of whatever screen is up and for
  every account alike; `components/invite-gate.svelte` says the rest (dead, or your own) in a
  dialog.

## UI design language

Tokens and components are in [`web/DESIGN-UI.md`](./web/DESIGN-UI.md); every new screen follows
it: one 4 px radius, hexagonal avatars, a bar with no word beside it, the swipe. A thing's bar
draws one cautious value, `c = s·W/(1 + W)` (`cautiousScore` in `utils/bar.ts`; DESIGN §1 "The
bar", §2.6): the mean of the Beta on "you'd like it" with `W` thumbs' worth of evidence at
`(1 + s)/2` plus the prior's one pseudo-thumb, mapped back to `(−1, 1)`. So a thing reaches an end
only with a strong prediction and a lot behind it, and one with little behind it sits near the
middle on either side. It is drawn as it is, with no step and no shading. An attribute's entry
carries no `W`, and its bar draws `s`. No score, or `W = 0`, draws the empty track ("nothing known
yet"). Storage keeps `s` and `W` apart; only the client combines them.

`web/src/app.css` carries the palette and the two faces' `@font-face` rules (the files are the
`@fontsource` packages'); `--shadow-*` does a second job as the 1 px rule around a panel. The
glyphs are `components/ui/icons.ts`, copied from Lucide and drawn by `icon.svelte`: Lucide redraws
its icons between releases, and a package would change them under the app.

The theme is `utils/theme.svelte.ts`: a choice of system, light or dark kept under
`grapevine-theme`, put on `<html>` as a class. The script in `src/app.html` does the same before
the first paint, and the two read the one key.

**Tailwind only emits a utility it has seen, and a missing one fails silently.** A recursive
`content` glob has failed to recurse before: it matched only the top level of `components/`, so
every primitive under `components/ui` rendered unstyled. The sources are listed one level at a
time as `@source` lines in `src/app.css`, `tailwind.config.js` keeps only `darkMode`, and
`web/tests/styles.test.ts` fails when a new directory of components has no line. Tailwind runs as
a Vite plugin (`@tailwindcss/vite`).

## What the list is drawn from

The list reads only the viewer's own feed and ratings, and searches in memory
(`utils/discover.ts`), with the catalog merged in by prefix so a thing that exists is found rather
than made twice. Empty, it is every entry of the feed plus everything the viewer has rated, since
the feed has no entry for what nobody else in reach rated. A thing's suggested rail is filled on
the client from the viewer's own ratings (`shared/src/suggest-attributes.ts`, DESIGN §2.11), and
is empty, never filler, for a viewer who has rated no attributes.

- **Nothing orders by when a thumb was given.** The recompute reads one bit of `rated_at` — before
  or after the viewer's own thumb — and `/privacy/` says ratings are stored with when; nothing on a
  screen shows or sorts by time.
- **The entry's id is what is drawn.** A ratings row can name an id nobody created, and showing it
  is harmless: it has been through the same folding and `CHECK`s.
- **An absent tag is "nothing is known", not "no"** (DESIGN §2.6): nobody in reach gave it and
  nothing predicted it.
- **Nothing on it is a number.** Empty, it ranks by the cautious value `c` its bar draws. Typing
  ranks by strength — the per-word geometric mean of what each piece of the query contributes, a
  thing's `c` for its name and an attribute's presence for an attribute, each mapped to `[0, 1]`,
  one minus either for a word typed with `!`, unknown as one half (DESIGN §1 "Search") — then by
  the viewer's own `conf`, then alphabetically, and never renders `conf`, `score` or any count. A
  rated row keeps its bar and tints its background; a chip carries the attribute itself and no
  state word. DESIGN §4 is why.

## The recompute behind it

`supabase/functions/refresh-recs/` is DESIGN §3.4 step for step.

- **The screen refreshes on open, and the function decides whether that means anything.** It
  returns the cached feed when it was *checked* under ten minutes ago and the viewer has not rated
  since, and when a recompute lands on the same answer, so `computed_at` moves only when there is
  something new; a friend's rating arrives on that window. The staleness check keys on `checked_at`,
  never `computed_at` — otherwise a thumb that did not change the feed forces a recompute on every
  open. Every stamp is the database's `now()` read *before* the neighbourhood, or a thumb given
  mid-recompute would be dated as already read.
- **The feed comes back inline, and the row is the fallback** for a cold start and an offline
  open, read through `my_feed()` (see "Reports"); one Realtime channel carries the case where something other than this tab rewrote it.
  Nothing but a viewer's own open writes that row. First paint is `localStorage`, in a try/catch,
  under a per-viewer key.
- **The neighbourhood is cached and patched** (DESIGN §3.4a). One call,
  `private.snapshot_delta(uid, CACHE_VERSION, N_max, depth)`, returns the viewer's stored blob and
  what changed since it: people the cut (`private.neighbourhood_cut`, the one implementation of
  who is loaded) added or dropped, and for kept people whose clock moved, thumbs written since,
  tombstones (`private.ratings_cleared`) and the friend list if `friends_changed_at` moved.
  `applyDelta` in `shared/src/snapshot-cache.ts` patches it; the core runs unchanged on the result.
  A full `private.neighbourhood(uid, N_max, depth)` runs when there is no usable cache and on every
  `RELOAD_EVERY = 100`th refresh (DESIGN §3.4a says why a count and not a clock), which compares
  it with the patch, writes a `snapshot-cache-mismatch` debug event (counts only) on a difference,
  and uses the full load.
  The cache is written with the feed in one transaction by `private.save_snapshot_cache`, stamped
  `since` = the `now()` read before any data. The rules that are easy to break:
  - **A patch is exact only if every change is stamped.** A write to `ratings` or `friendships`
    with the triggers off (a restore under `session_replication_role = replica`, a bulk rewrite)
    must be followed by `delete from private.snapshot_cache`; a change to the codec, the patch
    rules, `N_max` or the depth bumps `CACHE_VERSION`.
  - **The epoch.** Every purge (`private.drop_snapshot_caches`, on account deletion) bumps `private.snapshot_epoch` under an exclusive advisory lock; the save takes it shared and
    refuses when the epoch it was handed (read in `readStamps`, before any data) is stale. Without
    it a refresh that read before a deletion would write the deleted person back.
  - The delta reads from `since` less a minute, because `now()` is a transaction's start; a change
    read twice is applied as its current value.
  - The blob is `text`, seven bits a character (`bytesToText`), not `bytea`: postgres.js reads every
    result as text, so a bytea comes back as hex, twice its size, and the blob is most of a
    refresh's egress.
  - The boundary rounds are not cached: they depend on the core's answer and are read every time.
  - **A removed name drops no cache.** The delta's last row, `names`, lists every name removed
    since `since` less the minute, and `applyDelta` drops every key naming one.
- **Up to three boundary rounds follow** the neighbourhood, each `private.load_nodes(uid, ids)` on
  the (up to 200) boundary nodes with the greatest `strength` (the chain that would reach them),
  while `N_max` has room and some strength is above zero. `N_max` counts every node loaded, the
  rounds included.
- **Every recompute writes a feed.** There is no accuracy test and no keep-the-previous-feed
  branch: the core's only failure is a non-finite result, which it throws on and `allFinite`
  refuses again, and that is a 500 with the stored row untouched.
- **Nothing the core computes about anybody is kept between calls** (DESIGN §4): no stored
  chains or reliabilities. What is kept is the core's *input*, the cached neighbourhood — other
  people's thumbs and friend lists, which `ratings` and `friendships` already hold. Do not add a
  cache of anything the core computes about another person: DESIGN §3.4a measured that almost
  nothing in the model updates exactly from a delta.
- **The CPU ceiling is the thing to respect**: a free invocation is metered on the order of two
  seconds, and a recompute may call the core four times. If it binds, what gives first is the
  boundary rounds, then `N_max`, then the boundary itself (a core change).

The pure half — folding, change detection, sanitizing, which boundary nodes a round takes — is
`shared/src/entries.ts`; the cache's codec and patch are `shared/src/snapshot-cache.ts`, whose
tests check a patched neighbourhood equals a fresh load over generated event sequences.

## Reports

No client reads `reports` except through the admins' review queue (0014): a screen of its own,
`#/reports` (`components/reports-view.svelte`), opened by the *names people reported* row on the
people screen, which only an admin sees. It lists every reported name with its count, and a
name's row swipes left to remove it, asking first, and right to dismiss it. Three `security definer` functions in `public` are the whole of it, each
checking `private.is_admin()` first: `reported_names()` answers anybody else nothing, and
`remove_reported_name(text)` and `dismiss_reports(text)` refuse with `42501`.

A name that is abuse, a private person's name or spam is **removed**, not hidden.
`remove_reported_name` calls `private.remove_name` (0017), which only records the removal in
`private.removed_names` (`removed_at`), deletes the `items` row and the reports, and returns
nothing, in about a millisecond. The restrictive insert policies on `items`, `ratings` and
`reports` check that table, so the name cannot be created or reported again. Everything else is
lazy, and every reader of a name has to honour it:

- **The thumbs** stay until `private.purge_removed_names`, a cron job every minute, deletes them,
  5 000 a run (one scan of `ratings` each: there is no index on `item_id` or `tag`). Until then
  `private.unpurged_names()` lists the name, and `load_nodes`, `snapshot_delta` and a signed-in
  read of `ratings` (policy `ratings_not_removed_read`) leave those thumbs out. A name is marked
  `purged_at` once a run finds none left and it was removed over ten minutes ago, because an insert
  that passed the policy just before the removal can still commit.
- **The purge stamps nobody and leaves no tombstone**: the rating delete triggers skip a row naming
  a removed name, since no reader saw it. A purge that stamped every rater made the next patched
  refresh cost twice a full load.
- **A stored feed** keeps the name until its viewer's next recompute. The app reads it through
  `public.my_feed()`, which strips names removed after `computed_at` less a minute, and caches
  only what that returns; a direct read of `user_recs` still shows the viewer's own feed as
  computed.
- **Caches** drop it through the delta's `names` row (above).
- Anything new that reads `ratings` or a name from a feed must leave removed names out the same way.

Irreversible: the thumbs go. **Dismissing** deletes the name's reports and keeps the name; anyone
may report it again. Both still work from this checkout with no admin account:

```sh
supabase db query --linked "select private.remove_name('the exact id')"
```

The id must be exact (`normalizeId` of what is shown). Unblocking is `delete from
private.removed_names where id = '…'`, which brings nothing back; do it only once `purged_at` is
set, or thumbs the purge has not reached reappear to every reader while the caches that dropped
them never learn it (then also `delete from private.snapshot_cache`).

A wrong link on a name worth keeping is taken off without touching the name or its thumbs, and
can never be added again (`private.removed_refs`); nothing in the app does it:

```sh
supabase db query --linked "select private.remove_reference('the exact id')"
```

## Admins

Supabase has no application-level admin role for end users, so an admin is a row in
`private.admins`, which no client can read or write; `private.is_admin()` checks the caller's
own `auth.uid()`, and `account_is_admin()` tells the client whether to show the queue. An admin is
never locked (0010), with or without a connection. Granting is one line, run by the owner against
the project, with the account's Google address:

```sh
supabase db query --linked "insert into private.admins (user_id) select id from auth.users where email = 'someone@example.com'"
```

Revoking is `delete from private.admins where user_id = …`; an admin left with no connection is
then locked and loses their link. No user id goes in the repository.

## Priors and the schedule

**`κ` and `a₀(d)` are running tallies**: each recompute reports partial sums into `user_model`'s
`pair_*` columns and 0005 pools them into `private.params` under DESIGN §3.7's `N_min = 200`.
`rust/src/priors.rs::estimate_priors` is the batch version the simulator uses, and
`rust/tests/priors.rs` checks the tallies agree with it. A pair's tally is `(1 + λ̂)/2`, the
channel inverted at its things' chance of a match, not the share of matching thumbs, and its
"overlap" is a weight that makes 0005's frozen sampling term right for that rate (DESIGN §2.9);
0005's own comment still says `A/(A+D)`. The core reads `kappa` and `a0_d1`;
`a0_d2` and `a0_d3plus` are still pooled and read by nothing, because a chain replaces a prior by
distance. Dropping them is a migration that also rewrites 0005's `params-priors` job.

**Six statements run on a schedule, all inside the database (0005, 0012's fingerprint sweep and
0016's two), and nothing else anywhere does**: the priors pooling, the diagnostics TTL sweep, the
write-budget sweep, the deleted-identity sweep, and the sweeps of neighbourhood caches unused for
seven days and of tombstones older than eight. The two 0005 sweeps are
not optional: they are what stops a free project pausing after seven days without database
activity. There is deliberately no scheduled GitHub workflow — GitHub disables one after 60 days of
repository inactivity and nothing goes red.

## The written pages

Three prerendered routes — `/about/`, `/privacy/`, `/help/` (`web/src/routes/`) — each importing
no store and needing no session, so the full text sits in the exported HTML.
`components/doc-page.svelte` is the shell. `check:pwa` greps one sentence out of each exported page,
and its list is three on purpose: a page list that shrinks silently is how a page goes missing.
The pages have no diagrams and no formulas, and say each thing once, in as few words as they can.

`/about/` is also the explainer, and **nothing on it may claim more than DESIGN §2 does**.
It explains the swipe directions, and so does the list's one-time hint (DESIGN §1 item 7), which
waits for a list with rows in it; that sentence is also the `check:pwa` needle, so it stays on
`/about/`.

`/privacy/` says the uncomfortable parts out loud because DESIGN §4 does: **with exactly one
person in your vine, your list is their ratings** (word for word — it is the `check:pwa` needle);
that friction, not secrecy, stands between a list and knowing who; that a thing's name is public
text that can never change; that Google is the sign-in provider (so no password is stored, but the email address
Google sends is, in `auth.users`) and the site loads no trackers. It states what is done rather
than promising it: no counts and no attribution on any screen, and that the server keeps a copy
of your ratings to refresh other people's lists, deleted after a week unused
(`private.snapshot_cache`). It must **not** say a thumb is stored without a clock or that rating
order cannot be reconstructed: `ratings.rated_at` exists.

## Icons

`web/scripts/make-icons.mjs` reads `docs/mark.svg` and writes `icon.svg` and the four PNGs into
`web/static/`. It needs `rsvg-convert` (`brew install librsvg`); the outputs are committed. Run it
when the accent or the mark changes.

The mark is **hex grapes**: six hexagons in a 3-2-1 bunch, no stem, each an outlined hexagon with a
**same-size** hexagon clipped inside it and pushed toward one vertex, so a rim of even width
survives on exactly two sides. A *smaller* inner hexagon leaves a rim on three sides and reads as a
ring. Hexagons have real rounded corners rather than a rounded pen stroke. **Nothing in the mark may be `<text>`**: every renderer that
draws it (a favicon tab, an OS launcher, a PNG converter) has no webfont and substitutes whatever
grotesque it has.

## Supabase setup (do once)

**Status**: the project exists and this checkout is linked to it (the ref is in `supabase/.temp/`,
not committed); `web/src/lib/utils/project.ts` carries its URL and anon key. Steps 1–6 are done: the Google
OAuth client and a `config push`, `pg_cron`, migrations `0001`–`0007`, and `refresh-recs`.
`refresh-suggestions` has been deleted from the project by hand. **Step 7
is not**, and waits on the repository. Until the first `web.yml` run pushes `config.toml` again, the
project differs from the file in three ways: the redirect list is `http://localhost:*/**`, the phone
provider is on, and `site_url` is not `grapevine.hafa.cc`. `supabase config diff` shows all three.
The consent screen's privacy-policy URL (step 2) also predates `grapevine.hafa.cc`, and is changed
by hand in the Google Cloud console. Nothing below is needed to run against the local stack.

1. **Create a project**, free tier. Its URL and **anon** key go in `web/src/lib/utils/project.ts` as
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
6. **Realtime** carries `user_recs` and `friendships`, added to the publication by `0006`, which
   also restricts it to `insert, update` (a DELETE event cannot be bounded by RLS; 0006 says why). RLS applies to Realtime, so nobody receives another viewer's row.
7. **Repository secrets and one variable** — the whole of what the deploy is given:
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (secrets) — `link`, `db push`, `config push`,
     `functions deploy`.
   - `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET` (secrets) — `config push`.
   - `SUPABASE_PROJECT_REF` (a **variable**) — out of the file so a second project needs no diff.

   `SUPABASE_ACCESS_TOKEN` is a scoped token (Project scope, this project only, 90 days at most),
   and each of these is needed by some step of the deploy — `link` reads the secret API keys,
   `config diff` reads `/v2/projects/{ref}/config`, `config push` reads the add-ons first:
   Project Settings, Auth Config, Data API Config, Database Config, Migrations, Connection
   Pooling, Edge Functions, Realtime Config and Storage Config read-write; API Keys, API Key
   Secrets, Database, Network Restrictions, SSL Enforcement and Add-ons read. A token that has
   expired or lacks one fails at the step that needs it, and the fix is a new token (they cannot
   be edited) and `gh secret set SUPABASE_ACCESS_TOKEN -R hafacc/grapevine`.

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
  `/privacy/`'s "leaving" section that a deleted account's rows survive in them for up to 30 days —
  and that includes their thumbs inside other viewers' neighbourhood caches
  (`private.snapshot_cache`), which a backup holds as they were that night.
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
that is not live; if that job fails, Pages never runs. Migrations and `refresh-recs` deploy every
time. **And `bun export` runs in the gate too**: otherwise a build failure would land after `db
push` had applied forward-only migrations, leaving the database ahead of a site stuck on the last
good version, with nothing on the free tier to roll back with. The deploy job builds the `web` wasm
itself rather than downloading anything. `supabase functions deploy` uploads only the modules an
entry point imports; the `.wasm` ships because `config.toml`'s `static_files` names it for the
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
existing file under `supabase/migrations/`. `0001`–`0007` are recorded; `0008`–`0018` are not, and
the next deploy applies all eleven. Three of them destroy data on the project, irreversibly:
`0009_invite_links.sql` drops `username` and `searchable` (every claimed handle; none had been
claimed when it was written), `0011_remove_taste_search.sql` drops taste search's tables, and
`0015_witness.sql` drops `user_recs.error` and `user_model`'s `settle_movement`, `passes`,
`settled`, `truncation`, `boundary_residual`, `reach`, `reach_hash` and `reach_reuses`, which the
witness model does not produce. `0016_snapshot_cache.sql` adds the neighbourhood cache and its two
sweeps, and `0017_faster_queries_and_lazy_removal.sql` the purge of removed names' thumbs.
`0010_invite_only.sql` locks every account with no connection and deletes its link, so the
owner's own account needs a connection or the admin row ("Admins") before it can make a link again.

### The domain (do once, by hand)

**The site is `https://grapevine.hafa.cc/`, served from the root of its own origin**, not
`hafa.cc/grapevine/`. So the export has no base path: `vite.config.ts` sets none, `start_url`, the
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
3. **Settings → Pages → Source: GitHub Actions.** The deploy cannot do this itself: the job's
   token is refused creating a Pages site ("Resource not accessible by integration"), so a run
   before it fails in `build`, after the `supabase` job has already deployed.
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
deno check supabase/functions/refresh-recs/index.ts
deno lint  supabase/functions/refresh-recs/index.ts
supabase start && supabase db lint && supabase test db   # (docker); else run-local.sh, weaker
(cd shared && bun install --frozen-lockfile && bun run lint && bun test)
(cd web && bun install --frozen-lockfile && bun run lint && bun run test)
(cd web && bun run export && bun run check:pwa)          # (chrome)
(cd web && bun run check:signin && bun run check:feed)   # (docker + chrome), dev:local up
```

**The checks nobody runs.** Of the six check scripts in `web/scripts/`, only `check:pwa` needs
no stack, so it is the only one run here, and CI runs none. So `check:recs-parity`,
`check:recs-function` and `check:feed` run on no machine that exists. A
job in `ci.yml` that runs them is writable (the `database` job already runs Docker), but nobody here can
run it once before committing it; closing the gap is that job, watched through its first green run
by whoever has Docker.

By hand, against the deployed site:

- **Sign in.** Google's consent screen cannot be automated, so redirect-URL mismatches, a stale
  OAuth client and the PKCE/fragment collision otherwise fail in production, on a real person.
- `web/src/lib/utils/project.ts` carries a real project URL and anon key.
- `supabase/config.toml` — anonymous off, email signup off, no second factor, Google the only
  external provider, no SMTP section — and the deployed project agrees.
- **From a Google session, `supabase.auth.updateUser({ email: "someone-else@example.com" })` must
  not change `auth.users.email`** (`double_confirm_changes` and `enable_confirmations`, delivered
  only by `config push`).
- `refresh-recs` answers 401 to a POST with no `Authorization` header and to one carrying only
  the anon key: `verify_jwt = false`, so nothing in front of the function refuses it.
- The repo is public and Pages is on with GitHub Actions as its source.
- The Google consent screen's privacy-policy URL resolves to `/privacy/`.
- `http://grapevine.hafa.cc/` redirects to `https://`, and Pages shows the custom domain with
  Enforce HTTPS ticked.
