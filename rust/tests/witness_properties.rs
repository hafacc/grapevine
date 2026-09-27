//! The witness model's properties other than the sybil bound: DESIGN §2.3–§2.8 and
//! `docs/witness-model.md` §1.2, §1.5–§1.7, with every small graph enumerated.

use std::collections::{BTreeMap, BTreeSet};

use grapevine_core::witness::{Params, UserDetail, compute_all, compute_user_detail};
use grapevine_core::{ItemId, Ratable, Rng, Snapshot, TagId, UserId, WorldConfig, simulate};

fn detail_of(snapshot: &Snapshot, viewer: UserId, params: &Params, what: &str) -> UserDetail {
    compute_user_detail(snapshot, viewer, params)
        .unwrap_or_else(|error| panic!("{what}: no result: {error}"))
}

/// Everything that must hold of any result at all: finite, inside its range, and every person's
/// reliability no stronger than the head of their region. A score is checked against the closed
/// range here; that it never reaches either end is `a_score_never_reaches_either_end`'s.
fn check_sane(snapshot: &Snapshot, viewer: UserId, detail: &UserDetail, what: &str) {
    for (ratable, score) in &detail.result.scores {
        assert!(
            score.score.is_finite() && score.score.abs() <= 1.0,
            "{what}: {ratable:?} scored {}",
            score.score
        );
        assert!(
            score.confidence.is_finite() && score.confidence >= 0.0,
            "{what}: {ratable:?} has certainty {}",
            score.confidence
        );
    }
    let direct: BTreeSet<UserId> = snapshot.friends(viewer).iter().copied().collect();
    for user in snapshot.users() {
        let index = user.index();
        let (chain, reliability) = (detail.chain[index], detail.reliability[index]);
        assert!(
            chain.is_finite() && chain.abs() < 1.0,
            "{what}: {} is chained at {chain}",
            user.0
        );
        assert!(
            reliability.is_finite() && reliability.abs() < 1.0,
            "{what}: {} reads at {reliability}",
            user.0
        );
        if user == viewer {
            continue;
        }
        match detail.region[index] {
            None => {
                assert!(
                    chain == 0.0 && reliability == 0.0 && !direct.contains(&user),
                    "{what}: {} has no region but chain {chain}, reliability {reliability}",
                    user.0
                );
            }
            Some(head) => {
                assert!(
                    direct.contains(&head),
                    "{what}: {} is in the region of {}, whom the viewer does not trust directly",
                    user.0,
                    head.0
                );
                assert_eq!(
                    detail.region[head.index()],
                    Some(head),
                    "{what}: a head outside their own region"
                );
                let ceiling = detail.reliability[head.index()].abs();
                assert!(
                    reliability.abs() <= ceiling + 1e-12 && chain.abs() <= ceiling + 1e-12,
                    "{what}: {} reads at {reliability} (chain {chain}) past their head's {ceiling}",
                    user.0
                );
                for (tag, &value) in &detail.attribute_reliability[index] {
                    assert!(
                        value.is_finite() && (head == user || value.abs() <= ceiling + 1e-12),
                        "{what}: {} reads at {value} on {tag:?} past their head's {ceiling}",
                        user.0
                    );
                }
            }
        }
    }
}

/// §1.2: a chain is the product of its links, each below one in magnitude, so nobody reached
/// through someone is chained more strongly than them. Checked without knowing which link is
/// which: everyone reached who is not trusted directly has a neighbour in their own region, not
/// the viewer, chained strictly more strongly — the one their chain came through.
fn check_chains_shrink(snapshot: &Snapshot, viewer: UserId, detail: &UserDetail, what: &str) {
    let direct: BTreeSet<UserId> = snapshot.friends(viewer).iter().copied().collect();
    for user in snapshot.users() {
        let chain = detail.chain[user.index()];
        if user == viewer || direct.contains(&user) || chain == 0.0 {
            continue;
        }
        let region = detail.region[user.index()];
        let through = snapshot.friends(user).iter().any(|&other| {
            other != viewer
                && detail.region[other.index()] == region
                && detail.chain[other.index()].abs() > chain.abs()
        });
        assert!(
            through,
            "{what}: {} is chained at {chain} with no stronger neighbour in {region:?}",
            user.0
        );
    }
}

/// Four is enough for a pattern to make a thing unanimous, contested or unrated while keeping
/// the enumeration cheap.
const ITEMS: usize = 4;

