# grapevine-core

The algorithm of [DESIGN.md](../DESIGN.md) §2 as pure functions over an in-memory snapshot, plus
the synthetic-world simulator. No I/O, no database, no async. Built to WebAssembly by
`scripts/build-wasm.sh`, for the browser (`web` target) and for `rust/examples/smoke.mjs`
(`nodejs`).

```rust
let result = compute_user_tensor(&snapshot, viewer)?;
// result.scores: ratable -> Score { score, confidence, applies } for every thing an
//                account the viewer follows said anything about, and every attribute one of
//                them put on a thing
```

One viewer's list is what the accounts they follow say of each thing — the mean of their thumbs
under a uniform prior — plus the viewer's row of a rank-3 decomposition of how everybody's thumbs
depart from it. `tensor::decompose` is the same computation under other `Options` (a seed, a
tolerance), returning a `Fit`: the result, a `Plot` (a point per thing and per attribute), the
squared error the fit ended at and the number of sweeps.

Every entry point returns a `Result`. The error cases (`CoreError`) are an unknown viewer and a
fit, a score or an error that is not finite — never a rating anyone can write: values that are not
`1` or `-1` and keys whose halves are not usable ids are *dropped* at the boundary, because
refusing them would let one crafted account fail the list of everyone who follows it.

## Layout

| module | what it is |
|---|---|
| `ids` | `UserId`, `ItemId`, `TagId`, `Ratable` (a thing, or a thing–tag pair), the id check |
| `snapshot` | who follows whom and everyone's thumbs, names interned to integers |
| `data` | the boundary form: string ids, plain maps, sanitizing |
| `score` | `Score`, one ratable's result, and `UserResult`, one viewer's |
| `tensor` | the model: the followed accounts' mean, the decomposition (generic in its rank), the scores and the plot |
| `layout` | t-SNE: a plot's points placed in the plane, for the map |
| `error` | `CoreError` |
| `sim`, `rng` | simulated worlds with a ground truth |
| `wasm` | `computeUserTensor` at rank 1 to 6 (`{ viewer, scores, plot }`) and `layOut`, behind the `wasm` feature |

## Running

```sh
cargo test --release                    # the unit tests in each module
cargo test --release --features serde   # and the boundary's own deserializer
cargo clippy --all-targets -- -D warnings
cargo run --release --example cost      # one viewer's list, timed; --follows --items --own --each --tags --runs
cargo run --release --features serde --example dump-world -- --out /tmp/world.json
```

`cargo test` builds the core with no dependencies: `serde` sits behind a feature and the wasm
bindings behind another.
