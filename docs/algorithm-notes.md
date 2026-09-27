# Algorithm notes: what is derived, what is measured, what is chosen

The evidence behind DESIGN §2's claims, measured on the **built** core. `docs/witness-model.md`
holds the proofs and the prototype's measurements, which is where every design choice was made;
this file is what the core in `rust/src/witness/` does on the same worlds, against the model before
the relay and the relay, on the prototype's seeds, worlds, viewers and attack plans. It is notes,
not a specification: DESIGN is the source of truth for what is built.

The prototype, the relay and the model before it, and the comparison harness that measured the
built core in §1 and §3–§8, are code the repository does not keep; the numbers stay as
measured. §8's recompute cost is still reproducible:

    cargo run --release --features serde --example recompute-cost -- --seed 7

## 1. The built core against the prototype

The prototype breaks a claim of DESIGN §2 in five places, which the property suites
(`tests/witness_sybil.rs`, `tests/witness_properties.rs`) catch. The core departs from it in each,
so no number below is the prototype's unless it says so:

1. **Population statistics over everyone reached.** Read over every loaded person connected to the
   viewer, base rates, which attributes a thing carries, `κ_a` and the fact reliability let a
   swarm behind one connection move other regions' evidence, the links of chains and the heads'
   own reliabilities, none of which the bound counts: two hundred accounts that copy the model's
   feed and half invert it move one thing by 7.16 of log-odds behind one connection, against the
   bound's 4.69. Counting each region as one voice in those statistics still moves it 4.86,
   because the one voice reaches everyone else's base rates. The core reads them over the
   **circle** (the viewer and the people they trust directly), which nothing behind an accepted
   connection can be in; `κ_a`, and the base rate a thumb's evidence is judged against, add the
   rater's own region and reach only it (`docs/witness-model.md` §1.4). Over all 720 attacks of
   the sweep, every thing moves within the bound.
2. **Per-attribute reliability capped only at the head** lets copies of the viewer on things
   carrying an attribute raise a copier to the head through it (`+0.24` mean, `+0.58` worst, on
   the promoted thing). The core takes both caps of the overall rule; the attack is §6's "copy the
   viewer, tagging".
3. **"A gatekeeper stays between their later thumbs discounted and counted in full"** is false by
   `5 × 10⁻⁴`: the posterior mean is not monotone in exposure once two later thumbs are discounted
   (`docs/witness-model.md` §1.4, step 3, with a worked counterexample). The claim, and its test,
   is that exposure is the only way in: the gatekeeper's reliability equals, bit for bit, what the
   same number of connections to accounts that rate nothing gives.
4. **Sixteen grid points cannot hold a sharp prior**: at `κ_a = 1 024` the prior is a quarter of a
   grid step wide. Under such a prior the posterior is integrated over a window at the prior's own
   scale (`docs/witness-model.md` §1.8); the prior's mean is reproduced to `10⁻⁴`. Wherever the
   posterior can be anywhere it is the measured 16-point grid.
5. **`tanh` reaches exactly `±1`** (thirty agreeing voices near the clip). Scores are clamped to
   `±(1 − 2⁻⁵²)`.

Every sum runs in a fixed order, so a snapshot's result is bit-identical run to run.

The prototype with per-attribute reliability on, against the core,
over the fifteen worlds of §3, two category worlds and three attacked worlds, therefore showed the
departures, not rounding: single scores differed by up to 1.9 on the `(−1, 1)` scale and certainties
by up to 0.38, and the per-world AUCs by −0.052 to +0.026 (the prototype ahead on spread, the
category worlds and the attacked ones; the core ahead on mixed and sparse).

`κ_a` is chosen from `{1, 2, 4, …, 1024}`, eleven values; the prototype's grid has no 512.

## 2. Which parts are forced

