# grapevine-core

The recommendation algorithm of [DESIGN.md](../DESIGN.md) §2, as pure functions over an
in-memory snapshot, plus the synthetic-world simulator and the property suite that pins the
algorithm's claims down. No I/O, no database, no async. Built to WebAssembly by
`scripts/build-wasm.sh`, for the Edge Function (`web` target) and for
`rust/examples/smoke.mjs` (`nodejs`).

```rust
let result = compute_user(&snapshot, viewer, &Params::default())?;
// result.scores: ratable -> (score, confidence = W) for every item and tag anyone reached rated,
//                and every attribute gap filled from a linked pair
// result.reached: people with a non-zero chain
// result.boundary: unloaded neighbours of the loaded, with the strength a chain would reach them at
// result.pairs: the per-viewer tallies the database pools into the priors
```

Every entry point returns a `Result`. The error cases (`CoreError`) are a parameter table the model
has no answer for (`a₀` outside `(0, 1)`, a `κ` or `L` that is not positive and finite), an
unknown viewer, and a score or certainty that is not finite — never a rating
anyone can write: values that are not `1`/`-1` (or `2`/`-2`, the same thumbs given after the viewer's own) and
keys whose halves are not usable ids are *dropped* at the boundary, because refusing them would let
one crafted account fail the recompute of every viewer within reach of it.

## Layout

| module | what it is |
|---|---|
| `ids` | `UserId`, `ItemId`, `TagId`, `Ratable` (an item, or an item–tag pair), the id check |
| `snapshot` | the friend graph and everyone's ratings with their order stamps, names interned to integers; a user may be *unloaded* |
| `graph` | the `Graph` trait (adjacency may be missing, as it is for an unloaded user), BFS hop distances |
| `params` | the table of DESIGN §2.9: `a₀`, `κ`, `L` |
| `witness::channel` | the witness channel of §2.2: a shared thumb's likelihood with the reaction mixture, the posterior of `λ` on a 16-point grid, a thumb's clipped log-likelihood ratio, the chance it is the viewer's answer |
| `witness::circle` | the circle (the viewer and the people they trust directly) and the base rates read over it |
| `witness::chains` | direct reliability, the max-product chains and their regions, own history under the two caps |
| `witness::topics` | the attributes a thing carries, and reliability per attribute with `κ_a` chosen by marginal likelihood |
| `witness::score` | region averages, the starting point, the score and the certainty `W` |
| `witness::facts` | attribute thumbs as facts: the one fact reliability, tag scores, attribute pairs by spike-and-slab and the gaps they fill |
| `witness` | `compute_user`, `compute_user_detail` (everything per person, for tests), `compute_all`; the boundary and the tallies |
| `score` | `Score`: one ratable's score and `W` |
| `priors` | `κ` and `a₀(d)` by method of moments (§2.9): the per-recompute `PairTallies` the database pools, the same estimate over a whole snapshot for the simulator, and the per-field merge into the table |
| `rng`, `sim` | seeded xorshift; latent-taste worlds with clusters, homophily, correlated attributes, order stamps and an agreement oracle |
| `attack` | sybil regions: `PromoteOnly`, `CopyConsensus`, `ManufactureContested`, `TagSpam`, wired as a clique, a chain or a star of chains |
| `data` | the string-id boundary form — directed `friendIds`, the `loaded` set, permissive rating values — and the JSON a world dump carries |
| `error` | `CoreError`: what the core refuses to answer |
| `wasm` | `computeUser` behind the `wasm` feature (below) |

Decisions worth knowing before reading the code:

- **Nothing iterates.** One pass for base rates, one max-product search for the chains (a link is
  learned only when it could beat what its far end already has), one pass for own history, one
  per attribute for `κ_a`, one for scores and one for certainty.
- **A region is one voice.** Everyone reached through one directly trusted person is averaged into
  that person's region, and nobody in it reads stronger than its head; later thumbs raise nobody
  past their own chain. That is the sybil bound of §2.5.
- **Exposure is structural.** A thumb given after the viewer's is a reaction with probability
  `1/(people v trusts)`; every thumb in a chain link is one with probability `1/(v's connections
  nearer the viewer)`.
- **Population statistics are the circle's.** Base rates, which attributes a thing carries, the
  fact reliability and the attributes' base rates count only the viewer and the people they trust
  directly, whom no account behind an accepted connection can be. `κ_a` and the base rate a thumb's
  evidence is judged against add the rater's own region, and reach only it. Chains reach only
  people the loader read who are connected to the viewer; an unloaded person is on the boundary.
- **Per attribute, the same caps.** A person's reliability on an attribute is centred on their
  reliability off it (worked out by the same capped rule) and capped the same way; someone whose
  every shared thing carries the attribute reads at their overall reliability and does not vote on
  `κ_a`.

## Parameters

`Params::default()` is the table of DESIGN §2.9:

| parameter | kind | value |
|---|---|---|
| `prior_agreement` (`a₀`) | **prior** mean of a trust connection's agreement rate `(1 + λ)/2` | 0.65 |
| `prior_strength` (`κ`) | **prior** strength, in things | 8 |
| `clip` (`L`) | **cap** on one thumb's log-likelihood ratio | 2 |

`N_max` is not in it: how many people to load is the loader's decision (DESIGN §3.4), and the
core computes over whatever snapshot it is handed.

`κ` and `a₀` are estimated from the population (§2.9): every recompute reports its `PairTallies` —
per pair the rate `(1 + λ̂)/2` its shared items imply under the channel, with a match's chance the
circle's base rate, and a weight that makes 0005's sampling term right for that rate — a scheduled
statement in the database pools them into `private.params`, and each field replaces the table's
value only once its own sample clears `N_min`. `a₀(2)` and `a₀(3+)` are still pooled
and are read by nothing: a chain replaces a prior by distance.

## Running it

```sh
cargo test --release                     # the whole suite
cargo test --release --features serde    # and the boundary's own deserializer
cargo clippy --all-targets -- -D warnings
cargo fmt --check

cargo run --release --features serde --example dump-world -- --seed 7 --out world.json
cargo run --release --features serde --example compute-user -- world.json u3
cargo run --release --features serde --example recompute-cost   # docs/algorithm-notes.md §8
```

The examples that read or write JSON need the `serde` feature, which is off by default so that
`cargo test` builds the core with no dependencies at all.

WebAssembly, from the repo root:

```sh
bash scripts/build-wasm.sh nodejs   # rust/core-wasm/, for the smoke script
node rust/examples/smoke.mjs
bash scripts/build-wasm.sh web      # into supabase/functions/refresh-recs/
```

## The WebAssembly boundary

- `computeUser(snapshot, viewer, params, priors)` — `snapshot` is the loader's own form:
  `users`, directed `friendIds`, the `loaded` set and `ratings`; `params` a partial table or
  `null`; `priors` the `private.params` row or `null`. Returns
  `{ viewer, reached, boundaryNodes: { id, strength }[], pairs, scores }`, each score
  `{ score, confidence }` with `confidence` the certainty `W`. A rating value of `2` or `-2` is the
  same thumb given after the viewer's own. It throws on a parameter out of range, an unknown viewer
  or a non-finite result; nothing a rated account can write reaches that.

## What the tests assert

Each `witness` module has its own unit tests: the channel's arithmetic (the grid, chance
weighting, a certain reaction teaching nothing, flipping, the clip, `ρ` a chance); base rates with
the pair left out, chains multiplying along the strongest path, an unloaded or unconnected person
unreached, predictions raising someone to the head and copies not past their chain; a thing's
attributes by majority, a friend read per kind, a copier on one attribute held at their chain; one
friend's thumb by hand, a region as one voice, a split at the middle with some certainty; facts, taggers behind
one friend as one voice, a linked pair filling a gap; the boundary and the tallies.