/// The thumb `user` gives `item` under one pattern: nobody rating, a unanimous item, an even
/// split, and two sparse mixtures where most pairs share nothing. Pattern 5 adds attribute thumbs
/// on top of the last, so attributes, facts and attribute pairs are enumerated too.
fn thumb_of(pattern: usize, user: usize, item: usize) -> Option<i8> {
    match pattern {
        0 => None,
        1 => Some(1),
        2 => Some(if (user + item).is_multiple_of(2) {
            1
        } else {
            -1
        }),
        3 => (item == user % ITEMS).then_some(if user.is_multiple_of(3) { 1 } else { -1 }),
        _ => ((user * 3 + item) % 5 < 3).then_some(if (user ^ item).is_multiple_of(2) {
            1
        } else {
            -1
        }),
    }
}

/// Pattern 5's attribute thumbs: two attributes, tagged on things the person rated.
fn tag_of(pattern: usize, user: usize, item: usize, tag: usize) -> Option<i8> {
    (pattern == 5 && !(user + item + tag).is_multiple_of(3)).then_some(
        if (user + tag).is_multiple_of(2) {
            1
        } else {
            -1
        },
    )
}

/// A thumb's order against the viewer's: the viewer at 1, everyone else before (0) or after (2)
/// by a fixed rule, so the reaction mixture is enumerated too.
fn stamp_of(user: usize, item: usize) -> u32 {
    if user == 0 {
        1
    } else if (user + item).is_multiple_of(3) {
        2
    } else {
        0
    }
}

fn pair_count(nodes: usize) -> usize {
    nodes * (nodes - 1) / 2
}

/// One graph and one pattern, with original node `original` interned as `position[original]`.
/// Stamps follow the original label, so a relabelled snapshot is the same world renamed.
fn snapshot_of(nodes: usize, mask: u32, pattern: usize, position: &[usize]) -> Snapshot {
    let mut builder = Snapshot::builder();
    let users: Vec<UserId> = (0..nodes)
        .map(|index| builder.user(&format!("u{index}")))
        .collect();
    let items: Vec<ItemId> = (0..ITEMS)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let tags: Vec<TagId> = (0..2)
        .map(|index| builder.tag(&format!("t{index}")))
        .collect();
    let mut bit = 0;
    for first in 0..nodes {
        for second in (first + 1)..nodes {
            if (mask >> bit) & 1 == 1 {
                builder.edge(users[position[first]], users[position[second]]);
            }
            bit += 1;
        }
    }
    for original in 0..nodes {
        let user = users[position[original]];
        for (index, &item) in items.iter().enumerate() {
            let Some(thumb) = thumb_of(pattern, original, index) else {
                continue;
            };
            builder.rate_at(user, Ratable::Item(item), thumb, stamp_of(original, index));
            for (slot, &tag) in tags.iter().enumerate() {
                if let Some(value) = tag_of(pattern, original, index, slot) {
                    builder.rate_at(user, Ratable::Tag(item, tag), value, 0);
                }
            }
        }
    }
    builder.build()
}

fn identity(nodes: usize) -> Vec<usize> {
    (0..nodes).collect()
}

/// Every labelled graph on one to six nodes, every pattern, every viewer: a result exists, is
/// finite and in range, every region's members read no stronger than its head, chains only
/// shrink, and computing it twice gives the same bits. Six nodes carry two patterns rather than
/// six, which is already the bulk of the run.
#[test]
fn every_small_graph_has_a_sane_deterministic_answer() {
    let params = Params::default();
    for nodes in 1..=6usize {
        let patterns: &[usize] = if nodes == 6 {
            &[2, 5]
        } else {
            &[0, 1, 2, 3, 4, 5]
        };
        let position = identity(nodes);
        for mask in 0..(1u32 << pair_count(nodes)) {
            for &pattern in patterns {
                let snapshot = snapshot_of(nodes, mask, pattern, &position);
                for viewer in snapshot.users() {
                    let what = format!(
                        "n={nodes} mask={mask} pattern={pattern} viewer={}",
                        viewer.0
                    );
                    let detail = detail_of(&snapshot, viewer, &params, &what);
                    check_sane(&snapshot, viewer, &detail, &what);
                    check_chains_shrink(&snapshot, viewer, &detail, &what);
                    let again = detail_of(&snapshot, viewer, &params, &what);
                    assert!(detail == again, "{what}: two runs disagree");
                }
            }
        }
    }
}