| mechanism | status | why |
|---|---|---|
| the witness channel and chance weighting (§2.2) | **derived** | the likelihood ratio of one thumb under "knows or guesses from the base rate" (`docs/witness-model.md` §1.1) |
| a chain is the product of its links (§2.4) | **derived** | the channel composed; a chain is never more reliable than its weakest link (§1.2) |
| the posterior mean of `λ` (§2.3) | **forced by the loss** | a weight is judged by squared error |
| a region as one voice (§2.4) | **the one axiom** | the logarithmic pool is the exact posterior under full dependence (§1.3) |
| exposure `1/(people v trusts)`, `1/(connections nearer the viewer)` | **chosen, measured** | structural; each alternative measured let one attack through (`docs/witness-model.md` §2.6) |
| the caps on own history | **chosen, measured** | as above |
| `κ`, `a₀` | **estimated** | moments of the population's `(1 + λ̂)/2`, chance taken out (§2.9); the table is the fallback |
| `κ_a`, the share of linked pairs, the fact reliability | **learned per recompute** | type-II likelihood, empirical Bayes, the agreement rate |
| population statistics over the circle; a region's own for its `κ_a` and its evidence's base rate | **forced by the bound** | the circle is the largest population no set of accounts behind an accepted connection can be in (`docs/witness-model.md` §1.4) |
| `L = 2`, a 16-point grid | **chosen** | Huber's clip at `ε = 0.24`; 64 points measured no different; a sharp prior gets a window at its own scale |

## 3. Accuracy — measured

Held-out AUC of the score against the noiseless preference over the items the viewer did not rate
(a missing score is zero); three seeds; every thirtieth viewer:

| world | before the relay | relay | witness |
|---|---|---|---|
| mixed: 80 people, 140 items, friends almost regardless of taste | 0.710 | 0.781 | **0.836** |
| spread: 120 people, 240 items, 20 unanimous items | **0.827** | 0.826 | 0.819 |
| sparse: 200 people, 600 items, 5% rated | 0.585 | 0.677 | **0.721** |
| high-rank: taste in 30 dimensions | **0.528** | 0.526 | **0.528** |
| realistic: 600 people grown with homophily and triadic closure, 1 500 items | 0.518 | 0.568 | **0.580** |

Against the prototype's 0.826 / 0.830 / 0.692 / 0.529 / 0.578: `+0.010`, `−0.011`, `+0.029`,
`−0.001`, `+0.002`. The circle's base rates are a smaller sample than everyone reached's; the one world that
loses is the spread world, where twenty things everyone likes are much of what a base rate has to
say. With the
circle alone for evidence as well, it is 0.843 / 0.791 / 0.731 / 0.528 / 0.582, at the attack cost
§6 gives.

The model before the relay is scored on what it showed (its floor hid the rest); on the
cold-start sample, every twentieth viewer, it was 0.701 / 0.848 / 0.569 / 0.533 / 0.517. People
reached with a chain below 0.02: 44% / 3% / 29% / 33% / 8%.

The **realistic** world stands in for a dump of the real graph, which does not exist yet: people
join one at a time and befriend others mostly in their own of eight Zipf-sized taste groups, in
proportion to how many friends those already have, then friends of those friends — mean 11
friends, median 7, clustering 0.12; activity log-normal around 25 ratings (up to 400); items rated
in proportion to a Zipf popularity. Its AUCs are low because most people rate few things from a
long catalog.

**Cold start** (every twentieth viewer; AUC, and the share of held-out things
with a score): with no thumbs, 0.671 / 0.829 / 0.696 / 0.520 / 0.554, a score on every thing,
against the relay's 0.673 / 0.814 / 0.658 / 0.520 / 0.548 with a score on 96 / 100 / 85 / 100 /
78%, and the prototype's 0.636 / 0.813 / 0.664 / 0.517 / 0.547. With only thumbs on things no friend
rated, 0.769 / 0.838 / 0.700 / 0.520 / 0.569 against the relay's 0.701 / 0.820 / 0.664 / 0.520 /
0.560. With all thumbs on the same sample, 0.834 / 0.817 / 0.701 / 0.536 / 0.576.

