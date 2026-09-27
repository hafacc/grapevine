# The witness model: proofs and experiments

The appendix to DESIGN §2. DESIGN says what the model is and why; this file holds the arguments
behind its claims and the numbers behind its choices. The experiments of §2 ran on a prototype, and
compare it against the relay and the model before it; all three were measured on code the repository
does not keep. The built core, `rust/src/witness/`, departs from the prototype where the
property tests found the prototype wrong: population statistics over the circle (§1.4), `κ_a` per
region and the caps on per-attribute reliability (§1.7), and the numerics of §1.8. Its own
measurements are `docs/algorithm-notes.md`'s.

## 1. Proofs

Notation as in DESIGN §2: `u` the viewer, `t(x)` the viewer's answer on `x`, `λ ∈ (−1, 1)` a signed
reliability, `b` a base rate, `L` the clip.

### 1.1 Chance weighting and flipping follow from the channel

The channel is `P(v says + | t) = |λ|·[sign(λ)·t = +] + (1 − |λ|)·b`. For `λ ≥ 0` the likelihood ratio
of an up is `(λ + (1 − λ)b)/((1 − λ)b) = 1 + λ/((1 − λ)b)`, decreasing in `b`: as `b → 1` it tends to
`1/(1 − λ) > 1` — weakly informative, never one — and the ratio of a down, `(1 − λ)(1 − b)/(λ + (1 −
λ)(1 − b))`, tends to zero: a thumb against the grain is decisive. For `λ < 0` the two indicators swap,
so an up is evidence for down with the same magnitudes: flipping. Both ratios are increasing in `|λ|`
at fixed `b`, which §1.3 uses. ∎

### 1.2 A chain is never more reliable than its weakest link

Let `w` know `u`'s answer with probability `|λ|` (reversed if `λ < 0`) and otherwise guess from `b`,
and let `v` know `w`'s answer the same way with `μ`. Then `v`'s thumb is `sign(λμ)·t` with
probability `|λ||μ|`: `v` must know `w`'s answer and `w` must know `u`'s. In every other case `v`'s
thumb is a guess — `v`'s own, or `w`'s guess passed on — independent of `t`. So `v` is a
knows-or-guesses witness of `t` with reliability `λμ`, and by induction a chain's reliability is the
product along it, with `|λ_chain| ≤ min` of its links. The guessing distribution is `b` exactly when
`μ ≥ 0` or `b = ½`; otherwise it is a mixture of `b` and `1 − b`, a second-order difference the
prototype ignores. Equivalently, `u → w → v` is a Markov chain and the data-processing inequality gives
`I(t; v) ≤ I(t; w)`. ∎

### 1.3 A region counts as one voice

A region's evidence on `x` is `E = Σᵢ wᵢ ℓᵢ / Σᵢ wᵢ` over its members who rated `x`, with `wᵢ ≥ 0`
and `ℓᵢ` each member's clipped log-likelihood ratio. So `min ℓᵢ ≤ E ≤ max ℓᵢ`, and `|E| ≤ L`.

*As probability.* If the members are one source reported `k` times (Clemen & Winkler's correlation
`ρ = 1`), every member carries the same evidence, the Bayesian posterior uses it once, and the average
is that evidence exactly. When members disagree they cannot all be copies of one source, and the
weighted average of log-likelihood ratios is the logarithmic pool, the one pooling rule that commutes
with Bayesian updating (Genest & Zidek 1986). The average is exact under the worst dependence and the
principled pool otherwise; it never adds.

### 1.4 The bot bound

**Setting.** Chains run along trust connections (demonstrated-agreement links are not built; if they
were, only between people already in the same region, and every step below would stand). Let `S` be
accounts every trust path from `u` to which passes through `h ∉ S`, and `f` the head of `h`'s region
(`f = h` if `u` trusts `h` directly). The **circle** is `u` and the people `u` trusts directly.