`tests/mechanics.rs` — the three-user graph by hand (the wasm smoke script checks the same
number), every rated thing shown and nothing unreached, an empty answer for nobody to hear, a
contested friend triangle bounded, determinism and `compute_all`, what the data boundary drops, and
the boundary a partly loaded neighbourhood reports.

`tests/witness_sybil.rs` — DESIGN §2.5's bound as a property, over every plan (promote only, copy
the viewer, copy the viewer while tagging, copy the crowd, manufacture contested, tag spam, copy
this model's feed, copy it half inverted), every shape of `attack.rs`, one to two hundred accounts,
behind one to three of the viewer's connections:
every bot is in the region of the head its path passes, none reads above its head, copying the
viewer raises none past its own chain, the bots move any thing by at most `2L + ln 2` per accepted
connection, a gatekeeper moves only through their later thumbs (bit for bit what the same number of
connections to accounts that rate nothing gives), and nothing in front of a gatekeeper two steps
out moves.

`tests/witness_properties.rs` — a sane, deterministic answer and relabelling invariance on every
graph up to six nodes; chains never exceed their weakest link; a link that predicts nothing cuts off
everyone behind it who has no history of their own; a viewer with no thumbs gets a score for every
thing anyone reached rated; per-attribute reliability is the overall one when kinds do not matter,
and is capped as the overall one is; one co-tag moves a pair's odds by at most the factor
`docs/witness-model.md` §1.6 proves; no snapshot gives a non-finite result, and no score reaches
either end.

`tests/priors.rs` — `a₀(d)` and `κ` read back off a population against its true `(1 + λ)/2`,
including one with things everyone likes, where the plain share of matches is 0.22 too high, a
class below `N_min` keeps the table, one world gives one estimate, and the pooled tallies land
where the whole-snapshot estimate does.
