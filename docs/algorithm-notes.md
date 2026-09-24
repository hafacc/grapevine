# Algorithm notes: what is derived, what is measured, what is chosen

The evidence behind DESIGN §2's claims: which parts of the algorithm are forced, which are
measured, and which are chosen. It is notes, not a specification: DESIGN is the source of truth
for what is built.

Four runnable experiments back everything here:

    cargo run --release --example fixed-point -- --seed 7 --passes 8
    cargo run --release --example spread -- --seed 7 --requests 3 --bots 10 --users 240
    cargo run --release --features serde --example recompute-cost -- --seed 7
    cargo run --release --features serde --example suggest-cost -- --seed 7

All four need nothing but a Rust toolchain, so every claim here can be re-checked after a
change.

## 1. Which parts are forced

| mechanism | status | why |
|---|---|---|
| log-odds weighting of a person's thumbs (§2.3) | **forced** | Under conditional independence and a uniform prior, the error-minimising aggregation of binary votes weights each voter by `log(p/(1−p))`; by Neyman–Pearson it *is* the log-likelihood ratio, so every other weighting is strictly dominated. Nitzan & Paroush, *Int. Econ. Rev.* 23(2), 1982. Same object as I. J. Good's weight of evidence. |
| informativeness `ω = 4p(1−p)` (§2.2) | **forced up to an estimand choice** | This is Fisher information under the two-parameter item-response model, `a²·P(1−P)`, with every discrimination at 1. Birnbaum 1968; Lord 1980. **Open**: multiply by the variance if the estimand is a latent alignment parameter, *divide* by it — as GLS and Cohen's κ do — if it is a mean. Settleable by writing the likelihood down, not by argument. |
| the `n/(n+1)` support factor | **chosen, and it stays chosen** | The exact Beta(1,1) posterior `p̂(1−p̂)·(n+2)/(n+3)` with `p̂ = (k+1)/(n+2)` would delete the invented constant, and is deliberately not used: it reads `≈ 4/n` on a unanimous item where this form reads exactly **zero**, and that zero is §2.1's whole defence against an account that copies consensus. A tidier closed form is not an improvement when the untidy form's discontinuity is the property being relied on. |
| the affinity split (§2.4) | **forced given a constraint** | `split ∝ exp(β·alignment)` is the unique maximiser of `H(q) + β·E_q[alignment]` over the simplex — strictly concave, hence unique — so `β` is a multiplier on a constraint, not a tuned knob. Gibbs; axiomatically, Shore & Johnson, *IEEE IT* 26(1), 1980. Honest caveat: this relocates the arbitrariness into choosing the constraint level. |
| mass conservation and the sybil bound (§2.4) | **forced, and the best available** | You cannot have *zero* sybil gain: strong transitive trust + independence of disconnected agents + anonymity + misreport-proofness together imply beneficial sybil attacks exist (Seuken & Parkes, AAMAS 2014). "Bounded, not prevented" is the theorem, not a hedge. The closest thing to a characterisation of which flow rules admit the bound is Levien's *bottleneck property* — "a trust metric must dilute the trust accorded to the successors of `t` as more successors are added" — which is mass conservation, and which he states plainly is a conjecture with no proof. |
| `κ = 8` | **chosen, and load-bearing for a second reason** | §2.8 justifies it by how fast a stranger's alignment should rise. It is also what makes the whole computation settle — see §3. |
| learned edge trust (§2.5) | **ad hoc — not built** | See §4. |

## 2. Two costs of the design, and what the literature says about them

**The stronger sybil guarantee is for a different object.** Under personalized *hitting
probability* — did the walk ever reach you — the optimal sybil strategy is provably *no sybils at
all* (Hopcroft & Sheldon, WAW 2007). Grapevine measures accumulated visit mass, a resolvent,
which counts revisits; for that family one sybil with a two-loop strictly pays (Liu, Parkes &
Seuken, AAMAS 2016, Thm 1). **So DESIGN claims a bound, not immunity.** Non-backtracking
removes the two-loop specifically — a bot cannot bounce straight back along the edge it arrived
by — so the cheapest cycle attack becomes a triangle, two sybils instead of one, and no further.
There is **no literature at all** at the intersection of non-backtracking walks and sybil
resistance, so nothing here is borrowed.

