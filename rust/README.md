# grapevine-core

The recommendation algorithm of [DESIGN.md](../DESIGN.md) §2, as pure functions over an
in-memory snapshot, plus the synthetic-world simulator and the property suite that pins the
algorithm's claims down. No I/O, no database, no async. Built to WebAssembly by
`scripts/build-wasm.sh`, for the two Edge Functions (`web` target) and for
`rust/examples/smoke.mjs` (`nodejs`).

```rust
let result = compute_user(&snapshot, viewer, &Params::default())?;
// result.scores: ratable -> (score, confidence), everything with W ≥ W_min
// result.truncation: what the walk left unresolved, over the loaded nodes
// result.boundary_residual, result.boundary_nodes: what the unread nodes would have sent on
// result.settle_movement, result.passes, result.settled: where the settling loop stopped
// result.reach, result.reach_masses, result.work, result.pairs
```

Every entry point returns a `Result`. The error cases are a snapshot whose walk produced a
non-finite mass, a parameter table outside the ranges of §2.8, an unknown viewer, and a rescore
handed a mass vector of the wrong length — never a rating anyone can write: values that are not
`1`/`-1` and keys whose halves are not usable ids are *dropped* at the boundary, because refusing
them would let one crafted account fail the recompute of every viewer within reach of it.

## Layout

| module | what it is |
|---|---|
| `ids` | `UserId`, `ItemId`, `TagId`, `Ratable` (an item, or an item–tag pair), the id check |
| `snapshot` | the friend graph and everyone's ratings, names interned to integers; a user may be *unloaded* |
| `graph` | the `Graph` trait (adjacency may be missing, as it is for an unloaded user), BFS hop distances |
| `params` | the table of DESIGN §2.8: `Params::default()` on demand, `Params::deep()` for taste search |
| `walk` | the non-backtracking push of §2.4: `π̃`, truncation, boundary residual and the nodes holding it; `Budget` is the `E_max` it spends |
| `informativeness` | `ω` per item (§2.2), the viewer's own vote included at `π̃ = 1` |
| `alignment` | `A`, `D`, `â`, `ℓ` over item ratables (§2.3) |
| `score` | `E`, `W`, `s` for items and tags (§2.6) |
| `compute` | the settling loop: `compute_user`, `compute_user_detail`, `compute_all`, and `rescore_user` over cached masses |
| `suggest` | taste search (§5): the same computation at the deep budget, and the candidate filters |
| `priors` | `κ` and `a₀(d)` by method of moments (§2.10): the per-recompute `PairTallies` the database pools, the same estimate over a whole snapshot for the simulator, and the per-field merge into the table |
| `rng`, `sim` | seeded xorshift; latent-taste worlds with clusters, homophily and an agreement oracle |
| `attack` | sybil regions: `PromoteOnly`, `CopyConsensus`, `ManufactureContested`, `MimicFeed`, `TagSpam`, wired as a clique, a chain or a star of chains |
| `data` | the string-id boundary form — directed `friendIds`, the `loaded` set, permissive rating values — and the JSON a world dump carries |
| `error` | `CoreError`: what the core refuses to answer |
| `wasm` | `computeUser`, `rescoreUser` and `suggestFor` behind the `wasm` feature (below) |

Decisions worth knowing before reading the code:

- **Affinity reallocates flow; it never creates any.** At node `v` entered from `w`, a share
  `1 − α` of what arrived goes on, split over `v`'s neighbours other than `w` and the viewer in
  proportion to `aff_u(y) = exp(max(ℓ_{u,y}, 0))`, and the rest stops. So the mass beyond one
  friend is at most one friend-unit on **every** graph, and no cycle can amplify itself.
