# grapevine — design

Recommendations through the grapevine. You rate things (and attributes of things) with a
thumbs up or down; you get back a personal ranking of things built from your own ratings and
the ratings of your extended friend network, weighted by how much each person's taste has
turned out to predict yours. Nothing is absolute: every user sees their own view of the world,
and nobody is ever shown who rated what.

This file is the source of truth for *what* is built and *why*. `CLAUDE.md` says how to run it
and check it.

## 1. Product

### Objects

- **Item** ("thing"): anything with a name. A restaurant, a movie, a book, a hiking trail, a
  brand of olive oil. An item **is** its name, normalized: lower case, NFKC, whitespace runs
  collapsed to one space, trimmed. `"Café Bleu"`, `"café bleu"` and `"CAFÉ  Bleu"` are one
  item, and that item is `café bleu` — the accent and the space are part of the id, not folded
  out of it. Duplicates cannot be created, only found. Items are a shared catalog: anyone
  signed in can create one and anyone can see that it exists. Creation is not attributed in the
  UI.

  **There is no separate display name.** The id is the text, and the text is what every screen
  shows. What that gives up is the creator's capitalisation — whoever adds it typing
  `"Café Bleu"` gets `café bleu` back — and giving it up is the point: everything user-facing
  is lower case anyway (§1 "The one view"), so a stored capital would be a spelling no screen
  honours, plus a second field to keep in step with the key. §3.2 says what the folding refuses
  and what it costs.
- **Tag** (the UI calls it an **attribute**): an arbitrary string attached to an item by rating
  it. `restaurant`, `cheap`, `casual`, `action`, `late night`. There is one namespace: a
  "category" like `restaurant` and an "attribute" like `cheap` are the same kind of thing. That
  keeps the model and the UI to a single mechanism, and lets categories be as arbitrary as
  attributes. (A fixed, curated set of top-level kinds would be an additive change: a `kind`
  field on items, plus a fixed tag vocabulary that the UI suggests first.)

  A tag is an id under exactly the same rule, at the same cap, and nothing else: `late night`
  is the tag, with its space, and `"Late Night"` lands on it. There is no `tags` table and no
  tag display name, for the same reason an item has none.
- **Ratable**: the unit that receives a thumb. Either an item `i` ("is this good?") or an
  item–tag pair `(i, t)` ("does this item have this tag?"). Both take exactly one of
  `+1` / `-1` per user, changeable at any time, removable. A pair is **two fields**, never one
  joined string (§3.2).
- **Rating**: `(user, item, tag) -> +1 | -1`, with an empty `tag` meaning the thing itself.
  Private to the user who made it. Only the two server-side functions — the feed recompute
  (§3.4) and taste search (§5) — read other people's ratings.
- **Friend edge**: mutual, by request and acceptance (same mechanism as kip: usernames,
  connect requests, share links). Your friend list is visible only to you.

### The one view

The comps are in [`docs/mockups/`](docs/mockups/).

**There are no tabs.** The app is one screen: a list of things, with a search field pinned to
the bottom where a thumb already is. Everything else is a layer over that list, and the two
things that are not the list — a thing, and the people — are reached by opening a row and by
the avatar in the corner. Everything user-facing is lower case.

1. **The list.** With the field empty it is the viewer's feed, ranked by §2.6, plus everything
   the viewer has rated, which the feed may not carry — with no friends it carries none of it
   (a thing nothing in reach has scored sorts as zero). Typing filters the feed by an item's
   name **and** by its attributes, fuzzy-matched, so a misspelling finds the thing that
   already exists rather than offering to make a second one. A row carries the
   name, its attribute chips, and one bar. The bar belongs to **whatever matched**: an
   attribute match shows that attribute's score for this viewer, a name match the item's own.
   That is the whole answer to "why is this here", and it is an answer about the viewer's own
   model of a word, never about a person (§4).
2. **Adding is part of searching.** Above the field, quiet and dashed, sits *add "&lt;what you
   typed&gt;"* — available the whole time there is a query, not only when nothing matched,
   because identity is by folded name and an add that collides is a find. Tapping it opens the
   thing **provisionally**; nothing is written until the viewer rates it or gives it an
   attribute, so a name typed and abandoned never enters the shared catalog.
3. **Rating is a swipe, and on mobile it is the only way to rate.** Right is yes, left is no.
   Swiping the way you already voted **clears** that rating, and the reveal behind the row says
   so — it turns grey with a minus rather than green or red. Swiping the other way flips
   straight over, with no clear in between. The row moves horizontally and does nothing else:
   no rotation, no vertical travel. This is a choice between two sides, not a card being
   thrown away, and the borrowed card-deck motion would say the opposite. **There are no thumb
   buttons anywhere on mobile.** A rated row keeps its bar and tints its background, green for
   yes and red for no.
4. **A thing.** Opening a row replaces the list with the thing's own screen, drawn the same
   way. Its title bar carries a back button, the name, the item's own bar and the avatar — with
   its request badge, so an ask is never out of sight — and **is** the item's rating
   control: swiping the title bar rates the item, and only that bar takes the tint. Below it
   each attribute is a plain row — name, its own bar — rated on its own by the same swipe.
   Attributes are ordered **most uncertain first**, which on §2.6's `−1..1` scale is
   `|s_u(i,t)|` ascending: the answers worth most are the ones the viewer's network has least
   to say about. The screen's search field filters the attribute list and offers *add
   attribute* while typing, in the same place the list's add button sits. An eye beside the
   field hides the attributes the viewer has already answered; the icon itself changes — open
   eye, crossed-out eye — rather than only its colour, because a toggle whose only state is a
   tint is unreadable to anyone who cannot see the tint. The same toggle in the feed hides
   things the viewer has rated. At the end of the attribute list a row of dashed chips
   proposes attributes to apply (§2.11) under the heading *suggested*, which claims nothing
   about who: "people like you use this" is an attribution and §4 forbids it.

   The attribute list on a thing contains only attributes somebody has **rated**. A chip the
   viewer taps but never thumbs creates nothing — it is provisional on the client and never
   reaches the server, so it vanishes when they leave the screen. An attribute that exists
   because one person typed it and walked away is not a thing anyone else can ever see.
5. **People, behind the avatar.** One screen, under a title bar of its own — a back button and
   *you and your friends*, no avatar, since this is where the avatar leads — in this order.
   First the viewer's own row — photo, name, handle, the theme control and sign out on one
   line. Beneath it, two
   full-width lines that **are** switches, swiped like everything else, each one sentence
   because each setting is one sentence:
   - **Findable.** Shown once there is a handle; before that, a field and a *claim* button to
     pick one stand in its place, and claiming turns findable on. On: green, *findable as @handle — anyone who
     types it can ask to connect*. Off: grey, *swipe to be findable as @handle*. Off, typing the
     handle finds nobody.
   - **Suggestions.** Default **off**: grey, reading *swipe to show up in friend suggestions*.
     On: green, reading *suggested to people with similar taste*. Reciprocal in both directions
     (§5.1) — off means you are named to nobody and your own list is written empty. **Not a
     switch until there is a handle**: before one is claimed the line reads *claim a handle
     above to show up in friend suggestions*, does not swipe, and a tap on it puts the cursor in
     the claim field. Being suggested means being askable, asking needs a handle, and the schema
     refuses findable without one, so a swipe there could only ever end in an error.

   The two are coupled, because a suggestion names someone the viewer can then ask, and nobody
   can ask a person who is not findable: turning findable off turns suggestions off with it,
   and turning suggestions on while unfindable turns findable on first. Then the install line
   where the browser offers one, then pending asks, then friends, then *similar taste*.
   A pending ask and a similar-taste row carry, beneath the handle, **the attributes you agree
   on** (§5.1). That is the entire basis for deciding: no alignment level is shown, and there
   is no person page.
   **A friend's row swipes one way only**: left, revealing a *user-minus* glyph rather than a
   thumb, because no is the only answer a friendship takes here. It asks first — *unfriend
   &lt;name&gt;?*, *you'll drop out of each other's friends and feeds. to be friends again, one
   of you has to ask.* — and on *unfriend* removes both rows. On desktop the row keeps only its
   left button.
6. **Finding a person is typing a handle.** The page's search field filters the people already
   shown; a handle nobody there has offers *ask @handle to connect*, in the same place the add
   button sits everywhere else. Handles are exact and there is no browsing for people, which
   is the same rule the schema enforces. Asking someone hides them from suggestions
   and from that list until they accept, so nobody can be asked twice. The cost: **a pending
   ask is invisible to the asker** — they see neither the person nor the
   request they sent, only that the person is gone. The alternative is a state that can be
   re-sent, and re-sending is the thing worth preventing. It follows that **a sent ask cannot
   be withdrawn**: there is nothing on screen to withdraw it from. It ends when the other person
   accepts or declines.
7. **Nothing to show yet.** An empty feed reads, exactly: *search for and tag things you like
   or don't. swipe on anything to indicate your preferences.* — with an *add friends* button
   and a *read more* button, and **nothing saying which direction means what**. That is
   deliberate: `/how/` explains the swipe, and a first screen that teaches the gesture before
   there is anything to use it on is teaching nothing. The cost is that a first swipe may be a
   guess; the reveal names itself under the thumb, and the gesture is its own undo.
   That screen is only for a list that is really empty. When the eye has hidden every row
   there is, the list says *you've rated everything here. the eye shows it again.* instead —
   somebody with a list of their own does not need telling to start one.
8. **Desktop keeps the mobile layout** and replaces the swipe with a button welded to each
   side of a row — no on the left, yes on the right — tinted the same soft green and red that
   a rated row gets, with the coloured glyph on top. The side matching the viewer's current
   rating goes grey with a minus, because pressing it clears. Desktop is otherwise
   **unpolished and deliberately deferred**: the column is centred and the rest is the phone —
   the whole phone, bars included, so a back button or the avatar sits at the column's edge and
   not the screen's.

### The bar

The one thing that shows a score, everywhere one is shown. Four segments in a row, filled from
the left — a value part-fills the segment it lands in rather than rounding to it. Red at or
below the midpoint, green above; the unlit track is grey **with an outline**, so the level is
countable rather than guessed against the background. There is no word beside it, anywhere
(the accessible label keeps one, because a bar with no text is nothing to a screen reader).

No numbers, ever: every one of §4's promises holds — no counts, no raters, no averages, no
attribution.

**The fill is quantized to the error the recompute can carry.** A bar whose resolution is
pixels claims a precision the arithmetic does not have, so a difference smaller than the
recompute's own error is noise being drawn as a fact. The recompute carries two errors, and
neither dominates the other in general:

- **truncation** — §2.4's walk stops with some mass still in flight, bounded by `ε_total`, in
  `π̃` friend-units; a friend-unit of it moves a score by at most `L` (§2.9).
- **settle_movement** — §2.2's settling loop stops when the largest movement of any score in a
  pass falls under `SETTLE_TOLERANCE` or the pass cap fires, and a loop that stopped on the cap
  is still moving. This is already a distance between two values of `s`.

Where the loop settles, the converted truncation is the larger: on the eighty-viewer world
`rust/tests/settling.rs` samples, it is the larger for every one of the eighty. Where the loop
does not settle, the distance it stopped at is larger by an order of magnitude — 0.26 and 0.83
against a truncation bound of 0.04. So the recompute reports both, puts them in the same units,
and takes the larger:

    error  =  max( truncation · L,  settle_movement )        on the score's own (−1, 1) scale
    q      =  error / 2                                      on the bar's 0..1 scale
    fill(x)  =  round( ((s_u(x) + 1) / 2) / q ) · q

`q` is half the error because the bar maps `(−1, 1)` onto a unit of width. At `error = 0.04`
that is `q = 0.02`: fifty possible fills across four segments, a dozen per segment. It still
reads as a continuous bar, it still has no words and no numbers, and it cannot move by less
than the error. What either error can still do is move a value across one step boundary, which
moves the fill by exactly one quantum — the smallest thing the bar is able to say. The quantum
is per viewer and per feed, so a loop that stopped before it settled draws a coarser bar, which
is the honest thing for it to do. Ranking is done on the full-precision score and only the
drawing is quantized, or the quantum would manufacture ties in the order.

`user_recs.error` holds the first line's value (§3.2), which is how the error reaches a client
that cannot read `user_model`. It is deliberately not called `truncation`: a column named for
one of the two quantities while holding the maximum of both is a trap. `web/DESIGN-UI.md`
"The bar" is the component.

### Non-goals (v1)

- Comments, reviews, text, photos, star scales. Thumbs only.
- Merging two items that are the same thing under two names — `café bleu` and `cafe bleu`,
  `café bleu` and `café bleu sf`. Identity by normalized name removes the case where the
  difference is only case or spacing. The accent is part of the id (§3.2), so for the accent
  case the catalog's stored `search_id` — the id with its accents and punctuation stripped,
  written beside it and indexed — stands in: typing either spelling finds the one that exists,
  in the catalog and not merely in the feed the viewer already holds, so the second creator has
  to ignore it to make a duplicate. A merge tool is later, and it is the same tool the
  confusable case wants.
- Explaining recommendations. Deliberately not a feature: see §4.
- Live push updates. Recommendations are recomputed on open, behind a ten-minute staleness
  window (§3.4).
- **A person page**, and with it any *about* text a person writes about themselves. Deferred
  together, and in that order: there is nothing to put on a person page once the attributes
  you agree on are on the row itself, and an about line is the first thing that would bring
  it back. Whoever adds the about adds the page.
- **A polished desktop.** The phone layout is what is designed; the desktop is what it
  degrades to.

## 2. Recommendation algorithm

### 2.1 Goals and the threats it must survive

Everything below is per viewer `u`. The output is, for every ratable `x` that anyone within
reach has rated, a score `s_u(x) ∈ (-1, 1)` and a confidence `W_u(x) ≥ 0`.

Requirements, in priority order:

1. **Personal**: `s_u` is a function of `u`'s ratings and `u`'s network. There is no global
   score that anyone could care about or game for status, and no global aggregate at all.
2. **Sybil-bounded**: the total influence any set of accounts can have on `u` is bounded by
   the friend *edges* connecting that set to `u`'s honest network, not by the number of
   accounts in the set. Making 1,000 bots is no better than making 1. (Flow conservation,
   §2.4 — the same currency as SybilGuard/SybilLimit, Advogato, personalized PageRank.)
3. *(Deliberately not a requirement: self-correcting, localized blame — the edges that carried
   recommendations `u` then rated the other way lose trust, the edge into a bot and not the
   friend who accepted it. Alignment cannot supply it, because alignment rewards agreement and
   a mimic maximises agreement, and no other mechanism does. §2.5 says why that is survivable
   and what the mechanism would be.)*
4. **Incentive-aligned, per state**: whatever everyone else has said, reporting your true
   thumb on an item is at least as good for your own results as reporting the opposite, and
   rating is at least as good as not rating in expectation (§2.7, stated with its limits).
5. **Transitive taste, bounded**: a path of aligned people is followed as far as it still
   matters, with no fixed depth; a distant person with strong alignment can weigh as much
   as a fresh direct friend. Not as much as a well-aligned direct friend: a stranger who
   perfectly mimics you is indistinguishable from a bot behind one edge, so (2) caps what
   anyone reached only through others can earn (§2.4, §2.9).
6. **Discreet**: results never *display* who rated what. Leaks through inference are
   acceptable as long as they take deliberate effort (§4).

Threats, and what actually bounds each:

| Attack | What bounds it |
|---|---|
| Bot farm behind one honest friend `f` promotes item `P`. | Flow conservation with killing at rate ½: all bots together, however many and however wired, receive at most what lies beyond `f` can weigh, which is at most `f` itself (§2.4). Nothing shuts the swarm off after the viewer dislikes what it pushed, so what bounds it is the ceiling and not a reaction: one edge buys at most what `f` itself weighs — about a friend-unit, more where the viewer's other friends' walks also pass through `f` (a converged 500-bot clique held 1.050 behind a gatekeeper of 1.055, §2.4) — spread over however many accounts the attacker made, and every promotion competes against the viewer's honest reach at that ceiling for as long as the edge exists. §2.9 works the numbers and §2.9a measures how far such a promotion actually travels. |
| Bots learn `u`'s taste from their own feed (a bot's feed is the mass-weighted opinion of its reach, `u` included) and rate contested items to mimic it before promoting. | Real, and not detectable — a mimic is a perfect friend-of-a-friend. It is bounded, not prevented: everything beyond one friend weighs at most that friend, unconditionally, alignment is clamped, and a friend's own thumbs are never scaled. Worst case from one edge is quantified in §2.9. **And it does not compose**: mimicry is what carries a promotion past the person who accepted the request (without it the item reaches nobody else at all), but a swarm that has copied one person is wrong for everyone that person disagrees with, so it buys one weak ring and stops — measured in §2.9a. |
| Bots copy consensus opinions to look aligned with everyone. | Agreement on a unanimous item carries **exactly zero** weight, at any support: `ω = 4p(1−p)·n/(n+1)` is `0` when nobody in reach dissents. This is the row that decides the shape of `ω` (§2.2). Consensus is measured inside `u`'s reach with bounded mass, so bots cannot make consensus items look contested either. |
| Bots tag thousands of items with obvious categories to earn "agreement". | Tag ratings never enter alignment; only item ratings do (§2.3). |
| An anti-aligned account rates `−1` to promote. | Negative alignment flips the sign of an account's evidence; it does not shrink it. The defense against promotion is the mass bound, not the sign (§2.3). |
| A user rates dishonestly to manipulate a friend's feed. | Influence on that friend is scaled by alignment earned by agreeing with them, bounded by flow, and invisible, so there is no social payoff. They also degrade their own results (§2.7). |
| One account, or a swarm, behind one edge rates 10,000 items. | Bounded per item by mass, not per feed: all ten thousand can be there at once, each at the one edge's ceiling. Identical treatment for a prolific honest friend-of-a-friend, and nothing distinguishes them later either. What keeps this tolerable is that mass is not evidence until multiplied by alignment, so ten thousand ratings by an account the viewer has no agreement with carry a prior's worth each (§2.9). |
| A dense clique inside the viewer's nearest `N_max` people, built to make the walk expensive. | Not influence: the mass bound above holds on whatever the walk produced. What it can buy is **staleness**. A sweep costs two pushes per friendship loaded (§2.4), so a clique makes the walk dearer in proportion to the friendships it adds — a 500-bot clique behind one gatekeeper converges in 1.75 M pushes, well inside `E_max` — and one dense enough that a converged loop does not fit `E_max` stops the recompute short of `ε_total`, and a walk that does not resolve writes no feed, so the viewer keeps the last one they had (§3.4). Its edges still have to be accepted by real people, which is what bounds how close to a viewer it can sit. A clique beyond the nearest `N_max` is not walked at all (§2.4). |
| Inferring a specific friend's rating from your feed. | Display floor, no counts, no recency ordering, staleness window. With exactly one friend the feed *is* that friend's ratings; §4 says so. |

### 2.2 Ratings, consensus, and informativeness

Ratings `r_{v,x} ∈ {+1, −1}`. Alignment (§2.3) is computed over **item** ratables only; tag
ratables are scored (§2.6) but never used as evidence of shared taste.

For viewer `u` and item `x`, the reach-weighted vote counts are

    n⁺_x = Σ_v π̃_u(v) · [r_{v,x} = +1],    n⁻_x likewise,    n_x = n⁺_x + n⁻_x

summed over everyone in reach *including the viewer at `π̃_u(u) = 1`* (their own thumb is a
real vote in their own reach; leaving it out would make "everyone but me" unanimous look
uncontested, so a bot swarm the viewer disagrees with would never register), with `π̃_u`
from §2.4. The consensus and **informativeness** are

    p_x = n⁺_x / n_x
    ω_x = 4 · p_x · (1 − p_x) · n_x / (n_x + 1)  =  4 · n⁺_x · n⁻_x / (n_x · (n_x + 1))
                                                   ∈ [0, 1),   0 if n_x = 0

(`rust/src/informativeness.rs`). `4p(1−p)` is the even-split factor, the variance of a ±1
vote scaled so an even split reads 1; `n/(n+1)` is the support the count itself carries, one
pseudo-vote of doubt, so an item with little reach mass behind it does not read as maximally
informative — reach mass is measured in friend-units and is small. `ω_x → 1` for an evenly
contested, well-supported item, reaches `n/(n+1)` at an even split, and is **exactly `0`** on a
unanimous item however much mass rated it. An item two friend-units split evenly reads `2/3`.

**Not the exact Beta(1,1) posterior, deliberately.** `n/(n+1)` is an invented constant, and
the exact posterior `E[p(1−p) | data] = p̂(1−p̂)·(n+2)/(n+3)` with `p̂ = (k+1)/(n+2)` would
remove it. It cannot be used, because the two forms differ in exactly the place the defence
lives: this form reads **exactly `0`** on a unanimous item at any support, and the posterior
reads `4(n+1)/((n+2)(n+3))` — `0.60` at two friend-units, `0.28` at ten, `0.12` at thirty.
Thirty unanimous items at `ω ≈ 0.12` is `A ≈ 3.5`, which against `κ = 8` moves a stranger to
`â ≈ 0.55` and `ℓ ≈ 0.2` — small, and bought for nothing by an account that agrees with
everybody. So **"contested means at least one dissenter in reach, and nothing less counts"** is
a rule, and `n/(n+1)` is named as a chosen constant in §2.8. A tidier closed form is not an
improvement when the untidy form's *discontinuity* is the property being relied on.

**The definition is circular, and it is run until it stops moving.** `π̃` depends on
alignment, alignment depends on `ω`, and `ω` depends on `π̃`. The computation is therefore one
settling loop, not a fixed number of stages: walk with every alignment at its prior `a₀(d)`
(so the first walk depends on the graph only, not on any rating), recompute contestedness and
alignment from what it found, walk again, and stop when the largest movement of any score in a
pass falls below

    SETTLE_TOLERANCE = 1e-4      or   pass count reaches   SETTLE_MAX_PASSES = 12

**Reaching the cap is not an error.** The loop reports the movement it stopped at
(`settle_movement`) beside the truncation, and the caller decides what to do with it — §1's
bar quantizes to the larger of the two, and §3.4's recompute writes a feed either way.