0. *Nothing in `S` is in the circle, and no chain to anyone outside `S` passes through `S`.* A person
   `u` trusts directly has a path to `u` of one step, which does not pass `h` unless they are `h`,
   and `h ∉ S`. If a simple path from `u` to `v ∉ S` entered `S`, it would have to leave `S` again to
   reach `v`; but a neighbour `n ∉ S` of `S` is `h` itself (some path from `u` to `n` avoids `h`, or `n`
   would be in `S`, and that path extended by one step into `S` passes `h`, so `n = h`), and the path
   passed `h` on the way in.
1. *Every member of `S` is in `f`'s region.* The strongest chain to `s ∈ S` is a trust path from `u`,
   so it passes `h`; its value is the product of a prefix ending at `h` and a suffix after it, and
   maximizing the product maximizes the prefix independently, so the prefix is `h`'s own strongest
   chain (ties broken the same way), whose head is `f`.
2. *Every member of `S` reads at most `|λ_f|`.* A member with no history of their own reads at their
   chain, `λ_f` times factors of magnitude below one; a member with history reads at the larger of their
   earlier-thumb posterior capped at `|λ_f|` and their all-thumb posterior capped at their own chain,
   both at most `|λ_f|`; and so does their reliability on every attribute (DESIGN §2.8).
3. *Nothing about anyone outside `S` depends on `S`'s thumbs.* Every population statistic a
   reliability is learned with — the base rates of items, which attributes a thing carries, the fact
   reliability and the attributes' base rates — is read over the circle, which by 0 holds nobody in
   `S`. A direct connection's reliability is learned from their thumbs against `u`'s at those base
   rates; a chain link, from two people outside `S` (by 0) at the same base rates; so every chain,
   region and reliability of anyone outside `S` is as it was. Two quantities are read over the
   circle *and one region*, so that `S` reaches only its own: `κ_a` for the region's members, and the
   base rate a region's thumbs are judged against (step 4). **One caveat, stated rather than hidden**:
   a directly trusted person's exposure is `1/(number of people they trust)`, so bots who connect to
   `f` raise `f`'s count and make `f`'s own *later* thumbs count a little more. That is the only way
   `S` reaches `λ_f`: it equals what the same number of connections to accounts that rate nothing
   would give. It is **not** true that `λ_f` stays between its values with the later thumbs
   discounted as before and counted in full. Discounting
   `m` later thumbs multiplies the likelihood by `Πᵢ (c + Pᵢ(λ))`, `c = e/(2(1 − e))`, and the posterior
   mean is a ratio of two polynomials of degree `m` in `c`, monotone for `m = 1` (a weighted average of
   the prior mean and the one-thumb posterior mean, with weights `c` and `∫πP`) and not in general
   beyond. At `a₀ = 0.65`, `κ = 8` on the 16-point grid, with no other history, one later match on a
   thing with a base rate of 0.1 and one later mismatch on a thing with a base rate of 0.9 give
   `λ = 0.311` counted in full, `0.345` at `e = ½` (a person who trusts two people) and `0.360` at
   `e = ⅕` (the same person after three bots connect to them): outside the interval.
4. *`S`'s effect on `x`.* By 1, everything `S` says about `x` enters through `f`'s region's average,
   which by 1.3 lies in `[−L, L]` whatever `S` does; `S` can move it anywhere in that interval, and no
   further. A thumb's evidence is judged against the base rate over the circle and the thumb's own
   region, so `S`'s thumbs change the evidence of `f`'s region and nobody else's. By 2 and 1.1, a
   member's evidence is at most the ratio of one thumb at `|λ_f|` for the base rate, before the clip.
   An attribute's score has no starting point and is the same sum of region averages. A gap —
   `(thing, attribute)` nobody reached tagged — is filled from attribute pairs whose posteriors `S`'s
   co-tagging reaches, but a filled gap's whole score is one average of clipped ratios, in
   `[−L, L]` before and after, so it moves by at most `2L`.
5. *The starting point.* The viewer's prior on `x` is `logit` of `b = (1 + U)/(2 + V)`, where the region
   contributes `ω·q` to `U` and `ω` to `V`, `ω ≤ |λ_f| ≤ 1` its strongest rater's reliability and
   `q ∈ [0, 1]` its up-share. With the rest held fixed, `logit b` moves by at most
   `ln(1 + ω/(1 + U)) ≤ ln 2` up and `ln(1 + ω/(1 + V − U)) ≤ ln 2` down.