**Certainty**: the share of held-out things whose side of the middle
is the viewer's, from the lowest populated fifth of `W/(1 + W)` to the highest: 71% → 93%
(mixed), 64% → 78% (spread), 60% → 83% (sparse), 50% → 53% (high-rank), 53% → 66% (realistic).
Expected calibration error of the score read as a chance: 0.090 / 0.021 / 0.014 / 0.098 / 0.105,
against the prototype's 0.110 / 0.039 / 0.017 / 0.075 / 0.073: better where anything can be learned,
bolder where little can.

## 4. Kinds of thing — measured, and smaller than the prototype's

A world where each person's taste in each of three categories is their home group's with
probability `p`, with three category attributes and three quality attributes that carry no taste
(three seeds, every fifth viewer). "One reliability" is the same model on
the same world with every attribute thumb removed:

| `p` | relay | witness, one reliability | witness, per attribute | `κ_a` chosen: categories / qualities |
|---|---|---|---|---|
| 1.0 | 0.826 | **0.846** | 0.843 | 30 / 39 |
| 0.6 | 0.766 | 0.807 | **0.809** | 20 / 42 |
| 0.3 | 0.725 | 0.781 | **0.783** | 21 / 45 |

(`κ_a` is chosen per region; the last column is the geometric mean over regions.) The prototype
measured per-attribute reliability at 0.858 / 0.844 / 0.822 — a gain of 0.014 to 0.039 over one
reliability. **The built core gains −0.003 to +0.002.** Most of the prototype's gain came from
letting people beyond a direct connection rise to the head on the strength of thumbs given after the
viewer's, which is the variant DESIGN §2.4 rejected overall (§1, item 2). Choosing `κ_a` over the
circle alone, the population no swarm can reach, costs accuracy on every world (−0.005 to −0.007); per
region over the circle and the region, the gain is about nothing either way. It still tells
categories from qualities, choosing `κ_a` about twice as large for the qualities.

## 5. Attributes that go together — measured

12 attributes along 3 hidden properties, 80 people, three seeds, every eighth viewer; and the same
world with every attribute independent. A gap is a `(thing, attribute)`
nobody the viewer's chains reach tagged (for the relay, nobody at all):

| model | linked: gaps filled, right | independent: filled, right | pairs used per viewer | used pairs one added co-tag changes |
|---|---|---|---|---|
| relay | 660, 78.0% | 770, 51.4% | — | — |
| witness | 372, 86.3% | 0 | 7.3 / 0 | 0.030 / 0 |

Within a few gaps of the prototype's 364, 86.5%, 7.2, 0.023: the chains that weight the co-taggers
learn against the circle's base rates. **A filled gap's certainty** barely tells right from wrong —
`W/(1 + W)` averages 0.336 on the fills that were right and 0.308 on those that were wrong.

## 6. Attacks — measured

**Behind the viewer's own connections** (240 people in three taste
groups, every 24th viewer with at least three connections, three seeds; twenty bots in a clique
behind each of the first `k` connections, promoting one new thing; the thing's mean score for the
viewer, worst in brackets):

| the bots first | `k` = 1 | 2 | 3 |
|---|---|---|---|
| do nothing | +0.09 (0.23) / relay +0.06 | +0.17 (0.26) / +0.11 | +0.27 (0.40) / +0.16 |
| copy the viewer | +0.09 (0.23) / +0.37 | +0.17 (0.26) / +0.55 | +0.27 (0.40) / +0.66 |
| copy the viewer, tagging ¹ | +0.09 (0.21) / +0.37 | +0.18 (0.33) / +0.55 | +0.26 (0.40) / +0.66 |
| copy the crowd | +0.09 (0.23) / +0.19 | +0.17 (0.26) / +0.30 | +0.27 (0.40) / +0.39 |
| manufacture contested | +0.09 (0.23) / +0.17 | +0.17 (0.26) / +0.29 | +0.27 (0.40) / +0.37 |
| copy their own feed | +0.09 (0.23) / +0.13 | +0.17 (0.26) / +0.23 | +0.27 (0.40) / +0.31 |