- **The push drains a node, not an edge.** The system lives on directed edges — a residual on
  `(w → v)` may not go back to `w` — but expanding `v` passes on everything waiting there at
  once: what leaves along `(v → x)` is `(1 − α)·aff(x)·Σ_{w ≠ x} r(w → v)/(S_v − aff(w))`, one sum
  over the arrivals less the one from `x`. An expansion costs `deg(v)` pushes and a sweep of the
  neighbourhood one push per directed edge, where an edge-at-a-time push pays
  `Σ_v deg(v)·(deg(v) − 1)`. The order is largest residual first to within a factor of two — a
  bucket per binary exponent, first come first served inside one — so the walk is a function of
  the snapshot alone.
- **The settling loop, not a fixed number of passes.** The first walk runs with every alignment
  at its prior, so the masses depend on the graph alone. Each pass after it recomputes `ω`, the
  alignments and the scores from the masses it has, and walks again **starting from the
  previous pass's masses**: the residual it starts from is `e + T·a₀ − a₀` under the new split,
  signed, and the truncation is `Σ|r|·(1 − α)/α` either way. The loop stops when no score moved
  by more than `SETTLE_TOLERANCE`, at `SETTLE_MAX_PASSES`, or when the budget cannot pay for
  another pass. A pass is started only if what is left covers what the last one cost, and a
  pass the budget cuts short anyway is thrown away, so the answer is always the last complete
  pass.
- **Accuracy is relative to the loaded neighbourhood.** `truncation` counts only residual on
  loaded nodes, and it is what is held to `ε_total`. Mass that reaches a node whose friend list
  was never read is counted as visit mass there and reported as `boundary_residual`, apart from
  the truncation and not counted against `ε_total`: the loader reads more while `N_max` has room,
  and past that it is influence from beyond the nearest `N_max` people that the answer leaves
  out (DESIGN §3.4).
- **The viewer is removed from every transition row and the row is renormalized.** §2.4 says the
  walk continues to a neighbour `y ∉ {w, u}` in proportion to affinity, so the viewer's share is
  never handed out rather than handed out and dropped.
- **Distances are a separate BFS** and feed only `a₀(d)` in the alignment; the walk decides for
  itself how far to go.

## Parameters

`Params::default()` is the shipped table of DESIGN §2.8. Every constant in it is one of five
kinds, and the kind is what says how to argue about changing it:

| parameter | kind | value |
|---|---|---|
| `decay` (`α`) | **derived** — ½ is the rate that makes "everything beyond a friend ≤ that friend" exact | 0.5 |
| affinity `exp(max(ℓ, 0))` | **derived** — the odds that a neighbour shares the viewer's taste; no constant of its own | — |
| `alignment_clamp` (`L`) | **cap** on one account's evidence, and so on the affinity at `e^L ≈ 7.39` | 2 |
| `prior_friend`, `prior_friend_of_friend`, `prior_distant` (`a₀(d)`) | **priors** on agreement at hop 1 / 2 / further | 0.65 / 0.55 / 0.50 |
| `alignment_pseudocount` (`κ`) | **prior** strength: how much evidence it takes to override `a₀` | 8 |
| `score_shrinkage` (`κ_s`) | **prior** strength on the score: one friend-unit of nothing | 1 |
| `min_weight` (`W_min`) | **product threshold**: less support than this is not shown | 0.5 |
| `error_budget` (`ε_total`) | **budget** on the walk's error, friend-units | 0.02 / 0.001 deep |
| `node_budget` (`N_max`) | **budget** on how many nodes a walk expands | 2 000 / 50 000 deep |
| `edge_budget` (`E_max`) | **CPU ceiling** on the edge pushes one whole computation may spend | 10 000 000, both |
| `settle_tolerance` | **budget**: the loop has settled once no score moves by more than this | 1e-4 |
| `settle_max_passes` | **budget**: a hard stop on passes after the first | 12 |

`κ` and `a₀(d)` are estimated from the population (§2.10): every recompute reports its
`PairTallies`, a scheduled statement in the database pools them into `private.params`, and each
field replaces the table's value only once its own sample clears `N_min`.