6. *Several accepted connections.* If every path to `S` passes one of `h₁ … h_k`, each member is in the
   region of the `hᵢ` its strongest chain passes (by 1, applied to that path), so `S` enters at most
   `k` regions: at most `k` voices. Step 0 holds for each `hᵢ`, so nothing outside those regions moves.
7. *What copying earns inside the region* (not needed for the bound, only for how much of it an attack
   reaches). A member of `S` reaches toward the viewer only through `h` or other members of `S`, so a
   link into it is learned at exposure one, where a thumb is as likely a reaction as not and carries
   nothing about the link: copying `h`, or copying a feed that is `h`'s circle, leaves the link at its
   prior. Copying the viewer is later than the viewer, so by 2 it raises nobody past their chain —
   except where the order is misread: it is taken against the viewer's *current* thumb, which moves
   when the viewer turns it over or clears and gives it again, and every thumb given in between then
   reads as earlier, copies included (DESIGN §2.3). Such a copy can raise its account to `|λ_f|`,
   which 2 already allows, so the bound is unchanged. The gap is kept on purpose: a permanent
   first-rated time would reward rating everything early, any way, just to be first, and keep that
   influence after a change of mind.

So a set of accounts reached through `k` accepted connections moves the viewer's log-odds on any one
thing by at most `k·(2L + ln 2)` — `2L` because it can swing a region's average from one end to the
other — and the number of accounts does not appear. It is per thing, not per feed. ∎

**Why the circle.** Read over everyone reached, as the prototype reads them, the population
statistics make `S`'s thumbs part of every other region's base rates, so they move other regions'
evidence, the chains' links and the heads' own reliabilities, none of which step 4 accounts for:
two hundred bots behind one connection move one thing by `7.16` of log-odds, against a bound of
`4.69`. Counting each region as one voice in those statistics is not enough — the one voice still
reaches everyone else's base rates — and moves a thing by `4.86`. The circle is the largest population no set `S` can be in
for every choice of `h`: anyone further out could be. It counts each region as one voice, its head's.

### 1.5 A viewer with no history gets a list

With no thumbs of the viewer's, every direct connection's posterior is its prior, `λ = 2a₀ − 1 = 0.3`
at the fallback table (`a₀ > ½` in any population where people connect to people like them). Links
are learned from the history between other people, which the viewer's lack of thumbs does not touch.
So every region is headed by a positive reliability, and every thing rated by someone whose chain is
non-zero has non-zero evidence (up to exact cancellation) and a positive starting-point weight: a
score. The same holds for a viewer whose thumbs are all on things nobody near them rated, since those
thumbs meet nobody's. ∎

### 1.6 One thumb and whether a pair is used

A pair is used when the posterior probability that it is linked exceeds one half. Its odds are
`π/(1 − π) × m₁/m₀`, the slab's marginal likelihood over the spike's, with `π` the share of linked pairs.
A region's reading is its co-taggers' counts averaged by weights summing to one. A new co-tag from
someone who already co-tagged the pair adds at most one reading of weight `≤ 1`, which multiplies `m₀`
by `P₀(r)^w` and `m₁` by `E[P_λ(r)^w]` under the slab's posterior. Since `P_λ(agree)/P₀(agree) ≤ 1/c` and
`P_λ(disagree)/P₀(disagree) ≤ 1/(1 − c)`, with `c` the chance that two such thumbs agree anyway, the odds
rise by at most `max(1/c, 1/(1 − c))`: at most doubling near an even split. Downward the factor is the
slab posterior's expectation of the same ratio, which is bounded away from zero unless that posterior
sits at `λ = −1` (resp. `+1`). A person co-tagging the pair for the first time joins their region's
average, and can at most pull that region's reading toward a single co-tag. `π` moves with every pair's
evidence and is re-estimated; one thumb moves it by at most one pair's change in posterior divided by
the number of pairs. ∎ (Sketch for the downward half.)

### 1.7 Per-attribute reliability reduces to the overall one when kinds don't matter