/// Renaming everybody renames the answer and changes nothing else: the same things scored, the
/// same scores to rounding, the same chain and reliability per person. Every permutation on four
/// nodes, four fixed-point-free ones on five and six; every mask up to five nodes, one in
/// sixty-four on six.
#[test]
fn relabelling_leaves_the_answer_alone() {
    let params = Params::default();
    for nodes in 2..=6usize {
        let plain = identity(nodes);
        let stride = if nodes == 6 { 64 } else { 1 };
        for positions in relabellings(nodes) {
            for mask in (0..(1u32 << pair_count(nodes))).step_by(stride) {
                for pattern in [1usize, 2, 4, 5] {
                    let before = snapshot_of(nodes, mask, pattern, &plain);
                    let after = snapshot_of(nodes, mask, pattern, &positions);
                    for (original, &renamed) in positions.iter().enumerate() {
                        let what = format!(
                            "n={nodes} mask={mask} pattern={pattern} viewer={original} as {renamed}"
                        );
                        let here = detail_of(&before, UserId(original as u32), &params, &what);
                        let there = detail_of(&after, UserId(renamed as u32), &params, &what);
                        assert_eq!(
                            here.result.scores.keys().collect::<Vec<_>>(),
                            there.result.scores.keys().collect::<Vec<_>>(),
                            "{what}: relabelling changed what is scored"
                        );
                        for (ratable, score) in &here.result.scores {
                            let moved = there.result.scores[ratable];
                            assert!(
                                (score.score - moved.score).abs() <= 1e-9
                                    && (score.confidence - moved.confidence).abs() <= 1e-9,
                                "{what}: {ratable:?} went from {score:?} to {moved:?}"
                            );
                        }
                        for (one, &other) in positions.iter().enumerate() {
                            assert!(
                                (here.chain[one] - there.chain[other]).abs() <= 1e-12
                                    && (here.reliability[one] - there.reliability[other]).abs()
                                        <= 1e-12,
                                "{what}: person {one} went from chain {} / reliability {} to \
                                 {} / {}",
                                here.chain[one],
                                here.reliability[one],
                                there.chain[other],
                                there.reliability[other]
                            );
                        }
                    }
                }
            }
        }
    }
}

fn relabellings(nodes: usize) -> Vec<Vec<usize>> {
    if nodes <= 4 {
        let mut all = Vec::new();
        permute(&mut identity(nodes), 0, &mut all);
        all
    } else {
        (1..=4)
            .map(|shift| (0..nodes).map(|index| (index + shift) % nodes).collect())
            .collect()
    }
}

fn permute(current: &mut Vec<usize>, start: usize, out: &mut Vec<Vec<usize>>) {
    if start + 1 >= current.len() {
        out.push(current.clone());
        return;
    }
    for index in start..current.len() {
        current.swap(start, index);
        permute(current, start + 1, out);
        current.swap(start, index);
    }
}

/// Simulated worlds with items, categories and correlated attributes, three seeds.
fn worlds() -> Vec<Snapshot> {
    [7u64, 11, 23]
        .iter()
        .map(|&seed| {
            simulate(
                &WorldConfig {
                    users: 80,
                    items: 160,
                    consensus_items: 10,
                    tag_rated_fraction: 0.3,
                    attributes: 12,
                    attribute_axes: 3,
                    attribute_rated_fraction: 0.15,
                    ..WorldConfig::default()
                },
                &mut Rng::new(seed),
            )
            .snapshot
        })
        .collect()
}

/// §1.2 on worlds with depth: chains only shrink, and every result is sane, for every viewer;
/// and `compute_all` agrees with one viewer at a time.
#[test]
fn chains_never_exceed_their_weakest_link() {
    let params = Params::default();
    for (index, snapshot) in worlds().iter().enumerate() {
        let all =
            compute_all(snapshot, &params).unwrap_or_else(|error| panic!("world {index}: {error}"));
        for viewer in snapshot.users() {
            let what = format!("world {index} viewer {}", viewer.0);
            let detail = detail_of(snapshot, viewer, &params, &what);
            check_sane(snapshot, viewer, &detail, &what);
            check_chains_shrink(snapshot, viewer, &detail, &what);
            assert!(
                all[viewer.index()] == detail.result,
                "{what}: compute_all disagrees"
            );
        }
    }
}