**The incentive property we have is the one that is available.** Personalized PageRank fails
strong incentive compatibility for *any* damping factor, and satisfies self-confidence only when
the damping factor is strictly greater than ½ — ours is exactly ½ (Altman & Tennenholtz, IJCAI
2007, Prop. 15). Their Cor. 21 is the reason not to chase it: self-confidence + transitivity +
ranked IIA + strong incentive compatibility together collapse any personalized ranking system to
*rank by hop distance and nothing else*, which is why §2.7 cites the impossibility rather than
chasing the property.

Non-backtracking's real job is that ordinary eigenvector centrality localizes onto hubs and
non-backtracking does not, because it removes the hub↔neighbour reflection (Martin, Zhang & Newman, *PRE* 90, 052808). In a friend graph with one
500-friend account that is the difference between a working feed and a feed about the hub.

## 3. The circular definition settles — measured

Flow decides who is in reach, reach decides what is contested, contested decides alignment,
alignment decides flow. DESIGN resolves this by iterating to a fixed point, which assumes one
exists and is reached.

`fixed-point.rs` iterates the map and reports how far the score vector moves each pass.

**It contracts, hard.** Measured on the node push with warm-started passes (below). Per-pass movement of the worst single score falls by a factor of 0.032–0.039 at the first step
and 0.055–0.14 at the second, across seeds 1/3/7/11/23 and `p_same_cluster` from 0.05 to 0.6.
Past that the movement is around 5e-5 and the ratio is noise — 0.2 to 1.4 between single passes
— because each pass is a walk stopped at its own truncation and started from the one before, so
a pass can land a rounding of that size further off than the last. Over two passes it always
shrinks. Every viewer of every one of those worlds reaches the tolerance 1e-4: four passes the
median, six the most any viewer took.

**The dense worlds settle too.** At `p_same_cluster = 0.6` — 120 people, 72 friends each — every
viewer settles in at most four passes, on 52 000 to 60 000 edge pushes each. The 200-bot mimic
clique behind one of user 0's friends settles for all 320 viewers, eight passes the most any of
them took; the bots hold 1.025 friend-units against the 1.114 their gatekeeper holds. A 500-bot
clique behind one gatekeeper (`tests/sybil.rs`, the dense-clique test) resolves too: truncation 0.0041, five
passes, settled, 1.75 million pushes against an `E_max` of ten million.

**Two passes sits 0.006–0.012 from the fixed point** on the worst single ratable across the same
worlds, inside §2.9's truncation bound of `ε·L/(1+W) ≤ 0.04`. DESIGN §1 quantizes the bar to
`max(truncation·L, settle_movement)`: every viewer measured settles, but a loop the budget stops
reports the movement it stopped at, and the bar has to draw that case too.

**What a sweep costs, and why the push drains a node.** The system lives on directed edges — mass
that arrived at `v` from `w` may not go back to `w`. Pushing one residual on `(w → v)` at a time
deposits along every edge out of `v` but the one it arrived by, so a sweep costs
`Σ_v deg(v)·(deg(v) − 1)`, about the mean degree times the edge count. Expanding a node instead,
what leaves along `(v → x)` is `(1 − α)·aff(x)·Σ_{w ≠ x} r(w → v)/(S_v − aff(w))`, one sum over
the arrivals less the one from `x`, so an expansion costs `deg(v)` and a sweep one push per
directed edge. Both solve the same equation under the same stop rule and truncation bound, and
agree to within the walk's own error — section 8 has both. Each settling pass after the first starts
from the previous pass's masses, with residual `e + T·a₀ − a₀` under the new split. That residual
can be negative, so the truncation is `Σ|r|·(1 − α)/α`, and the masses can sit on either side of
the converged ones by at most that much in total. On the simulator's worlds the warm start cuts the loop's
pushes by a quarter at ten friends and by half at fifty.