A person's reliability on things carrying `a` has a Beta prior centred on their reliability elsewhere
with strength `κ_a`. As `κ_a → ∞` the prior is a point mass and the topical reliability is the overall
one; the chosen `κ_a` maximizes the marginal likelihood of the history with the viewer on `a` of
everyone in the circle and in the person's own region, so it goes large exactly when that history is
explained as well without a separate reliability. Every topical reliability takes both caps of the
overall one — predictions up to the head, later thumbs up to the person's own chain — and a region's
`κ_a` is chosen from the circle and that region only, so §1.4 is unchanged. ∎

### 1.8 Numbers

*Scores stay inside `(−1, 1)`.* `tanh` rounds to exactly `±1` past about 19 of half-log-odds, which
thirty agreeing voices near the clip reach; the score is clamped to `±(1 − 2⁻⁵²)`, which moves
nothing any smaller evidence gives.

*A sharp prior is integrated at its own scale.* Sixteen midpoints over `(−1, 1)` are what every
measurement used, and are kept wherever the posterior can be anywhere. At `κ_a = 1 024` the prior's
spread is about 0.03, a quarter of one grid step, and the grid snaps it. When `2n/(κ + n)` (how far
`n` readings can move a Beta mean) plus eight of the prior's spreads `1/√(κ + n + 1)` either side of its
centre does not cover the whole range, the midpoint rule runs over that window at a quarter of a spread
per point, and the window doubles until the log-posterior at each inner edge is 30 below its peak. The
prior's mean is then reproduced to 10⁻⁴ (a unit test), against up to half a grid step on the grid
alone.