/// A ladder `viewer – level 0 – level 1 – … – level 6`, each level two people who rate exactly
/// alike, joined to both people of the next level. Everyone past level 0 has two connections
/// nearer the viewer, so every link is learned (at exposure one half), and the two people of a
/// level are interchangeable, so the ratio of successive levels' chains is the link between them.
/// Each link agrees at a random rate, one of them at chance. The chain at every level is the
/// product of the links before it, and at most the weakest of them and the head.
#[test]
fn a_chain_along_a_ladder_is_at_most_its_weakest_link() {
    const LEVELS: usize = 7;
    let params = Params::default();
    let mut rng = Rng::new(5);
    for trial in 0..20 {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let levels: Vec<[UserId; 2]> = (0..LEVELS)
            .map(|level| {
                [
                    builder.user(&format!("a{level}")),
                    builder.user(&format!("b{level}")),
                ]
            })
            .collect();
        for &person in &levels[0] {
            builder.edge(viewer, person);
        }
        for pair in levels.windows(2) {
            for &one in &pair[0] {
                for &other in &pair[1] {
                    builder.edge(one, other);
                }
            }
        }
        let items: Vec<Ratable> = (0..60)
            .map(|index| Ratable::Item(builder.item(&format!("i{index}"))))
            .collect();
        let weak = 1 + trial % (LEVELS - 1);
        let mut values: Vec<i8> = items
            .iter()
            .map(|_| if rng.chance(0.5) { 1 } else { -1 })
            .collect();
        for (level, people) in levels.iter().enumerate() {
            if level > 0 {
                let agree = if level == weak {
                    0.5
                } else {
                    0.5 + 0.5 * rng.next_f64()
                };
                for value in &mut values {
                    if !rng.chance(agree) {
                        *value = -*value;
                    }
                }
            }
            for &person in people {
                for (&item, &value) in items.iter().zip(&values) {
                    builder.rate(person, item, value);
                }
            }
        }
        let snapshot = builder.build();
        let what = format!("trial {trial}");
        let detail = detail_of(&snapshot, viewer, &params, &what);
        check_sane(&snapshot, viewer, &detail, &what);
        let chain_at = |level: usize| {
            let [one, other] = levels[level];
            let value = detail.chain[one.index()];
            assert_eq!(
                value.to_bits(),
                detail.chain[other.index()].to_bits(),
                "{what}: the two people of level {level} are chained differently"
            );
            value
        };
        let mut weakest = chain_at(0).abs();
        for level in 1..LEVELS {
            let (before, after) = (chain_at(level - 1), chain_at(level));
            assert!(before != 0.0, "{what}: level {} unreached", level - 1);
            let link = after / before;
            assert!(
                link.abs() < 1.0,
                "{what}: a link of {link} into level {level}"
            );
            weakest = weakest.min(link.abs());
            assert!(
                after.abs() <= weakest + 1e-12,
                "{what}: level {level} is chained at {after}, past the weakest link {weakest}"
            );
        }
    }
}

/// `viewer – f₁, f₂ – w – v…`: `w` reaches the viewer only through `f₁` and `f₂`, and agrees with
/// each of them exactly as often as chance says over `n` things — a link that predicts nothing.
/// `w` is connected to both, so each link is learned at exposure one half (a person with one
/// connection toward the viewer is read at the prior, whatever they rated).
fn cut_world(things: usize) -> (Snapshot, UserId, UserId, Vec<UserId>, UserId, Vec<Ratable>) {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("viewer");
    let heads = [builder.user("f1"), builder.user("f2")];
    let gate = builder.user("w");
    let behind: Vec<UserId> = (0..5)
        .map(|index| builder.user(&format!("v{index}")))
        .collect();
    let predictor = builder.user("predictor");
    for &head in &heads {
        builder.edge(viewer, head);
        builder.edge(head, gate);
    }
    for &person in behind.iter().chain([&predictor]) {
        builder.edge(gate, person);
    }
    for (slot, &head) in heads.iter().enumerate() {
        for index in 0..things {
            let item = Ratable::Item(builder.item(&format!("h{slot}i{index}")));
            // Up, up, down, down: `w` agrees on the first of each pair of each sign and not on
            // the second, so agreement is exactly one half with both answers equally common, and
            // nobody else rates these things, so chance is exactly one half too.
            let value = if index % 4 < 2 { 1 } else { -1 };
            let agrees = index % 2 == 0;
            builder.rate(head, item, value);
            builder.rate(gate, item, if agrees { value } else { -value });
        }
    }
    // Each person behind `w` alone rates one thing; the predictor also rated the viewer's things
    // the way the viewer did, before the viewer.
    let lone: Vec<Ratable> = behind
        .iter()
        .map(|&person| {
            let item = Ratable::Item(builder.item(&format!("{}-only", person.0)));
            builder.rate(person, item, 1);
            item
        })
        .collect();
    for index in 0..30 {
        let item = Ratable::Item(builder.item(&format!("mine{index}")));
        let value = if index % 3 == 0 { -1 } else { 1 };
        builder.rate_at(viewer, item, value, 1);
        builder.rate_at(predictor, item, value, 0);
    }
    (builder.build(), viewer, gate, behind, predictor, lone)
}

