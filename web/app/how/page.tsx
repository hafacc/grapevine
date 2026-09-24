import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import DocPage, {
  Figure,
  Formula,
  H2,
  List,
  link,
  P,
  TheMath,
} from "../../components/doc-page";
import {
  BarDiagram,
  BlameDiagram,
  ComputeDiagram,
  ContestedDiagram,
  FriendUnitsDiagram,
  OneFriendDiagram,
  ThumbsDiagram,
  WalkDiagram,
} from "../../components/how-diagrams";
import { REPO_URL } from "../../utils/contact";

export const metadata: Metadata = {
  title: "how it works — grapevine",
  description:
    "Thumbs, whose taste has matched yours, and why a thousand fake accounts behind one friend are worth no more than one.",
};

// The explainer. Eight sections, one idea each, and under every one a fold-out
// quoting the formulas from DESIGN.md §2 unchanged.
//
// The rule this page is written under: nothing on it may claim more than the
// design does. Where the design says "bounded, not prevented", so does this —
// §2.1's threat table is a list of things that are survivable, not impossible,
// and an explainer that rounded those up to "grapevine stops bot farms" would
// be the one piece of marketing in the app.
//
// A static route, like the other written pages: the whole text is in the
// exported HTML, so it reads with JavaScript off and offline.

const DESIGN_URL = `${REPO_URL}/blob/main/DESIGN.md`;