¹ The bots also tag every other thing they copy, and the promoted thing, with the
attribute most often tagged on the viewer's things, on the same world with 30% of thumbs tagged. It
aims at per-attribute reliability, where there are fewer copies to match; under the prototype's cap
it reaches `+0.24` (worst `+0.58`) behind one connection. The bots' tags decide nothing about what
kind a thing is (the circle does), and their per-attribute reliability takes both caps.

Every plan gives the witness model the same number: whatever the bots do first, they read at their
chain and their thumbs on the promoted thing are judged against their own region's consensus. Against
the prototype's `+0.07 / +0.14 / +0.21` (worst `0.39`) the built core concedes `+0.02` to `+0.06`,
the price of a bound that holds. Judging the bots' thumbs against the circle alone, where nobody has rated the
promoted thing, gives `+0.13 / +0.24 / +0.37` (worst `0.55`); against the circle and the thumb's own
region, a swarm agreeing with itself is no surprise to itself. Chains and stars of bots move the
witness numbers down by a few hundredths. The worst single viewer under any plan, shape and `k`:
`+0.40`, against the relay's `+0.69`.

**The paid promotion** (three people accept forty bots each; everyone by steps from whoever accepted, 9 / 96 / 423 / 192 people at 0 / 1 / 2 / 3+; how many see the thing
lean past a tenth of the bar, and the mean score among them):

| plan | before the relay | relay | witness |
|---|---|---|---|
| promote only | 9 · 0 · 0 · 0 | 9 · 1 · 0 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| copy the crowd | 9 · 10 (+0.37) · 0 · 0 | 9 · 93 (+0.20) · 1 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| manufacture contested | 9 · 7 (+0.41) · 0 · 0 | 9 · 87 (+0.19) · 4 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| tag spam | 9 · 0 · 0 · 0 | 9 · 1 · 0 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| copy the relay's feed | 9 · 45 (+0.42) · 0 · 0 | 9 · 74 (+0.20) · 2 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| copy the witness feed | 9 · 35 (+0.41) · 0 · 0 | 9 · 69 (+0.18) · 3 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |
| copy it, half invert | 9 · 48 (+0.18) · 0 · 0 | 7 · 0 · 0 · 0 | 9 · 51 (+0.13) · 27 (+0.12) · 1 |

The prototype had 29 / 6 / 0 one and two steps out for most plans and 69 / 88 / 5 for the half-inverting
bots; the built core is the same for every plan, more people one and two steps out for the plain
ones and far fewer for the half-inverting ones, every lean faint.

On the realistic graph (two seeds, 2 / 46 / 244 / 108 people), the witness
model leans the thing for 37 of 46 one step out at `+0.14`, and for 2 of 244 two steps out, under
every plan; the relay for 5–34 of 46 at `+0.11`–`+0.25` and up to 5 of 244.

**The accepted copier** (one account a victim accepted, whose only connection is the victim, copies every one of the victim's thumbs — necessarily later — then
promotes one item; thirty victims of the spread world, 322 of their friends):

| model | the victim's score for the item | the victim's friends it leans for |
|---|---|---|
| before the relay | +0.67 | 0 of 322 |
| relay | +0.51 | 4 of 322 |
| witness | **+0.41** | **181 of 322** |

For the victim the copies teach nothing (exposure one), so the copier is a connection at the prior
and its lone thumb scores what a fresh friend's does. For the victim's friends it is a lone rater
two steps out at the victim's reliability times a link at its prior, alone in the victim's region
on the thing, so it speaks for that region — the "one bot" case of `docs/witness-model.md` §2.9,
faint (past `+0.1` for 181 people, against 139 with base rates over everyone reached) and inside
the bound. It is the price of not diluting a lone
rater by the size of their region.

## 7. Incentives — measured

DESIGN §2.7's average case (60 targets of the mixed world): held-out AUC
when the target reports honestly / withholds half / randomizes half / inverts a quarter, and for
how many targets any misreport did better than the truth:

| model | honest | withheld | randomized | inverted | a lie won for |
|---|---|---|---|---|---|
| before the relay | 0.737 | 0.721 | 0.656 | 0.653 | 21 |
| relay | 0.789 | 0.761 | 0.725 | 0.730 | 9 |
| witness | **0.828** | 0.799 | 0.776 | 0.772 | 14 |