/// DESIGN §2.4: a link near zero cuts off everyone beyond it who has not predicted the viewer
/// themselves. As the evidence that the link predicts nothing grows, the chain to everyone
/// behind it falls toward zero, and so does what their lone thumbs do to a score; someone behind
/// it who predicted the viewer is still heard, up to the head.
#[test]
fn a_link_that_predicts_nothing_cuts_off_everyone_behind_it() {
    let params = Params::default();
    let mut previous = f64::INFINITY;
    for things in [40usize, 160, 640, 2_560] {
        let (snapshot, viewer, gate, behind, predictor, lone) = cut_world(things);
        let what = format!("{things} things");
        let detail = detail_of(&snapshot, viewer, &params, &what);
        check_sane(&snapshot, viewer, &detail, &what);
        let heads = snapshot.friends(viewer);
        let head = heads
            .iter()
            .map(|head| detail.reliability[head.index()].abs())
            .fold(0.0, f64::max);
        let link = detail.chain[gate.index()].abs() / head;
        let reach = behind
            .iter()
            .map(|person| detail.chain[person.index()].abs())
            .fold(0.0, f64::max);
        assert!(
            reach < previous,
            "{what}: the chain behind the link did not fall ({reach} after {previous})"
        );
        previous = reach;
        for (&person, &item) in behind.iter().zip(&lone) {
            let reliability = detail.reliability[person.index()].abs();
            assert!(
                reliability <= link * head + 1e-12,
                "{what}: {} reads at {reliability} behind a link of {link}",
                person.0
            );
            let score = detail
                .result
                .scores
                .get(&item)
                .map_or(0.0, |score| score.score);
            // A lone up at reliability `r` against a base rate of one half is `ln((1 + r)/(1 − r))`
            // of log-odds through its region's average and `ln(1 + r)` through the starting
            // point.
            let most =
                (((1.0 + reliability) / (1.0 - reliability)).ln() + (1.0 + reliability).ln()) / 2.0;
            assert!(
                score.abs() <= most.tanh() + 1e-12,
                "{what}: a lone thumb behind the link scores {score}, past {}",
                most.tanh()
            );
        }
        let predicted = detail.reliability[predictor.index()].abs();
        assert!(
            predicted > 4.0 * detail.chain[predictor.index()].abs(),
            "{what}: the predictor reads at {predicted}, no better than their chain {}",
            detail.chain[predictor.index()]
        );
        assert!(
            predicted <= head + 1e-12,
            "{what}: the predictor passed the head"
        );
        if things == 2_560 {
            assert!(
                reach < 0.01 * head,
                "{what}: behind a link that predicts nothing, still chained at {reach} against \
                 a head of {head}"
            );
        }
    }
}

/// §1.5: with no thumbs of the viewer's — or only thumbs on things nobody near them rated —
/// every direct connection sits at the prior, and everything anybody reached rated has a score,
/// non-zero wherever one reached person rated it alone (nothing to cancel).
#[test]
fn a_viewer_with_no_history_gets_a_score_for_everything_reached() {
    let params = Params::default();
    for (index, world) in worlds().iter().enumerate() {
        for viewer in world.users().step_by(9) {
            let mut bare = world.edit();
            for &(ratable, _) in world.ratings(viewer) {
                bare.rate(viewer, ratable, 0);
            }
            let mut unshared = bare.clone();
            for slot in 0..10 {
                let item = Ratable::Item(unshared.item(&format!("only-mine-{slot}")));
                unshared.rate(viewer, item, if slot % 2 == 0 { 1 } else { -1 });
            }
            for (kind, snapshot) in [
                ("no thumbs", bare.build()),
                ("unshared thumbs", unshared.build()),
            ] {
                let what = format!("world {index} viewer {} with {kind}", viewer.0);
                let detail = detail_of(&snapshot, viewer, &params, &what);
                check_sane(&snapshot, viewer, &detail, &what);
                let prior = 2.0 * params.prior_agreement - 1.0;
                for &friend in snapshot.friends(viewer) {
                    let reliability = detail.reliability[friend.index()];
                    assert!(
                        (reliability - prior).abs() < 0.01,
                        "{what}: {} reads at {reliability}, not the prior {prior}",
                        friend.0
                    );
                }
                let mut raters: BTreeMap<Ratable, Vec<UserId>> = BTreeMap::new();
                for user in snapshot.users() {
                    if user == viewer || detail.chain[user.index()] == 0.0 {
                        continue;
                    }
                    for &(ratable, _) in snapshot.ratings(user) {
                        raters.entry(ratable).or_default().push(user);
                    }
                }
                assert!(!raters.is_empty(), "{what}: nobody reached rated anything");
                for (ratable, list) in &raters {
                    let score = detail.result.scores.get(ratable);
                    assert!(score.is_some(), "{what}: {ratable:?} has no score");
                    if ratable.is_item() && list.len() == 1 {
                        assert!(
                            score.is_some_and(|score| score.score != 0.0),
                            "{what}: {ratable:?}, rated by one reached person, scores zero"
                        );
                    }
                }
            }
        }
    }
}