**Each pass starts from the one before, and a pass that cannot finish does not count.** A pass
after the first is seeded with the previous pass's flow, so it pays only for how far the
affinities moved rather than for a walk from nothing (§2.4 gives the residual this leaves). And
the loop never starts a pass that the remaining push budget (§2.8's `E_max`) cannot pay for at
the last pass's price; a pass that stops on the budget anyway is discarded. The answer is always
the last *completed* pass — its masses, its scores, its movement — with `settled` false; a loop
that can afford only its first pass reports `settled: false, passes: 1`. A pass cut short must
never replace a converged one before it: a starved second pass would report a walk of fourteen
nodes after the first had reached three hundred.

Two fixed passes would not be enough. Measured on the same worlds, a two-pass answer sits
`0.006`–`0.012` from the settled answer on the worst single ratable — inside §2.9's truncation
bound of `0.04` — but where the loop cannot settle at all the distance it stopped at is an order
of magnitude past that bound, and that is the case the bar has to draw (§1).

**That it settles is measured, and there is a theorem for the shape of it.**
`rust/examples/fixed-point.rs` iterates the map and reports how far the score vector moves
each pass: movement of the worst single score falls by a factor of `0.032`–`0.039` at the
first step and `0.055`–`0.14` at the second, then wobbles around `5e-5` — it shrinks over every
*two* passes, not every pass — across seeds and across `p_same_cluster` from 0.05 to 0.30, and
every viewer of every one of those worlds reached the tolerance — four passes the median and
five the most any viewer took. Denser and hostile worlds settle too: at `p_same_cluster = 0.6`
— 120 people, 72 friends each — every viewer within four passes and 52 000–60 000 pushes; under
a 200-bot mimic clique all 320 viewers within eight passes, the bots holding 1.025 friend-units
behind a gatekeeper of 1.114. The cap of 12 is therefore room for a graph that contracts several
times more slowly than anything observed, and the tolerance of `1e-4` is two orders below the
smallest step the bar can ever draw. `fixed-point.rs` and the product path walk the same graph.
The general statement is Butkovsky's: a kernel whose
transition probabilities depend on the law it produces has a unique invariant measure, reached
geometrically, when its Lipschitz constant in the measure is below its Dobrushin coefficient
(*Theory Probab. Appl.* 58(4), 2014, Thm 2.2), and a walk killed at rate `α` supplies that
coefficient for free on every graph.

**Two obstructions, because the condition above is not self-evidently met here.** Butkovsky's
own Example 2.1 is a two-state chain satisfying the Dobrushin condition alone that does *not*
converge, so "the killing rate makes it contract" is false as a standalone argument — the
Lipschitz half is what §2.3's `κ` supplies and it is not free. And multilinear PageRank, a
close relative, is unique for `α < 1/2` and explicitly **non-unique for `α ≥ 1/2`** (Gleich,
Lim & Yu, *SIMAX* 36(4), 2015); ours is exactly `1/2`, chosen for a different reason (§2.4).
Different model, close enough that sitting on that boundary is a decision rather than an
oversight, and the measurements above are what stands behind it. This is why the cap exists
and why reaching it is reported rather than thrown.

Counting inside the viewer's own reach with conserved mass means a bot region can shift any
`p̂_x` by at most its bounded share, and there is no global aggregate for anyone to attack
from outside.

### 2.3 Pairwise taste alignment

For viewer `u` and any `v` in reach, over the **items** both have rated:

    A_{uv} = Σ_x ω_x · [r_{u,x} = r_{v,x}]        (weighted agreements)
    D_{uv} = Σ_x ω_x · [r_{u,x} ≠ r_{v,x}]        (weighted disagreements)

Shrink toward a prior that depends only on graph distance `d(u,v)`:

    a₀(1) = 0.65,   a₀(2) = 0.55,   a₀(d ≥ 3) = 0.50
    â_{uv} = (κ · a₀(d) + A_{uv}) / (κ + A_{uv} + D_{uv}),    κ = 8

The prior says a friend is weak evidence of shared taste, a friend-of-a-friend weaker, and
anyone further away none; data overrides all three. `κ = 8` means one agreement on a sparse item moves a stranger's alignment to
about `0.55`, ten agreements and no disagreements to about `0.78`, twenty to about `0.86`. This is what gives a
brand-new user something to look at (their friends' ratings at modest weight) and what makes a
like-minded second-hop person overtake a fresh direct friend once overlap accumulates.

**`κ` is load-bearing a second way, and this is the more important one.** It is what makes
§2.2's loop settle. Alignment divides by `κ + A + D`, so a change in the masses moves `A` and
`D` and is then divided by `κ`; a large `κ` means alignment barely responds to a change in
flow, which is exactly the small Lipschitz constant the contraction argument needs. So `κ` is
not only a statement about how fast a stranger should earn trust — it is what makes the whole
circular definition well-posed, and lowering it trades convergence for responsiveness rather
than responsiveness alone. It remains **chosen** rather than derived, against both jobs.

The **alignment weight** is the clamped log-odds of agreement:

    ℓ_{uv} = clamp(logit(â_{uv}), −L, +L),    L = 2

This is the elo-style logit, and the weighting is not a choice: under conditional independence
and a uniform prior, the error-minimising aggregation of binary votes weights each voter by
`log(p/(1−p))`, which by Neyman–Pearson *is* the log-likelihood ratio, so every other
weighting is strictly dominated (Nitzan & Paroush, *Int. Econ. Rev.* 23(2), 1982; the same
object as I. J. Good's weight of evidence). A thumb from `v` is evidence about `u`'s taste with
weight `ℓ_{uv}`. It is positive for like-minded people, near zero for people we know nothing about
*and* for people who only ever agree on consensus items, and **negative** for people whose
taste reliably opposes yours: their thumbs-up is evidence you will dislike it. Note what
negative alignment is not: it is not a penalty. Evidence is invariant under flipping both the
sign of `ℓ` and the sign of the rating, so an anti-aligned account promotes by rating `−1`
exactly as well as an aligned one by rating `+1`. What limits any account is the mass bound
(§2.4) and the clamp, not the sign.

**And the clamp is the second thing holding the loop together.** `L` bounds how much any one
account's thumb can ever count, which is the guarantee it was written for; it also bounds how
lopsided §2.4's split may get, since the affinity range is `e^L` and the best-to-worst
neighbour ratio is `e^{2L}`. Measured on the same worlds: at `L = 2` the ratio is 7:1 and the
loop contracts at about 0.2 a pass; at a ratio of 55:1 it is 0.45; at 3 000:1 it is 0.83; and
at `2.6e10:1` the iteration has a per-pass ratio of `1.008` and **never settles at all**. So
past a best-to-worst ratio in the thousands there is no answer to converge to. Concentration
does not help an attacker either — with 200 mimic bots the bots' share drifts slightly *down*
as the split sharpens — so stability is the only thing being traded, and `L = 2` keeps the
ratio at 7:1.

`ℓ_{uv} = ℓ_{vu}` exactly. That symmetry is why an account's own feed tells it how aligned it
is with its reach; see the mimicry row of §2.1.

### 2.4 Reach and flow: how much of each person `u` can hear at all

Alignment says how much to believe someone; it must not decide whether they can reach you, or
a thousand well-aligned bots would drown a network. Reach is a conserved quantity that flows
along friend edges and is followed as deep as it still matters.

**The walk.** From viewer `u`, run a **non-backtracking random walk**: it never immediately
re-traverses the edge it arrived by, it never steps onto `u` (the viewer is removed from every
transition row and the row renormalized, so mass that would have come back to you is shared
among that node's other neighbours instead), and at every step it is **killed with
probability `α = 1/2`**. From a node `v` entered along the edge `(w → v)`, it continues to a
neighbour `y ∉ {w, u}` with probability proportional to the **affinity**

    aff_u(y) = exp(max(ℓ_{u,y}, 0))      ∈ [1, e^L] ≈ [1, 7.4]

the odds that `y` shares the viewer's taste, when those odds are better than even. A
neighbour aligned with the viewer is preferred over an unaligned one by exactly those odds,
so a path of aligned people keeps most of its mass at every step, and the range follows
from the alignment clamp rather than from a constant of its own. The exponential form is
forced once the constraint is: `split ∝ exp(β·alignment)` is the unique maximiser of
`H(q) + β·E_q[alignment]` over the simplex — strictly concave, hence unique — so `β` is a
Lagrange multiplier on a constraint and not a tuned knob (Gibbs; axiomatically, Shore &
Johnson, *IEEE IT* 26(1), 1980), and `β = 1` is what makes the multiplier the log-odds
themselves. The honest caveat: this relocates the arbitrariness into choosing the constraint
level, which is what §2.3's paragraph on `L` is about. This is the
personalized, alignment-steered form of non-backtracking centrality: the visit mass
`π_u(v)`, the expected number of times the walk arrives at `v`, is what the Hashimoto-matrix
centrality localizes to a single start node.

**There is nothing else in the split.** Each node's onward mass goes to its neighbours in
proportion to the affinity above and to stopping at rate `α`, and that is the whole rule — no
learned per-edge distribution (§2.5). The injection at a friend is never scaled either way, so
a friend's own thumbs are judged by alignment alone.

Why there must be a killing rate, and why it is one half. On a finite graph an unkilled walk
forgets where it started: the expected number of visits to `v` before returning to `u` is
`deg(v)/deg(u)` for every `v`, however far away, so an undamped walk measures degree, not
proximity to you. Some horizon is therefore not a tuning knob but the definition of
"personalized". Killing with probability `1/2` is the one rate with a structural meaning here:
the mass that ever travels beyond a friend is `Σ_{j≥1} (1/2)^j = 1` times the mass injected at
that friend, so **everything that lies beyond any one friend weighs, in total, at most as much
as that friend**. That is the whole sybil argument, and it needs no further cap.

**Injection and normalization.** The walk starts by stepping to a friend `f` with probability
`1/|F_u|` (its first arrival counts as a visit). Normalize so one ordinary friend is the unit:

    π̃_u(v) = π_u(v) · |F_u|

A direct friend has `π̃ = 1` from injection plus whatever arrives by other routes (on a
triangle `u – f – f'`, `f'` gets `1 + 1/2` because all of `f`'s onward mass has nowhere else to
go); the total beyond a friend is at most that friend's own `π̃`, which is `1` only when no
other route reaches them, and less when the branch is sparse (the walk dies at leaves).

**What is actually computed.** Nothing is sampled. Let `B_u` be the viewer's
non-backtracking transition operator on directed edges (Hashimoto matrix with the affinity
weights, rows for edges into `u` zeroed) and `e_u` the injection vector. The visit mass is
the resolvent row

    π_u = e_uᵀ · Σ_{k≥0} ((1 − α) B_u)^k = e_uᵀ · (I − (1 − α) B_u)^{−1}

summed onto nodes. This is the non-backtracking analogue of personalized PageRank / Katz
centrality. It is a linear system, not an eigenproblem: the leading eigenvector of `B` is
one global ranking shared by everyone, whereas we need a different row of the resolvent for
every viewer, and `B_u` itself differs per viewer because the affinities are the viewer's own
alignments. A low-rank spectral approximation of the resolvent is exactly the wrong tool
here: the top eigenvectors carry global structure and smooth over sparse cuts, so a small
sybil region behind one edge would be assigned mass in proportion to its size — the property
the flow argument exists to prevent. So each viewer's row is solved directly.

**Error-bounded evaluation.** The solve is by local push (Andersen–Chung–Lang), which is
Gauss–Seidel on the Neumann series restricted to where the mass actually is. The residual lives
on directed edges, `r(w → v)`, because the walk is non-backtracking — but a push takes a
**node**: pop the node `v` holding the most residual, add everything waiting on its incoming
edges to `π_u(v)` at once, and send each outgoing edge `(v → x)` its share of `(1 − α)` times
that total *less* the part that arrived along `(x → v)`. Stop when the mass still in flight
could change no score by more than the budget, or when a budget is exhausted:

    stop when  Σ |r| · (1 − α)/α  <  ε_total        (0.02 on demand, 0.001 deep, in π̃ units)
           or  nodes touched ≥ N_max                (2 000 on demand, 50 000 deep)
           or  push work ≥ E_max                     (a CPU backstop, §2.8)

`N_max` bounds the nodes a walk touches, hence its memory, CPU and egress; since the
neighbourhood is in the function's memory (§3.4) it bounds no reads. The **deep** budget is the
same walk followed much further and tighter, and it is what friend suggestions run under (§5).

**A node push, because an edge push costs the degree squared.** A pop pushes one share along
each edge out of `v`, so a **sweep** of the loaded neighbourhood costs

    sweep  =  Σ_v deg(v)      pushes, two per friendship

and a converged walk takes about `⌈log₂(F / ε_total)⌉` sweeps, `F` the viewer's friend count.
Popping one *edge* at a time instead would deposit along every edge out of `v` but the one it
arrived by, so a sweep would cost `Σ_v deg(v)(deg(v) − 1)` — the mean degree times more. At
2 000 people and 50 friends each, one walk takes 6.9 ms by node against 12 354 ms by edge
(native), and the whole loop 27 ms against 56 188 ms, on the same equation, the same stop rule
and the same truncation: over 300–2 000 people the masses agree to 2.9e-4, the scores to 9.0e-4,
and the pass counts (4–5) are equal. Masses can err slightly high as well as low, within the
reported truncation. The pop order is largest-first to within a factor of two — one bucket per
binary exponent, first in first out inside a bucket — and deterministic.

**Passes are warm-started.** §2.2's loop runs the walk once per pass, and a pass after the first
starts from the previous pass's flow instead of from nothing: its residual is what that flow
leaves unexplained under the new affinities, `e + T(a₀) − a₀`, which may be negative. That is why
the stop rule sums `|r|`. It roughly halves a loop's work, since later passes pay only for how far
the affinities moved.

**Nothing is trimmed, and the accuracy is relative to the nearest `N_max` people.** The budget a
walk gets is `min((SETTLE_MAX_PASSES + 1) × (F + (sweeps + 1) · Σ_v deg(v)), E_max)`, and with
the node push and warm starts a converged loop over the whole `N_max` fits the CPU ceiling
(136 ms of `computeUser` in wasm at worst, 2 000 people × 50 friends). Do not make it fit by
unloading the furthest nodes: §3.4's boundary rounds skip anything already loaded, so trimmed
nodes never come back, and every viewer with a neighbourhood past about a hundred people would
get no feed at all.

**Influence from beyond the nearest `N_max = 2 000` people is ignored.** The walk reports two
quantities, not one. `truncation` is the residual left *inside* the loaded set, and it is what
`ε_total` bounds. `boundary_residual` is the mass that walked out of it onto people who were
never loaded; it is reported and stored (`user_model.boundary_residual`, §3.2) and **not**
counted against `ε_total`. It is not small: in loose worlds at 10–40 friends each it measured
0.2–14 friend-units, against an `ε_total` of 0.02. Against a walk of the whole world the bars
moved by at most 0.03–0.11 and about one item in twenty fell below the display floor. That is
the price of a bounded load, accepted as a threshold rather than hidden in a bound it does not
satisfy.

**A walk that cannot meet `ε_total` inside the loaded set writes no feed at all.** It does
not write a worse one: §3.4's recompute answers with the *previous* `user_recs` row and
`recomputed: false`, stamping `checked_at` so the staleness window still applies — including for a
viewer with no earlier feed, who would otherwise pay a walk on every open. A feed the viewer
already has is a better answer than a feed drawn from a walk that did not resolve, and the
alternative — storing it with a large reported error — puts a number on the bar that is really a
statement that the computation failed. With nothing trimmed only `E_max` can cause this: a
neighbourhood dense enough that a converged loop does not fit the CPU ceiling.

Residual left at termination still counts as visit mass where it sits; only its onward flow
is lost, and `truncation = Σ |r| · (1 − α)/α` is reported with the result. Since evidence is
mass times a clamped alignment, any ratable's `E_u(x)` is within `L · truncation` of the exact
value, and its score within `L · truncation / (κ_s + W_u(x))` — of the exact value *over the
loaded set*, which is the guarantee's scope as stated above. This is a true search: a path of
strongly aligned people is followed as long as the mass on it can still matter, however many
hops away it leads, and a wide unaligned neighbourhood is cut off as soon as it cannot. The
cost bound is the node budget, not a depth. The pop order is fixed, so the result is
deterministic. A global power iteration would cost one pass over the whole graph per step for
every viewer; the push costs `O(1/(α·ε))` pushes regardless of graph size, which is why it is
the standard way to compute personalized centralities, and why one viewer costs milliseconds.

**Why this is sybil-bounded.** Take any set of accounts `S` reachable only through edges from
honest gatekeepers `h₁..h_k`. Every row is a distribution, so mass enters `S` only along
those edges, at most `π_u(h_i) · P_{h_i}(S)` per unit at `h_i` (where `P_h(S)` is the share
of `h`'s onward mass that leads into `S`, at most `1 − α`), and inside `S` it can accumulate
at most `1/α = 2` times its inflow. So

    π̃_u(S) ≤ Σ_i  π̃_u(h_i) · P_{h_i}(S)

and, since the onward share of any node is at most `1 − α`, a region behind one gatekeeper
never outweighs the gatekeeper. `π̃_u(h_i)` is the gatekeeper's total mass, which includes
what returns to it (a walk `h → b₁ → b₂ → h` is not backtracking): from a single region
routing everything straight back, at most `1/(1 − (1−α)²) = 4/3` times what it had; in
general it is bounded only by conservation (three mutual friends each sit near `1.9`, fed by
each other), and `π̃_u(S) ≤ π̃_u(h)` holds regardless. Nothing
in the bound is `|S|`: adding accounts to `S` re-divides a fixed pie, and no chain, clique,
or fan-out inside `S` can collect more than what entered. **Nor is the budget in it.** A
clique dense enough to exhaust `E_max` inside itself leaves the loop stopped on a partial walk,
and the bound still holds on the masses that walk produced, because what the push did not
carry is held as residual and reported as `truncation`, not handed to anybody; the cost of that
case is an answer nobody is shown, since §3.4 writes no feed and the viewer keeps the last one.
A 500-bot clique behind one gatekeeper does not get there: the loop converges in 5 passes and
1.75 M pushes, settled, at a truncation of 0.0041, and the bots hold 1.050 friend-units against
the bound's 1.055. **That is more than one friend-unit, and "a region behind an ordinary
gatekeeper holds at most one friend-unit" is not a theorem**: the gatekeeper's own `π̃`
includes what the viewer's other friends' walks carry through it, and the bound is that, not
`1`. A region beyond the nearest `N_max` people is not walked at all, which bounds it
trivially. The worst case from one *captured* edge — a friend whose entire beyond-them world is
bots that have correctly predicted `u`'s taste — is one friend-unit, `4/3` with maximal
feedback; an ordinary gatekeeper adds whatever else flows through it. Mass is not evidence until
multiplied by alignment (§2.6), which starts at the prior for anyone new. That ceiling is the
whole of the defence on that edge: nothing reacts to what crosses it afterwards (§2.5). §2.9
works the numbers.

**The bound is the best available, and that is a theorem rather than a hedge.** You cannot
have *zero* sybil gain: strong transitive trust, independence of disconnected agents,
anonymity and misreport-proofness together imply that beneficial sybil attacks exist (Seuken &
Parkes, AAMAS 2014). So "bounded, not prevented" is what any rule of this kind can offer. The
closest thing to a characterisation of which flow rules admit the bound is Levien's
*bottleneck property* — a trust metric must dilute the trust accorded to the successors of a
node as more successors are added — which is mass conservation, and which he states plainly is
a conjecture with no proof.

**Two costs that come with measuring visit mass.** Under personalized *hitting probability* —
did the walk ever reach you — the optimal sybil strategy is provably no sybils at all (Hopcroft
& Sheldon, WAW 2007). We measure accumulated visit mass, a resolvent, which counts revisits, and
for that family one sybil with a two-loop strictly pays (Liu, Parkes & Seuken, AAMAS 2016,
Thm 1). **So this design must not claim immunity, only the bound above.** Non-backtracking
removes the two-loop specifically — a bot cannot bounce straight back along the edge it arrived
by — so the cheapest cycle attack becomes a triangle, two sybils instead of one, and no
further; there is no literature at the intersection of non-backtracking walks and sybil
resistance, so that benefit is measured here and borrowed from nobody. Non-backtracking's other
job is the one it is famous for: ordinary eigenvector centrality localizes onto hubs and
non-backtracking does not, because it removes the hub↔neighbour reflection (Martin, Zhang &
Newman, *PRE* 90, 052808). In a friend graph with one 500-friend account that is the difference
between a working feed and a feed about the hub.

### 2.5 Why there is no learned edge trust

**Each node's onward split is §2.4's affinity split and nothing else.** A per-viewer, per-edge
fit — a learned logit `θ_e` on every directed edge reallocating the onward mass, trained by
gradient descent on the viewer's own thumbs under a Gaussian prior — is deliberately not built.

**Why not.** The loss is convex in the scores, but the scores are a resolvent of `θ`, so
**convexity in `θ` is not established**. Descent finds a stationary point with no uniqueness
claim, and a starved budget finds wherever it happened to stop — so the answer depends on the
budget, which is the one thing a bound must not do. The sharp counterpoint from the literature
is that spectral initialisation plus a *single* EM step is minimax optimal for the analogous
rater-reliability problem (Zhang, Chen, Zhou & Jordan, *JMLR* 17, 2016): the initialiser is the
whole problem, and running an optimiser to convergence is the part with no guarantee. A fit is
principled when the model is identified and the optimum provably unique — the Bradley–Terry MLE
exists and is unique exactly when the comparison digraph is strongly connected (Ford 1957;
Hunter, *Ann. Statist.* 32(1), 2004). The objection is not to optimising; it is that this
objective is non-convex in its parameter, its loss is unmotivated, and its prior scale, tolerance
and step cap are three more chosen constants in the part of the design whose job is to remove
chosen constants.

**What that leaves undone.** §2.1's requirement 3 — blame the edge into the bot, not the friend
— has no mechanism: **outcome-based blame is not implemented.** Nothing in grapevine watches what
a recommendation turned out to be worth and moves anything because of it. What a bad
recommendation costs its source is only what §2.3 already charges — a disagreement in `D_{uv}`,
which lowers that person's alignment — and that is per person, not per edge and not per path, so
the friend who accepted the bot is charged alongside the bot.

**Why that is survivable**, and it is an argument from measurement (§2.9a): the attack
requirement 3 defends against is the expensive one, aimed at one person at a time, and the
ceiling of §2.4 already bounds it to a friend-unit however many accounts are behind the edge.
The attack that *scales* — a business putting one item in front of as many people as possible —
is bounded by something requirement 3 never touches, namely how many real people accept a friend
request; bots are free and worthless, and copying one person's taste is what forfeits the next
person's.

**If it is ever wanted, the shape is Resnick & Sami's influence limiter** (RecSys 2007). Each
source carries a reputation starting near zero, moves the prediction only in proportion to it,
and gains or loses when the viewer later rates the thing themselves. Six lines. Total damage from
`n` sybils is bounded **with no assumption about what fraction of raters are honest** (Thm 4); an
honest rater gives up `O(log n)` influence once and is unlimited afterwards (Thm 7); and honest
reporting is optimal because the update is a proper scoring rule (Lemma 1). It needs the one
input most recommenders lack and grapevine has by construction — the viewer eventually rating the
same thing. **The warning that comes with it**: its bound covers *myopic* attackers only, and the
authors explicitly exclude one who misleads other raters into amplifying her effect and later
corrects. Learned per-edge weights are exactly the machinery that moves a system into that
excluded case, which is a second reason not to build them.

Mass conservation, the sybil bound, the per-account ceiling `L` and the truncation bound all
hold at the affinity split as stated. Nothing sits a swarm's edge at a floor after a few
dislikes, and nothing routes the whole of a friend's onward mass to one well-aligned neighbour;
§2.9's worked bounds assume neither.

### 2.6 Scoring a ratable

For viewer `u` and item `x`, summing over every `v ≠ u` in reach who rated `x`:

    E_u(x) = Σ_v π̃_u(v) · ℓ_{uv} · r_{v,x}          (signed evidence)
    W_u(x) = Σ_v π̃_u(v) · |ℓ_{uv}|                  (total weight = confidence)
    s_u(x) = E_u(x) / (κ_s + W_u(x)),   κ_s = 1

`s_u(x) ∈ (−1, 1)` is a shrunk posterior mean: near 0 with little evidence, approaching ±1
only with a lot of consistent, well-aligned, well-connected evidence. One fresh direct friend
(`π̃ = 1`, `ℓ = logit(0.65) = 0.62`) moves an unrated item to `±0.38`; a well-aligned one
(`ℓ = 2`) to `±0.67`. Ranking is by `s_u` descending.

Items with `W_u(x) < W_min` (`W_min = 0.5`) are not shown at all.

Tag ratables `(i, t)` ask a factual question ("is it cheap?"), so they are weighted by reach
alone, not by whether we share taste:

    E_u(i,t) = Σ_v π̃_u(v) · r_{v,(i,t)},    W_u(i,t) = Σ_v π̃_u(v)

with the same shrinkage and floor. "Restaurants that are cheap" means items where, for each
selected tag, `u` rated it `+1`, or `s_u(i,t) > −0.1`, or `W_u(i,t) < W_min` (unknown is not
"no"), ranked by `s_u(i)`. Taste-flavoured tags ("date-night") would want per-tag alignment;
that is the first refinement in §2.8.

Treating raters as independent evidence over-counts when many correlated friends rate the
same thing. The `κ_s + W` denominator turns this into a weighted average rather than a
naive-Bayes sum, which is the right tradeoff for ranking.

### 2.7 Incentive compatibility, stated carefully

The claim: for **every fixed state** of everyone else's ratings and of the graph, reporting
your true thumbs is at least as good for your own results as reporting the opposite, and at
least as good as not reporting, **in expectation over which items you happen to rate**. Fix
everything except `u`'s reports. They enter `u`'s own results through exactly two paths:

1. `u`'s displayed state for a rated item (own rating replaces the score): trivially
   honest-best.
2. The alignment estimates `â_{uv}`, and only through the indicators `[r_{u,x} = r_{v,x}]`
   weighted by `ω_x`. The quantity being estimated is `u`'s *true* agreement rate with `v`.
   The honest report is the one under which those indicators are a correct sample of that
   rate; the inverted report is a sample of `1 −` that rate. Whatever `v` said, the honest
   estimate is therefore the consistent one, and in expectation over the items `u` rates it
   is closer to the truth. It is *not* closer for every single item: you and a close friend
   who truly agree nine times in ten will disagree on some item, and on that item the honest
   report moves the estimate away from 0.9 while the lie would move it toward it. No
   estimator can promise per-sample improvement, and the same holds for withholding.

**The settling loop adds no third path.** `ω_x` moves by at most `u`'s one vote. The *first*
walk of §2.2's loop is at the priors and depends on no rating at all. Every later walk does
depend on `u`'s reports — through the affinities, which are the alignments — and that is path 2,
because everything reaching the walk is mediated by the agreement indicators and nothing else
touches it. What the loop does add is a second-order channel: a report on `x` can move `π̃` of
the people who rated `x`, which moves `ω` of *other* items, which reweights the agreement counts
of pairs `u` is not in. It is bounded by the same contraction that makes the loop terminate —
each round of feedback is damped by the measured 0.03–0.14 over the first two passes (§2.2) — so
the effect is a few percent of the first-order one, in the same direction, and the honest report
is the consistent estimate at the fixed point exactly as it is at the first walk. A report on `x`
never touches `â_{uv}` *directly* for a `v` who did not rate `x`. Rating a consensus item, or one
nobody in reach has rated, has no effect (`ω ≈ 0`, or no `v`), hence "at least as good". What
remains true and unavoidable: every rating on a sparse item creates a little `|ℓ|` with
strangers who happen to have rated it, so the total weight behind long-tail items grows with how
many of them you rate; `κ = 8` and `ω`'s support factor keep that noise below the display floor
for a lone stranger (§2.9).

One state is excluded on purpose: an **adaptive** adversary who conditions on your reports.
An account that rates by the sign of its own feed is mimicking your *reported* taste, and
random misreporting on your part costs it alignment while costing you little; in simulation
the honest reporter still wins on average but loses in about a quarter of runs. This is not
specific to this algorithm: any method that trusts agreement can be baited by an adaptive
agreer. The fixed-state guarantee is what we claim; the average-case claim is what holds
against adaptive mimicry.

**And the stronger property is provably unavailable, which is why the gap above is a gap and
not an oversight.** Personalized PageRank fails strong incentive compatibility for *any*
damping factor, and satisfies self-confidence only when the damping factor is strictly greater
than ½ — ours is exactly ½ (Altman & Tennenholtz, IJCAI 2007, Prop. 15). Their Cor. 21 is the
reason not to chase it: self-confidence, transitivity, ranked IIA and strong incentive
compatibility together collapse any personalized ranking system to *rank by hop distance and
nothing else*, which is the one thing this design is for not doing.

What we do not claim: strategy-proofness with respect to *other* people's results. Your
ratings do influence your friends' feeds; that is the product. The defenses are that the
influence is scaled by alignment earned through agreement, that it is bounded by flow, and
that nobody can see it happen, so there is no social payoff to performing a rating. The
simulation suite (`rust/tests/incentives.rs`) measures the self-interest claim under random worlds *and* under
adversarially chosen fixed states (every friend disagrees with you; every friend agrees;
mixed) per seed, and under adaptive mimicry on average.

### 2.8 Parameters and planned refinements

Every number in the design, by what kind of thing it is.

| kind | name | value | why it exists |
|---|---|---|---|
| derived | `α` | 1/2 | the one killing rate at which "beyond a friend ≤ the friend" is exact (§2.4) |
| cap (the guarantee) | `L` | 2 | how much any one account's thumb can ever count; bounds per-account influence and truncation error — **and** the limit on how lopsided §2.4's split may get, since past a best-to-worst neighbour ratio in the thousands §2.2's loop stops settling at all (§2.3) |
| prior | `κ` | 8 | strength of the Beta prior on pairwise agreement — **and** what damps §2.2's loop, since alignment divides by `κ + A + D` (§2.3) |
| prior | `a₀(d)` | 0.65 / 0.55 / 0.50 | mean of that prior at hop 1 / 2 / further |
| chosen | `ω`'s support factor | `n/(n+1)` | one pseudo-vote of doubt; kept over the exact posterior because it reads exactly zero on a unanimous item (§2.2) |
| unit | `κ_s` | 1 | scoring shrinkage of one friend-unit (§2.6) |
| product | `W_min` | 0.5 | display floor: half a friend-unit. Measured against `L`, `α` and the friend-unit, which are chosen and do not move — not against what a fresh friend's thumb happens to weigh, since `a₀(1)` is estimated from the population (§2.10) and a ratio to it moves with the estimate |
| product | §5 thresholds | 20 overlaps, 5 suggestions | taste search |
| budget | `ε_total` | 0.02 on demand, 0.001 deep | walk error tolerance, friend-units |
| budget | `N_max` | 2 000 on demand, 50 000 deep | nodes a walk may load: memory, CPU and egress, not reads (§2.4, §3.4). The deep column is what friend suggestions run under (§5) |
| budget | `E_max` | 10 000 000 pushes, on demand and deep alike | a CPU backstop: 0.3 s at 30 ns a push (measured about 11 ns in wasm, 18 ns native), because §3.4 may call the core up to four times inside a free invocation's roughly two seconds. The budget a walk gets is `min(reservation, E_max)`, the reservation being `(SETTLE_MAX_PASSES + 1) × (F + (⌈log₂(F/ε_total)⌉ + 1) · Σ_v deg(v))`. No converged loop measured spent more than 2.45 M pushes (§2.4), so it bounds a pathological graph, not an ordinary one |
| budget | `SETTLE_TOLERANCE`, `SETTLE_MAX_PASSES` | 1e-4, 12 | when §2.2's loop stops. The tolerance is two orders below the smallest step the bar can draw; the cap is room for a graph contracting several times more slowly than anything measured, and reaching it is reported, not an error |
| budget | `REACH_REUSE_MAX` | 20 | consecutive recomputes that may reuse the cached reach masses before one full walk is forced anyway (§3.4) |

Affinity (`exp(max(ℓ, 0))`) and tag weighting (reach only) carry no constants of their own.
`κ` and `a₀(d)` — the only population-level quantities — are **estimated from the population**
(§2.10), with the values in the table as the fallback while there is too little data to
estimate from.

Planned refinements: per-tag or per-domain alignment (you and a friend may share movie
taste and not food taste — fit `â` per top-level tag when overlap is large enough, fall back
to pooled); time decay on ratings. §2.11's attribute similarity brings no constant into this
table: it runs on the client over the viewer's own ratings and never touches the walk.

### 2.9 Worked bounds with the defaults

- **One fresh friend's thumb**: `π̃ = 1`, `ℓ = logit(0.65) = 0.62` ⇒ `W = 0.62 ≥ W_min`,
  `s = ±0.38`. Surfaces.
- **One maximally aligned person behind a friend with 10 other, unaligned friends**, at the
  split: share `= e² / (e² + 10) ≈ 0.42` of the friend's onward `0.5`, mass `0.21`,
  `ℓ ≤ 2` ⇒ `W ≤ 0.42 < W_min`. Does not surface alone, however many items it rates. The
  ceiling for anyone reached through one friend is that friend's whole onward mass, `0.5`, so
  `W ≤ 1.0` and `s ≤ 0.5` on an item only they rated — reached only when the friend has no
  other neighbours to share it with.
- **A swarm of mimics behind one friend** (any number, any wiring): total `π̃(S) ≤ π̃(f)`.
  For a captured friend that is at most `4/3` friend-units with maximal feedback and `1`
  without; an ordinary friend other routes also reach can weigh more, and the swarm with it
  (1.050 measured, §2.4). At the captured bound `W ≤ 2.7` and
  `s ≤ 0.73` on an item only they rated — enough to surface their promotions, and it stays
  enough: there is no outcome-based blame (§2.5). What the swarm loses by being disliked is
  only what §2.3 charges any account: disagreements in `D`, which lower its members' alignment
  and so the `ℓ` its mass is multiplied by — per account, and the friend who accepted them is
  charged the same way for the items the friend also rated. So the swarm keeps its shots for as
  long as the edge exists, at the ceiling above, and what bounds the damage is §2.9a's
  measurement rather than a reaction: it costs an attacker one real person's acceptance per
  ring, and the ring does not propagate.
- **Lone stranger noise**: one coincidental agreement on an item two friend-units split,
  `ω = 0.8`, `κ = 8` ⇒ `â ≈ 0.55`, `ℓ ≈ 0.18`, at `π̃ ≤ 0.21` ⇒ `W ≤ 0.04`. Invisible.
- **Transitive discovery**: a person two hops out with 40 agreements and 0 disagreements on
  contested items, through a friend with 10 other unaligned friends: `ℓ = 2`, `π̃ = 0.21` ⇒
  effective `0.42`; through a friend with no other neighbours to share the onward mass with,
  up to `1.0` — above a fresh direct friend, below a well-aligned one (`2`). The affinity
  split is what earns the difference, and a well-aligned neighbour is preferred over an
  unaligned one by exactly `e^{2}`, so a friend's onward mass concentrates on the aligned
  branch without anything being learned. Through a friend with
  few other friends the non-backtracking walk has nowhere else to go: a chain `u – f – g – h`
  of degree-2 nodes gives `h` exactly `0.25`, effective `0.5` at `ℓ = 2`. Deep discovery is
  real but modest; suggestions (§5) are how a distant kindred spirit becomes a direct friend.
- **Truncation**: with `ε_total = 0.02` and `L = 2`, no score moves by more than
  `ε_total·L / (1 + W) = 0.04 / (1 + W)` versus the exact walk over the loaded set *at a given
  pass* — mass beyond the nearest `N_max` people is outside it (§2.4). **This is not the whole
  of the error and must not be drawn as if it were**: the other half is how far §2.2's loop was
  still moving when it stopped, and which of the two is larger is a fact about the graph, not a
  constant. §1 "The bar" takes the maximum of both and draws no finer than that, at any `ε`,
  including a walk that ran out of budget or a loop that hit its cap. A walk that could not
  meet `ε_total` at all draws nothing new, because it writes no feed (§2.4), and a pass cut
  short by the budget never reaches the bar either (§2.2).

### 2.9a How far a paid recommendation actually travels — measured

The bounds above are about one viewer. The attack that pays for itself is not one viewer: it is
a business that wants one item in front of as many people as possible. `rust/examples/spread.rs`
runs it. Each person who accepts a bot's friend request gets their own group of bots, which read
their own feeds to copy that person's taste and then promote a single item; the whole honest
population's feeds are then computed and the item's score read out of each one.

**The result, pooled over seven seeds — 240 people each, three taste groups, nine friends
apiece, three accepted requests:**

| steps from whoever accepted | people | see the item at all | mean `s_u` |
|---|---|---|---|
| 0 — accepted the request | 21 | 21 (100%) | `+0.98` |
| 1 — their friends | 172 | 92 (54%) | `+0.49` |
| 2 | 900 | 11 (1.2%) | `+0.42` |
| 3 or more | 587 | 1 (0.2%) | `+0.35` |

The cliff is between the first ring and the second, and it is almost total: 54% of the duped
person's friends against 1.2% of the ring beyond them.

Three things follow, and they are the sharpest statement of §2.1's threat model that exists:

- **Whoever accepts is fully taken.** Near the top of the scale, and copying barely matters to
  it (`+0.98` with copying, `+0.93` without). Accepting a bot's friend request means being shown
  what it is paid to show you. No part of §2 is trying to prevent that, and none can.
- **Copying is the only reason it travels at all.** With the same bots promoting the item and
  copying nobody, the item reaches **exactly zero** people beyond the ones who accepted, at every
  distance. Mimicry is not an amplifier on top of a working attack; it *is* the attack's entire
  reach past the first person.
- **And copying cannot be done twice.** A group of bots that has copied one person is, by
  construction, wrong for anyone whose taste differs — which is everybody the copied person
  disagrees with. So the leak past the duped person is one weak ring: about half of their
  friends, at half the strength, and 1% of anybody further. **Agreement is
  measured on the items people disagree about (§2.2), so the very ratings that earn trust with
  one person are the ones that forfeit it with the next.** That is the property doing the work,
  and it is why there is no mechanism here that tries to detect a bot.

Two supporting measurements from the same file. **Bots are free and worthless**: 30, 120 and 480
bots behind three accepted requests swayed the same 17 people out of 120, and the item's mean
score fell slightly as the swarm grew. **Effort scales with the target**: with friend counts held
at nine, three accepted requests reach 17 of 120 people, 13 of 240, and 11 of 480 — the absolute
reach per accepted request is roughly fixed, so holding a constant *share* of a growing network
costs proportionally more real people saying yes.

Stated as the guarantee: **an attacker's reach is bounded by the number of real people who accept
a friend request, and nothing they can buy — bots, compute, better copying — substitutes for
that.** What copying buys is one weak ring around each of them.

Caveats, because this is measurement and not proof: the ring table is seven seeds, the sweeps
are one world per configuration, and the simulator's model of taste is the one this design
assumes. The shape (flat in bots, linear in accepted requests, decaying in steps) is robust
across the seeds and densities tried; the constants are not claims.

### 2.10 Estimating the priors from the population

`κ` and `a₀(d)` are moments of distributions the data exhibits, so they are estimated by
empirical Bayes from the population and the estimates are what every recompute uses; §2.8's
constants apply only until enough data exists. They are the **only** non-local quantities in
the design — everything else in §2 is a function of one viewer's own neighbourhood.

**The estimator.** The alignment prior is `Beta(κ·a₀(d), κ·(1 − a₀(d)))` by distance. Over all
pairs `(u, v)` at hop distance `d` with weighted overlap `A + D ≥ n_min = 10`, the observed
agreement rates `A/(A + D)` have a mean and a variance. Method of moments: the mean is
`a₀(d)`; the variance of a Beta-binomial proportion with `n` trials is
`m(1−m)·(1 + (n−1)/(κ+1))/n`, so the excess of the observed variance over the sampling
variance `m(1−m)/n̄` gives `κ` — pooled across distances, one `κ`, and one `a₀` per distance
class `d = 1, 2, ≥3`. A class with fewer than `N_min = 200` pairs keeps the table value for
that class.

**They are running tallies, not a job.** A recompute already computes an alignment for every
pair `(u, v)` in the viewer's reach, at a hop distance it already knows, so it already holds
every sample the estimator wants. It reports its own partial sums into twelve `user_model`
columns, per distance class `d1/d2/d3`: `pair_n`, `pair_sum` and `pair_sumsq` — a count, a sum
and a sum of squares of `A/(A+D)` — and `pair_overlap`, `Σ(A + D)`, because `κ`'s moment
equation needs the mean overlap `n̄` and the other three cannot supply it. A scheduled statement
in the database pools them across viewers into `private.params`, applying the `N_min` guard per
class. Counts, sums and sums of squares are all a mean and a variance need, and they add, which
is the whole reason this shape works. The simulator keeps `estimate_priors(snapshot)` in the
crate, so the same estimator runs over synthetic worlds, the recovered `a₀(d)` and `κ` must land
near the generating values, and `rust/tests/priors.rs` checks the pooled tallies land where the
batch estimate does.

**Where the estimates live.** `private.params`, server-only, with no client verb of any kind:
reading it would hand out an aggregate nobody is shown anywhere else, and writing it would
move the prior behind every feed at once. The recompute reads it at the start of a run and
falls back per field to §2.8's table where a sample is below `N_min`, so a missing or partial
row can only fail to move a number.

### 2.11 Attribute similarity: proposing attributes to apply

**What it is for.** The entity screen ends in a row of dashed chips headed *suggested* — the
attributes this viewer might want to apply to this thing. The problem it solves is that an
attribute nobody has ever put on a thing does not exist for it: §2.6 scores the tag ratables
that exist, and a viewer who would happily answer "is it *quiet*?" is never asked unless someone
in reach already asked it. The suggestion is the ask. It is not a recommendation and it is not a
score: a chip proposes a question, and the answer is the viewer's own thumb. It is computed by
`shared/src/suggest-attributes.ts`.

**It reads the viewer's own ratings and nothing else.** Not the neighbourhood, not the walk's
output, not any aggregate over anybody. This is stricter than the reach bound the rest of §2
works under, and the reason is an attack rather than a privacy rule: **if candidates came from
the network, somebody could poison your suggestions by rating the things you rate.** Drawing
only on your own vocabulary makes that impossible by construction. It also means the
computation runs **on the client**, since a viewer already holds their own ratings — no budget,
no server round trip, nothing taken from the walk, and the row re-ranks the instant you give a
thumb.

**The consequence: it can only ever propose a word you have already used.** That is the feature
and not the limitation — you can type any attribute you like, so your own vocabulary grows on
its own, and the row is a convenience over words you have already chosen rather than a channel
through which new words arrive.

**The estimator: maximum coverage over your own history, chosen greedily.**

Let the viewer's history be the things they have rated, each carrying the attributes they rated
on it — **a thumbs-down counts**, because a chip asks a question and engaging with the question
is what makes the word yours, not the answer. For a candidate attribute `t`, let `U(t)` be the
things in that history carrying `t`.

For a thing the viewer has rated no attributes on, choose the suggestion set `S` to maximize

    V(S)  =  Σ_{i in history}  f( |{ t in S : i carries t }| ),    f concave, f(0) = 0

with `f = sqrt`. Add one attribute at a time, each time taking the one that raises `V` the
most: most-used attribute first, then whichever covers the most things the first one missed.
Because `V` is monotone and submodular, adding greedily is within `1 − 1/e` of the best set of
that size. The estimator is therefore derived, with a bound, rather than chosen.

**The concavity is what makes a special case unnecessary.** Once every rated thing carries one
of the suggestions, the useful next step is the things carrying only one, then two; a concave
`f` produces exactly that cascade at every depth on its own — covering something already covered
still helps, just less. With `f` linear the objective is just total usage and the suggestions are
near-duplicates; with `f` a step function it is plain coverage and it stalls once everything is
covered.

**Once the viewer has rated attributes on this thing, the history narrows.** Let `A` be the
attributes **the viewer themselves** has rated here — not every attribute shown on the screen,
which would let other people's ratings steer the row. Weight each thing `i` in the history by

    w(i)  =  |attrs(i) ∩ A| / |A|

and maximize the same `V` against those weights: a thing carrying two of the three counts two
thirds. Not `|attrs(i) ∩ A|` unnormalized, which lets a thing with many attributes dominate, and
never a filter — requiring a thing to carry *all* of `A` collapses to nothing after two
attributes. **The row holds at most five chips**, which is what fits two lines at the chip sizes
`web/DESIGN-UI.md` gives. Rating one more attribute re-ranks the whole row, which is free here
because the computation is local.

**No floor, and no quiet mode.** A viewer who has rated five attributes gets those five
proposed. The row is a convenience, not a claim, and the most-used-of-five is still a better
guess than an empty row. A viewer who has rated no attributes at all gets the heading over an
empty rail, never filler.

**What it must satisfy:**

- **No attribution, ever.** A chip says *suggested* and nothing more. Not "people like you", not
  "3 of your friends", not a source (§4).
- **No number is shown.** No bar, no count, no rank that reads as a score. Rank order within the
  row is allowed; it is what a list is.
- **It changes no score.** A suggested attribute the viewer ignores leaves the feed exactly as it
  was. Only a thumb moves anything.
- **Incentive-compatible by construction**, because it proposes questions rather than answers,
  and because nothing anybody else does can reach it at all.

The rule that a chip tapped but never thumbed creates nothing is §1's (item 4 of "The one view").

## 3. System design

### 3.1 Stack

Next.js static export on GitHub Pages, React, Tailwind, Biome, Bun for scripts and tests. The
backend is **Supabase**: Postgres with row-level security, PostgREST in front of it, GoTrue for
auth, Realtime for the two channels that have to feel live, and two Deno Edge Functions for the
per-viewer work. **Nothing runs on a schedule outside the database** (§3.7). Repo layout:

    web/            Next.js app (static export). The only thing a user touches
    shared/         pure TypeScript used by web/ and both Edge Functions: id
                    normalization, the search fold, feed folding, the staleness rule
    rust/           the one Rust crate, no I/O: the algorithm of §2, the simulator,
                    property tests; built to WebAssembly by wasm-pack
    supabase/       config.toml (auth providers and redirect URLs, in the repo),
                    migrations/ (schema, grants, policies, server-only functions, cron),
                    functions/, tests/ (pgTAP), seed.sql
    .github/workflows/  ci.yml, web.yml (deploy)

**Why a row store.** Everything in §2 is local: nothing needs global state, and every recompute
needs the viewer's neighbourhood. A document store bills that neighbourhood per document —
on Firestore, two reads per loaded node, up to `N_max` — so the cost of one recompute scales
with reach and the free tier is gone at about a hundred users. Postgres returns the same
neighbourhood as one query, and the cost becomes bytes moved rather than documents read. That
matters beyond the price: bytes compress and can be cut by reading fewer ratings (§3.8), where
documents per node is a floor nothing gets under. Holding the whole world resident in a
long-lived function, so that a recompute reads nothing, is the rejected alternative: it fights a
platform whose functions are short-lived, replaces a per-viewer cost with a per-instance one,
and scales with the size of the population rather than the size of a neighbourhood.

`rust/` is the only place the algorithm lives. It takes a snapshot in, returns results out, and
does no I/O, so `cargo test` runs the simulator and the property suites in seconds against
nothing. `scripts/build-wasm.sh` builds it for two targets: `web` for the Edge Functions, which
Deno initializes from bytes they read themselves, and `nodejs` for `rust/examples/smoke.mjs`,
the one thing that runs the boundary outside Deno; CI builds both. Neither build is committed.
Rust rather than TypeScript because the per-viewer compute (§3.4) is on the request path under
a CPU ceiling, and the simulator runs thousands of synthetic worlds.

### 3.2 Postgres schema

Column names are `snake_case`; the client sees them through PostgREST under the same names.

```sql
profiles          (id uuid pk -> auth.users, username text unique, display_name text,
                   photo_url text, searchable bool, created_at timestamptz)
friendships       (user_id, friend_id) pk, since timestamptz          -- both directions stored
connect_requests  (from_id, to_id) pk, created_at
items             (id text pk, search_id text not null, created_at, created_by uuid)
                  -- id IS the name; search_id is it with accents/punctuation stripped,
                  -- client-written from `searchFold`, its own text_pattern_ops index,
                  -- checked by a script rather than by a trigger (below)
ratings           (user_id, item_id, tag) pk, value smallint, rated_at timestamptz
user_prefs        (user_id pk, discoverable_by_taste bool, dismissed_suggestions uuid[])
user_recs         (user_id pk, computed_at, entries jsonb, feed_hash text,
                   error real not null)          -- max(truncation·L, settle movement); §1
user_model        (user_id pk, computed_at, checked_at, suggestions_at, nodes_touched,
                   rating_count, truncation, boundary_residual, settle_movement,
                   passes, settled, recomputed, priors_at,
                   reach jsonb, reach_hash text, reach_reuses,
                   pair_n_d1, pair_n_d2, pair_n_d3,
                   pair_sum_d1, pair_sum_d2, pair_sum_d3,
                   pair_sumsq_d1, pair_sumsq_d2, pair_sumsq_d3,
                   pair_overlap_d1, pair_overlap_d2, pair_overlap_d3)  -- §2.10's tallies
suggestions       (user_id, rank) pk, suggested_id uuid
                  -- a name and an order, nothing else; the chips are computed on request
                  -- by `public.shared_attributes(uuid)` and stored nowhere (§5.1)
private.params        (one row: computed_at, kappa, a0_d1, a0_d2, a0_d3plus, samples)
private.debug_events  (id, user_id, kind, detail, at, expires)
private.ratings_changed (user_id pk, changed_at)                      -- trigger-written
private.write_budget  (user_id, day) pk, writes                       -- trigger-written
```

- **`friendships` is the adjacency**, a join is the read, and a deferred constraint trigger
  makes a one-sided friendship impossible at commit. The core's own reciprocity check stays as
  defence in depth against a later schema change; it is free and nearly always vacuous.
- **A handle is unique by index.** Claiming one is one statement, and `unique` is the guarantee.
- **A name is stored once.** No friend edge, connect request or suggestion carries a copy of
  anybody's name or photo: a friend, a pending asker and someone you are suggested to can each
  read your profile under RLS (§3.3), so a rename is a change to the only copy.
- **An item's id is its display text, and there is no `tags` table.** `items` holds `id`,
  `search_id`, `created_at` and `created_by`; the grants are `insert (id, search_id)` and
  `select (id, search_id)`, so the client writes both, from the one `searchFold` in `shared/`,
  and `created_at` and `created_by` are the server's. A tag has no row anywhere: it exists
  because somebody rated it. `"Late Night"` normalizes to `late night`, which is what a person
  would write and what every screen shows.

  What that costs is the creator's capitalisation, everywhere: `"Café Bleu"` is stored and
  shown as `café bleu`. §1 "The one view" puts the whole interface in lower case, so a stored
  capital would be a spelling nothing renders, and dropping it removes a second field per name,
  the rule that would keep it immutable, a client cache in front of it and the branch where a
  name is missing. An entry in the feed carries its id and that is its name, so there is
  nothing to look up. An item with no `items` row can appear in a feed — a ratings row can name
  an id nobody created — and that is harmless, because the id has been through the same folding
  and the same `CHECK`s the catalog holds and renders as the same plain text. `items` is the
  catalog: what creation spends a write budget unit on, and what the prefix search over things
  nobody in reach has rated reads.
- **Who created an item is never readable**: `created_by` has no `SELECT` privilege. It is also
  the one reference to a person that does **not** cascade from `auth.users`: `on delete set
  null`, because a thing's name is shared, permanent and pointed at by everyone's ratings, so the
  row has to outlive its creator. Null there means "added by an account that is gone"; any other
  `on delete` action would make an account that ever added a thing impossible to delete.
- **The feed is one row.** `entries` is one jsonb column, written in one statement, TOASTed out
  of line. `feed_hash`, the rounded feed signature, is what stops a recompute that landed on the
  same answer from moving `computed_at` (§3.4).
- **`user_recs.error` is the bar's quantum, and it is not `truncation`.** It is
  `max(truncation·L, settle_movement)` — the larger of the two errors §2.9 bounds, both on the
  score's own scale (§1 "The bar") — copied onto the one row the viewer may read, since
  `user_model` has no client verb of any kind and the bar cannot quantize itself to a bound it
  cannot see. The recompute writes both halves to `user_model` and only their maximum here, and
  either can be the larger, so a column named for one of them would be a trap. It rides out
  inline with the entries too, so the common path needs no second read. It is not a score, it is
  not about anybody, and nothing renders it: it is the step size of a drawing.
- **`user_model` is the recompute's own scratch row, with no client verb of any kind.** It holds
  the two stamps of §3.4; `suggestions_at`, taste search's own ten-minute window (§5.1), which
  cannot be read off the `suggestions` rows because a search that found nobody writes none; the
  walk report — `truncation`, `settle_movement`, `passes`, `settled` (§2.2) and
  `boundary_residual`, the mass that left the nearest `N_max` people, reported and never counted
  against `ε_total` (§2.4), all of which a rescore over cached masses carries through unchanged
  since it walked nothing; `reach`, `reach_hash` and the count of consecutive reuses that
  `REACH_REUSE_MAX` bounds (§3.4); and §2.10's twelve `pair_*` tallies.

Three things the schema says directly:

- **There is no column for an email address or a phone number**, so there is no key to park one
  under. A contact detail exists in exactly one place, the auth account, in a schema the API does
  not serve and no policy exposes — which is a narrower claim than "it is not in the database",
  and is the one worth making.
- **A rating's value is validated, and its key is columns.** One row per thumb means
  `check (value in (1, -1))`, and the thumb is keyed by `(user_id, item_id, tag)` — `tag` **not
  null**, with the empty string meaning the thing itself rather than one of its attributes. Each
  field carries the id `CHECK` on its own, and `tag` carries it or is empty. The sanitizers on
  both sides of the wasm boundary stay — they are what protects a walk from a schema change —
  and they check the two fields separately.

  **Inside the core one map key per rated thing is still wanted**, and the two fields join
  there with a **NUL** (`\0`): `café bleu` for the thing, `café bleu\0coffee` for one of its
  attributes. Postgres text cannot contain a NUL at all — the server refuses the byte on input
  — so no name anybody can type can forge the join or smuggle a second separator into a half,
  which matters because an id is arbitrary Unicode and no pattern could enumerate what a half
  may contain. The join is the core's and the wasm boundary's; it is never stored, never queried
  and never shown.
- **A thumb carries its own clock.** `rated_at` is 8 bytes on a row the neighbourhood query does
  not select. It is written from the first day because history cannot be backfilled, it is the
  time the thumb was *given* — turning one over moves it — and nothing reads it. It is not the
  staleness probe: a flip lowers no maximum and a clear leaves no row, so "have this viewer's
  thumbs changed?" is `private.ratings_changed`, one row per viewer that a trigger on `ratings`
  moves on every insert, delete and real change of value, and a trigger on `friendships` moves
  for each end of an edge that comes or goes. **Nothing in the UI surfaces either**, and §4 is
  written so that it does not have to: reconstructing a rating order from the column takes full
  database access, and anyone holding that already holds every rating. Surfacing it is a change
  with its own decision, and whoever makes it revisits the privacy page.

**Normalization.** One folding, in `shared/` and nowhere else, applied to an item id and to a
tag alike:

    lowercase  →  NFKC  →  collapse every whitespace run to one space  →  trim

and that is the whole of it. The NFKC comes **after** the lowercasing because lowercasing a
normalized string is not guaranteed to leave it normalized, and the last step has to be the one
whose output the column `CHECK` is about to test. `"Café  BLEU "` is `café bleu`, and a script
with no Latin in it survives intact — `日本` is `日本`.

**What is refused**, by the folding, by every caller and by the column `CHECK` as the second
copy:

- **Empty.** After trimming, an id of zero length. Every caller refuses it rather than writing
  it.
- **Control characters.** Nothing in Unicode category `Cc` or `Cf`, with `U+200C` and `U+200D`
  (ZWNJ, ZWJ) the two exceptions, because Persian and several Indic scripts need them to spell
  ordinary words and emoji sequences are built from them. The bidirectional overrides
  (`U+202A`–`U+202E`, `U+2066`–`U+2069`) are refused by name: one of those in a name reverses
  the rest of the row it is drawn in. Nothing in `Cs`, `Co` or `Cn` either. And no NUL, which
  Postgres would refuse anyway and which the core's own join depends on never seeing.
- **Anything that is not NFKC-normal.** `id is nfkc normalized` is a Postgres predicate, so the
  `CHECK` states this directly rather than approximating it with a pattern. It is what makes
  the id canonical: there is one byte sequence per name.
- **Over 128 characters**, counted in code points. The folding **refuses** rather than
  truncating — a cut at 128 can land inside a grapheme cluster or denormalize what it just
  normalized, and a silently shortened name is a different thing from the one somebody typed.
- **Leading or trailing whitespace, and any doubled space**, which the folding cannot emit and
  the `CHECK` therefore refuses.

Two lowercasings exist and they are two implementations of the same Unicode table: the
client's (`toLowerCase`) and the database's (`lower`, under a collation that is not `C`). They
can disagree on a handful of characters, and where they do the database is the authority,
because its `CHECK` is what decides whether the row exists.

**The catalog carries a second copy of every id with the accents and punctuation stripped off,
and that is what search matches against.** `search_id` — `cafe bleu` beside `café bleu` — has its
own `text_pattern_ops` index, so typing `cafe` finds `café bleu` in the catalog and not merely in
the feed the viewer already holds. Two alternatives were rejected:

- *Stripping only at query time* leaves the catalog's prefix search literal, so a viewer who
  types the unaccented name finds nothing, adds the thing again, and **splits the catalog** — a
  duplicate nothing in v1 merges (§1 non-goals) and that every later rating is then divided
  between.
- *A trigger computing the column* would put the stripping rule in SQL as well as in
  `searchFold`, where the two can disagree and a disagreement makes a row unfindable by its own
  name. (It could not be a generated column either: accent-stripping in Postgres reads a
  dictionary and is not `IMMUTABLE`.) So **the client writes `search_id`**. What a client gains
  by lying is a thing that turns up when somebody searches for a name it does not have; that is
  already available by naming the thing misleadingly, and a search result renders the real id,
  so the lie is visible the moment it is read.

What holds the two columns together is therefore a **check, not a constraint**: a script reads
`items` and asserts `search_id = searchFold(id)` for every row, using the one implementation.
It catches the app breaking its own rule, which is the real failure. `items` has no `UPDATE`
grant for anyone, so neither column moves after insert.

`search_id` is not a second identity. The id remains the key, the thing rendered, and the only
value any rating points at; `search_id` is an index into the catalog and is shown nowhere. Two
different things may share one, which is a search result with two rows in it and not a collision.
The primary key's own `text_pattern_ops` index serves the literal prefix and is not optional —
the collation is not `C`. Inside the feed, which is where most searching happens, the match is
done in memory and needs neither.

**Unicode admits strings that look identical and are not.** Latin `a` (`U+0061`) and Cyrillic
`а` (`U+0430`) survive NFKC as different characters, so `café bleu` and `cаfé bleu` are two
items that no reader can tell apart. NFKC removes the compatibility cases (`ﬁ` is `fi`,
full-width is half-width); the confusable cases it leaves. The mitigation is a **confusable
skeleton** (Unicode TR39: map each character to its representative, then compare) used for
lookup and duplicate detection — the search that finds a near-match compares skeletons too, so
someone who types the ordinary spelling sees the look-alike among the results and the person
adding a second one is shown the first. In §2.1's terms, this is bounded and not prevented:
nothing stops a determined account creating a homograph of an existing thing, and if nobody
searches for it nothing will surface it. What it buys is that the accident — two honest people,
two keyboards — is caught, and the attack costs a write budget unit per name and gains a
duplicate catalog row rather than anybody's ratings. The remedy if it is ever used in anger is
the one §4 plans for a misleading name: report and hide, per viewer and then operator.

### 3.3 Row-level security

Five conventions:

- **Schema isolation.** Anything no client may touch lives in schema `private`, which is not in
  PostgREST's exposed list — not a policy that can be got wrong, an address that does not exist.
  The params row, the diagnostics table, every policy helper and the neighbourhood loader live
  there.
- **Column privileges.** `GRANT INSERT (id, search_id)` on `items`: a column the client cannot
  write takes its default, and a column it cannot select is in no response. This is what makes
  `created_at`, `created_by`, `since`, `rated_at`, `at` and `expires` unforgeable.
- **Table privileges.** "No update verb and no delete verb, for anyone" is a `REVOKE`.
- **A daily write budget, in the database.** Every rating insert or update, every item created,
  every connect request sent and every diagnostics event draws on one allowance per account per
  UTC day, a number written once, in `private.daily_write_limit()`; deletes draw nothing. A
  `security definer` BEFORE trigger counts against `auth.uid()` in `private.write_budget` and
  refuses the write past the allowance with SQLSTATE `PT429`, which PostgREST serves as HTTP 429
  and the client says in a sentence with no number in it. The client cannot be what holds itself
  to this, since a crafted client is the case a budget exists for. Connect requests are on the
  list because a request is an INSERT event on the target's Realtime channel, and without a
  budget a send-and-delete loop would be an unbounded stream of them aimed at one person. A
  connection with no request identity — the Edge Functions, which write none of those tables —
  is not counted, and a scheduled statement deletes past days.
- **No policy reads another table directly.** Every cross-table predicate goes through a
  `security definer stable` helper in `private` — `is_friend`, `has_incoming_request_from`,
  `has_open_outgoing_request_to`, `is_suggested_to_me`, `is_searchable`, `is_discoverable` — so
  RLS never nests and never recurses. Policies say `(select auth.uid())`, never bare
  `auth.uid()`, so the planner evaluates it once per statement instead of once per row.

The policies themselves are short. A profile is readable by its owner, by a friend, by someone
who has asked to be their friend, by someone still findable whom they have asked, and by anyone
it is suggested to **while it stays discoverable** — `is_discoverable(p)` is `searchable` and
`discoverable_by_taste` both on, and the `suggestions` read policy and `shared_attributes` check
the same helper, so either switch going off withdraws the profile, the row and the chips at once
rather than at each other viewer's next search (a row naming someone outlives their switching
off, because only its owner's own search rewrites it). The two halves of a pending ask are
separate clauses because they are separate permissions, and only the sender's expires when the
target goes private. Friendships, connect requests, ratings and prefs are readable and writable
by the people they are about. `user_recs` and `suggestions` are readable by their owner and
writable by nobody, since the Edge Functions write as `service_role`, which bypasses RLS — a
planted suggestion row would be a stranger presented as vouched for by the algorithm, so there
is no client write verb on that table even for its owner. `user_model` is readable by nobody at
all; the only form in which alignment leaves the server is §5.1's chips, which name attributes
and never a person's standing. Items are readable by every signed-in user and creatable by them,
with no update and no delete for anyone.

**The whole of what a client may call**, and it is short, because a stored procedure here is a
transaction rather than a server: `claim_username(text)` (one statement over a unique index, after
`has_credential()`), `accept_connect_request(uuid)` (`security invoker`, so every policy still
applies to it — two friendship rows and the request's deletion in one transaction),
`dismiss_suggestion(uuid)`, `find_by_username(text)` and `profile_by_id(uuid)` (below),
`record_debug_event(text, text)`, which is the only write verb on a table in `private` and
supplies none of the three columns it stamps, and `shared_attributes(uuid)`, which returns at
most three attribute words for one exact other person and an empty array for anyone the caller is
not entitled to ask about (§5.1).

**Taste search itself is not a stored procedure and cannot be one.** It runs §5.1's deep walk,
the deep walk is the wasm core, and no `security definer` SQL function can host it — so it is a
second Edge Function beside `refresh-recs`, `supabase/functions/refresh-suggestions/`, and
nothing a client calls through PostgREST at all. The split is along that line: the half that is
one statement over two tables is a function here, and the half that needs the core is a server.

**`shared_attributes` is in schema `public`, on purpose, and that is not a relaxation.**
PostgREST serves only the schemas `config.toml` names, and `private` is deliberately not one of
them — so a function there is unreachable from a client *whatever* its grants, which is exactly
why the tables live there and exactly why this one cannot. It is `security definer` with
`set search_path = ''`, with `execute` **revoked from `public`** and granted to `authenticated`
alone, the shape `find_by_username` has and the answer to the second hazard below. It takes an
exact key, returns no rating, no count, no item and no rank beyond list order, and answers a
caller with no entitlement with an empty result rather than an error, because an error separates
"nothing to say" from "not allowed to ask". It decides whom it will answer for with
`has_incoming_request_from` and `is_suggested_to_me`, which itself requires `is_discoverable`.

Two triggers complete the schema and neither is callable: `handle_new_user()` on `auth.users`
creates the profile and prefs rows in the same transaction as the account, so "the profile is
missing" cannot happen for a signed-in user; and `assert_symmetric()`, deferred to commit, is
what makes a one-sided friendship impossible. The six policy helpers are the rest of schema
`private`, alongside `neighbourhood` and `load_nodes`.

**Two hazards are permanent.**

*Enumeration is the default.* A clause that authorizes reading a row authorizes reading every
row it matches, so `or searchable` in the profile policy would also authorize `select * from
profiles where searchable` — a dump of every findable account with their handles, which is a
global aggregate this app does not otherwise have and which §4 says it will not have. So the
`searchable` disjunct is *not* in the policy. It lives inside two `security definer` functions,
`find_by_username(text)` and `profile_by_id(uuid)`, each taking an exact key, returning at most
one row, and refusing a target who is not searchable. A pattern, a prefix or an unbounded limit
in either body is the enumeration they exist to prevent, and the same care is owed anywhere a
policy clause looks tempting.

*Postgres grants `EXECUTE` on a new function to `PUBLIC` by default.* `private.neighbourhood`
returns the raw ratings of up to `N_max` people, so a `grant execute` on it, or moving it to a
schema PostgREST serves, hands every viewer the ratings of everyone within two hops and breaks
§4's "nothing about another user is ever computed on a client". Schema isolation is the
mitigation; every migration is read with this in mind.

**One check is kept although it is currently vacuous.** `has_credential()` — an account that is
not anonymous and carries a confirmed email, a confirmed phone or a Google identity — gates
exactly one thing, claiming a handle, because handles are permanent and never released. With
Google as the only door every session passes it by construction. It stays because the thing it
guards against is a dashboard toggle rather than a code path: enabling anonymous sessions or a
second provider is a two-click change that ships no diff and passes no review, and it would
silently reopen permanent-handle squatting to accounts nobody can prove ownership of. Every
other check in this design guards against a client; this one guards against us.

### 3.4 Computation: per viewer, on open

**The neighbourhood is one function call.** `private.neighbourhood(viewer, max_nodes, max_depth)`
is a `WITH RECURSIVE` breadth-first walk carried in two arrays — the seen set and the current
frontier, one row per level — joined to `friendships` and `ratings` and aggregated into exactly
the `{ users, friendIds, loaded, ratings }` shape the wasm boundary takes. Since a rating is
keyed by columns (§3.2), a node's `ratings` come back **nested**, item to tag to value, with `""`
for the thing itself: `{"café bleu": {"": 1, "coffee": -1}}`, one inner `jsonb_object_agg`
grouped by item under the outer one grouped by node. Nested rather than an array of
`[item, tag, value]` triples because it writes each item id once, and egress is the scarce
resource (§3.8); not NUL-joined because Postgres text cannot hold a NUL, so the join happens in
the boundary wrapper on the way into wasm, which is the only place that wants a single key. The
set-at-a-time form is not a flourish: a node-per-row recursion cannot express a global row cap,
because `limit` on the outer select relies on demand-driven evaluation to stop the recursion,
which is an implementation detail and not a contract. Arrays of at most `N_max` uuids are tens
of kilobytes and `user_id = any(frontier)` is a bitmap index scan.

The node cap is the real bound and it is hard: the recursion stops the moment the seen set
reaches `N_max`, and the slice that cuts the crossing level is deterministic because each
level's ids arrive sorted. The depth bound is a backstop against a pathological low-degree
component spending unbounded recursion steps to reach `N_max`; at degree 15 the node cap binds
at depth 3, and the depth bound must never be small enough to become the thing that fires,
because a fixed horizon is exactly what §2.4 refuses.

The boundary set falls out for free: everyone named by a loaded node who is not themselves
loaded is a boundary node, with no adjacency and no ratings, whose residual the core reports.
The extra rounds chasing whatever residual is still worth reading are the same tail against an
explicit id list (`private.load_nodes`), one call a round. `N_max` counts every node a recompute
loads, rounds included. It does not bound reads so much as memory, CPU and egress, and egress is
the scarce resource (§3.8); it stays where it is for the CPU ceiling.

**The recompute is one Edge Function**, `refresh-recs`, called by the client on open and on
demand:

    verify the caller's JWT with GoTrue        -> uid, and from nowhere else
    read now(), user_model (computed_at, checked_at, reach, reach_hash, reuses,
         truncation, boundary_residual, settle_movement, passes, settled),
         private.ratings_changed
    staleness rule (keyed on checked_at, set or not)
                    -> if the answer still stands, return it without walking
    read private.params
    private.neighbourhood(uid)                 -> snapshot, at most N_max people
    hash the adjacency just loaded             -> rescoreUser(reach, stored walk report),
                                                  or computeUser in full
    computeUser(snapshot, uid, params)         -> §2.2's settling loop
    up to 3 x private.load_nodes(...)          while N_max has room and the boundary
                                                  residual is worth a read
    truncation > ε_total -> return the PREVIOUS row, recomputed: false,
         stamp checked_at, write no feed       (boundary_residual is not in this test)
    fold to one entry per item, hash the feed
    unchanged hash -> update checked_at only;  otherwise write user_recs and user_model
    return { computedAt, recomputed, entries, error, truncation, settleMovement }

**`computeUser` is a loop** (§2.2). It walks, recomputes contestedness and alignment from what it
found, and walks again until the largest movement of any score falls under `SETTLE_TOLERANCE` or
the pass count reaches `SETTLE_MAX_PASSES`; the movement it stopped at comes back beside the
truncation, the function writes their `max` (with `L` applied to the truncation) to
`user_recs.error`, and both separately to `user_model`, beside `boundary_residual`, `passes` and
`settled`. Reaching the cap is not an error and does not suppress the write — it makes the bar
coarser and nothing else. **A rescore walks nothing, so it reports nothing new about the walk**:
`rescoreUser` takes the stored walk report and hands it back unchanged, rather than claiming
`settled: true, passes: 0` over a loop that had not settled.

**`E_max` is a CPU backstop, sized from the invocation rather than from the graph.** A free Edge
Function is metered on the order of two seconds, and one recompute may call the core up to four
times — the first walk and three boundary rounds — so the walk's share is about 0.3 s of wasm
CPU per call: 10 000 000 pushes at a generous 30 ns each, on demand and deep alike; a walk gets
`min(reservation, E_max)` (§2.8). A converged loop over a full `N_max` measured 136 ms of
`computeUser` in wasm at worst (2 000 people × 50 friends, about 80 ms of it crossing the
snapshot and one scoring pass; 71–84 ms at 12–15 friends) and never more than 2.45 M pushes, so
the backstop is there for a pathological graph, not an ordinary one, and nothing is trimmed from
the loaded set to fit it (§2.4).

**The one case that writes nothing is a walk that could not meet `ε_total` inside the loaded
set** (§2.4). Mass that left the nearest `N_max` people is not part of that test: it is stored
as `boundary_residual` and ignored, which is the scope of the accuracy guarantee and not a
loophole in it. The function answers `200` with the *previous* `user_recs` row and
`recomputed: false`, so the client goes on showing what it had, and stamps `checked_at` so the
staleness window still applies and the next open does not pay for the same failure immediately —
which holds for a viewer with no earlier feed too, because the staleness rule asks whether
`checked_at` is set, not `computed_at`. Storing a feed from a walk that did not resolve would put
a number on the bar that is really a report that the computation failed.

**Two stamps, not one.** `checked_at` is stamped by every recompute, including one that found
nothing new, and is what the ten-minute staleness window keys on, so an idle viewer pays one
walk per window rather than one per open. `computed_at` moves only when a reader would see
something different, which is what the feed hash decides. A viewer whose thumbs changed since
the last *check* always recomputes — compared against `checked_at`, not `computed_at`, or a thumb
that did not change the feed would force a walk on every later open — and that is one primary-key
read of `private.ratings_changed`. Every stamp the recompute writes is the database's `now()`,
read before the neighbourhood is: the function's own clock after the walk would date a thumb
given mid-walk as already read.

**The reach masses are cached, and that is a small win.** `user_model.reach` holds the `π̃` map
the last full walk produced, at most `N_max` entries. The masses are a function of the friend
graph and the alignments, which move slowly, so a recompute whose inputs have not moved skips the
walk and rescores from the stored map. Whether they have moved is decided by checking, not by
being told: the recompute reads the neighbourhood on every call anyway, so it hashes the
adjacency it just loaded — the sorted friend lists of every loaded node — and compares against
`user_model.reach_hash`. Equal means the graph the walk ran on has not moved; different means a
full walk. That is exact, needs no trigger, no new table and no change feed, and costs one hash
over data already in memory. Two further conditions force a full walk regardless:
`private.ratings_changed` having moved for anyone whose alignment feeds an affinity the walk used
— ratings do not change the graph but they do change the steering — and a count of consecutive
reuses reaching `REACH_REUSE_MAX = 20`, a belt so that a long-lived cache cannot drift
unexamined.

What the cache does not save is the larger cost. The walk is on the order of milliseconds —
0.2–0.3 ms at 300 people × 10 friends, 1.6–2.4 ms at 2 000 × 12–15 — crossing the snapshot into
wasm costs more than the walk does, and the neighbourhood read costs more again. Skipping the
walk saves the *third* largest of the three, and is worth doing only because it is nearly free.
The change that would save the read — asking the database only for ratings changed since
`checked_at` and applying them as deltas to `entries` — needs a per-ratable delta path, a
reach-scoped change feed and a correctness argument against drift that nobody can check without
real traffic. It is deliberately not built; the ten-minute window already stops a viewer paying
repeatedly.

**Every query runs as `service_role`, and says so.** The connection logs in as `postgres`, and a
`role` startup parameter does not survive Supavisor, which forwards only `search_path`. So each
transaction opens with `set local role service_role` and checks `current_user` before doing
anything, which is what makes the grants in §3.3 the rights the function actually has. The
gateway's JWT check is off (`verify_jwt = false`); the GoTrue call above is the only thing that
refuses an unauthenticated request, and it refuses before any query.

**The feed is returned inline and also stored.** Inline because the function has the entries in
hand and returning them saves a second round trip; stored because a cold start and an offline
open need a row to read, and because a walk that did not resolve answers out of it (above).
Nothing else writes that row, so the one Realtime subscription on it covers exactly one case —
another tab or device of the viewer's own having called the function — and its payload *is* the
change.

**The CPU ceiling is the real constraint, and deserialization dominates it.** At degree 15 and
100 ratings a person, crossing ~23 000 rating entries into wasm costs more than the walk does.
Headroom is real but not generous and it shrinks linearly in ratings per user. The knobs, in
order: pass a smaller `edgeBudget`, which is a parameter and whose only consequence is that a
pathological region stops short of `ε_total` and keeps its last feed rather than getting a new
one; keep `N_max` where it is, since Postgres would happily return ten thousand nodes and the CPU
ceiling is why we do not ask; and only then reopen the boundary, by handing the core a JSON
string to parse inside wasm instead of a JS object. The third is a change to the core's signature
and is deliberately not taken.

**There is no background sweep of feeds.** A viewer's feed is recomputed when that viewer opens
the app and at no other time: a sweep would spend CPU and egress on viewers who may never open it,
and the walk is cheap enough that amortizing it buys nothing. If a warm feed turns out to be worth
having, it comes back as a queue drained in slices, which is the right shape for a small
per-viewer cost.

### 3.5 Client

- The list calls `refresh-recs` on open and on demand, keeps the returned feed in memory and in
  local storage (its own feed, which it may see anyway) for first paint and offline, and does
  all searching, fuzzy matching and filtering locally over it. It also loads the viewer's own
  ratings, to overlay them on rows and to honour the hide-rated eye. There is no "as of" line
  on screen; `computed_at` is what the Realtime subscription watches.
- Typing does two searches at once and shows one list: the loaded feed, matched fuzzily and
  accent-insensitively on an item's name **and** on its attributes, plus the catalog itself —
  `items` by prefix over both the normalized query against the primary key and the folded query
  against `search_id` — for things the viewer's reach has nothing to say about. Over the feed
  the fold happens in memory on both sides; over the catalog it matches the stored folded copy,
  so typing a name without its accents finds a thing the viewer has never heard of rather than
  offering to create it a second time (§3.2). The catalog query is what makes the *add* button
  honest: it is offered the whole time there is a query, and the client inserts `items` with
  `on conflict do nothing`, which settles a race between two people typing the same name by
  letting the loser read the winner's row instead of collecting a permission error. The insert
  happens on the first rating or attribute, not on the tap — a provisionally opened thing that
  the viewer backs out of writes nothing.
- The attributes on a row and on a thing's own screen are the tag ratables in the viewer's own
  feed entry for it, plus any the viewer rated themselves, ordered by `|s|` ascending on the
  thing's screen and left in feed order on a row. A chip renders the tag itself — there is
  nothing to look up and no cache in front of it.
- Ratings are written directly by the client into its own rows: an upsert for a thumb, a delete
  for clearing one. The feed updates on the next call.
- **Two Realtime channels over three published tables**: one channel for the viewer's own feed
  row, and one for the people screen, which carries `connect_requests` inserts in both directions
  *and* the insert of the viewer's own half of a new `friendships` pair. That third table is in
  the publication because "you are now friends" is the one event that matters to somebody who is
  not the actor. The publication is `insert, update` only, because a policy can bound a row but
  cannot bound a delete of anything (`0006_realtime.sql` gives the reason at length). No table is
  in the publication without a subscriber. The request half is also what puts the badge on the
  avatar's upper-right vertex, which is the only notification in the product. Profiles, prefs and
  suggestions change by the viewer's own action, which the client already knows about, or — for
  suggestions — when the viewer's own call recomputes them (§5.1); they are fetched on mount and
  on focus. RLS applies to Realtime, so nobody receives another viewer's row.

### 3.6 Auth: one door

Supabase Auth with **Google as the only provider**. No email link, no password, no anonymous
session, no phone, and therefore no mail sender of any kind. The provider list, the redirect
URLs and the flags that keep the other doors shut live in `supabase/config.toml`, in the repo
and in the diff, rather than on a console page someone has to remember to visit.

Three things follow:

- **A profile arrives named.** A trigger on the auth user creates the profile row and the prefs
  row in the same transaction, taking `display_name` and `photo_url` from Google's identity
  metadata. So "the profile is missing" cannot happen for a signed-in user, and the name gate
  covers the one real case: a Google account that carries no name at all.
- **The OAuth flow must not eat the fragment.** Every screen has its URL in the fragment, and
  Supabase's implicit flow returns the session as `#access_token=…`. The two cannot both be
  right: the router would be handed a fragment it cannot parse and an access token would sit in
  browser history. PKCE returns `?code=…` in the query string, which the client consumes and
  strips, leaving the fragment to the router. This is a correctness requirement, not a
  preference, and its failure looks like a routing bug.
- **The cost.** A person without a Google account, or unwilling to hand Google a record of which
  apps they use, cannot sign in at all — and the premise of grapevine is that you bring your
  actual friends, so a friend who will not use Google is a friend who cannot be invited. There is
  also no second door when Google's OAuth is down or misconfigured. Email link and anonymous
  sessions are additive, and what they need is mail sent from an owned domain with mail
  authentication on it, because a fresh consumer address sending sign-in links is filed as spam
  whatever the authentication — tolerable for a notification, fatal for a front door that *is* an
  email. Nothing sends mail from `grapevine.hafa.cc` — support mail is forwarded in, never sent
  out — so Google is the only door.

Google-only makes a fresh identity cost a Google account rather than a click, and **nothing in
§2.1's threat table changes**, because no row of it rests on the cost of an account. Requirement 2
is bounded by the friend *edges* connecting a sybil set to the honest network, not by the number
of accounts, and §2.4's "adding accounts to `S` re-divides a fixed pie" says the same thing from
the other side. What an attacker still has to buy is a friendship with a real person. A
fresh-identity cost is not a sybil defence and must never be written up as one.

### 3.7 Nothing runs on a schedule except three statements in the database

Three `pg_cron` statements, in migration `0005`, are the only scheduled work in the project:

- **`κ` and `a₀(d)` pooling** (§2.10). A recompute already computes an alignment for every pair
  in reach at a hop distance it already knows, so it reports its partial sums — count, sum, sum
  of squares and total overlap per distance class — into the twelve `pair_*` columns of its own
  `user_model` row, and a daily statement pools the rows checked in the last seven days into
  `private.params` under the `N_min = 200` guard. Nothing reads the whole graph to estimate them.
- **The diagnostics sweep**, which deletes expired `debug_events`.
- **The write-budget sweep**, which deletes past days from `private.write_budget`.

The two sweeps are load-bearing twice over: besides their own jobs, they are what keeps a free
project from pausing after seven days without database activity, so deleting the last of them
would do something nobody would guess.

There is no scheduler outside the database. A scheduled GitHub Actions workflow is disabled
automatically after sixty days of repository inactivity, and nothing goes red when it is; a job
run that way would also need a long-lived credential that bypasses RLS in a repository secret.

**Taste search runs on demand** instead, as a second Edge Function beside `refresh-recs`:
`supabase/functions/refresh-suggestions/` takes the caller's bearer token and answers 401 the
same way, loads the caller's neighbourhood, runs §5.1's search for that one caller and writes
that one caller's five `suggestions` rows as the service role. The people screen calls it on
open behind the same ten-minute staleness rule the feed uses (§5.1), which is what stops it
being a button that costs a deep walk. One viewer's whole search measured at most 15 ms, plus
about 6 ms reading the rows into the core (`docs/algorithm-notes.md` §9), against an invocation
metered on the order of two seconds; searching for everybody on a schedule would pay for people
who never open the app.

**This makes two servers, and the exception is stated.** The rule is that every user-facing
action is a direct PostgREST write under row-level security, because nothing about another user
may be computed on a client (§4). Suggestions are the second thing that cannot be: ranking
strangers by alignment needs strangers' ratings. **It is not folded into `refresh-recs`**
because the search is a second walk at the deep budget that almost nobody needs on any given
feed refresh; folding it in would make every refresh pay for it. Two functions, each with one
job, is cheaper than one function with a mode flag — and the mode flag would be a second entry
point in all but name.

### 3.8 Cost, and where the free tier breaks

Assumptions, so they can be argued with: friend degree 15, so a two-hop reach of about 226
people; `R` ratings a user; responses gzipped by the API gateway; a fifth of users active daily
at four opens, three of which pass the staleness window.

Storage is about 48 KB a user at `R = 100` and 117 KB at `R = 500`, against 500 MB: fine at a
thousand users, at the line at ten thousand. Egress is 120 KB per recompute at `R = 100` and
540 KB at `R = 500`, against 5 GB a month: about half the allowance at a thousand users and
`R = 100`, over it at `R = 500`. Invocations never bind. **Egress breaks first, at roughly one
to three thousand users**, against about a hundred for a store billed per document (§3.1).

What to change first, in order: stop shipping the whole feed on every open (send the top of it
plus a hash and let the client ask for the rest); stop fetching ratings for reach nodes whose
mass cannot matter, which needs the core to distinguish "has adjacency" from "has ratings" and
is the single largest saving available, because the first walk of §2.2's loop depends on the
graph alone and the graph is a tenth of the bytes a person's ratings are; and then pay, because
$25 a month buys 8 GB and 250 GB of egress and two thousand users is where a project has users
worth paying for.

The normalized ratings table is the one place this design spends storage for structure: a row is
about 110 bytes against 30 for a map entry, bought for the constraints of §3.2. If storage ever
binds before egress does, the fallback is one jsonb map per user and it changes no application
code, because the neighbourhood query already hands the core the aggregated shape.

An id is arbitrary UTF-8, so a name in a non-Latin script costs two or three bytes a character
instead of one — a few percent on both numbers, and nothing that changes where the line falls.
The neighbourhood's nested shape writes each item id once however many of its attributes a
person rated, which matters more, because the neighbourhood is egress and `items` is storage.
`search_id` is usually the smaller of an item's two columns, since folding strips characters and
never adds any.

`user_model.reach` is a map of at most `N_max` entries, which at `N_max = 2 000` is the largest
single thing the design stores per viewer after the feed itself. It is storage rather than egress
— no client may read `user_model` at all — and it buys the third largest of three costs (§3.4),
so it is the first thing to drop if storage ever binds before egress does.

## 4. Privacy and social safety

The stance: nobody's individual ratings are ever shown, and inferring them should take
deliberate, repeated effort rather than a glance. We do not try to make inference impossible;
that would cost recommendation quality for a guarantee nobody expects from a friends app.

- No screen ever shows counts, raters, averages, "N friends liked this", or who created an
  item. Scores are shown as a personal meter — four segments, a fill quantized to the error
  the walk can carry (§1 "The bar") — never as a number and never with a word beside it.
- Ratings are readable only by their owner; by the two Edge Functions, which read the
  neighbourhood of whoever is calling and write back only that caller's own scores and
  suggestions; and by `shared_attributes`, which reads one other person's rows against the
  caller's own and returns at most three words (§3.3). No process reads everybody's ratings at
  once.
- Minimum support `W_min` means an item does not surface from a lone second-hop source. A
  single direct friend's thumb clears that floor whenever the population's own agreement
  prior puts it there (§2.10 estimates that prior from the population as it accumulates, so
  it is a fact about the data rather than a guarantee this design makes), so with exactly one
  friend your feed is that friend's ratings, and with a few friends it still says that
  *someone* close to you liked an item. The friction is: no counts, no recency ordering, a
  coarse meter instead of a number, a staleness window, and the floor. The privacy page says
  this in plain words.
- An account's feed reveals the mass-weighted opinions of its reach. That is what any
  account, including a bot that a friend accepted, can learn about you: aggregate taste,
  never individual ratings.
- Friend lists are private: each connection is visible to the two people at its ends and
  nobody else. Either end can unfriend, which removes both rows in one statement, and with them
  the profile read and the reach that being friends gave. Nothing is public to signed-out
  visitors except the app shell.
- Being findable and being suggested are both switchable, and switching either off takes effect
  at once for everybody. Findable off means typing your handle finds nobody and turns
  suggestions off with it (§1 item 5). Suggestions off — or findable off — means every existing
  suggestion row naming you stops being readable, and with it your profile and your chips
  through that row (§3.3's `is_discoverable`); it does not wait for each other viewer's next
  search. A pending ask you sent cannot be withdrawn (§1 item 6), and one sent to you stays
  readable to you until you answer it.
- Item names and tags are the one channel of user-written text that everyone in reach can
  see, and a name can never change — it *is* the id (§3.2), so there is no verb that could
  change it and nothing that could be changed under it. A name like "blue bottle (rated by 9
  friends)" or a real person's name is therefore possible and permanent. v1 accepts this with
  three limits: names are rendered as plain text, never as links or markup; the folding
  refuses control characters, so a bidirectional override cannot reverse the row a name is
  drawn in; and a misleading name occupies only itself — anyone else can still create and
  find the name they meant, since identity is exact. A report-and-hide mechanism (per viewer,
  then admin) is the planned remedy, and it is also the remedy for a homograph of an existing
  name, which §3.2 says is bounded rather than prevented.
- Alignments are never shown, so there is no way to learn "the app thinks you and X
  disagree". There is no per-friend trust map (§2.5), and `user_model` is readable by nobody,
  not even its owner (§3.3). The one thing about alignment that ever leaves the server is
  §5.1's chips, which name attributes and never a person's standing.
- The operator of the project (whoever holds the Supabase project) can read the database to
  keep it working or when the law requires it; the privacy page says so. "Only you and the
  recompute" is a statement about grapevine's users and the app, not about the operator.
- An account whose only friend is you sees your thumbs as its feed, exactly as you would see
  theirs: the one-friend leak reads the same from either end of the edge.
- The recompute reads the friend lists and ratings of everyone in the viewer's reach, for
  the length of one call and no longer — at most the nearest `N_max = 2 000` of them, and what
  lies beyond them does not reach the viewer's feed at all (§2.4). That read is a database
  function in a schema the API does not serve, executed only by the server's own role: a client
  cannot call it, and no client ever receives another person's ratings, pseudonymized or
  otherwise.
- Nothing about another user is ever computed on a client. Whatever a client is served it can
  read — with DevTools, a modified bundle or a plain HTTP call — so serving another person's
  ratings is disclosure, not inference. And no transformed version escapes that: a score is
  `Σ_v π̃(v)·ℓ_uv·r_v`, linear in each person's ratings with weights the viewer can steer (befriend
  only `v`, and the feed is `v`'s ratings), so a per-person digest, a pseudonymized bundle, or a
  client that walks while the server scores all hand that person's ratings to the client in some
  encoding. The only per-viewer artefact that survives is the one the server already writes: the
  viewer's own feed.
- Diagnostic records carry an `expires` field and nobody reads one back. What deletes them
  is a scheduled statement in a migration, in the repo and applied by the deploy, rather
  than a console setting somebody has to remember to make and whose absence is silent.

## 5. Taste search

The on-demand walk stops where mass stops mattering. Someone with your taste who is far
away, or behind crowded intermediaries, gets a sliver of mass and no influence. Taste
search runs the *same* walk with the **deep** budget (`N_max = 50 000`, `ε_total = 0.001`) so
that trust is followed much further, and turns what it finds into friend suggestions. It runs
for one viewer at a time, when that viewer asks (§3.7). Accepting one creates an edge, after
which they count like any direct friend. It is a suggestion channel, not a trust channel:
nothing about a suggestion changes any score until the viewer accepts.

### 5.1 Mechanism

- Users opt in to being discoverable by taste (`user_prefs.discoverable_by_taste`; default
  **off**, one swipe on — the full-width line under the findable line on the people screen,
  which together with it is the whole of the settings (§1). Discoverability is reciprocal:
  off means you are named to nobody and your own list is empty. Being *named* in someone's
  list also requires being findable by username (`searchable`), because a connect request
  can only be sent to a findable person and a Connect button that always failed would be
  worse than no suggestion. So the two lines are coupled on the client: findable off takes
  this off too, and this on while unfindable turns findable on first — which takes a handle,
  so before one is claimed the line is not a switch at all (§1 item 5). **Named to nobody holds
  from the moment either goes off**: other viewers' rows naming you are not rewritten until
  their own next search, but `private.is_discoverable` — both switches on — is in the read
  policy on those rows and in every read that goes through them, so they stop being readable at
  once (§3.3). Non-discoverable users still carry mass through the walk; they are just never
  suggested.
- **One viewer's search, run for that viewer, on request.** `refresh-suggestions` (§3.7) runs
  the deep walk and full alignment from `u` and nothing wider. Candidates are discoverable `v`
  with `A_{uv} + D_{uv} ≥ 20` (twenty units of informative overlap), `ℓ_{uv} ≥ 1`, not already a
  friend, not dismissed, and whose current influence is negligible (`π̃_u(v)·ℓ_{uv} < 0.1` under
  the on-demand budget — people who already reach you are not suggestions). Rank by

      π̃_u(v) · ℓ_{uv}

  from the deep walk, and write the top 5 to `u`'s `suggestions` rows. **Who writes them**:
  the server, as `service_role`, on the caller's own behalf and for the caller's own rows only
  — there is no client write verb on that table, because a planted row would be a stranger
  presented as vouched for by the algorithm. It is called by the people screen on open, behind
  the same ten-minute staleness rule the feed uses, so an idle viewer pays for one deep search
  per window and a viewer who never opens the screen pays for none at all.
- **A row carries the attributes the two of you agree on, not a level of alignment.** A coarse
  level — "some in common", "lots in common" — is a number with a word painted over it and
  answers nothing a person is actually deciding: *lots in common* is not a reason to accept a
  stranger, and *coffee, cycling, sci-fi* is. The chips are the same ones the rest of the
  interface is made of, and the same ones a pending connect request carries.
- **Which attributes: the ones you agree on against the grain.** Not the rarest word, not the
  most-used one. A shared attribute is worth showing exactly when the two of you answered it the
  same way *and* that answer departs from what the rest of `u`'s reachable network says about
  that same item-and-attribute. Both of you liking the coffee at a place everybody around you
  also likes for coffee says nothing about the two of you; both of you liking the coffee at a
  place your network pans says a great deal. So, over every pair `(i, t)` that `u` and `v` both
  rated, and with the same shared answer `r ∈ {+1, −1}`:

      dev(i,t)  =  1 − r · s_u(i,t)        ∈ [0, 2]        (`r² = 1`, so this is `r·(r − s_u)`)
      D(t)      =  Σ_i dev(i,t)            over those pairs
      the chips =  the top 3 tags by D(t)

  `s_u(i,t)` is §2.6's ordinary tag score — the grain — read out of the viewer's own
  `user_recs.entries`, the on-demand feed; a tag missing from `entries` already means
  `W_u(i,t) < W_min`, which is exactly the pair this rule skips. It is **`u`'s own
  reach-weighted** one, never a global average, so §5.2's "no global aggregate" holds here as it
  does everywhere else. Nothing needs subtracting from it: §2.6 sums over `v ≠ u`, so `u`'s own
  thumb is never part of the grain it is measured against, and a *candidate* is by the rule above
  someone whose `π̃·ℓ` is already below `0.1`, so `v`'s own contribution is negligible by
  construction. On a **pending ask**, where no such rule applies and the asker may be close,
  `v`'s thumb does partly set the grain — which can only pull `s_u` toward `r` and shrink `dev`,
  so it understates the deviation and never overstates it. **Three chips** is the whole of the
  per-row cap; ties break alphabetically, so the list is a function of the data and not of
  iteration order.

  Two consequences, both wanted. An attribute on items nobody else in reach has an opinion
  about contributes nothing — there is no grain to go against, `W_u(i,t) < W_min` means
  `s_u(i,t)` does not exist, and the pair is skipped. And a person with a great deal in common
  with you in the ordinary way may show **no chips at all**, because agreeing with everyone is
  not what this measures. A row with no chips is a row with no chips; there is no filler.
- **What it reveals, in one sentence**: a chip says that, on at least one thing carrying that
  attribute, this person answered it the way you did and the two of you went against what your
  network thinks. It names no thing, no rating and no number — but that sentence is the
  disclosure, it is accepted, and §5.2 bounds it.
- The people screen shows them under *similar taste*. Sending a request is the ordinary
  connect request, and sending one **hides that person from the list until they accept**, so
  nobody is asked twice; the cost is that the asker cannot see their own pending ask (§1).
  Dismissed suggestions are not re-shown.
- **The chips are computed on request, by one query, and stored nowhere.** §1 puts the same
  chips under a pending connect request and under a suggestion, and **both use the same call**:
  there is no column and no second path. The attributes two people rated the same way is a join
  of `ratings` against `ratings`, and the deviation weighting needs only the viewer's own
  `user_recs`, which the viewer may already read. A *client* cannot run it, because it touches
  the other person's rows — so it is `public.shared_attributes(other uuid) returns text[]`,
  `security definer` with `set search_path = ''`, taking one exact user id and returning at most
  three tag ids and nothing else. It is in `public` with `execute` granted to `authenticated`
  alone, for the reasons and under the hazards §3.3 gives: it answers only for the two
  relationships named below, it returns no rating, no count and no item, and it takes an exact
  key so it is not an enumeration surface. Nothing is written, so nothing goes stale.
- **And it cannot be aimed, which is what makes probing a non-issue.** An instant answer looks
  probeable — rate something, ask again, watch whether a chip moves, and you have learned one of
  their ratings. It is not, because **you do not choose whose chips you see.** They are shown for
  exactly two kinds of person: one who **sent you a request**, and one who **is suggested to
  you**, which requires them to have `discoverable_by_taste` and `searchable` on, now and not
  merely when the suggestion was made. Both are explicit acts by the other person. Your own
  outgoing requests are shown to nobody and produce no chips for you (§1), so sending a request
  at a chosen target reveals nothing about them at all. An attacker can therefore only probe
  people who have already volunteered into their view, and cannot pick who those are — the same
  `profiles` read clauses already decide it. The residual: an account that turns its own
  discoverability on raises its chances of being suggested to *somebody*, and whoever that turns
  out to be is then probeable. It cannot choose who.
- **The function answers for those two relationships and refuses everything else.** It is the
  authorization rule, not a policy on a table, because it is a function: a caller with no pending
  request from the target and no suggestion row naming a still-discoverable target gets an empty
  list, not an error — an error distinguishes "no overlap" from "not allowed to ask", which is
  itself a disclosure.

### 5.2 Why this is acceptable under §2's threats

- **Sybils, of any shape**: ranking by mass × alignment means every candidate is scored by
  the trust path that reaches them. A sybil region behind one edge shares that branch's
  bounded mass, so each of its members ranks below any honest person reached by an equally
  strong path, and no region can fill the list unless it holds several distinct edges into
  the viewer's network — the same currency as everywhere else. No "one per cluster" rule
  is needed and none would help against sybils that are not friends with each other.
- **No global aggregate**: consensus `ω` is the viewer's own reach-weighted one from the
  deep walk, so edgeless sybils cannot blind or manufacture contestedness.
- **The decision is the viewer's**: a suggestion is vetted the way any friend request is.
  A bad accept costs one direct friend's worth — and that is the *whole* of what it costs,
  because nothing reacts to what crosses the edge afterwards (§2.5). What limits it is the
  ceiling and the viewer's own ability to unfriend, not a correction.
- **Leaks**: a suggestion says that `v` agrees with `u` on a lot of contested items, and up to
  three chips say *which attributes* the two agreed on against the network's own opinion
  (§5.1). That is a wider channel than a coarse level of alignment would be, and it is accepted
  rather than bounded away. What bounds it:

  - **A chip is a word, not a rating.** It names the attribute and never the thing, so it
    cannot be read as "`v` rated `café bleu`". The pair it came from is one of however many
    items in `u`'s reach carry that attribute, and `u` is not told which — or how many.
  - **The grain is `u`'s own.** `s_u(i,t)` is the viewer's reach-weighted score, so the
    selection is a fact about `u`'s network agreeing or not, and an outsider cannot compute
    the same list for somebody else's view of the same pair.
  - **It cannot be aimed, and that is what bounds probing.** The chips answer at once, so no
    delay protects them; §5.1 states the real bound: you do not choose whose chips you see, both
    of the relationships that produce them are the other person's explicit act, and your own
    outgoing requests produce nothing. What a probe would still cost somebody who has been
    volunteered into an attacker's view: `u`'s own thumbs are not in `s_u`, so flipping one of
    them does not move the grain — it can only add or remove an `(i,t)` pair from the both-rated
    set, and only a reorder of the top three shows. Getting a specific rating out of `v` that way
    means guessing the item *and* the attribute first, since neither is displayed.
  - **The floors, and the one place they do not hold.** For a **suggestion**: twenty units of
    informative overlap and `ℓ ≥ 1` before `v` is a candidate at all. For a **pending ask**
    neither applies — anyone findable may send you a request — so the chips under a request rest
    on the pair floor alone. That floor does hold on both paths: `W_u(i,t) ≥ W_min` before a
    pair has a grain to depart from, so a pair nobody else in reach has an opinion about is
    silently skipped and a chip never rests on a single other person's thumb. What a pending ask
    buys an attacker over a suggestion is therefore chips from somebody with *less* in common
    with the viewer, from a relationship the viewer did not ask for — bounded by the fact that
    the request is visible, refusable, and sendable only to a findable account.

  What is *not* claimed: that `v`'s ratings are unrecoverable. They are recoverable the way
  everything here is — deliberately, with a guess about which item is involved, by somebody who
  cannot choose whom to try it on. §4's stance is friction, not secrecy, and this is inside it.

### 5.3 Cost

**It is priced per viewer who asks, not per account.** One search is one neighbourhood read at
the same `N_max = 2 000` the feed uses, one crossing into the core, two walks over what was read —
the deep one to rank, the on-demand one to drop anyone the live feed already carries — and at
most five rows written: at most 15 ms of walking plus about 6 ms of crossing, measured over the
world the taste-search checks seed (`docs/algorithm-notes.md` §9). Behind the ten-minute
staleness rule, a viewer who opens the people screen repeatedly pays once a window and a viewer
who never opens it pays nothing.

**The constraint is egress, not CPU, and it is linear in nodes loaded.** The deep budget's
`N_max = 50 000` bounds the walk, not the read: the search reads the same neighbourhood a feed
refresh reads, so one opened after a refresh adds no egress of its own. At 50 000 nodes the read
would be on the order of a hundred megabytes, which fits nothing; if the search ever needs to
load more than the feed does, how far is a decision with an egress measurement behind it rather
than a constant to raise.

§5.1's chips add no walk: `s_u(i,t)` is already in the viewer's `user_recs.entries`, and the
chips are one pass over the pairs the viewer and one other person both rated — at most five
candidates a viewer after the candidate rule, plus whoever has an open request in.

A scheduled search for everybody would read the whole graph and every rating — about
`N × (0.4 + 0.028·R)` KB compressed, a few hundred megabytes a month at 10k users — spent on
everybody whether or not they ever looked. Paying per active viewer beats that whenever not
everyone is active, which is always; what it costs instead is that each payment has to fit
inside one invocation, and it does with two orders of magnitude to spare.
