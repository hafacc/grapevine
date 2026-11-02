# grapevine — contributor notes

[DESIGN.md](./DESIGN.md) is the source of truth for *what* is built and *why*. This file is what a
person or an agent needs to run and check things, and the rules that are easy to break.

Read DESIGN §1 before changing any screen.

## Layout

    web/         SvelteKit app (Svelte 5), static export. Bun. The only thing a user
                 touches. `src/routes/` is the app at `/` and the three written pages,
                 `src/lib/components/` the UI (`ui/` the primitives), `src/lib/utils/`
                 logic and database access, `static/` the icons, `sw/` the service
                 worker, `tests/` the unit suites, `e2e/` the Playwright tests and
                 their helpers, `core-wasm/` the built core (not committed).
    shared/      Pure TypeScript, zero runtime dependencies, imported where it lives by
                 web/. No generated copy of it exists anywhere. Bun. `src/import/` reads
                 other services' export files and matches what is in them.
    scripts/     build-wasm.sh — wasm-pack, one target argument: `web` for the browser,
                 `nodejs` for `rust/examples/smoke.mjs`, the only thing that runs the
                 wasm boundary outside a browser. generate-name-rules.ts — the
                 allow-list for names, from pinned Unicode data, written into
                 `shared/src/name-tables.ts` and a new migration (see "Normalization").
                 load-prefilled.ts — the SQL that loads a prefilled account (see
                 "Prefilled accounts").
    prefilled/   The prefilled accounts, written by hand: `accounts.csv` and one
                 `<handle>.csv` of thumbs each.
    rust/        The one Rust crate (`grapevine-core`): DESIGN §2's model (`src/tensor.rs`),
                 the simulator and their tests. No I/O. Built to WebAssembly by wasm-pack; neither
                 build output is committed.
    supabase/    config.toml (auth providers, redirect URLs — in the repo, not a console),
                 migrations/ (schema, grants, policies, functions, cron),
                 tests/ (pgTAP, and the scripts that run a database without Docker),
                 seed.sql (deliberately empty)
    docs/        mark.svg (the mark), which only make-icons.mjs reads.

`supabase/` lives at the repo root because the web app and every check point at the one local
stack, and `supabase db push` reads that directory. There is no `supabase/functions/`: nothing
of ours runs on a server.

## Commands

Run each from the directory named. **Everything marked (docker) needs Docker, which is not
installed on Erik's machine and is not going to be.** The Supabase CLI is installed (CI pins
2.117.0), and what it does against the linked project works here: `db query --linked`,
`config diff`, `migration list --linked`. Anything against `supabase start`'s stack, and
`db dump`, wants Docker.

```sh
supabase start                   # (docker) Postgres, GoTrue, PostgREST, Realtime and Studio.
supabase db reset                # (docker) every migration, then seed.sql, from zero
supabase db lint                 # (docker) plpgsql_check over the applied migrations
supabase test db                 # (docker) the pgTAP suites. THE runner: CI uses it.

# The pgTAP suites without Docker: a throwaway PostgreSQL cluster from initdb, every migration,
# the same files, about a second. Needs `initdb`, `pg_ctl` and `psql` on PATH. It stands in for a
# cut-down `auth` schema and for Vault. pgTAP is the real one: the installed extension, or else
# pgTAP's source, pinned and fetched once into ~/.cache/grapevine/ (so the first run needs the
# network), and only offline with nothing cached a stand-in copying pgTAP's signatures. So a
# suite that passes here and fails under `supabase test db` leaned on a stand-in or a version
# difference. Use it to develop a suite; believe CI. `throws_ok`'s third argument is the expected
# error MESSAGE, not a description: `throws_ok(sql, '42501', null, 'description')`.
bash supabase/tests/run-local.sh          # all of them: 25 suites, 792 assertions
bash supabase/tests/run-local.sh 05_items # one, by prefix

# The lock across two connections, which one pgTAP session cannot interleave. By hand, after
# touching `revoke_link_if_locked`, `set_invite_link`, `redeem_invite` or `is_unlocked`. Its own
# throwaway cluster, nine checks; not run by run-local.sh and not in CI. Also after touching
# `next_revision` or `account_thumbs_since`: it holds the overlap that makes a difference exact.
bash supabase/tests/races.sh

# A local stack without Docker, for the app and the browser tests: the same cluster
# run-local.sh builds (`local-cluster.sh` is the one copy of it), kept running, with PostgREST
# (on :54399) and in front of it `web/scripts/local-gateway.mjs` on :54321, standing where the
# real gateway does. Postgres on :54322. Needs `initdb`, `pg_ctl`, `psql`, `postgrest` (brew install postgrest)
# and `node`. No GoTrue (a test mints its own session), no Realtime (the app says, after a
# while, that it has stopped receiving updates: that is this stack), no pg_cron. The database
# lives only while it runs.
bash supabase/tests/serve-local.sh        # up, until Ctrl-C; `cd web && bun stack:local`
                                          # is the same
bash supabase/tests/serve-local.sh stop   # from another shell

bash scripts/build-wasm.sh web   # the core the browser loads, into web/core-wasm/. `dev`,
                                 # `dev:local`, `export` and `e2e` need it; `lint` and
                                 # `test` do not (`web/src/core-wasm.d.ts` types the import).
                                 # Again after any change under rust/.
bash scripts/build-wasm.sh nodejs
node rust/examples/smoke.mjs     # three accounts through the wasm boundary

cd web && bun install            # once, and again when web/package.json changes
cd web && bun dev            # dev server on :3000, against the real project
cd web && bun dev:local      # dev server on :3001, against the local stack, either kind
cd web && bun lint           # THE gate: svelte-kit sync + svelte-check +
                                 # service-worker tsc + biome
cd web && bun fmt            # biome format --write
cd web && bun run test           # unit suites
cd web && bun export         # vite build -> web/out/

# The browser tests: Playwright (`web/e2e/`, `web/playwright.config.ts`) driving the installed
# Chrome (`channel: "chrome"`, so nothing is downloaded). None is in CI. `bun e2e` is all of
# them; `bun e2e:pwa` and `bun e2e:stack` are the two projects; `--headed`, `--debug` and
# the other Playwright flags pass through.
cd web && bun e2e:pwa        # installability, offline, and each written page's own text.
                                 # Needs NO stack: it builds the export, serves it itself,
                                 # stops serving it to test offline, and signs nothing in.

# The `stack` project wants a local stack up — `supabase start` (docker) or serve-local.sh. It
# brings no backend up: it seeds into the running stack and says so if it is not there. It
# starts its own `dev:local` on :3002 (GRAPEVINE_E2E_PORT), or drives GRAPEVINE_ORIGIN when that
# is set, e.g. to a `dev:local` already up on :3001.
cd web && bun e2e:stack      # the four below
cd web && bun e2e:signin     # a minted session renders the app, none renders the welcome
                                 # screen, a tap on your name renames you, a link made by one
                                 # account names its owner signed out and is answered by
                                 # another, the first run's offer of the critics, following
                                 # back, a prefilled account found and followed from the
                                 # people screen's search, and its critics. NOT the
                                 # OAuth round trip (see "One door").
cd web && bun e2e:feed       # the one list: what the browser computed as the ranking,
                                 # filtering by name and attribute, an attribute alone, the
                                 # add button, what a first rating writes, and every bar's
                                 # fill the value it draws. Not the numbers: those are the
                                 # crate's.
cd web && bun e2e:search-id  # every `items` row has `search_id === searchFold(id)`,
                                 # importing the one implementation of the folding
cd web && bun e2e:map        # the map on the people screen: the row opens the sheet, it
                                 # draws a dot per thing from the computed plot, a chip
                                 # recolors the dots without moving them, a tap names one
cd web && bun seed:local     # a simulated world into the running local stack
cd web && bun open:local     # (chrome) a window on :3001 signed in as a seeded person,
                                 # for looking at the app by hand; `bun open:local u3` for
                                 # another. The session is minted and lasts an hour.

cd shared && bun install
cd shared && bun test            # normalizeId, searchFold, confusable skeletons; entries.ts
                                 # (sanitizing, folding scores into a list); search.ts;
                                 # suggest-attributes.ts; name-rules.ts; references.ts;
                                 # import/ (the export formats, the cuts, the matchers)
cd shared && bun lint        # tsc + biome

cd rust && cargo test --release                    # the unit tests in each module
cd rust && cargo test --release --features serde   # and the boundary's own deserializer
cd rust && cargo clippy --all-targets -- -D warnings
cd rust && cargo fmt --check

cd rust && cargo run --release --example cost      # one call of compute_user_tensor, timed, on
                                                   # a made-up viewer; --follows, --items,
                                                   # --own, --each, --tags, --runs
# The world `seed:local` loads.
cd rust && cargo run --release --features serde --example dump-world -- --out /tmp/world.json
```