**Do not trim the neighbourhood to fit a budget.** `Budget::for_snapshot` reserves, for the
graph-only pass and each of `SETTLE_MAX_PASSES` more, one deposit per friend and one sweep more than a cold walk
needs to shrink `F` friend-units below `ε_total`; on the 80-person world `tests/settling.rs`
reads it off, every viewer's converged loop spends under a quarter of it. `E_max` is a CPU
ceiling on top of that (section 8), which no measured neighbourhood reaches. Unloading the
furthest nodes until a whole loop's reservation fits a flat `E_max` kept 72 to 104 of the nodes of
every viewer on 120- and 300-person worlds at 9–14 friends, left a boundary residual of 0.5 to 4.8
against an `ε_total` of 0.02, and so wrote no feed for anyone with a hundred people in reach.

**Why it contracts, and what that says about `κ`.** Alignment is `(κ·a₀ + A)/(κ + A + D)`, so a
change in the masses moves `A` and `D` and is divided by `κ + A + D`. A large `κ` means alignment
barely responds to a change in flow, which is exactly what makes the composition a contraction.
There is a theorem for the general case — a kernel whose transition probabilities depend on the
law it produces has a unique invariant measure, reached geometrically, when its Lipschitz
constant in the measure is below its Dobrushin coefficient (Butkovsky, *Theory Probab. Appl.*
58(4), 2014, Thm 2.2) — and a walk with stop probability `α` supplies that coefficient for free
on every graph. Two obstructions worth not skipping: Butkovsky's Example 2.1 is a **two-state**
chain satisfying the Dobrushin condition alone that does *not* converge, so "the killing rate
makes it contract" is false on its own; and multilinear PageRank is unique for `α < 1/2` and
explicitly **non-unique for `α ≥ 1/2`** (Gleich, Lim & Yu, *SIMAX* 36(4), 2015). Ours is exactly
`1/2`. Different model, close enough that sitting on the boundary should be a decision.

**Concentration is bounded by this, not by taste.** Parameterising the split as
`exp(β·alignment)`, where `β = 1` is §2.4 and the best:worst neighbour ratio is `e^{2β}`:

| β | best : worst | contraction ratio | two-pass gap |
|---|---|---|---|
| 1 (shipped) | 7 : 1 | ~0.2 | 0.088 |
| 2 | 55 : 1 | 0.45 | — |
| 4 | 3 000 : 1 | 0.83 | — |
| 12 | 2.6e10 : 1 | **1.008 — never settles** | 0.827 |

So "put everything on one friend" is a ratio in the thousands, which is where the iteration needs
tens of passes, and past that there is no answer to converge to. **The clamp `L = 2` is the
stability limit**, and DESIGN justifies it only as "how much any one account's thumb can ever
count". Concentration does *not* help an attacker — with 200 mimic bots the bots' share drifts
slightly *down* as `β` rises (0.790 → 0.776 → 0.756 at β = 1, 2, 3) — so stability is the only
thing being traded. **The shipped table keeps 7:1.**

## 4. Why there is no learned edge trust

A learned per-edge trust `θ`, fitted by descent on a loss over the viewer's own thumbs, is the
obvious extension and is deliberately not built (DESIGN §2.5). Its loss `L(θ)` is convex in the
scores, but the scores are a resolvent of `θ`, so **convexity in `θ` is
unestablished**. Two hundred descent steps find a stationary point with no uniqueness claim, and
a starved budget finds wherever it stopped. The sharp counterpoint from the literature: spectral
initialisation plus *one* EM step is minimax optimal for the analogous rater-reliability problem
(Zhang, Chen, Zhou & Jordan, *JMLR* 17, 2016) — the initialiser is the whole problem and running
an optimiser to convergence is the part without a guarantee.

To be fair to fitting in general: a fit is principled when the model is identified and the
optimum provably unique — the Bradley–Terry MLE exists and is unique exactly when the comparison
digraph is strongly connected (Ford 1957; Hunter, *Ann. Statist.* 32(1), 2004). The objection is
not the act of optimising. It is that *this* objective is non-convex in its parameter, its loss
is unmotivated, and its regularisation weight, tolerance and step cap are three more chosen
constants in a section whose job is to remove chosen constants.