/// A world where kinds don't matter: every thing doubled, the copy carrying one attribute and
/// rated exactly as the original, at the same point in each person's order, by everyone who
/// rated it. Everyone's history on the attribute is then their history elsewhere, and the history
/// elsewhere is the original world's.
fn twin_world(seed: u64) -> (Snapshot, Snapshot, TagId) {
    let original = simulate(
        &WorldConfig {
            users: 60,
            items: 60,
            rated_fraction: 0.6,
            ..WorldConfig::default()
        },
        &mut Rng::new(seed),
    )
    .snapshot;
    let mut builder = original.edit();
    let copy = builder.tag("copy");
    let twins: Vec<ItemId> = (0..original.item_count())
        .map(|item| builder.item(&format!("copy-of-{item}")))
        .collect();
    for user in original.users() {
        for (&(ratable, value), &stamp) in original.ratings(user).iter().zip(original.stamps(user))
        {
            let Ratable::Item(item) = ratable else {
                continue;
            };
            let twin = twins[item.index()];
            builder.rate_at(user, Ratable::Item(twin), value, stamp);
            builder.rate_at(user, Ratable::Tag(twin, copy), 1, 0);
        }
    }
    (original, builder.build(), copy)
}

/// DESIGN §2.8 and §1.7: a person's reliability on an attribute has a prior centred on their
/// reliability elsewhere with strength `κ_a`, so as `κ_a` grows it reproduces that reliability;
/// and `κ_a` is chosen large when kinds don't matter. In the twin world, for everyone the viewer
/// trusts directly, the reliability on the attribute is within what `n` things can move a mean
/// under a prior worth `κ_a` things — `2n/(n + κ_a)` on `λ`'s scale — of their reliability in the
/// original world.
#[test]
fn per_attribute_reliability_is_the_reliability_elsewhere_when_kinds_do_not_matter() {
    let params = Params::default();
    for seed in [7u64, 11, 23] {
        let (original, twins, copy) = twin_world(seed);
        for viewer in original.users().step_by(7) {
            let what = format!("seed {seed} viewer {}", viewer.0);
            let before = detail_of(&original, viewer, &params, &what);
            let after = detail_of(&twins, viewer, &params, &what);
            check_sane(&twins, viewer, &after, &what);
            for &friend in twins.friends(viewer) {
                let Some(&topical) = after.attribute_reliability[friend.index()].get(&copy) else {
                    continue;
                };
                // `κ_a` is chosen per region; a directly trusted person heads their own.
                let Some(&chosen) = after.attribute_strength.get(&(copy, friend)) else {
                    continue;
                };
                let shared = original
                    .ratings(viewer)
                    .iter()
                    .filter(|&&(ratable, _)| {
                        ratable.is_item() && original.rating(friend, ratable).is_some()
                    })
                    .count() as f64;
                let elsewhere = before.reliability[friend.index()];
                let bound = 2.0 * shared / (shared + chosen);
                assert!(
                    (topical - elsewhere).abs() <= bound + 1e-9,
                    "{what}: {} reads at {topical} on the attribute and {elsewhere} elsewhere, \
                     past {bound} for {shared} things at κ_a = {chosen}",
                    friend.0
                );
            }
        }
    }
}

/// DESIGN §2.8: every per-attribute reliability is capped as the overall one is (§2.4): nobody
/// past the head of their region, and someone whose thumbs on the viewer's things all came after
/// the viewer's no further than their own chain. Otherwise copying the viewer on things carrying
/// an attribute — which kinds of thing always are — raises a copier to the head.
#[test]
fn per_attribute_reliability_is_capped_as_the_overall_one_is() {
    let params = Params::default();
    for seed in [7u64, 11, 23] {
        let (_, twins, _) = twin_world(seed);
        for viewer in twins.users().step_by(7) {
            let what = format!("seed {seed} viewer {}", viewer.0);
            let detail = detail_of(&twins, viewer, &params, &what);
            for user in twins.users() {
                let Some(head) = detail.region[user.index()] else {
                    continue;
                };
                if head == user {
                    continue;
                }
                let predicted = twins.ratings(viewer).iter().any(|&(ratable, _)| {
                    twins.rating(user, ratable).is_some()
                        && twins.stamp(user, ratable) <= twins.stamp(viewer, ratable)
                });
                let ceiling = if predicted {
                    detail.reliability[head.index()].abs()
                } else {
                    detail.chain[user.index()].abs()
                };
                for (tag, &value) in &detail.attribute_reliability[user.index()] {
                    assert!(
                        value.abs() <= ceiling + 1e-12,
                        "{what}: {} reads at {value} on {tag:?}, past {ceiling} (head {}, \
                         chain {}, overall {}, any earlier thumb: {predicted})",
                        user.0,
                        detail.reliability[head.index()],
                        detail.chain[user.index()],
                        detail.reliability[user.index()]
                    );
                }
            }
        }
    }
}