Honesty is best on average under every model. Per target, a misreport beat the truth for 14 of 60
under the witness model against 9 under the relay: on average and not per state, which is all
§2.7 claims.

## 8. What one recompute costs — measured

Milliseconds per viewer over a whole 2 000-person neighbourhood, 40 viewers of each world, median
(worst); natively, and the same binary built for `wasm32-wasip1` and run under Node 22:

| world | before the relay | relay | witness | witness, prototype | witness in wasm | relay in wasm |
|---|---|---|---|---|---|---|
| ~13 friends, 300 items, 15% rated | 16 (20) | 46 (57) | **28 (31)** | 30 (32) | **35 (49)** | 69 (142) |
| ~13 friends, 2 000 items, 5% rated | 44 (57) | 50 (57) | **43 (77)** | 48 (53) | **51 (56)** | 71 (82) |
| ~50 friends, 2 000 items, 5% rated | 63 (99) | 52 (61) | **109 (112)** | 116 (121) | **134 (138)** | 75 (89) |
| realistic, 3 000 items | 16 (24) | 24 (87) | **18 (24)** | 22 (26) | **23 (30)** | 35 (138) |

The prototype's wasm medians were 39 / 59 / 141 / 28. At or under the prototype at the median
everywhere (one viewer of the second world took 77 ms natively), and, at the four calls a recompute may make (the loader's three extra rounds), well inside a free
invocation's roughly two seconds. The cost is the chain links — one posterior per trust
connection explored — so it grows with friends per person. `recompute-cost` over its default
spread-out world (150 people, 500 items, 45% rated): 6.1–6.3 ms at the median
over three seeds, 6.7–8.8 at the worst.

## 9. Why there is no learned edge trust, and what the order bit is instead

A learned per-edge trust `θ`, fitted by descent on a loss over the viewer's own thumbs, is the
obvious extension and is deliberately not built. Its loss `L(θ)` is convex in the
scores, but the scores are a nonlinear function of `θ` through every chain, so **convexity in `θ` is
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

**What it would carry.** Blaming the edge into a bot rather than the friend who accepted it. The
witness model does that without a fitted weight: the link into a swarm is learned from the swarm's
thumbs against its gatekeeper's, at exposure one, where a copy teaches nothing, so the link stays
at its prior and everything behind it is capped at the head. If it ever
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

**What the order bit does that edge trust was for.** Resnick & Sami's limiter rewards a source
for predicting a thumb the viewer gave *later*. DESIGN §2.3 uses exactly that asymmetry without a
learned per-edge parameter: a thumb given before the viewer's is a prediction and counts in full;
one given after is, with probability equal to the source's exposure, a reaction that says nothing;
and only predictions may raise a person past their own chain (§2.4).

## 10. Two things the practice literature says that are not in DESIGN

**Every bound must be stated over pre-attack reach.** Ruderman's critique of Advogato: Levien's
proof bounded trust by the *final* capacities of the confused nodes, which let an attacker gain
trust proportional to the **square** of the attack's cost. The relay's bound has that shape — a
gatekeeper's visit mass includes what a region's loops send back to it. DESIGN §2.5's
bound does not: a head's reliability is learned from the head's own thumbs against the viewer's,
which nothing in the region rates as, and `tests/witness_sybil.rs` checks the bound under every
plan.

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

## 11. Not built: one joint model over every ratable

A Gaussian over all of a viewer's ratables, with
a covariance learned from the reach at the relay walk's masses, on top of the relay's evidence:
rank 0 is the relay's scoring exactly; at rank 8 it moved held-out AUC by −0.014 to +0.003, and by
−0.025 to +0.010 over ranks 2–32; the same covariance over everyone at equal weight gained +0.005 to
+0.060 (a global, per-account aggregate, ruled out); bots splitting on the promoted item took the
first ring from 56 to 79 of 96 at `+0.91`; and its error could move a shown mean by 2–17 times what
a single score's error could. Its code is not kept.