`E_max` is not a work estimate. `Budget::for_snapshot` reserves what a whole loop over the loaded
neighbourhood can cost — for the graph-only pass and each of `SETTLE_MAX_PASSES` more, one deposit
per friend and one sweep more than a cold walk needs to shrink `F` friend-units below `ε_total` —
and takes the smaller of that and `E_max`. `E_max` is the pushes that fit in 0.3 s of
WebAssembly, measured at about 30 ns a push (`docs/algorithm-notes.md` §8), and no neighbourhood
measured comes near it: the worst converged loop over 2 000 people at 50 friends each spends
2.5 million.

`ω` is unsmoothed and carries its own support: `ω = 4·n⁺·n⁻/(n·(n+1))`, the even-split factor
times `n/(n+1)`, and `0` where nothing in reach has rated the item. An item with no dissenter in
the viewer's reach is worth exactly zero, which is what makes copying consensus worthless
rather than merely cheap. The viewer's own thumb is one of the votes, at `π̃_u(u) = 1`.

Tag votes carry no alignment at all: a tag asks whether a place is cheap, not whether two people
share taste, so `E` and `W` weight them by reach mass alone.

## Running it

```sh
cargo test --release                     # the whole suite, about 10 s on a quiet machine
cargo test --release --features serde    # and the boundary's own deserializer
cargo clippy --all-targets -- -D warnings
cargo fmt --check

cargo run --release --features serde --example dump-world -- --seed 7 --out world.json
cargo run --release --features serde --example compute-user -- world.json u3
cargo run --release --example fixed-point -- --seed 7           # docs/algorithm-notes.md §3
cargo run --release --features serde --example recompute-cost   # §8
cargo run --release --features serde --example suggest-cost     # §9
cargo run --release --example spread                            # §5
```

The examples that read or write JSON need the `serde` feature, which is off by default so that
`cargo test` builds the core with no dependencies at all.

WebAssembly, from the repo root:

```sh
bash scripts/build-wasm.sh nodejs   # rust/core-wasm/, for the smoke script
node rust/examples/smoke.mjs
bash scripts/build-wasm.sh web      # a copy in each Edge Function's directory
```

## The WebAssembly boundary

- `computeUser(snapshot, viewer, params, priors)` — `snapshot` is the loader's own form:
  `users`, directed `friendIds`, the `loaded` set and `ratings`; `params` a partial table or
  `null`; `priors` the `private.params` row or `null`. Returns `viewer`, `reach`, `reachMasses`,
  `truncation`, `boundaryResidual`, `boundaryNodes`, `settleMovement`, `passes`, `settled`,
  `pairs` and `scores`. It throws on a parameter out of range, an unknown viewer, or a result
  whose reported error is not a finite number; nothing a rated account can write reaches that.
  A large truncation is not refused — the caller reads it and decides.
- `rescoreUser(snapshot, viewer, reach, walk, params, priors)` — the same result from masses a
  previous `computeUser` produced, with no walk: `reach` is its `reachMasses`, and `walk` is
  `{ truncation, boundaryResidual, settleMovement, passes, settled }` from the same result,
  carried through unchanged because it bounds the error in exactly those masses.
- `suggestFor(snapshot, viewer, discoverable, dismissed, params, priors)` — taste search over the
  caller's neighbourhood: `discoverable` and `dismissed` are uid lists, `params` is
  `{ deep, live }` (`null` for the deep budget paired with the on-demand one). Returns at most
  five `{ uid, strength, overlap }`, strongest first. Only the uid and the order are for a
  viewer; `strength` and `overlap` are there for the checks.

## What the property tests assert

`src/walk.rs` (unit) — a lone friend keeps one unit; the walk does not step back; no affinity
makes a friend triangle diverge; an affinity of zero, below zero or not finite is refused; a
300-clique stops on a small budget with its truncation above `ε_total` and resolves in a few
sweeps given room; one converged walk fits in a pass of the reservation; one budget is shared
across calls; a warm start reaches the cold answer for fewer pushes; the pop order is fixed by
the graph; an unloaded node's mass is reported rather than swallowed.