`rust/` tracks stable Rust through `rust/rust-toolchain.toml`. `cargo test` builds the core with no
dependencies: `serde` sits behind a feature (`dump-world` needs `--features serde`) and the wasm
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
`e2e` scripts are Playwright's runner, which runs under `node`; `bun test` reads only `tests/`
(`bunfig.toml`), so it never picks up a `*.spec.ts`.

## The model in the crate

DESIGN §2 is the specification, including the order the core computes in. It is all in
`rust/src/tensor.rs`. What a
contributor needs to not undo:

- **One call, one viewer, only what they follow.** `compute_user_tensor` reads the viewer's thumbs
  and the thumbs of the accounts the viewer follows. Nobody else in a snapshot changes anything:
  not their thumbs, not whom they follow, not their following the viewer
  (`an_account_the_viewer_does_not_follow_is_not_heard`). Anything that reads past
  `follows(viewer)` is a change of design.
- **Nothing is kept between calls**, and nothing is pooled across viewers.
- **What the followed accounts say is `(ups − downs) / (n + 2)`**: the mean of their thumbs under
  a uniform prior on the share that are up. Each account counts once; the viewer's own thumbs are
  not in it. The `+ 2` is the only caution anywhere, which is why the client draws the score as
  it is. A viewer who has rated nothing gets exactly this.
- **What is fitted is each thumb less that mean**, the viewer's thumbs included, and `0` wherever
  nothing was said.
- **The zeros count at full weight.** That is what holds the fit in (the ridge is too small to),
  and what makes every row of a mode share one `RANK × RANK` system, so a sweep is one pass over
  the statements. Weighting the empty cells less, or fitting only the statements, changes the
  model and puts a system per row back.
- **Liking is attribute zero.** A thumb on the thing itself is one more attribute beside the
  tags, and the shared row of a thing is the only tie between its rating and its attributes'.
- **`RIDGE` is for solvability.** Do not tune it as a prior.
- **One fixed seed, and sorted maps.** Alternating least squares can end in different places from
  different starts, so `SEED` is part of the model: one snapshot gives bit-identical results.
  Nothing may draw from a clock or an unseeded generator, or iterate a hash map.
- **Scores are strictly inside `(−1, 1)`**, clamped at `EDGE`.
- **No entry is inferred.** There is an entry for every thing a followed account said anything
  about and for every attribute a followed account put on a thing, and for nothing else. A
  thing only its attributes were spoken of has an entry at a count of zero. `Score` has no
  field that says an entry was guessed, and neither has the client.
- **`Score.confidence` is a count** of the followed accounts that made the statement, not a
  certainty. `Score.applies` is `1` for a thing and `(1 + score)/2` for an attribute on a thing.
- **A rating of a tag says the tag applies, whichever way its thumb points; the thumb says how
  good an example the thing is.** That holds for a person's own thumbs on every screen. The core
  returns one number for everybody else's (DESIGN §2.4), so a bad example sits below an attribute
  nobody mentioned.
- **No floor.** Nothing is hidden for having little behind it.
- Nothing is `#[ignore]`d. Every entry point returns a `Result`; a system that cannot be
  factored, or an error or a score that is not finite, is `CoreError::Divergent`, never a result.
  Rating values and keys are sanitized rather than refused, so one crafted row cannot fail the
  list of everyone who follows its author. `is_normalized_id` does not claim canonicity:
  NFKC-normality is a database `CHECK` and the crate has no Unicode tables.
- **The wasm call answers `{ viewer, scores, plot }`** (`ResultData` in `rust/src/data.rs`).
  `plot` is `things` and `attributes`, a point for each by name of as many numbers as the rank,
  the empty attribute name being liking. `computeUserTensor(snapshot, viewer, rank)` takes the
  rank, 1 to 6, each compiled; the app passes the rank the device keeps
  (`web/src/lib/utils/taste-rank.ts`: 3 until changed on the map, and a change computes the
  list again). A second call, `layOut(points)`, places a plot's things in the plane for the
  map on the people screen (`rust/src/layout.rs`: t-SNE from rank 3 up), asked for only when
  the map opens. `web/src/core-wasm.d.ts` types both and `rust/src/wasm.rs` is the contract.
- **The model does not defend against a followed account** (DESIGN §2.1), and that is the design,
  not an omission to patch quietly: no cap per account or per thumb, no order of thumbs, no copy
  detection.
- **The simulator's worlds are not for comparing models.** `sim.rs` is there for `dump-world`
  (what `seed:local` loads), for `cost`, and for the test that a simulated world's scores are
  finite and inside the ends.

## The local stack

Two ways to one, at the same addresses, so `dev:local` and the tests do not know which is up:
Postgres on 54322, the API on 54321.

- **`supabase start`** (docker) is the real one: GoTrue, Realtime, Studio on 54323, Inbucket on
  54324 (unused, since nothing sends mail). `supabase db reset` is the reproducible database and
  is also destructive.
- **`bash supabase/tests/serve-local.sh`** (or `cd web && bun stack:local`) needs no Docker
  and is what runs on Erik's machine: the cluster `local-cluster.sh` builds, which `run-local.sh`
  and `races.sh` build too, with PostgREST on 54399 behind `web/scripts/local-gateway.mjs`. It
  is whatever PostgreSQL is installed, with stand-ins for `auth` and Vault, no Realtime and no
  scheduled statements, so it is weaker in the same direction `run-local.sh` is: something that
  passes on it and fails on the real stack leaned on a stand-in.

**Signing in locally does not work through the UI, and that is expected.** Google's consent screen
cannot be driven headlessly and neither local stack has a Google. A local session is minted against
the stack's fixed JWT secret and written into `localStorage` under supabase-js's storage key
(`web/e2e/local-session.ts`), which is what the browser tests do. Pointing a local stack at a
real Google OAuth client would put a production credential in a development config, and is refused.

## One door: Google

Supabase Auth with **Google as the only provider**: no email link, no password, no anonymous
session, no phone, no mail sender, and nothing configured outside `supabase/config.toml` (which
reaches the project only through `supabase config push`).

- **A profile arrives named**: a trigger on `auth.users` creates it from Google's metadata, and
  calls a Google account that carries no name `unknown`. Nothing asks for a name.
- **PKCE, not implicit.** The implicit flow returns `#access_token=…`, and the fragment belongs to
  the router: the collision looks like a blank screen on first sign-in, i.e. a routing bug. PKCE
  returns `?code=…`, which `detectSessionInUrl` consumes and strips. The client must use
  `flowType: "pkce"`.