/// The weighted up-share of each attribute over the reached, by `|chain|`: the base rate a pair's
/// chance of agreeing comes from (DESIGN §2.8).
fn tag_rates(snapshot: &Snapshot, viewer: UserId, detail: &UserDetail) -> BTreeMap<TagId, f64> {
    let mut sums: BTreeMap<TagId, (f64, f64)> = BTreeMap::new();
    for user in snapshot.users() {
        let weight = detail.chain[user.index()].abs();
        if user == viewer || weight == 0.0 {
            continue;
        }
        for &(ratable, value) in snapshot.ratings(user) {
            if let Ratable::Tag(_, tag) = ratable {
                let entry = sums.entry(tag).or_insert((0.0, 0.0));
                entry.1 += weight;
                if value > 0 {
                    entry.0 += weight;
                }
            }
        }
    }
    sums.into_iter()
        .map(|(tag, (up, total))| (tag, (up + 1.0) / (total + 2.0)))
        .collect()
}

/// `m₁/m₀`: a pair's posterior odds of being linked over the prior odds `π/(1 − π)`.
/// `None` where the posterior has saturated to exactly 0 or 1 in floating point, where the odds
/// are not a number.
fn bayes_factor(detail: &UserDetail, pair: (TagId, TagId)) -> Option<f64> {
    let link = detail.pairs.get(&pair)?;
    if link.linked <= 0.0 || link.linked >= 1.0 {
        return None;
    }
    let share = detail.linked_share;
    Some((link.linked / (1.0 - link.linked)) / (share / (1.0 - share)))
}

/// §1.6: one more attribute thumb from someone who already co-tagged a pair on other things
/// multiplies that pair's evidence for being linked by at most `max(1/c, 1/(1 − c))`, `c` the
/// chance two such thumbs agree anyway. Pairs the new attribute is not in do not move at all.
#[test]
fn one_thumb_moves_a_pair_by_at_most_the_proven_factor() {
    let params = Params::default();
    let mut rng = Rng::new(3);
    let mut tried = 0;
    for (index, world) in worlds().iter().enumerate() {
        for viewer in world.users().step_by(8) {
            let before = detail_of(world, viewer, &params, "before");
            let rates = tag_rates(world, viewer, &before);
            let reached: Vec<UserId> = world
                .users()
                .filter(|&user| user != viewer && before.chain[user.index()] != 0.0)
                .collect();
            for _ in 0..10 {
                let person = reached[rng.below(reached.len())];
                let tagged: Vec<(ItemId, TagId)> = world
                    .ratings(person)
                    .iter()
                    .filter_map(|&(ratable, _)| match ratable {
                        Ratable::Tag(item, tag) => Some((item, tag)),
                        Ratable::Item(_) => None,
                    })
                    .collect();
                if tagged.is_empty() {
                    continue;
                }
                let (item, _) = tagged[rng.below(tagged.len())];
                let on_item: BTreeSet<TagId> = tagged
                    .iter()
                    .filter(|&&(other, _)| other == item)
                    .map(|&(_, tag)| tag)
                    .collect();
                let fresh: Vec<TagId> = rates
                    .keys()
                    .copied()
                    .filter(|tag| !on_item.contains(tag))
                    .collect();
                if fresh.is_empty() {
                    continue;
                }
                let tag = fresh[rng.below(fresh.len())];
                // Only pairs this person already co-tagged elsewhere are bounded by the factor;
                // a first co-tag joins a region's average instead.
                let co_tagged: BTreeSet<TagId> = world
                    .ratings(person)
                    .iter()
                    .filter_map(|&(ratable, _)| match ratable {
                        Ratable::Tag(other, first) if other != item => Some((other, first)),
                        _ => None,
                    })
                    .filter(|&(other, _)| world.rating(person, Ratable::Tag(other, tag)).is_some())
                    .map(|(_, first)| first)
                    .filter(|&first| first != tag && on_item.contains(&first))
                    .collect();
                let value = if rng.chance(0.5) { 1 } else { -1 };
                let mut builder = world.edit();
                builder.rate_at(person, Ratable::Tag(item, tag), value, u32::MAX - 1);
                let changed = builder.build();
                let what = format!(
                    "world {index} viewer {} person {} tags {item:?} with {tag:?} {value:+}",
                    viewer.0, person.0
                );
                let after = detail_of(&changed, viewer, &params, &what);
                let rates_after = tag_rates(&changed, viewer, &after);
                for &pair in before.pairs.keys() {
                    let (Some(was), Some(now)) =
                        (bayes_factor(&before, pair), bayes_factor(&after, pair))
                    else {
                        continue;
                    };
                    let (first, second) = pair;
                    if first != tag && second != tag {
                        assert!(
                            (now / was - 1.0).abs() <= 1e-9,
                            "{what}: {pair:?}, which the thumb is not in, moved by {}",
                            now / was
                        );
                        continue;
                    }
                    let other = if first == tag { second } else { first };
                    if !co_tagged.contains(&other) {
                        continue;
                    }
                    let factor = |table: &BTreeMap<TagId, f64>| {
                        let (one, two) = (table[&first], table[&second]);
                        let chance = one * two + (1.0 - one) * (1.0 - two);
                        (1.0 / chance).max(1.0 / (1.0 - chance))
                    };
                    let bound = factor(&rates).max(factor(&rates_after));
                    tried += 1;
                    assert!(
                        now / was <= bound * (1.0 + 1e-9),
                        "{what}: {pair:?}'s odds of being linked rose by {} past {bound}",
                        now / was
                    );
                }
            }
        }
    }
    assert!(tried > 20, "only {tried} pairs were exercised");
}