**What it would carry.** §2.1 requirement 3 — blame the edge into the bot, not the friend — and
nothing else supplies it. Alignment cannot: alignment rewards agreement and a mimic maximises
agreement. The requirement is dropped on the evidence in §5 below. If it ever
comes back, the shape is Resnick & Sami's **influence limiter** (RecSys 2007): each source carries
a reputation starting near zero, moves the prediction only in proportion to it, and gains or
loses when the viewer later rates the thing themselves. Six lines. Total damage from `n` sybils
is bounded **with no assumption about what fraction of raters are honest** (Thm 4); an honest
rater gives up `O(log n)` influence once and is unlimited after (Thm 7); honest reporting is
optimal because it is a proper scoring rule (Lemma 1). It needs the one input most recommenders
lack and grapevine has by construction — the viewer eventually rating the same item.

**And the warning that comes with it**: its bound covers *myopic* attackers only. The authors
explicitly exclude one who misleads other raters into amplifying her effect and later corrects.
Learned per-edge weights are the machinery that moves a system into that excluded case.

## 5. What the attack that scales actually achieves — measured

`spread.rs` runs the attack that pays for itself: a business wants one item in front of as many
people as possible. Each person who accepts a bot's friend request gets their own group of bots,
which read their own feeds to copy that person's taste and then promote a single item.

The headline result is in DESIGN §2.9a. The supporting sweeps:

- **Bots are free and worthless.** 30, 120 and 480 bots behind three accepted requests swayed the
  same **17** people out of 120 — identical — and the item's mean score fell slightly as the
  swarm grew.
- **Sway is linear in accepted requests**: 1 → 7 people, 3 → 17, 6 → 38, 12 → 66, out of 120.
  About six people per person duped.
- **Variety protects.** Three accepted requests, same botnet: a population with one taste group
  loses 35 people (29%), three groups 17 (14%), eight groups 11 (9%).
- **Effort scales with the target.** With friend counts held at nine: three requests reach 17 of
  120 people, 13 of 240, 11 of 480. Absolute reach per accepted request is roughly fixed, so
  holding a constant *share* of a growing network costs proportionally more real people saying
  yes.
- **Copying is the whole of the reach past the first person.** Same bots promoting without copying
  anyone: **zero** people beyond the ones who accepted, at every distance.
- **The ring table is seven seeds**, 240 people each: everyone who accepted is taken (100%, mean
  `+0.98`), 54% of their friends see it at `+0.49`, and then it falls off a cliff — 1.2% of the
  next ring and 0.2% beyond. An earlier single-seed run put the first ring at a quarter rather
  than a half; the seven-seed figure is the one to quote.

A correction worth keeping, because the clever version was wrong: the leak is stopped by
*dilution*, not by backfire. The mechanism where a thumbs-up from someone you reliably disagree
with reads as a warning does exist, but it fired for at most one person in 120 across every run.
What actually happens is that the item simply never reaches people outside the copied group.

## 6. On formalizing this