- **The trip to Google loses the URL** (`utils/sign-in-return.ts`). The screen a signed-out visitor
  opened (somebody's `#/item/...`) is kept in `sessionStorage` before the redirect and restored on
  return, because `redirectTo` cannot carry a fragment ahead of the `?code=` GoTrue appends. A
  refused or canceled sign-in comes back as `?error=…&error_description=…`, which supabase-js only
  logs; it is read and stripped before the client is constructed and shown on the welcome screen
  through `authErrorMessage`. A link's token (`#/invite/<token>`, `utils/invites.ts`)
  is in the fragment because a fragment reaches no server (not the host's logs, not a `Referer`)
  and the OAuth return writes only the query; it is taken out of the address on arrival and kept
  in `sessionStorage` the same way, so it survives the trip and never sits in history.
- **Email confirmations stay ON although there is no email door.** A Google session can call
  `updateUser({ email })`; with confirmations off that rewrites `auth.users.email` to an address
  the caller does not own, and the real owner's next Google sign-in links into that account.
  Sign-out is `scope: "local"`: the default revokes every session the account holds.
- **`has_credential()` is vacuous today and stays.** It gates making a link and every way of
  following, and guards against a dashboard toggle turning on anonymous sessions or a second
  provider, which ships no diff. Its body is general so a second door is correct the day it is
  enabled.
- **No anonymous accounts, although a link would be the natural place for one** (DESIGN §3.6):
  the per-account write budget multiplies by accounts that cost a click (and Supabase's remedy, a
  CAPTCHA, is a third-party script `/privacy/` says the site does not load); `linkIdentity` fails
  for a Google account that already has a grapevine account, stranding the anonymous one with the
  new follow; an unconverted account is a follower nobody can sign back into; and
  `has_credential()` would stop being vacuous.
- **Invite-only, enforced after the fact** (DESIGN §3.6). Any Google sign-in creates an
  account, because the OAuth round trip carries nothing of ours to GoTrue and a "before user
  created" hook would have no token to check. So an account that **follows no other person is
  locked**, whether it never joined, unfollowed its last person, or was removed by them:
  `private.is_unlocked()` reads `follows` (nothing stores the lock). **A prefilled account does
  not count, and neither does being followed.** `private.count_write` (the trigger every counted
  write goes through) refuses a locked caller with `42501`, `private.refuse_if_locked` does the
  same for a name update and clearing a thumb, and `follow_back`, `follow_prefilled` and
  `import_thumbs` check it themselves. `redeem_invite` does not: redeeming a live link writes the
  follow, which is the unlock. Losing the last follow of a person deletes the account's own link
  (a trigger on `follows`), so a link's owner is never locked. That trigger and
  `set_invite_link` each take `for no key update` on the account's profile first: without it,
  under READ COMMITTED, each can run beside the other's uncommitted half and a locked account
  keeps a link (`supabase/tests/races.sh`). `redeem_invite` treats a link whose owner is locked
  as dead regardless. Nothing deletes a locked account.
  The client asks `account_locked()` with the profile and shows `components/locked-screen.svelte`
  (*your account is locked*) instead of the list, unless the device holds a live link. Removing
  the last person from the vine warns first (`components/account-actions.ts`). An admin (see
  "Admins") is never locked, which is how the first account makes the first link. **Anything new
  a client can write must go through `count_write` or check `private.is_unlocked()`**, or a
  locked account can write it.
- **A fresh-identity cost is not a defense of anybody's list.** A list hears only the accounts
  its viewer follows. Do not write "Google sign-in stops bot farms" anywhere.
- **The cost**: someone without a Google account, or unwilling to give Google a record of which
  apps they use, cannot sign in or be invited, and there is no door when Google's OAuth is down.
  An email door would need mail sent from an owned domain with mail authentication;
  `grapevine.hafa.cc` sends none.

## Postgres schema

The tables and columns are DESIGN §3.2, the policies §3.3, all in `0001_fresh_schema.sql`. Access
is three mechanisms: a **column privilege** (the client cannot write this field, so it takes its
default), a **table privilege** (nobody has this verb at all), and a **policy** (which rows this
caller may see). Reach for them in that order — a privilege cannot be got wrong by a later policy,
and a table in schema `private` cannot be reached at all, because PostgREST does not serve it.

**The database stores thumbs and decides who may read whose. It computes nothing about anybody
and stores nothing computed.** A table that keeps a list, a reliability, a score or a copy of
somebody's thumbs is a change of design (DESIGN §3.1), not a cache to add.

The rules below are the ones that are easy to break:

- **`profiles`**: a person, or a prefilled account. Readable by self, by anyone it follows, by
  anyone following it, and — `prefilled` — by everyone signed in; a link's holder sees a name and
  photo through `invite_owner`, not this table. `prefilled` is the ONE clause that names no live
  relationship, on purpose. **A person has no handle and there is no lookup of a person by
  anything**: nothing on this table may become a read clause that matches a stranger. `id` is not
  a foreign key to `auth.users` (a prefilled account has no sign-in): one trigger on `auth.users`
  creates a person's row and another removes it. No email or phone column. `display_name`
  defaults to Google's first name and is the owner's to change. `CHECK`s refuse a blank one,
  control characters, bidi marks, line and paragraph separators and the characters that draw as
  nothing (U+00AD, U+061C, U+200B, U+2060, U+FEFF); `web/src/lib/utils/display-name.ts` carries
  the same list, and `handle_new_user` strips them and falls back to `unknown` so no Google name
  can stop an account being made. `photo_url` is null or `https://`: a link's holder is shown it
  signed out. `tags` is a prefilled account's attributes, those on the most of its things
  first, null for every person (a `CHECK`), in no client's update grant, written only by
  `private.load_prefilled` from the thumbs it loads and by `private.remove_name`, which takes a
  removed name out of it at once (no follow stands between it and a reader). The table has no
  INSERT or DELETE for a client, and the update policy refuses a prefilled row.
- **`follows`**: `(follower_id, followed_id)`, one way. **No client inserts one.** Three
  `security definer` functions do, each saying why the caller may follow that account:
  `redeem_invite(text)` (they hold its link), `follow_back(uuid)` (it already follows them) and
  `follow_prefilled(uuid)` (it is prefilled). The last two give one refusal for every other uuid,
  so the answer says nothing about whether an account exists. Either end deletes the row:
  unfollowing, and removing a follower. Rows are readable only by the two accounts named.
  **A follow is a read of every thumb the followed account has given** (below), so a fourth way
  to follow, or a looser check in one of the three, discloses ratings.
- **`invite_links`**: a person's link, at most one (`owner_id` is the key), with no expiry and no
  limit on uses. The token is stored as itself so the owner can copy it again:
  `token` and `created_at` are selectable, `owner_id` is not, and the select policy admits the
  owner's own row only, so filtering on somebody else's token finds nothing. No insert or update
  grant; DELETE is turning it off. `set_invite_link()` mints the token (32 bytes from two
  `gen_random_uuid()`s, base64url) over the owner's row, so the old one stops working at once,
  and spends a write. `invite_owner(text)` answers one exact token with a name and a photo and
  no id, and is **the one thing `anon` may call**: the link is the authority to see them, and
  the welcome screen shows them. `redeem_invite(text)` spends a write even on a miss, then writes
  ONE follow, the caller following the owner; the owner follows nobody by it. A dead link — off,
  replaced, mangled — names nobody and says *invalid or expired*, on the welcome screen before
  any trip to Google; a malformed token never reaches the server (`isInviteToken`). Replacing or
  turning off a link keeps the follows it made. **Removing a follower replaces the link**:
  `private.follow_lost` mints a new token (`private.new_invite_token()`) when the followed side
  deletes the row, so the link that person was handed is dead; it spends no write, and the
  store re-reads the link afterwards (`removeFollower` in `store.svelte.ts`). An unfollow, the
  owner's own connection and an account's deletion do not. The removed person can still follow
  back while the remover follows them.
- **`ratings`**: key `(user_id, item_id, tag)`; `tag = ''` is the thing itself. A row with a tag says the tag applies, and its `value` how good an example the thing is; "does not apply" has no row. Written by its
  owner alone. **Readable by its owner and by every account that follows the owner**
  (`ratings_select`, through `private.following()`), less thumbs on a removed name awaiting the
  purge (see "Reports"). That read is the product: the browser computes the list from it.
  `rated_at` is in NO select grant and nothing reads it, in the database or out: a follower
  reading when somebody rated each thing would be a record of that person's days. It is set on
  insert and kept because history cannot be backfilled.
- **`private.ratings_revision (user_id, revision, salt, floor)`** is the only clock a follower
  is given. A BEFORE trigger on `ratings` gives every written thumb the account's next revision
  (`ratings.revision`, no client grant), whatever role wrote it; an update to the same value
  takes none. A delete takes one and leaves a tombstone in `private.ratings_cleared`, which a
  re-insert of that thumb deletes; a thumb on a removed name leaves none. The rules that are
  easy to break:
  - **`private.next_revision` must stay an `insert … on conflict do update` on the counter
    row.** The row lock it holds until commit serializes writers to one account, so they commit
    in revision order. A sequence would not: a reader answered at 8 while the writer of 7 was
    uncommitted would skip 7 for good.
  - **`account_thumbs_since` must stay `STABLE` and one statement.** Then the counter and the
    rows are read on one snapshot. `VOLATILE`, or two statements, reads them at two instants.
  - **A write to `ratings` with the triggers off** (a restore under
    `session_replication_role = replica`) leaves rows with stale revisions and no tombstones:
    every device then holds something no difference will correct, and nothing here repairs
    it. Decide how readers are sent back for everything before doing one.
  - **`private.sweep_cleared` raises `floor` in the statement that deletes the tombstones.**
    Sweep without it and a reader who needed one keeps a thumb that was cleared.
  - Never derive the stamp from `rated_at` or a count: a digest of the two gives the time away
    to a follower, who can count the thumbs and try every timestamp.
  `25_thumbs_since` is the suite; `races.sh` the overlap.
- **`followed_stamps()`** and **`account_thumbs_since(uuid, bigint, bigint)`** are how the
  browser reads what it computes from. The first answers `md5(salt : revision : names ever
  removed)` per followed account with a readable thumb. The second answers `{revision, removed,
  full, thumbs, cleared}`: full when the caller's revision is null, not positive, ahead of the
  account's or below its `floor`, or when the count of removed names differs. Both are
  `security definer` because they read what no client may, so each body restates what the
  `ratings` policies decide — the caller's own or a followed account's, and nothing on an
  unpurged removed name — **and anything added to those policies must be added to both**. The
  second answers every other uuid as a followed account that never rated. Thumbs come back
  nested, item to tag to value, never under a joined key: text cannot hold the NUL the core
  joins with. They are aggregated as `json` and cast to `jsonb` once; nested `jsonb_object_agg`
  re-encodes the level below at every level.
- **`account_thumbs(uuid)`** is an account's thumbs whole, NOT `security definer` (the policies
  decide what it sees, so anyone unreadable answers `{}`). Nothing in the browser calls it.
- **Deleting an account is `public.delete_account()`**: no argument, deletes the caller's
  `auth.users` row; a trigger takes the profile, and the cascade from the profile does the rest
  (09 and 10 pin it). Anything new that names a person needs `on delete cascade` from `profiles`,
  or deletion either fails or leaves it behind; a uuid kept outside a foreign key (an array, a
  column with no FK like `debug_events.user_id`) needs clearing by hand in
  `private.handle_deleted_user`, the trigger that takes the profile, so that an account deleted
  from the dashboard leaves nothing either. It also
  leaves `private.deleted_identities`: an HMAC of each identity's `provider:provider_id` under
  the Vault secret `identity_fingerprint_key`, with that UTC day's spent budget, which a trigger
  on `auth.identities` hands to a new account from the same identity that day (16 pins it).
  Swept after its day. `private.deleted_imports` keeps each import inside its 30 days under the
  same fingerprint, and a second trigger hands them to the new account (21 pins it). The two
  local scripts stand in a plain-text Vault.
- **`items`**: the id is what somebody typed, normalized. The CLIENT writes `search_id` from
  `searchFold`, deliberately: a trigger would be a second implementation of the stripping, and a
  disagreement is a row nobody can find by its own name; `e2e:search-id` is what checks it. No
  UPDATE or DELETE for anyone. No URL is stored (a phishing surface) and no tag list: a thing's
  link is `item_refs (source, ref)`, the id checked against `private.ref_sources`' pattern, and
  the URL built from it by `shared/src/references.ts`. Never store coordinates there: that is
  what keeps OpenStreetMap's share-alike out of reach. Both
  `text_pattern_ops` indexes are needed: the collation is not `C`. `created_by` is readable by
  nobody and is the ONE person reference that does not cascade (`on delete set null`), or deleting
  an account would be impossible; its partial index keeps that set-null off a catalog scan.
- **`reports`**: a signed-in person reports a thing's name from its screen. INSERT of
  `item_id` only (`user_id` defaults to the caller), one per person per name, one write spent,
  no SELECT/UPDATE/DELETE for any client — see "Reports" for review and removal.
- **`private.admins`**: one row per admin, no client grant, written by hand ("Admins").
- **`private.write_budget`**: every rating insert or update, item, link on a thing, report,
  invite link turned on or replaced, follow (`private.spend_write`, from the three follow
  functions) and debug event spends one of `private.daily_write_limit()` (the ONLY place the
  number is written) per account per UTC day, via `private.count_write` keyed on `auth.uid()`.
  Deletes are free; connections with no `auth.uid()` are not counted. Past it, SQLSTATE `PT429`,
  which `isDailyLimit` in `web/src/lib/utils/supabase.ts` turns into a sentence with no number
  in it.
- **`private.imports`**: an import's own allowance, one row per account and source —
  `started_at`, `thumbs` — written only by `public.import_thumbs(text, jsonb)`, the ONE bulk
  write a client has. One import per source every 30 days, up to 10 000 thumbs, in chunks of at
  most 500 things a call, open for a day after its first thumb; each number is written once, in
  `private.import_thumb_limit()`, `import_chunk_limit()`, `import_open_for()` and
  `import_every()` (in hours: a `day` added to a timestamp follows the session's time zone). A
  call spends ONE daily write, and the rows it writes skip `count_write` through the
  transaction-local setting `grapevine.importing`, which only that function and
  `private.load_prefilled` set. So the function is where everything a client's own insert is
  checked for has to be checked again: `private.is_unlocked()`, the name rules,
  `private.is_removed`, the link's pattern in `private.ref_sources`, `private.is_ref_removed`. It
  creates a name only with a link, puts the thumb on whatever already holds the link, never
  overwrites a thumb (`on conflict do nothing`), and takes no date: `rated_at` is `now()`. Past
  the day, `GV429`. `public.import_state()` answers the caller's own rows with no timestamp.
  Anything added to what a rating or a name is checked for must be added there too.
- **`private.load_prefilled(handle, name, thumbs)`** is the owner's, executable by the service
  role alone: it writes a profile and its thumbs past the budget and the lock (see "Prefilled
  accounts").

**Four standing hazards, in the order they will bite.**

- **A follow is a read.** Whatever lets account A follow account B hands A every thumb B has
  given. Read every change to the follow functions and to `ratings_select` as a change to who can
  read ratings.
- **Postgres grants `EXECUTE` on a new function to `PUBLIC` by default**, and the platform grants
  ALL on a new table in `public` to `authenticated`. `0001` turns both defaults off before it
  creates anything (the unqualified `alter default privileges`; its comment says why the
  schema-qualified form removes nothing), and `07_structure` reads the catalog for a widened
  grant. Every migration gets read with this in mind.
- **Enumeration is the default.** Before adding a clause to a read policy, ask what `select *`
  returns under it.
- **`security definer` means the function's own rights.** Anything that runs as its owner must
  take an exact key and return at most one row, or answer only about the caller, or it is an
  enumeration surface with a friendly name. In `public`, which is served, the exact key, the
  `revoke ... from public` and the caller check are the whole of the defense.

**Normalization is one `normalizeId` in `shared/src/index.ts`**, used by the client and by
`scripts/load-prefilled.ts`:

    lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim

NFKC comes after lowercasing, because lowercasing a normalized string can denormalize it and the
last step must be the one the column `CHECK` tests. `"Café  BLEU "` is `café bleu`; `日本` survives.
The `CHECK` refuses: empty after trimming; anything not NFKC-normal (`x is nfkc normalized`); a
word starting with `!`, `#` or `@`, which search reads as operators (DESIGN §1 "Search"); over 128
code points, which the folding refuses rather than truncates, since a cut can land inside a
grapheme cluster or denormalize; and anything off the allow-list (migration `0002`):

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
change the list, edit the generator and write the NEXT migration; like `0002`, it must
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

- **No server of ours, anywhere.** Every user action is a direct PostgREST read or write under
  row-level security, and the list is computed in the browser. Treat an Edge Function, or a
  table of computed results, as a claim to disprove: DESIGN §3.4 says what the one candidate
  would buy and cost.
- **Local-stack mode is `VITE_LOCAL_SUPABASE=1` ANDed with `import.meta.env.DEV`.** Vite replaces
  the `DEV` half with a literal, which folds the branch away in a production bundle; the flag
  alone would leave a build one variable away from localhost. The condition is written out at each
  of its uses in `project.ts`, because a bundler folds `false && …` where it stands and need not
  look inside a function; `e2e:pwa` fails an export that carries the local address or key.
- **The project's address is configured in exactly one place, `web/src/lib/utils/project.ts`.** It
  is a plain module that touches nothing of the browser, because the root layout reads the origin
  while the pages are prerendered, for its `preconnect`, and `bun test` reads it too. Do not add an
  environment variable beside it.
- **`shared/` reaches `web/` by an alias**, not a `file:` dependency, which bun installs as a tree
  of symlinks. It is declared twice, and both are needed: `resolve.alias` in `web/vite.config.ts`
  for the bundler, and `paths` in `web/tsconfig.json` for the type checker and `bun test`.
  `server.fs.allow` there is the repo, so the dev server may read a file above `web/`. Nothing
  needs building.
- **The core reaches `web/` by an alias too**: `grapevine-core` and `grapevine-core/wasm` in
  `vite.config.ts` point into `web/core-wasm/`, which `scripts/build-wasm.sh web` writes and
  nothing commits. `web/src/core-wasm.d.ts` types both, so the type checker and `bun test` need
  no build; only the worker (`utils/taste-worker.ts`) imports them, and anything else that did
  would pull the wasm onto the page.
- **The app's screens are not SvelteKit's routes.** SvelteKit routes `/` and the three written
  pages; the five screens live in the fragment and are `web/src/lib/utils/router.ts`'s. It keeps
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
- **Five routes and no more**: `#/` (the list), `#/item/<id>`, `#/people`, `#/import` (see
  "Importing"; nothing of an import is in the address, so a reload starts it over) and
  `#/reports` (an admin's review queue; anybody else who opens it is put on the list, as for a
  fragment that names no screen, once the profile says they are not an admin); the three
  written pages are static routes the router stays off. **There is no account page**: an account
  is a row (`components/account-row.svelte`), on the people screen and the first run's offer. A
  pasted link to a thing gets the list seeded under it so Back goes somewhere, and one to
  `#/reports` the list and the people screen. `web/tests/router.test.ts` asserts
  that any other fragment names no screen. `#/invite/<token>` is not a route: the store takes the
  token out of the address before the router reads it (`utils/invites.ts`). A live one is asked
  on one full screen, `components/link-question.svelte`, in place of whatever screen is up and for
  every account alike; `components/invite-gate.svelte` says the rest (dead, or your own) in a
  dialog.
- **What an account row does is in one file**, `components/account-actions.ts`: add to the vine,
  remove from it (which says first when that locks the account), stop somebody following. Every
  screen that lists accounts calls those.

## UI design language

Tokens and components are in [`web/DESIGN-UI.md`](./web/DESIGN-UI.md); every new screen follows
it: one 4 px radius, hexagonal avatars, a bar with no word beside it, the swipe. A thing's bar
draws the core's score as it is (`barValue` in `utils/bar.ts`; DESIGN §1 "The bar", §2.6), mapped
from `(−1, 1)` to the bar's length, with no step and no shading. Nothing pulls it toward the middle
for having little behind it: the followed accounts' mean already does that once (DESIGN §2.3), so
one thumb up is a third of the way from the middle to the end. An attribute's bar draws the same,
of how good an example of it the thing is. No score draws the empty track ("nothing known yet").
The count the core returns beside a score only breaks ties in the order and is never drawn.

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

The list reads only the list the browser computed and the viewer's own ratings, and searches in
memory (`utils/discover.ts`), with the catalog merged in by prefix so a thing that exists is found
rather than made twice. Empty, it is every computed entry plus everything the viewer has rated,
since there is no entry for what no followed account rated and the viewer's own record says
nothing about. A thing's suggested rail is the viewer's own words by
`shared/src/suggest-attributes.ts`, which reads the viewer's own ratings and nothing else
(DESIGN §2.11). It is empty, never filler, when there are none. The core proposes no attribute.

- **Nothing orders by when a thumb was given.** No client can read `rated_at` at all.
- **The entry's id is what is drawn.** A ratings row can name an id nobody created, and showing it
  is harmless: it has been through the same folding and `CHECK`s.
- **An absent tag is "nothing is known"** (DESIGN §2.6): no followed account put it there.
- **A thing is shown as having an attribute only when it `carries` it** (`utils/discover.ts`):
  the viewer rated it, or somebody followed did and `applies > 0.5`, which is a score above zero
  (DESIGN §2.4). That decides a row's chips and the rows on a thing's screen. So an attribute the
  followed accounts mostly thumbed down on a thing gets no chip and no row there, though a search
  for it still finds the thing, low.
- **`presence` is `applies`; `goodness` is the thumb, or the score read as `(1 + s)/2`.** A
  viewer's own thumbs-down on an attribute is presence 1 and goodness 0: a bad fantasy is a
  fantasy. For an attribute only followed accounts rated, the two are the same number.
- **Nothing on it is a number.** Empty, it ranks by the score its bar draws. Typing
  ranks by strength — the per-word geometric mean of what each piece of the query contributes, a
  thing's score for its name and an attribute's presence for an attribute, each mapped to `[0, 1]`,
  one minus either for a word typed with `!`, unknown as one half, **and, when no piece read as
  its name, one more factor: how good an example the thing is of the attributes asked for,
  falling back to how good the thing is where nobody has said** (DESIGN §1 "Search") — then by `conf`, then
  alphabetically, and never renders `conf`, `score` or any count. A rated row keeps its bar and
  tints its background; a chip carries the attribute itself and no state word. DESIGN §4 is why.
- **The list's search finds things only.** A word's leading `@` is dropped (`parseQuery`): it
  is still reserved in names, so the add stays disabled.
- **Accounts are found by the people screen's search** (`findAccounts` in `utils/people.ts`).
  What it searches is `known` — the accounts the viewer follows, their followers, every
  prefilled account — all already in the store; the screen's *critics* and the first run's
  offer of them (`components/prefilled-offer.svelte`) list `grapevine.prefilled` from the same
  store. It asks the server nothing, and must never: a query that reached past `known` would be
  a lookup of people by name. Every word must start the handle, a word of the name, or a word
  of any of a prefilled account's `tags`, not only the three a row shows; a matched tag is
  always among the row's chips (`accountChips`). A person has no tags, so is found by name
  only.
- **Nothing on a screen says which account a row came from**, or how any account's taste
  compares with the viewer's. The browser holds the thumbs to work either out; drawing either is
  a decision for DESIGN §4, not a feature to add.

## Importing

DESIGN §1 item 9 is what it does; §3.3 the function that saves it. `shared/src/import/` is the pure
half (`formats.ts` reads the eight export files, `thumbs.ts` is the cuts, `match.ts` the matchers),
`web/src/lib/utils/zip.ts` reads a zip's directory with standard APIs, `web/src/lib/utils/import.ts`
sends the requests, resolves against the catalog and saves, and `components/import-view.svelte` is
the screen. The rules that are easy to break:

- **The file never leaves the browser**, and no date in it is read: an imported thumb is
  stamped by the server when it is saved, as every thumb is. No client writes `rated_at`.
- **An import never overwrites a thumb**, and never rates an attribute. The filter
  before the save (`resolveImport`) and the statement itself (`on conflict do nothing`) both
  hold it.
- **A match is named as a hand-add of it would be**: `titleToName` of the English Wikipedia
  title, or `placeCandidate`'s names, resolved by `classifyMatches`. Never invent a qualifier:
  an imported thing with its own spelling is a second thing. A thing that holds the link is
  found by the link whatever it is called, on the client and again on the server.
- **The other service's id is never stored**, and nothing says a thumb was imported. A place's
  position is compared in memory and never stored, as for a hand-add.
- **A file is recognized by its content**, columns are read by header name, and every fixture
  under `shared/tests/fixtures/import/` is written by hand. Real exports are other people's
  ratings: none goes in the repository.
- **The query service is fragile to a query's shape.** Each query in `match.ts` is the form
  that answered in a second where an equivalent one timed out at 65; run a changed one against
  the live service before trusting it. Labels are moving to language `mul`, so a title or an
  author's name is asked in both `en` and `mul`.
- **Pacing is the caller's** (`createAsk`): one request at a time, Photon no more than once
  every 1.1 seconds, a 429 waited out once, and no `Api-User-Agent` to the query service,
  where it would force a preflight on every request. A refusal from Photon is backed off
  from and halves the pace; it must not end a run that can be hours long.
- **The only cap is the import's 10 000**, the server's. Do not add a smaller one for a
  source. A run saves as it goes (`segmentOf` in the screen), so leaving it keeps what it
  matched.
- **Only a clean match is saved, and nothing is asked but one thing.** `decide` in `match.ts`
  answers one thing or a miss; a row with two things it could be is a miss. Do not add a way
  to guess, and do not add a question: the flow has no screen between the file and the save,
  which is why the how-to sheet says before the file is chosen that it saves at once.
  **The one exception is Netflix's profiles.** Its `Ratings.csv` holds every profile on the
  account, so a file with more than one profile shows each by name, all on, to be turned
  off; only the thumbs of those left on are imported (`netflixReading`). A file with one
  profile skips the step. The names are kept in the screen's state for the run and nowhere
  else.
- **A Netflix title is matched by its label alone** (`titleLabelRequest`): the file has no
  year and no id. One film or series of that label is the match; of several, the one that
  holds a Netflix id (P1874); anything else is a miss. A title the file rates twice, or two
  chosen profiles rate, is imported only when every thumb on it agrees, since telling which
  came last would read the file's dates.
- **No rating and no name of an import is kept on the device.** What is: whether the offer
  was answered (`utils/import-offer.ts`), and where a run that was left stopped — a source
  and two counts (`utils/import-resume.ts`) — so the same file chosen again within the
  import's day takes up there. Both are forgotten on sign-out.
- **Counts appear on this screen and nowhere else**: how far a run has got, and how many
  of the person's own ratings were saved. No list of what was left out.
- **The file out** (`shared/src/import/export.ts`, `web/src/lib/utils/export.ts`) is the viewer's own
  thumbs and their things' links, built in the browser, with no dates in it. A cell that
  starts as a formula does is prefixed with `'`: a name is text anybody typed.


## How the browser computes the list

DESIGN §3.4, in `web/src/lib/utils/`: `recs.ts` (the reads, the worker, the cache), `taste.ts` (the
pure half: which accounts are stale, the snapshot the core takes), `taste-worker.ts` (the wasm).

- **Two reads, never a select of `ratings`.** `followed_stamps()` answers one opaque stamp per
  followed account; `account_thumbs_since` is read once per account whose stamp is new
  (`fetchThumbsSince`), `READS_AT_ONCE` (four) at a time, with the revision and removed count
  held for it, as one JSON value. A plain select would be cut at PostgREST's `max_rows` (1 000),
  and one critic can hold thousands of thumbs. An open on which nothing changed is the stamps
  call alone.
- **Followed accounts' thumbs are kept on the device** (`utils/followed-cache.ts`): IndexedDB,
  keyed by viewer and account, each row the thumbs with their stamp, revision and removed
  count. `held` is loaded from it on a viewer's first computation in a session and written back
  after each. **Every failure there is "read in full"**, never an error: each function answers
  as though the cache were empty. An account that leaves the stamps (unfollowed, or with
  nothing visible) is deleted from it; `forgetDevice` in the store deletes everything on
  sign-out, whoever's it was. These are other people's ratings at rest: anything that widens
  what is kept, or keeps it past sign-out, is a DESIGN §4 decision.
- **An answer is applied cleared first, then written** (`applyThumbsSince` in `taste.ts`): a
  thumb cleared and given again is in both, and the written one is what is there now. A full
  answer replaces. `readThumbsSince` refuses anything that is not a whole answer, so what is
  kept is only ever built from one.
- **What is cached on the device is the viewer's own list**, in `localStorage` under a per-viewer
  key, in a try/catch, for first paint and offline. `forgetCachedFeeds` clears every viewer's on
  sign-out. A cached list sets no `ready`: "nothing here yet" is only said after a computation.
- **Nothing is computed when nothing changed**: same stamps, and the viewer's own ratings the same
  object (they are replaced on every change, never mutated, so identity is the comparison).
- **The list refreshes on open, when the tab comes back, when the vine changes and after an
  import — not on each thumb.** A list that re-ranks under a finger is a row that moves as it is
  swiped.
- **One computation at a time** (`refreshMyRecs`): an ask during one is answered by a second run
  after it. A viewer who signed out or changed mid-read gets nothing written (`heldFor`).
- **The core runs in a worker**, which calls `computeUserTensor` for a list and `layOut` for the
  map, and nothing else. On the page, tens of milliseconds of arithmetic, more for accounts
  with thousands of thumbs, is a swipe that does not answer. The worker closes itself when the
  core fails to load, and the page drops one when the core is gone (it failed to load, or
  trapped: `fatal` on the answer), on `messageerror`, or after 60 s without an answer
  (`COMPUTE_PATIENCE_MS`), telling whoever is waiting, so the next ask makes a new one. A
  refusal the core words itself is an answer to the one ask, and the worker stays.
- **The map is at most `DOTS` (600) things** (`utils/taste-map.ts`), the viewer's own counted
  in. The layout visits every pair at every step, so twice the dots is four times the wait and
  the memory; do not draw "all the viewer rated" on top of the cap.
- **`failed` means no computation has finished this session and the last one failed.** The
  failure notice shows then, over a cached list too. `ready` false, `failed` false and no
  entries is "still loading", which the list draws as the pulsing mark.
- **What is held for an account is dropped on every change of session, from the store**
  (`forgetFeedUnless`, `forgetRatingsUnless`): the list, the viewer's thumbs, the followed
  accounts' thumbs. A computation checks the session's uid before it writes.
- **`refreshFollows` drops a read that a local follow or unfollow overtook**, or the row just
  swiped comes back.
- **A name is looked up by own keys only.** `__proto__` and `constructor` are legal names for a
  thing or a tag; index a ratings or scores object with `Object.hasOwn`, never bare.
- **Three sanitizers, on purpose**: `sanitizeRatings` (`shared/src/entries.ts`) before the wasm
  boundary, `to_snapshot` in the crate, and `allFinite` on what comes back. A followed account's
  rows are input the viewer did not write, and one crafted row must not fail the list of
  everyone who follows its author.
- **A removed name leaves through the same two reads**: the restrictive policy on `ratings` hides
  its thumbs, `followed_stamps` digests the number of names ever removed so every stamp moves
  once, and `account_thumbs_since` answers in full when that number differs from the caller's,
  so the next computation replaces what the device held for every account.

## Reports

No client reads `reports` except through the admins' review queue: a screen of its own,
`#/reports` (`components/reports-view.svelte`), opened by the *names people reported* row on the
people screen, which only an admin sees. It lists every reported name with its count, and a
name's row swipes left to remove it, asking first, and right to dismiss it. Three
`security definer` functions in `public` are the whole of it, each checking `private.is_admin()`
first: `reported_names()` answers anybody else nothing, and `remove_reported_name(text)` and
`dismiss_reports(text)` refuse with `42501`.

A name that is abuse, a private person's name or spam is **removed**, not hidden.
`remove_reported_name` calls `private.remove_name`, which only records the removal in
`private.removed_names` (`removed_at`), deletes the `items` row and the reports, and returns
nothing, in about a millisecond. The restrictive insert policies on `items`, `ratings`,
`item_refs` and `reports` check that table, so the name cannot be created, linked or reported
again. Everything else is lazy, and every reader of a thumb has to honor it:

- **The thumbs** stay until `private.purge_removed_names`, a cron job every minute, deletes them,
  5 000 a run (one scan of `ratings` each: there is no index on `item_id` or `tag`). Until then
  `private.unpurged_names()` lists the name, and a signed-in read of `ratings` (policy
  `ratings_not_removed_read`, which also covers `account_thumbs`) and `account_thumbs_since`
  leave those thumbs out, and `followed_stamps` answers no stamp for an account with nothing
  else. A name is marked `purged_at` once a run finds none left and it was removed
  over ten minutes ago, because an insert that passed the policy just before the removal can
  still commit.
- **A list already computed** keeps the name until that browser computes again; every stamp
  moves on a removal, so the next ask does. The purge then bumps each rater's revision, and
  their followers re-read them once more.
- **`private.load_prefilled`** leaves out a thumb on a removed name.
- Anything new that reads `ratings` as its owner (`security definer`) must leave removed names
  out the same way; anything that reads it as the caller gets it from the policy.

Irreversible: the thumbs go. **Dismissing** deletes the name's reports and keeps the name; anyone
may report it again. Both still work from this checkout with no admin account:

```sh
supabase db query --linked "select private.remove_name('the exact id')"
```

The id must be exact (`normalizeId` of what is shown). Unblocking is `delete from
private.removed_names where id = '…'`, which brings nothing back; do it only once `purged_at` is
set, or thumbs the purge has not reached reappear to every reader.

A wrong link on a name worth keeping is taken off without touching the name or its thumbs, and
can never be added again (`private.removed_refs`); nothing in the app does it:

```sh
supabase db query --linked "select private.remove_reference('the exact id')"
```

## Admins

Supabase has no application-level admin role for end users, so an admin is a row in
`private.admins`, which no client can read or write; `private.is_admin()` checks the caller's
own `auth.uid()`, and `account_is_admin()` tells the client whether to show the queue. An admin is
never locked, whoever they follow. Granting is one line, run by the owner against the project,
with the account's Google address:

```sh
supabase db query --linked "insert into private.admins (user_id) select id from auth.users where email = 'someone@example.com'"
```

Revoking is `delete from private.admins where user_id = …`; an admin left following no person is
then locked and loses their link. No user id goes in the repository.

## Prefilled accounts

An account the owner makes by hand to hold a critic's or a source's published picks (DESIGN §1
"Objects"): a `profiles` row with `prefilled = true` and a `handle`, no `auth.users` row, no
sign-in. Anyone signed in can find it (`@`, by handle, name or one of its `tags`, or the
people screen's *critics*) and follow it with no link (`follow_prefilled`). Its `tags` are the
attributes its thumbs use, set by the load, so `accounts.csv` has no column for them.
Following one does not unlock an account. There is no page listing its ratings; its thumbs are
read by following it.

An account that has just accepted a link is offered every prefilled account once, before the
import offer (`components/offer-or-app.svelte` puts them in that order: an import is a screen of
its own, and an offer still waiting would stand in front of it). Whether it was answered is kept
per account on the device (`utils/prefilled-offer.ts`, on `utils/offer-memory.ts` as the import
offer is) and forgotten on sign-out. It is not asked before the link, because a locked account
cannot follow one, and it is skipped when there is no prefilled account or their read failed.

The source is two kinds of file under `prefilled/`:

    accounts.csv     handle,name            one row per account
    <handle>.csv     name,attribute,rating,source,id
                     attribute empty for the thing itself; rating `yes` or `no`;
                     source and id optional, the thing's link (`wikidata`,`Q…` or `osm`,`n…`)

That is the app's own export format (`shared/src/import/export.ts`), so a file can start as
somebody's export; `scripts/load-prefilled.ts`'s header is the full description. A thing's tags
are rows of their own: `The Anxious Generation,book,yes`.

```sh
bun scripts/load-prefilled.ts            # prints the SQL for every account, runs nothing
bun scripts/load-prefilled.ts obama      # one, by handle
supabase db query --linked -f <(bun scripts/load-prefilled.ts obama)   # the owner loads it; a file,
                                                                    # since a large account is too long for an argument
```

The script checks what a client's own write is checked for — the name rules, the link's shape,
one thumb per thing and attribute — and fails with a line number, because
`private.load_prefilled` refuses a whole load on its first bad entry. The function finds the
account by handle, so loading again is the same account with the same id (renamed if the name
changed), and makes its thumbs **equal the file exactly**: new ones written, changed ones turned
over, and any the file no longer holds deleted. A thumb on a removed name is skipped and counted.
A new thing's `search_id` is taken from any of its entries. Loading the same file twice moves
nothing the second time: no thumb takes a revision, so no follower is sent to read it again.
It answers the account's `id` and counts as JSON: `saved`, `changed`, `deleted`, `skipped`,
`items`, `refs`.

Rules that are easy to break:

- **Only the service role may execute `private.load_prefilled`**, and the script is never given
  it: it prints, the owner runs.
- **A prefilled profile is nobody's own.** No session carries its id; the update policy refuses
  it anyway; the `auth.users` delete trigger never removes one.
- **Its handle is its identity.** Changing a handle in `accounts.csv` makes a second account and
  leaves the first, with its followers, in the database. Nothing removes an account; deleting its
  `profiles` row by hand cascades to its thumbs and follows.
- Each follower's device reads a large account in full once, and after a load only what the
  load changed (DESIGN §3.8). **Offer `ratings` only the rows that are missing**: an insert that
  conflicts still takes a revision on its way to being turned away, and sends every follower to
  read an account that did not change.

## The schedule

**Six statements run on a schedule, all inside the database (`0003_cron.sql`), and nothing else
anywhere does**: the diagnostics TTL sweep, the write-budget sweep, the deleted-identity sweep,
the sweep of imports past their 30 days, the sweep of cleared-thumb tombstones past theirs
(`private.sweep_cleared`), and the purge of removed names' thumbs. The sweeps are
not optional for a second reason: they are what stops a free project pausing after seven days
without database activity. There is deliberately no scheduled GitHub workflow — GitHub disables
one after 60 days of repository inactivity and nothing goes red. `serve-local.sh`'s stack has no
`pg_cron`, so nothing scheduled runs there: a removed name's thumbs stay hidden and are never
purged.

## The written pages

Three prerendered routes — `/about/`, `/privacy/`, `/help/` (`web/src/routes/`) — each importing
no store and needing no session, so the full text sits in the exported HTML.
`components/doc-page.svelte` is the shell. `e2e:pwa` greps one sentence out of each exported page,
and its list is three on purpose: a page list that shrinks silently is how a page goes missing.
The pages have no diagrams and no formulas, and say each thing once, in as few words as they can.

`/about/` is also the explainer, and **nothing on it may claim more than DESIGN §2 does**.
It explains the swipe directions (*Swipe a row right for yes, left for no.*, the `e2e:pwa`
needle), and so does the list's one-time hint (DESIGN §1 item 7), which waits for a list with
rows in it.

`/privacy/` says the uncomfortable part out loud because DESIGN §4 does: **anyone who follows
you can read your ratings** (word for word — it is the `e2e:pwa` needle, and the one place
grapevine says in plain words who else can read a person's ratings). It also says who can follow
you and that you can remove them; that a thing's name is public text that can never change; that
Google is the sign-in provider (so no password is stored, but the email address Google sends is,
in `auth.users`) and the site loads no trackers; that the list is built in the browser and the
server never holds it; and what the device keeps. It states what is done rather than promising
it. It must **not** say a thumb is stored without a clock: `ratings.rated_at` exists, and the
page says ratings are stored with when. `/help/`'s needle is *Thumb it down*.

## Icons

`web/scripts/make-icons.mjs` reads `docs/mark.svg` and writes `icon.svg` and the four PNGs into
`web/static/`. It needs `rsvg-convert` (`brew install librsvg`); the outputs are committed. Run it
when the accent or the mark changes.

The mark is **hex grapes**: six hexagons in a 3-2-1 bunch, no stem, each an outlined hexagon with a
**same-size** hexagon clipped inside it and pushed toward one vertex, so a rim of even width
survives on exactly two sides. A *smaller* inner hexagon leaves a rim on three sides and reads as a
ring. Hexagons have real rounded corners rather than a rounded pen stroke. **Nothing in the mark may
be `<text>`**: every renderer that draws it (a favicon tab, an OS launcher, a PNG converter) has no
webfont and substitutes whatever grotesque it has.

## Supabase setup (do once)

**Status**: the project exists and this checkout is linked to it (the ref is in `supabase/.temp/`,
not committed); `web/src/lib/utils/project.ts` carries its URL and anon key. The Google OAuth
client exists and `pg_cron` is enabled. The fresh start below was run on 2026-11-01: the
project holds this schema, `0001`–`0006` are recorded on it, and it serves no function.
`supabase config diff` shows what the project's auth settings differ from `config.toml` by; the
deploy's `config push` closes that. Step 7 waits on the repository. Nothing below is needed to
run against a local stack.

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
   pushed to production, so it names the one port somebody signs in on (`bun dev`);
   `dev:local` needs none, because local sessions are minted.
5. **`pg_cron` must be enabled** for `0003` to apply.
6. **Realtime** carries `follows` and nothing else, added to the publication by `0004`, which
   also restricts it to `insert, update` (a DELETE event cannot be bounded by RLS; 0004 says why).
   RLS applies to Realtime, so a follow reaches its two ends and nobody else.
7. **Repository secrets and one variable** — the whole of what the deploy is given:
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (secrets) — `link`, `db push`, `config push`.
   - `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET` (secrets) — `config push`.
   - `SUPABASE_PROJECT_REF` (a **variable**) — out of the file so a second project needs no diff.

   `SUPABASE_ACCESS_TOKEN` is a scoped token (Project scope, this project only, 90 days at most).
   `link` reads the secret API keys, `config diff` reads `/v2/projects/{ref}/config`, and
   `config push` reads the add-ons first. The set that has worked: Project Settings, Auth Config,
   Data API Config, Database Config, Migrations, Connection Pooling, Edge Functions, Realtime
   Config and Storage Config read-write; API Keys, API Key Secrets, Database, Network
   Restrictions, SSL Enforcement and Add-ons read. A narrower set is untested. A token that has
   expired or lacks one fails at the step that needs it, and the fix is a new token (they cannot
   be edited) and `gh secret set SUPABASE_ACCESS_TOKEN -R hafacc/grapevine`.

   `web.yml` refuses to start if any of the five is empty. These are long-lived secrets (Supabase
   has no workload identity federation): rotate them, and never put one in anything the client
   bundles.
8. **Free tier**: 500 MB of database and 5 GB of egress a month (DESIGN §3.8 says which binds),
   and no point-in-time recovery.

### The fresh start (done once, by hand, on 2026-11-01)

Kept for a second project, or for starting over.


The project's recorded migration history holds versions `0001`–`0004` under other names, so a
plain `supabase db push` would treat this repository's first four files as already applied and change
nothing. The schema is put in place by resetting the project instead. **This destroys every row
in the project: every account's profile, thumbs and follows.**

```sh
supabase migration list --linked       # read first: what the project has recorded
supabase db reset --linked             # DESTRUCTIVE. Reapplies supabase/migrations/ from zero
                                       # and rewrites the recorded history, then runs seed.sql,
                                       # which is empty.
supabase functions delete refresh-recs # nothing calls it, and no deploy touches functions
supabase migration list --linked       # 0001-0006, local and remote, and nothing else
```

Then a normal deploy ("Release runbook"), which pushes `config.toml` and publishes the site.
Then, as for any new project:

- Sign in once, so the owner's account exists, and grant it admin ("Admins"). An admin is never
  locked, which is how the first link gets made.
- Turn the link on from the people screen and send it to the first person.
- Load the prefilled accounts ("Prefilled accounts").

Not checked by this file: whether `db reset --linked` also empties `auth.users`. A profile is
made by a trigger on the *insert* of an auth user, so an auth user that survives the reset has
no profile and the app cannot show them one. Before signing in, run `supabase db query --linked
"select count(*) from auth.users"`; if it is not zero, delete those rows (`delete from
auth.users`), and each person's next sign-in makes the account again, with its profile.

From then on the migrations are recorded, and "Migrations" below applies to them.

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
  passphrase: the `auth` half holds everybody's email address, and `public` everybody's thumbs.
- **Kept 30 days**, then deleted by the same script. The change that sets backups up must add to
  `/privacy/`'s "leaving" section that a deleted account's rows survive in them for up to 30 days.
- **Restore-tested**, monthly and after any migration: build a cluster the way `run-local.sh` does,
  load the `public` and `private` data with `set session_replication_role = replica` (the stand-in
  `auth.users` has too few columns for the real rows), and compare row counts per table against
  `supabase db query --linked`.

## Deployment

**Deploying is manual.** A push to `main` runs `ci.yml` and nothing else.
`.github/workflows/web.yml` (`workflow_dispatch` only, refusing any ref but `main`) does the whole
deploy, in an order that is not negotiable:

    CI gate (ci.yml, reused by workflow_call)
      → Supabase: refuse an empty secret or a ref other than main
                  + db push --dry-run + config diff (printed, read-only)
                  + db push + config push
        → GitHub Pages: build the web wasm, bun export, upload web/out
          → deploy-pages

A GitHub Release deploys nothing: it would run on its tag, and the `github-pages` environment
accepts main only, so migrations would apply and the Pages job would then be refused.

**The database goes first**, so the site never publishes a frontend expecting a policy or function
that is not live; if that job fails, Pages never runs. **And `bun export` runs in the gate too**
(`ci.yml`'s `check` job, after building the `web` wasm): otherwise a build failure would land
after `db push` had applied forward-only migrations, leaving the database ahead of a site stuck on
the last good version, with nothing on the free tier to roll back with. The deploy's build job
builds the wasm itself rather than downloading anything: a stale core is worse than the minute it
costs. Nothing is deployed to Supabase but migrations and config: there are no functions.

`ci.yml` has four jobs: `rust` (fmt, clippy, both test runs, both wasm targets, the smoke test),
`check` (web lint, test, the wasm, export), `database` (the migration rule below, `db lint`,
`supabase test db`) and `shared` (lint, test). `automerge.yml` merges Dependabot pull requests once
`ci.yml` passes; it deploys nothing.

### Migrations

    0001_fresh_schema.sql   every table, privilege, policy and function a client calls
    0002_name_rules.sql     the generated allow-list for names (replaces is_normalized_id)
    0003_cron.sql           the six scheduled statements
    0004_realtime.sql       the publication: `follows`, insert and update only
    0005_import_sources.sql storygraph, netflix, trakt and spotify as import sources
    0006_prefilled_tags.sql a prefilled account's attributes, `profiles.tags`

`0001`–`0006` are recorded on the project. So:

**Migrations are append-only once recorded.** A migration whose version appears in `supabase
migration list --linked` is frozen: never edit, rename, reorder or delete it. `db push` skips
recorded versions, so an edit reaches every fresh stack (CI, `run-local.sh`) and never the project,
and the two diverge silently. Every change, including a fix to one that just shipped, is a new
file with the next number. SQL is not applied to the project by hand; if an emergency forces it,
the same SQL lands as the next migration in the same change and is recorded with `supabase
migration repair --status applied <version>`. A migration runs against real data with no undo, so
one that drops or rewrites a column is reviewed as the irreversible thing it is, and `supabase db
reset` belongs nowhere near the project after the fresh start.

`ci.yml`'s `database` job fails a push or pull request that modifies, deletes or renames an
existing file under `supabase/migrations/`. It compares against the base commit, and skips a base
that has no `0001_fresh_schema.sql`. So it objects to an edit from the first commit after the one
that adds the four files, whether or not the fresh start has been run by then.

The pgTAP suites are `supabase/tests/01`–`25`, one subject each, named for it: `15_invite_only`
is the lock, `22_follows` the three ways to follow, `23_prefilled` the prefilled accounts,
`24_followed_thumbs` what a follow lets you read, `25_thumbs_since` reading only what changed,
`19_lazy_removal` removed names, `07_structure` the grants and default privileges. A new table or function gets a line in
`07_structure` and a suite, or a place in one.

### The domain (do once, by hand)

**The site is `https://grapevine.hafa.cc/`, served from the root of its own origin**, not
`hafa.cc/grapevine/`. So the export has no base path: `vite.config.ts` sets none, `start_url`, the
manifest `scope` and the worker's scope are all `/`, and `e2e:pwa` serves the export at the root.
The `grapevine-` cache prefix and `grapevine-theme` key are kept for the day something else is
served from this origin.

`support@grapevine.hafa.cc` is on Cloudflare Email Routing, which puts MX and SPF records at
`grapevine` itself, and a `CNAME` cannot share its name with any other record (RFC 1034 §3.6.2), so
the name uses the apex form: `A` and `AAAA` records to GitHub Pages, as `kip.hafa.cc` does. Every
record is **DNS only (gray cloud)**: a proxied one answers with Cloudflare's addresses, GitHub's DNS
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
supabase start && supabase db lint && supabase test db   # (docker); else run-local.sh, weaker
(cd shared && bun install --frozen-lockfile && bun lint && bun test)
(cd web && bun install --frozen-lockfile && bun lint && bun run test)
(cd web && bun e2e:pwa)                          # (chrome); builds the export itself
bash supabase/tests/races.sh                             # after a change to the lock or a link
# A local stack up (`bun stack:local`, or docker):
(cd web && bun e2e:stack)                        # (chrome)
```

**What CI does not run.** None of the Playwright tests in `web/e2e/` is in CI, nor is
`races.sh`. `e2e:pwa` needs no stack. `seed:local`, `e2e:search-id`, `e2e:signin`, `e2e:map`
and `e2e:feed` need one, and run and pass on this machine against `serve-local.sh`, with no
Docker. That stack has no GoTrue, no Realtime and stand-ins for `auth` and Vault, so a pass
on it says less than a pass on `supabase start`, which nobody here can run. Nothing anywhere
checks the list's numbers in a browser: those are `cargo test`'s, natively, and
`rust/examples/smoke.mjs`'s through the wasm boundary under Node.

By hand, against the deployed site:

- **Sign in.** Google's consent screen cannot be automated, so redirect-URL mismatches, a stale
  OAuth client and the PKCE/fragment collision otherwise fail in production, on a real person.
- **The list computes**: with one account followed, rows appear. The worker loads the `.wasm`
  from the site's own origin, and a build that left it out fails only here.
- `web/src/lib/utils/project.ts` carries a real project URL and anon key.
- `supabase/config.toml` — anonymous off, email signup off, no second factor, Google the only
  external provider, no SMTP section — and the deployed project agrees.
- **From a Google session, `supabase.auth.updateUser({ email: "someone-else@example.com" })` must
  not change `auth.users.email`** (`double_confirm_changes` and `enable_confirmations`, delivered
  only by `config push`).
- **From a second account that does not follow the first, `account_thumbs(<first's uuid>)`
  answers `{}`, `account_thumbs_since(<first's uuid>, null, null)` answers empty `thumbs`**, and
  a select of `ratings` filtered to that uuid answers no rows.
- `supabase functions list` is empty.
- The repo is public and Pages is on with GitHub Actions as its source.
- The Google consent screen's privacy-policy URL resolves to `/privacy/`.
- `http://grapevine.hafa.cc/` redirects to `https://`, and Pages shows the custom domain with
  Enforce HTTPS ticked.