/// No input the builder accepts makes a non-finite result: every thumb one way, every thumb
/// against every other, thumbs only after the viewer's, a dense clique, and people nobody reaches.
#[test]
fn no_snapshot_produces_a_non_finite_result() {
    let params = Params::default();
    let mut rng = Rng::new(17);
    for case in 0..24 {
        let mut builder = Snapshot::builder();
        let people: Vec<UserId> = (0..30)
            .map(|index| builder.user(&format!("p{index}")))
            .collect();
        let items: Vec<ItemId> = (0..20)
            .map(|index| builder.item(&format!("i{index}")))
            .collect();
        let tags: Vec<TagId> = (0..4)
            .map(|index| builder.tag(&format!("t{index}")))
            .collect();
        let density = [0.0, 0.05, 0.3, 1.0][case % 4];
        for (index, &one) in people.iter().enumerate() {
            for &other in &people[index + 1..] {
                if rng.chance(density) {
                    builder.edge(one, other);
                }
            }
        }
        for (position, &person) in people.iter().enumerate() {
            for (slot, &item) in items.iter().enumerate() {
                let value = match case / 4 {
                    0 => 1,
                    1 => {
                        if position % 2 == 0 {
                            1
                        } else {
                            -1
                        }
                    }
                    2 => {
                        if (position + slot) % 2 == 0 {
                            1
                        } else {
                            -1
                        }
                    }
                    _ => {
                        if rng.chance(0.5) {
                            1
                        } else {
                            -1
                        }
                    }
                };
                let stamp = if case % 3 == 0 {
                    u32::MAX
                } else {
                    rng.below(3) as u32
                };
                builder.rate_at(person, Ratable::Item(item), value, stamp);
                for &tag in &tags {
                    if rng.chance(0.3) {
                        builder.rate(person, Ratable::Tag(item, tag), value);
                    }
                }
            }
        }
        let snapshot = builder.build();
        for viewer in snapshot.users() {
            let what = format!("case {case} viewer {}", viewer.0);
            let detail = detail_of(&snapshot, viewer, &params, &what);
            check_sane(&snapshot, viewer, &detail, &what);
        }
    }
}

/// DESIGN §2.1: a score is in `(−1, 1)`, never at either end, however many voices agree. Thirty
/// people the viewer trusts directly, each of whom predicted the viewer on twenty things only the
/// two of them rated (so every agreement is a surprise), all rate one more thing up: thirty
/// voices, each near the clip.
#[test]
fn a_score_never_reaches_either_end() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("viewer");
    let friends: Vec<UserId> = (0..30)
        .map(|index| builder.user(&format!("f{index}")))
        .collect();
    let target = Ratable::Item(builder.item("target"));
    for (position, &friend) in friends.iter().enumerate() {
        builder.edge(viewer, friend);
        builder.rate_at(friend, target, 1, 0);
        for slot in 0..20 {
            let item = Ratable::Item(builder.item(&format!("f{position}h{slot}")));
            let value = if slot % 2 == 0 { 1 } else { -1 };
            builder.rate_at(viewer, item, value, 1);
            builder.rate_at(friend, item, value, 0);
        }
    }
    let snapshot = builder.build();
    let detail = detail_of(&snapshot, viewer, &params, "thirty voices");
    let score = detail.result.scores[&target].score;
    assert!(
        score.abs() < 1.0,
        "thirty voices score {score}: the end of the scale, not a point inside it"
    );
}