**Not in Lean.** Mathlib has Banach with explicit rates (`ContractingWith`,
`apriori_dist_iterate_fixedPoint_le`) and the exact truncation identity
(`NormedRing.inverse_one_sub_nth_order'`), which is most of what mass conservation and the error
bound need. It does **not** have Perron–Frobenius (mathlib's own registry marks it unformalized),
finite Markov chains, non-backtracking anything, or an ℓ1 induced matrix norm — and the mass
bound is a max-*column* sum while the available matrix norm is max-*row* sum. Calibration: the
first Perron–Frobenius in Lean 4 took three authors about 15 000 lines. The dominant cost would be
a definitional layer — edge space, the non-backtracking constraint — at one to three weeks before
anything is provable, and it would not touch the actual risk, which is the Rust implementing a
different operator than the prose describes.

**Exhaustive enumeration instead**: `rust/tests/enumeration.rs` takes every reciprocal graph up
to six nodes (156 unlabelled) and checks mass conservation, the error bound against the exact
resolvent solve, and every relabelling — which at that size is a proof and not a sample. It runs
in seconds.

## 7. Two things the practice literature says that are not in DESIGN

**Every bound must be stated over pre-attack reach.** Ruderman's critique of Advogato: Levien's
proof bounded trust by the *final* capacities of the confused nodes, which let an attacker gain
trust proportional to the **square** of the attack's cost. "Everything beyond one friend weighs at
most as much as that friend" has exactly that shape and must mean *that friend's reach before the
attack*. If the bots' presence raises the gatekeeper's own mass, the bound is circular. Checkable
in the simulator; not currently checked.

**The staleness window is load-bearing for privacy, not just for cost.** Passively diffing a
system's aggregates over time recovers individual contributions, and smaller datasets are
strictly *easier* (Calandrino et al., IEEE S&P 2011 — a third of one service's users' secret
answers with zero error). A viewer who polls their own feed and diffs it is running that attack
against a three-person aggregate. The ten-minute window, `computed_at` moving only when a reader
would see something new, and `feed_hash` suppressing no-op recomputes are documented as cost
savings, but they are load-bearing for §4 too: an optimisation that removes one widens what a
viewer can learn by diffing. Relatedly, differential privacy is
*provably* unavailable at these neighbourhood sizes: constant accuracy needs `ε ≥ (1−o(1))/α` for
a node of degree `α·log n` (Machanavajjhala, Korolova & Das Sarma, VLDB 2011), which is vacuous
at three friends. §4's "friction, not secrecy" is the only available framing, which is what it
already says.

## 8. What one recompute costs — measured

The tool is `rust/examples/recompute-cost.rs`:

    cargo run --release --features serde --example recompute-cost -- --seed 7

The world is the one the taste-search checks seed — 150 users, 500 items, 45% of the catalog rated,
`--p-same-cluster 0.035` — and every one of the 150 viewers is computed.

| seed | snapshot as json | ms, median / p90 / max | edge pushes, median / p90 / max |
|---|---|---|---|
| 7 | 320 450 B | 7.0 / 8.2 / 11.5 | 5 288 / 5 943 / 6 385 |
| 11 | 321 574 B | 7.1 / 8.2 / 9.6 | 5 251 / 5 797 / 6 428 |
| 23 | 320 270 B | 7.1 / 8.1 / 9.5 | 5 140 / 5 706 / 6 741 |

The **bytes** are the whole world, which at 150 users *is* the neighbourhood — a real
neighbourhood is capped at `N_max`, and this is the stand-in for what `private.neighbourhood`
returns. The **time** is one viewer on a quiet laptop, against an Edge Function metered on the
order of two seconds, and at 150 people scoring the settling passes is most of it: the walk is
the small part. The settling loop takes four passes on this world.

With a learned edge-trust fit (§4), on the edge-at-a-time push, the same command measured 36–41 ms at the median and 77–99 ms
at the worst, on 159 000–192 000 pushes at the median: its twenty to forty forward-and-reverse
walks were most of the cost.

**Where the node push matters is 2 000 people**, the `N_max` a neighbourhood is loaded to. The
edge-at-a-time push against the node push of section 3 on the same worlds (stochastic block
worlds, 300 items, 15% rated; one viewer per row for the edge push at 2 000 × 50, which takes a
minute), natively, per viewer:

| world | edge push, loop | node push, loop | edge push, walk | node push, walk | masses, max diff | scores, max diff |
|---|---|---|---|---|---|---|
| 300 × 10 friends | 35–97 ms | 3.2–6.6 ms | 8–17 ms | 0.2–0.3 ms | 2.9e-4 | 9.0e-4 |
| 1 000 × 10 | 192–249 ms | 8–12 ms | 37–50 ms | 0.7–0.9 ms | 7.6e-5 | 6.2e-4 |
| 1 000 × 20, ring lattice | 619–672 ms | 12 ms | 117–143 ms | 1.0–1.3 ms | 1.7e-4 | 7.3e-4 |
| 2 000 × 12 | 505–1 018 ms | 17–24 ms | 173–251 ms | 1.6–2.4 ms | 1.0e-4 | 6.2e-4 |
| 2 000 × 15 | 822–1 345 ms | 18–23 ms | 201–301 ms | 1.9–2.4 ms | 9.7e-5 | 6.1e-4 |
| 2 000 × 50 | 56 188 ms | 27 ms | 12 354 ms | 6.9 ms | 2.7e-5 | 1.1e-4 |

"Walk" is one cold walk at uniform affinity; "loop" is the whole computation. The masses and
scores agree to within what either walk leaves unresolved, and both settle in the same four or
five passes.

**`E_max` is a CPU ceiling, and this is how it is sized.** In WebAssembly under Node, the whole
`computeUser` — the snapshot crossing the boundary included — takes 71–84 ms at 2 000 × 12–15 and
112–136 ms at 2 000 × 50, deep budget included, of which 48–83 ms is the crossing and one pass of
scoring. The marginal cost of a push, from the same viewers at `ε_total` of 0.02 and 1e-6, is
7.7 ns natively and 11 ns in WebAssembly at 50 friends; at 12 friends a cold walk costs 18 ns a
push natively, per-node overhead included, and about 1.5 times that in WebAssembly. At 30 ns a
push, 0.3 s of CPU — what one of the up to four `computeUser` calls a feed refresh makes can
spend inside a two-second invocation — is ten million pushes, and `E_max` is 10 000 000 for both
tables. The worst converged loop measured spends 2.5 million (2 000 × 50, deep).

## 9. Whether one viewer's taste search fits on demand — measured

DESIGN §3.7 runs taste search on demand on the strength of this measurement. The tool is
`rust/examples/suggest-cost.rs`, over the same world as section 8:

    cargo run --release --features serde --example suggest-cost -- --seed 7

A search is **two walks, not one**. Section 5.1 ranks candidates by the deep walk
(`N_max = 50 000`, `ε_total = 0.001`) and then drops anyone whose weight under the **on-demand**
budget is already high, because somebody the live feed carries is not a suggestion. Both walks
run over the one neighbourhood that was read, so there is one read and two walks. Per viewer, over
150 viewers:

| seed | nodes loaded | neighbourhood as json | deep pushes, median / p90 / max | deep walk ms, median / p90 / max | on-demand walk ms | whole search ms, median / p90 / max |
|---|---|---|---|---|---|---|
| 7 | 147 | 315 435 B | 7 636 / 8 721 / 9 533 | 5.7 / 6.1 / 7.8 | 6.8 / 7.8 / 9.1 | 10.5 / 12.8 / 15.0 |
| 11 | 148 | 319 004 B | 7 588 / 8 735 / 9 263 | 5.8 / 6.0 / 8.0 | 6.8 / 7.8 / 9.5 | 10.5 / 12.7 / 15.0 |
| 23 | 149 | 319 570 B | 7 637 / 8 572 / 9 694 | 5.8 / 6.0 / 7.2 | 6.9 / 7.8 / 9.0 | 11.4 / 12.9 / 14.8 |

Reading the rows into the core costs another 6.0 ms at the median, which is the same crossing
section 8 says is the larger of the two costs for the feed. About 85 of the 150 viewers have
somebody to suggest.

**It fits, on CPU, with two orders of magnitude in hand.** Fifteen milliseconds at the worst case
against an Edge Function metered on the order of two seconds. The deep walk costs about 1.5 times
the on-demand one's pushes, which is what `ε_total` at `0.001` instead of `0.02` buys; its time is
no larger, because scoring the passes is most of either.

**The constraint is egress, not CPU, and it is linear in nodes loaded.** At 150 users the
neighbourhood *is* the connected component, so the deep search reads exactly what a feed refresh
reads — the same 320 KB — and adds no egress at all over the refresh that ran a minute earlier.
Five gigabytes a month is about 15 000 reads of that size; the feed already spends them, and the
people screen behind the same ten-minute rule spends far fewer.

**What this does not measure.** The deep budget allows `N_max = 50 000` and this world can supply
149, so the cap never binds and nothing here says what happens when it does. At 50 000 nodes the
same read is on the order of a hundred megabytes, which does not fit anything — so the number to
watch as the population grows is the **neighbourhood size**, not the walk. `E_max` bounds the
walk's CPU and not the query's bytes; if the deep search ever loads a neighbourhood much larger
than the feed's, its `N_max` has to come down to where the egress is affordable, and that is a
decision with a measurement behind it rather than a constant to raise.