export default function HowPage(): ReactElement {
  return (
    <DocPage title="how grapevine works" route="/how/">
      <P>
        grapevine turns thumbs into a ranking that is yours and nobody else's.
        There is no global score, no average, and no screen that says who rated
        what. This page is the whole mechanism in plain words — one idea at a
        time, each with the formulas it comes from folded away underneath, taken
        from{" "}
        <a className={link} href={DESIGN_URL}>
          the design document
        </a>{" "}
        unchanged.
      </P>
      <P>
        Where that document says a thing is bounded rather than prevented, so
        does this page. Nothing here is rounded up.
      </P>

      <section id="thumbs">
        <H2>1. thumbs, and nothing else</H2>
        <P>
          The only thing you ever tell grapevine is that something is good or it
          isn't. No stars, no score out of ten, no review to write. A thumb can
          be changed or taken back at any time.
        </P>
        <P>
          <strong>
            You give one by swiping the row: right is yes, left is no.
          </strong>{" "}
          Swiping the way you already voted takes that thumb back — the strip
          revealed behind the row goes grey with a minus rather than green or
          red — and swiping the other way flips it straight over, with no step
          in between. On a wide screen a button welded to each end of the row
          does the same, no on the left and yes on the right. This page is the
          only place the directions are written down: the app itself says
          nothing about them, because a first screen teaching a gesture before
          there is anything to use it on teaches nothing.
        </P>
        <P>
          A <em>thing</em> is anything with a name: a restaurant, a film, a
          book, a trail, a brand of olive oil. A thing <em>is</em> its name,
          lower-cased and with runs of spaces squeezed to one, so “Café Bleu”
          and “café bleu” are one thing. Accents and punctuation are kept —
          “cafe bleu” is spelled differently — but searching ignores them, so
          typing either one finds the thing already there before it offers to
          add a second.
        </P>
        <P>
          You can also thumb a <em>tag</em> on a thing — <code>cheap</code>,{" "}
          <code>restaurant</code>, <code>date-night</code>. That answers a
          different question, “does this thing have this tag?” rather than “is
          it any good?”, through the same one mechanism. There is one namespace:
          a category and an attribute are the same kind of thing here.
        </P>
        <P>
          Thumbs on tags never count towards whether you and someone else share
          taste. Only thumbs on things do. Otherwise an account could tag ten
          thousand films <code>movie</code> and earn agreement with everyone for
          saying nothing.
        </P>
        <Figure caption="One thumb per thing, and one per tag on it. A tag chip carries the tag itself, never a count.">
          <ThumbsDiagram />
        </Figure>
        <TheMath of="thumbs and tags">
          <Formula>{`Ratings r_{v,x} ∈ {+1, −1}. Alignment (§2.3) is computed over
item ratables only; tag ratables are scored (§2.6) but never
used as evidence of shared taste.`}</Formula>
        </TheMath>
      </section>

      <section id="reach">
        <H2>2. who you can hear</H2>
        <P>
          Your friends, their friends, and onward — but not equally, and not
          forever.
        </P>
        <P>
          Picture a token that starts with you and steps to one of your friends
          at random, then wanders along friendships. Three rules: after that
          first step it has a one-in-two chance of stopping at every step; it
          never immediately goes back along the friendship it just crossed; and
          it never steps onto you. How often it arrives at a person is how much
          of that person you hear. One ordinary friend is the unit — call that
          one, a <em>friend-unit</em>.
        </P>
        <P>
          The one-in-two isn't a dial someone turned. It is the rate at which
          the arithmetic says something exact:{" "}
          <strong>
            everything that lies beyond any one friend weighs, in total, at most
            as much as that friend.
          </strong>{" "}
          Halve, halve again, halve again, and the whole tail adds to one. Some
          horizon is not a tuning knob but the definition of “personal” — an
          undamped walk forgets where it started and ends up measuring how
          popular people are.
        </P>
        <P>
          That one sentence is the defence against fake accounts. A thousand
          accounts behind one friendship are worth no more than one account
          behind it, however they are wired to each other: adding accounts
          re-divides a fixed slice, it doesn't enlarge it. What an attacker has
          to buy is not accounts but friendships with real people.
        </P>
        <Figure caption="Half the weight survives each step, so everything beyond a friend adds up to at most that friend — and a swarm behind one friendship shares that one slice.">
          <WalkDiagram />
        </Figure>
        <P>
          The token isn't blind, though. Out of any person it prefers the
          neighbours whose taste has matched yours, by exactly the odds that it
          has — and treats someone whose taste opposes yours no worse than a
          stranger. So at each step most of what goes onward follows the people
          who agree with you — the halving still applies — and a wide
          neighbourhood you have nothing in common with is dropped as soon as it
          can't matter. There is no fixed number of hops anywhere in this.
        </P>
        <P>Two things this does not do.</P>
        <List>
          <li>
            <strong>It never scales your own friends.</strong> What is injected
            at a direct friend is untouched by any of the above, so a friend's
            thumbs are judged only by how much you have actually agreed with
            them.
          </li>
          <li>
            <strong>It doesn't keep anyone out.</strong> A bot a friend accepted
            can reach you. It is bounded, not prevented —{" "}
            <a className={link} href="#limits">
              part 6
            </a>{" "}
            says what that costs.
          </li>
        </List>
        <TheMath of="who you can hear">
          <P>
            The walk prefers a neighbour by the odds they share the viewer's
            taste, when those odds are better than even:
          </P>
          <Formula>{`aff_u(y) = exp(max(ℓ_{u,y}, 0))      ∈ [1, e^L] ≈ [1, 7.4]`}</Formula>
          <P>
            Killing with probability <code>α = 1/2</code> is the one rate with a
            structural meaning here: “the mass that ever travels beyond a friend
            is <code>Σ_{"{j≥1}"} (1/2)^j = 1</code> times the mass injected at
            that friend, so{" "}
            <strong>
              everything that lies beyond any one friend weighs, in total, at
              most as much as that friend
            </strong>
            . That is the whole sybil argument, and it needs no further cap.”
          </P>
          <P>
            One ordinary friend is normalized to the unit, and the visit mass is
            a resolvent row of the non-backtracking transition operator —
            solved, never sampled:
          </P>
          <Formula>{`π̃_u(v) = π_u(v) · |F_u|

π_u = e_uᵀ · Σ_{k≥0} ((1 − α) B_u)^k = e_uᵀ · (I − (1 − α) B_u)^{−1}`}</Formula>
          <P>
            And for any set of accounts <code>S</code> reachable only through
            honest gatekeepers <code>h₁..h_k</code>:
          </P>
          <Formula>{`π̃_u(S) ≤ Σ_i  π̃_u(h_i) · P_{h_i}(S)`}</Formula>
          <P>
            “Nothing in the bound is <code>|S|</code>: adding accounts to{" "}
            <code>S</code> re-divides a fixed pie, and no chain, clique, or
            fan-out inside <code>S</code> can collect more than what entered.”
          </P>
        </TheMath>
      </section>

      <section id="belief">
        <H2>3. how much to believe someone</H2>
        <P>
          Reach says how much of a person you hear. It doesn't say whether to
          believe them. That comes from what the two of you have both rated.
        </P>
        <P>
          <strong>
            Agreement counts only where there was something to disagree about.
          </strong>{" "}
          Every thing is scored by how contested it is{" "}
          <em>inside your own reach</em>: one that everybody who rated it agreed
          about counts for nothing at all, an evenly split one with many votes
          counts for the most, and one that just two people split counts about
          two thirds. Your own thumb is one of the votes, at full weight.
        </P>
        <P>
          So agreeing that a universally loved film is good says nothing about
          whether you share taste; agreeing about a divisive one does. An
          account that copies consensus to look agreeable with everyone earns
          nothing — and because “contested” is measured inside your reach with
          the same bounded weights, a swarm can shift how contested a thing
          looks by no more than its bounded share.
        </P>
        <Figure caption="How contested a thing is inside your reach is how much agreeing about it says. Unanimous is worth nothing; an even split is worth the most.">
          <ContestedDiagram />
        </Figure>
        <P>
          Your agreements and disagreements with a person, each weighted that
          way, are then pulled towards a starting guess that depends only on how
          far away they are: a friend is weak evidence of shared taste (0.65), a
          friend of a friend weaker (0.55), anyone further away none at all
          (0.50). Data overrides all three. One agreement on a contested thing
          moves a stranger to about 0.55; ten agreements and no disagreements,
          to about 0.78; twenty, to about 0.86.
        </P>
        <P>
          That agreement rate becomes a weight — the log-odds of it, clamped at
          ±2: how much a thumb from them shifts your guess, up to a hard
          ceiling. It is positive for people whose taste matches yours, near
          zero both for people nothing is known about <em>and</em> for people
          who only ever agree about things nobody disputes, and negative for
          people whose taste reliably opposes yours: their thumbs-up is evidence
          you will dislike it.
        </P>
        <P>
          Negative is not a punishment. Someone whose taste reliably opposes
          yours is as useful to you as someone who reliably agrees; you read
          their thumbs upside down. Flip the sign of the weight and the sign of
          the rating together and the evidence is unchanged — so an anti-aligned
          account promotes something by thumbing it <em>down</em> exactly as
          well as a like-minded one does by thumbing it up. What limits any one
          account is the reach bound and the clamp, never the sign.
        </P>
        <P>
          The weight is symmetric: it is the same number read from either side.
          Which is also why an account can work out how aligned it is with its
          own reach — see{" "}
          <a className={link} href="#limits">
            part 6
          </a>
          .
        </P>
        <TheMath of="how much to believe someone">
          <P>
            Informativeness, over the reach-weighted vote counts{" "}
            <code>n⁺_x</code>, <code>n⁻_x</code> (the viewer included at{" "}
            <code>π̃_u(u) = 1</code>):
          </P>
          <Formula>{`ω_x = 4 · n⁺_x · n⁻_x / (n_x · (n_x + 1))       ∈ [0, 1),   0 if n_x = 0`}</Formula>
          <P>
            Over the <strong>items</strong> viewer <code>u</code> and person{" "}
            <code>v</code> have both rated:
          </P>
          <Formula>{`A_{uv} = Σ_x ω_x · [r_{u,x} = r_{v,x}]        (weighted agreements)
D_{uv} = Σ_x ω_x · [r_{u,x} ≠ r_{v,x}]        (weighted disagreements)

a₀(1) = 0.65,   a₀(2) = 0.55,   a₀(d ≥ 3) = 0.50
â_{uv} = (κ · a₀(d) + A_{uv}) / (κ + A_{uv} + D_{uv}),    κ = 8

ℓ_{uv} = clamp(logit(â_{uv}), −L, +L),    L = 2`}</Formula>
          <P>
            “
            <code>
              ℓ_{"{uv}"} = ℓ_{"{vu}"}
            </code>{" "}
            exactly.”
          </P>
          <P>
            Because how much you hear of someone depends on how aligned they
            are, and alignment depends on how contested things are within reach,
            the two are solved together: walk, work out the alignments that fall
            out of it, walk again, and stop when a pass moves no score by more
            than a ten-thousandth — far finer than the smallest step a bar can
            draw. The first walk is at the starting guesses alone and depends on
            nobody's ratings. If it is still moving after twelve passes it stops
            anyway and reports how far, and that distance is part of what the
            bar's step size is taken from.
          </P>
        </TheMath>
      </section>

      <section id="blame">
        <H2>4. what a wrong recommendation costs</H2>
        <P>
          Nothing in grapevine watches how a recommendation turned out and moves
          anything because of it. There is no credit and no blame on a
          friendship. Out of any person, the weight going onward is split
          between the friendships leading out of them by how much those people's
          taste has matched yours, and by nothing else.
        </P>
        <P>
          So what does a promotion you hated cost whoever pushed it? This much:
          you and that account now disagree about a thing that was contested,
          which lowers how aligned the two of you are, so their thumbs count for
          less with you from then on. That is charged{" "}
          <strong>per person</strong> — not per friendship and not per path. The
          friend who accepted the bot is charged for what they themselves rated
          and no more, and the way in is not narrowed at all.
        </P>
        <Figure caption="A thumbs-down lowers how much that account's thumbs count with you. The friendship it arrived along is exactly as wide as it was.">
          <BlameDiagram />
        </Figure>
        <P>
          <strong>This is a limit, and it is stated rather than fixed.</strong>{" "}
          An earlier version of grapevine learned a weight on every single
          friendship from your own thumbs, so that a run of bad recommendations
          arriving along one way in closed it. It was the largest thing in the
          code and it is deleted: what it was solving had no one answer, so how
          much of it got to run decided what came out — and an answer that
          depends on how much arithmetic it was allowed is not a bound. Nothing
          took its place, so there is one thing grapevine deliberately does not
          do: it cannot tell the friend from the bot behind them.
        </P>
        <P>
          What still holds is{" "}
          <a className={link} href="#reach">
            part 2
          </a>
          : whatever a swarm behind one accepted friendship does, all of it
          together weighs at most what that friendship does. That bound was
          never a consequence of the deleted machinery, and deleting it changed
          nothing about the guarantees — only about the extra claims the old
          version of this page made on top of them.
        </P>
        <TheMath of="what a wrong recommendation costs">
          <P>
            The only thing a disagreement moves is the pair's own agreement
            count, from{" "}
            <a className={link} href="#belief">
              part 3
            </a>
            :
          </P>
          <Formula>{`D_{uv} = Σ_x ω_x · [r_{u,x} ≠ r_{v,x}]        (weighted disagreements)
â_{uv} = (κ · a₀(d) + A_{uv}) / (κ + A_{uv} + D_{uv})`}</Formula>
          <P>
            “<strong>Outcome-based blame is not implemented.</strong> Nothing in
            grapevine watches what a recommendation turned out to be worth and
            moves anything because of it … so the friend who accepted the bot is
            charged alongside the bot.” The design says why that is survivable —
            the attack it would defend against is the expensive one aimed at one
            person, while the attack that scales is bounded by how many real
            people accept a friend request — and it names the published
            mechanism to build if it ever comes back, Resnick and Sami's
            influence limiter, so that it is not reinvented.
          </P>
        </TheMath>
      </section>

      <section id="shown">
        <H2>5. what you see, and what you never see</H2>
        <P>
          A thing's standing with you is a bar of four segments and nothing
          else: no word beside it, and never a number — a number is a figure to
          compare, and there is nothing to compare it against, because there is
          no global score at all. The fill steps in units no finer than the
          error the rebuild reported, so the bar cannot draw a difference the
          arithmetic can't support.
        </P>
        <P>
          <strong>There is no count anywhere.</strong> No “four friends liked
          this”, no average, no list of raters, no who created a thing. A tag
          chip carries the tag itself and no word, and a tag's own standing is
          drawn as a bar like anything else.
        </P>
        <Figure caption="A bar, no word beside it. Every count, percentage and name in the lower half is something no screen in grapevine shows.">
          <BarDiagram />
        </Figure>
        <List>
          <li>
            <strong>Below the floor, nothing is shown.</strong> A thing needs
            half a friend-unit of support before it appears at all, so a
            stranger you have never agreed with never surfaces anything by
            itself, and even one whose taste has matched yours perfectly only
            can when they are most of what one of your friends leads to.
          </li>
          <li>
            <strong>Your ratings are read by you and by the recompute.</strong>{" "}
            No one else using grapevine can read them — not your friends, not
            the people whose feeds they end up shaping.
          </li>
          <li>
            <strong>Nothing explains a recommendation.</strong> “Because Ana
            liked it” is a feature grapevine deliberately doesn't have.
          </li>
          <li>
            <strong>
              No screen says how aligned it thinks you are with anyone,
            </strong>{" "}
            so there is no way to learn “grapevine thinks you and X disagree”.
          </li>
          <li>
            <strong>A feed is a snapshot.</strong> It is rebuilt when you open
            the app if it has not been checked in over ten minutes or you have
            rated since, and it is the one you were last shown until then.
            Nothing is ordered by how recent it is, which is one more thing that
            would otherwise help someone work out who rated what.
          </li>
        </List>
        <TheMath of="what a score is made of">
          <P>
            Summing over every <code>v ≠ u</code> in reach who rated{" "}
            <code>x</code>:
          </P>
          <Formula>{`E_u(x) = Σ_v π̃_u(v) · ℓ_{uv} · r_{v,x}          (signed evidence)
W_u(x) = Σ_v π̃_u(v) · |ℓ_{uv}|                  (total weight = confidence)
s_u(x) = E_u(x) / (κ_s + W_u(x)),   κ_s = 1`}</Formula>
          <P>
            “Items with <code>W_u(x) &lt; W_min</code> (<code>W_min = 0.5</code>
            ) are not shown at all.” Tag ratables ask a factual question, so
            they are weighted by reach alone rather than by shared taste:
          </P>
          <Formula>{`E_u(i,t) = Σ_v π̃_u(v) · r_{v,(i,t)},    W_u(i,t) = Σ_v π̃_u(v)`}</Formula>
          <P>
            “With <code>ε_total = 0.02</code> and <code>L = 2</code>, no score
            moves by more than <code>0.04 / (1 + W)</code> versus the exact
            walk.” The bar's fill is quantized to that error, so what a viewer
            sees cannot move by less than it.
          </P>
        </TheMath>
      </section>

      <section id="limits">
        <H2>6. the honest limits</H2>
        <P>
          <strong>A mimic can't be spotted.</strong> An account can learn your
          taste from its own feed — every account's feed is the weighted opinion
          of its own reach, and you are in it — and then rate contested things
          the way you would before promoting whatever it exists to promote. That
          is real, and it is not detectable: a mimic is a perfect
          friend-of-a-friend. It is bounded, not prevented. Everything beyond
          one friend weighs at most that friend whatever it does, what any one
          account's thumb can count is clamped, and a friend's own thumbs are
          never scaled. A swarm of mimics behind one accepted friend never
          weighs more than that friend does — about 2.7 in confidence when the
          swarm is the friend's only way back to you, against a display floor of
          0.5 — enough to surface its promotions. Each one you thumb down counts
          as a disagreement with every account that pushed it, so what the rest
          carry drops with each thumb until they fall below the floor.
        </P>
        <P>
          <strong>With one friend, your feed is that friend's thumbs.</strong>{" "}
          Whether a single direct friend's thumb clears the display floor is not
          a promise this design makes: how much a friend's thumb is worth is the
          starting guess about a friend, and that guess is measured every night
          from how much people here actually turn out to agree with their
          friends (
          <a className={link} href="#numbers">
            part 7
          </a>
          ). As things stand it clears it, so with exactly one friend nothing is
          hidden: the feed simply is their thumbs. With a few friends it still
          says that <em>someone</em> close to you liked a thing. What stands
          between that and knowing who: no counts, no ordering by recency, a bar
          instead of a number, a staleness window, and the floor. That is
          friction, not secrecy, and the{" "}
          <Link className={link} href="/privacy/">
            Privacy Policy
          </Link>{" "}
          says so in the same words.
        </P>
        <Figure caption="With one friend the feed is that friend; with a few it says only that someone close to you liked a thing.">
          <OneFriendDiagram />
        </Figure>
        <P>
          <strong>
            “Your honesty is your best strategy” — exactly what that means.
          </strong>{" "}
          For every fixed state of everyone else's ratings and of the friend
          graph, reporting your true thumb is at least as good for your own
          results as reporting the opposite, and rating is at least as good as
          not rating, in expectation over which things you happen to rate. Three
          things that is narrower than it sounds:
        </P>
        <List>
          <li>
            <strong>In expectation — not on every single thing.</strong> You and
            a close friend who genuinely agree nine times in ten will disagree
            about something, and on that thing the honest report moves the
            estimate of your agreement away from the truth while a lie would
            move it toward it. No estimator can promise better than that, and
            the same holds for simply not rating.
          </li>
          <li>
            <strong>
              For every fixed state — which excludes an adversary who watches
              what you report.
            </strong>{" "}
            An account that rates by the sign of its own feed is mimicking your{" "}
            <em>reported</em> taste. There the honest reporter still wins on
            average but loses in about a quarter of simulated runs. That is not
            particular to grapevine: any method that trusts agreement can be
            baited by something that agrees on purpose.
          </li>
          <li>
            <strong>
              It is a claim about your own results, not other people's.
            </strong>{" "}
            Your ratings do influence your friends' feeds — that is the product.
            What grapevine claims is that the influence is earned by agreeing,
            bounded by friendships, and invisible, so there is no social payoff
            in performing a rating for an audience that cannot see it.
          </li>
        </List>
        <P>
          Two smaller things it also means. Rating something nobody in reach has
          rated, or something everyone agrees about, changes nothing — that is
          the “at least”. And every thumb on an obscure thing makes a sliver of
          alignment with whoever else happened to rate it, so the more long-tail
          things you rate the more strangers weigh a little; the prior and the
          one-vote-of-doubt keep a lone stranger's sliver under the floor.
        </P>
        <P>
          <strong>Names are public text, and permanent.</strong> A thing's name
          is written by whoever created it, is visible to anyone signed in who
          searches for it, and can never be changed — the name <em>is</em> the
          thing, lower-cased and with runs of spaces squeezed to one, and there
          is no second key underneath it to move. A misleading or unpleasant
          name is therefore possible and permanent. Two limits on the damage:
          names are drawn as plain text, never as a link or as markup, and
          searching ignores accents and punctuation, so a bad spelling doesn't
          block anyone else from the thing they meant. A way to report and hide
          one is planned and not built.
        </P>
        <P>
          <strong>Two names can look identical and be different.</strong> A
          Latin <code>a</code> and a Cyrillic <code>а</code> draw the same and
          are not the same letter, so two spellings of one name can both exist.
          Before offering to add a thing, grapevine strips both down to what
          they look like and shows you the one already there instead. That
          catches two people with two keyboards. It does not stop somebody doing
          it on purpose.
        </P>
        <TheMath of="why honesty pays">
          <P>
            The claim, in full: “for <strong>every fixed state</strong> of
            everyone else's ratings and of the graph, reporting your true thumbs
            is at least as good for your own results as reporting the opposite,
            and at least as good as not reporting,{" "}
            <strong>in expectation over which items you happen to rate</strong>
            .” Your reports reach your own results through exactly two paths —
            your own displayed state for a thing you rated, and the alignment
            estimates <code>â_{"{uv}"}</code>, which are what the walk itself
            reads — and:
          </P>
          <Formula>{`There is no third path: ω_x moves by at most u's one vote, the
first walk does not depend on ratings, and a report on x never
touches â_{uv} directly for a v who did not rate x.`}</Formula>
          <P>
            What the settling loop adds, stated rather than waved at: a report
            on one thing moves how much you hear of the people who rated it,
            which moves how contested <em>other</em> things look, which
            reweights pairs you are not in. Each round of that feedback is
            damped by the same contraction that makes the loop stop, so it is a
            few percent of the direct effect and in the same direction.
          </P>
          <P>
            What is excluded on purpose is “an <strong>adaptive</strong>{" "}
            adversary who conditions on your reports … in simulation the honest
            reporter still wins on average but loses in about a quarter of
            runs.”
          </P>
        </TheMath>
      </section>

      <section id="numbers">
        <H2>7. the numbers we chose</H2>
        <P>
          Every constant in grapevine is one of six kinds, and which kind it is
          matters more than its value. A <strong>derived</strong> number is
          forced by the arithmetic and could not be anything else. A{" "}
          <strong>cap</strong> is the guarantee itself. A <strong>prior</strong>{" "}
          is a starting guess that data overrides. A <strong>unit</strong> fixes
          the scale. A <strong>product</strong> number is a judgement about what
          to show. A <strong>budget</strong> bounds work: changing one changes
          how much error gets reported, never a guarantee.
        </P>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-[14px]">
            <caption className="pb-3 text-left text-[14px] text-muted">
              Every constant in grapevine, what kind it is, and why it exists.
            </caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th
                  scope="col"
                  className="label py-2 pr-3 font-semibold text-muted"
                >
                  kind
                </th>
                <th
                  scope="col"
                  className="label py-2 pr-3 font-semibold text-muted"
                >
                  name
                </th>
                <th
                  scope="col"
                  className="label py-2 pr-3 font-semibold text-muted"
                >
                  value
                </th>
                <th scope="col" className="label py-2 font-semibold text-muted">
                  why it exists
                </th>
              </tr>
            </thead>
            <tbody>
              {PARAMETERS.map(({ kind, name, value, why }) => (
                <tr key={name} className="border-b border-border align-top">
                  <td className="py-2 pr-3 text-muted">{kind}</td>
                  <td className="py-2 pr-3 font-mono text-[14px]">{name}</td>
                  <td className="py-2 pr-3 font-mono text-[14px]">{value}</td>
                  <td className="py-2 text-muted">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Figure caption="One ruler for how much is behind a recommendation — reach times alignment: the floor at 0.5, a perfectly aligned friend at 2, and a swarm behind one friend at 2.7 when that friend has no other route to you. The fresh friend's mark is the only one that moves: it is the starting guess above, at the value that runs until the nightly measurement replaces it.">
          <FriendUnitsDiagram />
        </Figure>
        <P>
          Three things carry no constant of their own at all: how much the walk
          prefers an aligned neighbour, how contested a thing is, and how tag
          thumbs are weighted.
        </P>
        <P>
          The two priors are the rows that are not chosen at all. Every rebuild
          reports how far the people it looked at turned out to agree — with
          their friends, with friends of friends, with everyone else — and once
          a night those reports are added up and used in place of the two in the
          table. They wait for their own evidence: until a few hundred pairs of
          people have rated enough of the same things, the value above is what
          runs, and a number that never gets its evidence never changes. Still
          to come: separate alignment per kind of thing — you and a friend may
          share film taste and not food taste — and then time decay on old
          ratings.
        </P>
      </section>

      <section id="computed">
        <H2>8. how it is computed</H2>
        <P>
          One viewer at a time, when that viewer asks. Nothing global, and
          nothing sampled.
        </P>
        <P>
          Opening the app asks for a rebuild: if your feed has not been checked
          in over ten minutes, or you have rated something since it was built,
          it runs; otherwise you get the one already there. Nothing rebuilds a
          feed nobody is looking at. Your own thumb shows up on your next
          refresh; a friend's reaches you within that window, or when you next
          open the app.
        </P>
        <Figure caption="A rebuild reads your neighbourhood, solves your row of the walk inside an error budget, and writes a feed only you can read.">
          <ComputeDiagram />
        </Figure>
        <P>
          A rebuild walks outward from you over friendships until it has loaded
          up to two thousand people or run out of graph, reads their ratings,
          and hands the whole snapshot to the algorithm — going back for more of
          the edge of it, up to three times, if too much weight was still
          heading there.
        </P>
        <P>
          <strong>The walk is solved, not sampled.</strong> No simulated random
          walks, and no global ranking personalized after the fact — a global
          ranking is exactly the wrong tool, because it would hand a small bot
          region weight in proportion to its size, which is the thing the whole
          argument exists to prevent. It is a linear system, and your row of it
          is computed directly by pushing weight out along friendships from you,
          always taking the largest piece still unsent.
        </P>
        <P>
          It stops when what is still in flight couldn't move any score by more
          than the error budget, or when the budget for how many people it may
          hold or how much arithmetic it may do runs out — and it reports how
          much it gave up, so the error is a number rather than a hope. The
          budget is set so that you can't see it: no score moves by more than
          0.04 divided by one plus its confidence, and the bar's fill steps in
          units no finer than that, so truncation cannot change what you read. A
          rebuild that can't get inside the error budget writes nothing, and you
          keep the feed you had.
        </P>
        <P>
          <strong>
            That guarantee is about the nearest two thousand people, and only
            them.
          </strong>{" "}
          Weight that would have flowed on to people further out than that is
          counted and then ignored, so their ratings never reach your feed. In
          tests against a walk over everyone, that moved no score by more than
          about 0.1 on its scale from −1 to 1, and about one thing in twenty
          dropped out of sight.
        </P>
        <P>
          It is deterministic. Ties are broken by an identifier, the answer is a
          function of the snapshot it read, and running it twice on the same
          snapshot changes nothing a reader can see the second time (it only
          notes that it checked).
        </P>
        <TheMath of="how the walk is solved">
          <P>
            The solve is by local push (Andersen–Chung–Lang): the residual lives
            on directed edges, and each push takes everything waiting at one
            person at once. It stops when:
          </P>
          <Formula>{`stop when  Σ |r| · (1 − α)/α  <  ε_total        (default 0.02, in π̃ units)
       or  nodes touched ≥ N_max                (2 000 on open; 50 000 for the deeper search behind friend suggestions)
       or  push work ≥ E_max                     (10 000 000, on open and deep alike: a CPU backstop)`}</Formula>
          <P>
            “Residual left at termination still counts as visit mass where it
            sits; only its onward flow is lost, and{" "}
            <code>truncation = Σ |r| · (1 − α)/α</code> is reported with the
            result.” The residual can be negative because each pass of the
            settling loop starts from the one before, hence the absolute value.
            Mass that walks out past the loaded people is reported separately
            and is not part of <code>ε_total</code>. “This is a true search: a
            path of strongly aligned people is followed as long as the mass on
            it can still matter, however many hops away it leads, and a wide
            unaligned neighbourhood is cut off as soon as it cannot.”
          </P>
        </TheMath>
      </section>

      <H2>the rest of it</H2>
      <P>
        What grapevine stores and who can see it:{" "}
        <Link className={link} href="/privacy/">
          Privacy Policy
        </Link>
        . What the screens do:{" "}
        <Link className={link} href="/help/">
          Help
        </Link>
        . The whole design, including everything this page left out:{" "}
        <a className={link} href={DESIGN_URL}>
          DESIGN.md
        </a>
        .
      </P>
    </DocPage>
  );
}

// What the two prior rows carry on top of their own description: they are the
// only rows whose value is measured rather than chosen (DESIGN §2.10), and until
// the measurement has enough behind it the number in the table is what runs.
const ESTIMATED =
  " — measured nightly from how much people here actually agree, and the value shown is the fallback while there is too little data to measure from";

// DESIGN §2.8's table, in its own vocabulary. The `kind` column is the point of
// it: a budget can be changed by anyone tuning cost, a cap cannot be changed
// without changing what grapevine promises.
const PARAMETERS: readonly {
  kind: string;
  name: string;
  value: string;
  why: string;
}[] = [
  {
    kind: "derived",
    name: "α",
    value: "1/2",
    why: 'the one killing rate at which "beyond a friend ≤ the friend" is exact (the chance the walk stops at a step)',
  },
  {
    kind: "cap (the guarantee)",
    name: "L",
    value: "2",
    why: "how much any one account's thumb can ever count; bounds per-account influence and truncation error (the ceiling on one person's weight)",
  },
  {
    kind: "prior",
    name: "κ",
    value: "8",
    why:
      "strength of the prior on pairwise agreement (how much agreeing it takes to overrule the starting guess)" +
      ESTIMATED,
  },
  {
    kind: "prior",
    name: "a₀(d)",
    value: "0.65 / 0.55 / 0.50",
    why:
      "mean of that prior at hop 1 / 2 / further (the starting guess about a friend, a friend of a friend, anyone else)" +
      ESTIMATED,
  },
  {
    kind: "unit",
    name: "κ_s",
    value: "1",
    why: "scoring shrinkage of one friend-unit (how much has to be behind a thing before its word moves off the middle)",
  },
  {
    kind: "product",
    name: "W_min",
    value: "0.5",
    why: "display floor: half a friend-unit (how much has to be behind a thing before it is shown at all)",
  },
  {
    kind: "product",
    name: "taste-search thresholds",
    value: "20 overlaps, 5 suggestions",
    why: "how much agreement it takes before a stranger with your taste is suggested, and how many are offered",
  },
  {
    kind: "budget",
    name: "ε_total",
    value: "0.02",
    why: "walk error tolerance, friend-units (how much weight the walk may leave unsent)",
  },
  {
    kind: "budget",
    name: "N_max, E_max",
    value: "2 000 / 50 000, 10⁷",
    why: "node cap on the walk, and a backstop on its arithmetic \u2014 past it the rebuild keeps the feed you had rather than writing a worse one (how many people it may hold at once, and how much CPU one rebuild may spend)",
  },
  {
    kind: "budget",
    name: "settle tolerance, pass cap",
    value: "1e-4, 12",
    why: "when the answer is called settled (how small a pass's largest move, and how many passes, before it stops and reports how far it was still moving)",
  },
];