*Every sum is in a fixed order* (user, ratable, region or strength order, never a hash map's), so the
same snapshot gives bit-identical results.

## 2. Experiments

Worlds: **mixed** (80 people, 140 items, friends almost regardless of taste), **spread** (120, 240,
20 unanimous items), **sparse** (200, 600, 5% rated), **high-rank** (taste in 30 dimensions), all four
the simulator's (`sim.rs`), and **realistic** (600 people grown with homophily and triadic closure,
1 500 items, heavy-tailed activity); three seeds each. AUC is per viewer, of the
score against the noiseless preference over things the viewer did not rate, averaged. The prototype's
defaults are the design: own history raised to the head only by earlier thumbs and to the chain by
later ones; exposure `1/(people v trusts)` for the viewer's own history and `1/(connections nearer the
viewer)` for a chain link, with every shared thumb in a link treated as possibly seen; base rates over
the reached only; the starting point from each region's strongest rater; a 16-point grid; no agreement
links; one reliability per person unless "per attribute" is said. These are the prototype's numbers,
before the departures above.

### 2.1 Held-out accuracy, and the choices behind it

| variant | mixed | spread | sparse | high-rank | realistic |
|---|---|---|---|---|---|
| relay | 0.781 | 0.826 | 0.677 | 0.526 | 0.568 |
| **the design** | **0.826** | **0.830** | **0.692** | **0.529** | **0.578** |
| no chains | 0.659 | 0.729 | 0.583 | 0.515 | 0.518 |
| even start, no base-rate prior | 0.770 | 0.812 | 0.646 | 0.526 | 0.568 |
| own history capped at the whole chain | 0.728 | 0.783 | 0.682 | 0.519 | 0.558 |
| later thumbs up to the head | 0.847 | 0.843 | 0.700 | 0.536 | 0.591 |
| no cap at all | 0.848 | 0.847 | 0.700 | 0.536 | 0.591 |
| start from combined reliability, up to the head | 0.827 | 0.830 | 0.701 | 0.529 | 0.580 |
| agreement links inside a region | 0.831 | 0.830 | 0.694 | 0.529 | 0.579 |
| link exposure over all connections | 0.827 | 0.826 | 0.693 | 0.534 | 0.577 |
| exposure along the path | 0.827 | 0.826 | 0.694 | 0.534 | 0.577 |
| links with the order between the two people known | 0.822 | 0.831 | 0.694 | 0.529 | 0.577 |
| per attribute (these worlds carry no kinds) | 0.826 | 0.830 | 0.692 | 0.529 | 0.578 |

The model before the relay, from the cold-start rows: 0.701 / 0.848 / 0.569 / 0.533 / 0.517. People
reached with a chain below 0.02: 53% / 11% / 30% / 42% / 16%. The order between two people who are not
the viewer is worth nothing measurable, so the database is not asked for it.

### 2.2 Cold start

AUC, and in brackets the share of held-out things with any score.

| world | model | all thumbs | no thumbs | only unshared thumbs |
|---|---|---|---|---|
| mixed | relay | 0.775 (1.00) | 0.673 (0.96) | 0.701 (1.00) |
| | design | 0.824 (1.00) | 0.636 (1.00) | 0.744 (1.00) |
| spread | relay | 0.844 (1.00) | 0.814 (1.00) | 0.820 (1.00) |
| | design | 0.840 (1.00) | 0.813 (1.00) | 0.827 (1.00) |
| sparse | relay | 0.662 (1.00) | 0.658 (0.85) | 0.664 (1.00) |
| | design | 0.678 (1.00) | 0.664 (1.00) | 0.673 (1.00) |
| high-rank | relay | 0.536 (1.00) | 0.520 (1.00) | 0.520 (1.00) |
| | design | 0.541 (1.00) | 0.517 (1.00) | 0.517 (1.00) |
| realistic | relay | 0.567 (1.00) | 0.548 (0.78) | 0.560 (0.99) |
| | design | 0.576 (1.00) | 0.547 (1.00) | 0.565 (1.00) |

Starting from the voices' combined reliability, up to the head, gives 0.659 / 0.820 / 0.674 / 0.518 /
0.552 with no thumbs: most of the mixed world's gap, and the hole of §2.6's second-to-last rows.

### 2.3 Certainty and calibration

Held-out things with a score, by certainty `W/(1 + W)` in fifths, and the share whose side of the
middle is the viewer's:

| world | 0–0.2 | 0.2–0.4 | 0.4–0.6 | 0.6–0.8 | 0.8–1 |
|---|---|---|---|---|---|
| mixed | 72% (1 005) | 74% (3 057) | 78% (1 744) | 92% (89) | — |
| spread | — (3) | 71% (1 227) | 73% (3 797) | 81% (3 554) | — (4) |
| sparse | 62% (7 073) | 63% (17 876) | 66% (9 025) | 85% (221) | — |
| high-rank | 50% (194) | 51% (2 181) | 53% (6 340) | 56% (662) | — |
| realistic | 54% (13 072) | 54% (43 514) | 57% (25 103) | 58% (4 523) | 68% (337) |

The score read as a chance, binned by tenths: expected calibration error 0.110 / 0.039 / 0.017 / 0.075
/ 0.073. Mixed is too timid (things given 0.54 are liked 66% of the time), realistic and high-rank too
bold (0.84 is liked 67% and 54%).

### 2.4 Kinds of thing

A world (150 people, 300 items, 3 categories, 3 taste groups) where each person's taste group in each
category is their home group's with probability `p` and random otherwise; friends by home group; each
item carries its category as an attribute (tagged by 30% of raters) and three quality attributes that
carry no taste.

| `p` | relay | design | design, per attribute | `κ_a` chosen: categories / qualities |
|---|---|---|---|---|
| 1.0 | 0.826 | 0.844 | **0.858** | 22 / 31 |
| 0.6 | 0.766 | 0.809 | **0.844** | 13 / 28 |
| 0.3 | 0.725 | 0.783 | **0.822** | 14 / 31 |

### 2.5 Attribute pairs

12 attributes along 3 hidden properties, 80 people, three seeds, every eighth viewer; and the same world
with every attribute independent. Gaps are `(thing, attribute)` nobody in reach tagged.

| rule | linked: filled, right | independent: filled, right | pairs used per viewer | pairs one thumb flips |
|---|---|---|---|---|
| relay | 660, 78.0% | 770, 51.4% | — | — |
| every pair at its posterior | 702, 86.0% | 814, 54.9% | 66 / 66 | — |
| posterior size above 0.3 | 696, 86.6% | 452, 52.4% | 25 / 5 | 0.033 / 0.007 |
| **more likely linked than not** | **364, 86.5%** | **0** | **7 / 0** | **0.023 / 0** |

Normalizing a region by all its taggers rather than by the pair's co-taggers (which makes 1.6's bound
hold for every thumb) filled fewer gaps no better, so the pair's co-taggers it is.

### 2.6 Defences

Twenty bots in a clique behind one of the viewer's connections (240 people in three taste groups, every
24th viewer with at least three connections, three seeds), promoting one new thing after doing one
other thing; the thing's mean score for the viewer (worst in brackets), and held-out AUC averaged over
the five worlds:

| variant | nothing | copy viewer | copy crowd | manufacture contested | copy own feed | AUC |
|---|---|---|---|---|---|---|
| relay | +0.06 (0.08) | +0.37 (0.39) | +0.19 (0.30) | +0.17 (0.29) | +0.13 (0.29) | 0.676 ¹ |
| all five undone | +0.32 (0.44) | +0.41 (0.70) | +0.42 (0.56) | +0.59 (0.77) | +0.40 (0.62) | 0.717 |
| **the design** | **+0.07 (0.21)** | **+0.05 (0.19)** | **+0.07 (0.21)** | **+0.07 (0.21)** | **+0.06 (0.19)** | **0.699** |
| … later thumbs to the head | +0.07 (0.21) | +0.18 (0.64) | +0.19 (0.44) | +0.18 (0.37) | +0.16 (0.52) | 0.712 |
| … link exposure over all connections | +0.07 (0.21) | +0.05 (0.40) | +0.08 (0.32) | +0.07 (0.24) | +0.17 (0.58) | 0.700 |
| … base rates over everyone | +0.07 (0.21) | +0.05 (0.19) | +0.07 (0.21) | +0.15 (0.25) | +0.06 (0.19) | 0.699 |
| … start from combined reliability, up to one | +0.32 (0.44) | +0.29 (0.43) | +0.32 (0.44) | +0.32 (0.44) | +0.30 (0.43) | 0.705 |
| … start from combined reliability, up to the head | +0.13 (0.36) | +0.10 (0.34) | +0.13 (0.36) | +0.13 (0.36) | +0.11 (0.34) | 0.702 |

¹ The relay's average of §2.1; the other AUCs here are over every thirtieth viewer, a slightly different
sample, where the design's §2.1 average is 0.691.

"All five undone" is the design with later thumbs raised to the head, link exposure over all
connections, base rates over everyone, the start from combined reliability up to one, and the order
between two people known. Each defence is there because removing it lets one attack through. On the
realistic graph, starting from the raters' combined reliability lets a swarm of weak bots claim a
whole voice: 243 of 244 people two steps out lean a promoted thing.

### 2.7 Behind one, two, three accepted connections

The same world and viewers; twenty bots behind each of the first `k` of the viewer's connections. Mean
promoted score, relay then design (worst in brackets), clique shape:

| bots first | `k` = 1 | 2 | 3 |
|---|---|---|---|
| nothing | +0.06 / +0.07 (0.21) | +0.11 / +0.14 (0.24) | +0.16 / +0.21 (0.39) |
| copy viewer | +0.37 / +0.05 (0.19) | +0.55 / +0.08 (0.18) | +0.66 / +0.11 (0.27) |
| copy crowd | +0.19 / +0.07 (0.21) | +0.30 / +0.14 (0.24) | +0.39 / +0.21 (0.39) |
| manufacture contested | +0.17 / +0.07 (0.21) | +0.29 / +0.14 (0.24) | +0.37 / +0.21 (0.38) |
| copy own feed | +0.13 / +0.06 (0.19) | +0.24 / +0.10 (0.21) | +0.32 / +0.16 (0.31) |

Chains and stars of bots move the design's numbers by at most a few hundredths either way (the file's
full output lists them).

### 2.8 The paid promotion

Three people accept groups of forty bots in a clique, which follow a plan and promote one thing; every
person, by steps from whoever accepted: how many see the thing lean past a tenth of the bar, and the
mean score among them. 240 people in three groups (9 / 96 / 423 / 192 people at 0 / 1 / 2 / 3+ steps),
three seeds:

| plan | model | 0 | 1 | 2 | 3+ |
|---|---|---|---|---|---|
| promote only | pre-relay | 9 +0.98 | 0 | 0 | 0 |
| | relay | 9 +0.96 | 1 +0.14 | 0 | 0 |
| | design | 9 +1.00 | 29 +0.13 | 6 +0.12 | 0 |
| copy the crowd | pre-relay | 9 +0.98 | 10 +0.37 | 0 | 0 |
| | relay | 9 +0.95 | 93 +0.20 | 1 +0.11 | 0 |
| | design | 9 +1.00 | 32 +0.13 | 8 +0.12 | 0 |
| manufacture contested | pre-relay | 9 +0.97 | 7 +0.41 | 0 | 0 |
| | relay | 9 +0.94 | 87 +0.19 | 4 +0.12 | 0 |
| | design | 9 +1.00 | 28 +0.13 | 7 +0.12 | 0 |
| copy the relay's feed | pre-relay | 9 +0.99 | 45 +0.42 | 0 | 0 |
| | relay | 9 +0.98 | 74 +0.20 | 2 +0.11 | 0 |
| | design | 9 +1.00 | 17 +0.13 | 4 +0.11 | 0 |
| copy this model's feed | pre-relay | 9 +0.99 | 43 +0.40 | 0 | 0 |
| | relay | 9 +0.98 | 63 +0.19 | 1 +0.12 | 0 |
| | design | 9 +1.00 | 19 +0.13 | 4 +0.12 | 0 |
| copy this model's feed, half invert | pre-relay | 9 +0.38 | 49 +0.18 | 0 | 0 |
| | relay | 8 +0.51 | 0 | 0 | 0 |
| | design | 8 +0.83 | 69 +0.14 | 88 +0.12 | 5 +0.13 |

Tag spam matches promote only. On the realistic graph (two seeds; 2 / 46 / 244 / 108 people), the design
leans the thing for 34–35 of 46 one step out at `+0.13`–`+0.14` under every plan and for at most 4 of
244 two steps out; the relay for 5–34 of 46 at `+0.11`–`+0.25` and up to 5 of 244; the half-inverting
bots reach 35 of 46 and 4 of 244 under the design, none under the relay. The design leans a promoted
thing for more people one step out than the relay when the bots only promote, and much further when
half of them invert what they copied — faintly (`+0.12` to `+0.14`) and inside the bound.

### 2.9 One bot, and the lone rater

A single bot behind a friend, promoting only: `+0.10` on average (worst `+0.23`), against the relay's
`+0.01`. It is the model's honest estimate of an unknown person the friend trusts: its reliability is
the friend's times a link at its prior, and alone on the thing it speaks for its region. The only ways
to make it smaller are to dilute a lone rater by the size of their region — which is what the relay does,
and what makes an honest friend-of-a-friend's lone recommendation invisible too — or to lower the link
prior below the population's, which the population would then contradict. Neither is principled, so
it stays: faint, bounded, and the same for a real person as for a bot.

### 2.10 Cost

Milliseconds per viewer over a whole 2 000-person neighbourhood, 40 viewers, median (worst):

| world | relay native | design native | relay wasm | design wasm |
|---|---|---|---|---|
| ~13 friends, 300 items, 15% rated | 48 (56) | 30 (32) | 73 (87) | 39 (54) |
| ~13 friends, 2 000 items, 5% rated | 53 (60) | 48 (53) | 79 (90) | 59 (67) |
| ~50 friends, 2 000 items, 5% rated | 57 (65) | 116 (121) | 84 (98) | 141 (149) |
| realistic, 3 000 items | 26 (94) | 22 (26) | 37 (147) | 28 (33) |

Per-attribute reliability costs nothing measurable here; agreement links cost two to three times the
whole. The design's cost is the chain links, one posterior per trust connection explored, and it grows
with friends per person; a 16-point grid measured no different from 64 and halves it.