`tests/mechanics.rs` — the arithmetic, on graphs small enough to check by hand.

- `hand_computed_three_user_graph` — two friends thumbing one item up: `W = 2·logit(0.65)`,
  `s = 0.5531881`. The wasm smoke script checks the same number.
- `informativeness_is_zero_on_unanimity` — `ω` on even and uneven splits, zero on unanimity, a
  single rating and no ratings; the viewer's own dissent is what makes a ten-up item contested.
- `alignment_shrinks_toward_the_prior` — `â` and `ℓ` from the shrinkage formula at hop 1 and
  hop 2; a hundred agreeing *tag* ratings move neither.
- `walk_mechanics` — injection, `‖β^{(f)}‖₁ ≤ 1`, non-backtracking on a path, the absorbing
  viewer on a triangle, affinity steering by `e^L/(e^L + 9)`, and conservation on a tree: what
  leaves a node, which is what its children hold, is `1 − α` of what reached it whatever the
  split.
- `walk_equals_the_exact_resolvent` — the push reproduces `e_uᵀ(I − (1−α)B_u)^{-1}` to 1e-8
  against a dense Gaussian solve built in the test, under a uniform and a skewed affinity.
- `walk_error_bound` — reported truncation bounds the distance to the converged walk, for
  `π̃` and for every score, at three budgets and under a starved node budget; and the same graph
  gives the same walk and the same settling loop.
- `a_friend_triangle_stays_bounded_and_settles` — a K4 of mutual friends: every friend at most
  two units, the reach at most `|F_u|/α`, and the loop settles.
- `the_data_boundary_drops_what_it_cannot_read` — malformed values and keys drop out and the
  rest computes; every parameter out of range is refused.
- `partial_graph_reports_its_boundary` — an unloaded node is a boundary and not a leaf, its
  residual is reported with its id and apart from the truncation, reading it moves the frontier
  one hop out, and an id only one side lists is not an edge.
- `sign_symmetry`, `determinism_and_degenerate_inputs`.

`tests/enumeration.rs` — every reciprocal graph up to six nodes: an answer inside its bounds, the
push within the reported truncation of the resolvent, and relabelling leaves the answer alone.

`tests/settling.rs` — the loop settles on random worlds and under the copying attack, its
movements shrinking over every two passes; a loop squeezed by the budget keeps its last complete
pass and says `settled: false`; reaching the pass cap is reported and not an error; the bar's
step is the larger of the two errors; the budget is read off the graph; every viewer of 120- and
300-person worlds at 9–14 friends meets `ε_total` on the product path; rescoring cached masses is
the same answer to the bit, and a mass vector of the wrong length is refused.

`tests/sybil.rs` — the mass bound over three shapes, four sizes and both budgets, three
gatekeepers, a captured gatekeeper and the feedback shape `h – b₁ – b₂ – h`, each to within the
reported truncation; the 500-clique behind one gatekeeper is bounded and resolves; consensus
copying earns nothing.

`tests/discovery.rs` — the walk follows aligned paths four hops out where the uniform pass does
not, and nothing surfaces on one stranger.

`tests/suggest.rs` — taste search on six identical lanes: five aligned people fill the list;
friends, the already influential, the private and the dismissed are excluded; a consensus-copying
farm and edgeless sybils change nothing; a region behind one edge takes at most one slot and the
honest field keeps the rest; the answer is deterministic.

`tests/priors.rs` — `a₀(d)` and `κ` read back off a population against what generated it, a
class below `N_min` keeps the table, one world gives one estimate, and the pooled tallies land
where the whole-snapshot estimate does.

`tests/incentives.rs` — honest reporting beats withholding, randomizing and lying, on average
and per state.
