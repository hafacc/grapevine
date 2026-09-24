//! What taste search will and will not put in front of a viewer (DESIGN section 5).
//!
//! Every test runs on one hand-built world, because the claims are about *who* is named and in
//! what order, and a simulated world makes the answer to that a matter of the seed. The shape:
//!
//! ```text
//! u ── f_l ── c_l1 ── c_l2 ── c_l3 ── c_l4 ── h_l          (lanes 1..5, honest)
//! u ── f_0 ── c_01 ── c_02 ── c_03 ── c_04 ── {bots}       (lane 0, whatever is wired there)
//! ```
//!
//! Every node along a lane has exactly two neighbours, so the walk halves its mass at each hop
//! and the far end of a lane holds `2⁻⁵ = 0.03125` friend-units — far enough out that `π̃·ℓ` is
//! under the on-demand threshold and the person there is a *suggestion* rather than somebody the
//! viewer already hears. The lanes are identical, so anything a bot region gains it gains by
//! being a bot region and not by sitting somewhere better than the honest five.

mod common;

use std::collections::BTreeSet;

use grapevine_core::{
    MAX_SUGGESTIONS, Params, Ratable, Snapshot, SnapshotBuilder, Suggestion, UserId,
    compute_user_detail, suggest,
};

/// How far out along a lane the interesting people sit.
const LANE_LENGTH: usize = 4;

/// Contested items: the viewer and half their friends say one thing, the other half the other.
const CONTESTED_ITEMS: usize = 40;

/// Items nobody in reach disagrees about, which is what a consensus farm has to work with.
const UNANIMOUS_ITEMS: usize = 60;

const LANES: usize = 6;

/// The lane the bots hang off. An *agreeing* friend, so that the affinity split sends as much
/// as it can down that branch and the attack is measured at its strongest.
const SYBIL_LANE: usize = 0;

struct TasteWorld {
    snapshot: Snapshot,
    viewer: UserId,
    /// The far end of each honest lane: the five people a suggestion list should be made of.
    honest: Vec<UserId>,
    /// The last chain node of the sybil lane — one edge, and everything behind it.
    gate: UserId,
}

/// The viewer's opinion of one contested item. Alternating, so that "the same" and "the
/// opposite" are both a real mix of thumbs rather than a constant.
fn contested_thumb(index: usize) -> i8 {
    if index.is_multiple_of(2) { 1 } else { -1 }
}

/// Copies the viewer's whole opinion, contested items and unanimous ones alike.
fn agree_with_viewer(builder: &mut SnapshotBuilder, user: UserId, contested: &[Ratable]) {
    for (index, &item) in contested.iter().enumerate() {
        builder.rate(user, item, contested_thumb(index));
    }
    for index in 0..UNANIMOUS_ITEMS {
        let item = Ratable::Item(builder.item(&format!("uncontested{index}")));
        builder.rate(user, item, 1);
    }
}

fn oppose_viewer(builder: &mut SnapshotBuilder, user: UserId, contested: &[Ratable]) {
    for (index, &item) in contested.iter().enumerate() {
        builder.rate(user, item, -contested_thumb(index));
    }
    for index in 0..UNANIMOUS_ITEMS {
        let item = Ratable::Item(builder.item(&format!("uncontested{index}")));
        builder.rate(user, item, 1);
    }
}

fn taste_world() -> TasteWorld {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let contested: Vec<Ratable> = (0..CONTESTED_ITEMS)
        .map(|index| Ratable::Item(builder.item(&format!("contested{index}"))))
        .collect();
    agree_with_viewer(&mut builder, viewer, &contested);

    let mut honest = Vec::new();
    let mut gate = viewer;
    for lane in 0..LANES {
        let friend = builder.user(&format!("f{lane}"));
        builder.edge(viewer, friend);
        // Three friends with the viewer and three against, so every contested item has a
        // dissenter in reach and `ω` sits near its maximum.
        if lane < LANES / 2 {
            agree_with_viewer(&mut builder, friend, &contested);
        } else {
            oppose_viewer(&mut builder, friend, &contested);
        }
        let mut previous = friend;
        for hop in 0..LANE_LENGTH {
            // The chain rates nothing at all: it is reach, not evidence, and somebody with no
            // overlap is never a candidate however close they are.
            let node = builder.user(&format!("c{lane}_{hop}"));
            builder.edge(previous, node);
            previous = node;
        }
        if lane == SYBIL_LANE {
            gate = previous;
        } else {
            let candidate = builder.user(&format!("h{lane}"));
            builder.edge(previous, candidate);
            agree_with_viewer(&mut builder, candidate, &contested);
            honest.push(candidate);
        }
    }

    TasteWorld {
        snapshot: builder.build(),
        viewer,
        honest,
        gate,
    }
}

/// How the accounts behind the one edge are wired to each other.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BotShape {
    /// Every bot friends the gatekeeper and every other bot.
    Clique,
    /// One bot friends the gatekeeper and the rest hang off it in a line.
    Path,
    /// Every bot friends the gatekeeper and nothing else.
    OneEdgeEach,
}

/// Adds `count` accounts behind the world's single gatekeeping edge, each copying the viewer's
/// ratings exactly — perfect agreement on every contested item, which is the most alignment any
/// account can have and puts every one of them at the clamp.
fn add_bots(world: &TasteWorld, count: usize, shape: BotShape) -> (Snapshot, Vec<UserId>) {
    let mut builder = world.snapshot.edit();
    let contested: Vec<Ratable> = (0..CONTESTED_ITEMS)
        .map(|index| Ratable::Item(builder.item(&format!("contested{index}"))))
        .collect();
    let bots: Vec<UserId> = (0..count)
        .map(|index| builder.user(&format!("bot{index}")))
        .collect();
    match shape {
        BotShape::Clique => {
            for (index, &bot) in bots.iter().enumerate() {
                builder.edge(world.gate, bot);
                for &other in &bots[index + 1..] {
                    builder.edge(bot, other);
                }
            }
        }
        BotShape::Path => {
            if let Some(&head) = bots.first() {
                builder.edge(world.gate, head);
            }
            for window in bots.windows(2) {
                builder.edge(window[0], window[1]);
            }
        }
        BotShape::OneEdgeEach => {
            for &bot in &bots {
                builder.edge(world.gate, bot);
            }
        }
    }
    for &bot in &bots {
        agree_with_viewer(&mut builder, bot, &contested);
    }
    (builder.build(), bots)
}

/// Everybody but the viewer has left discoverability on, which is the default.
fn everyone(snapshot: &Snapshot, viewer: UserId) -> BTreeSet<UserId> {
    snapshot.users().filter(|&user| user != viewer).collect()
}

fn suggestions_for(
    snapshot: &Snapshot,
    viewer: UserId,
    discoverable: &BTreeSet<UserId>,
    dismissed: &BTreeSet<UserId>,
) -> Vec<Suggestion> {
    match suggest(
        snapshot,
        viewer,
        discoverable,
        dismissed,
        &Params::deep(),
        &Params::default(),
    ) {
        Ok(suggestions) => suggestions,
        Err(error) => panic!("suggesting for {}: {error}", viewer.0),
    }
}

fn named(snapshot: &Snapshot, suggestions: &[Suggestion]) -> Vec<String> {
    suggestions
        .iter()
        .map(|suggestion| snapshot.user_name(suggestion.user).to_string())
        .collect()
}

/// Five honest people, each behind a friend of their own, are exactly the five slots.
#[test]
fn five_aligned_people_behind_five_friends_fill_the_list() {
    let world = taste_world();
    let discoverable = everyone(&world.snapshot, world.viewer);
    let suggestions = suggestions_for(
        &world.snapshot,
        world.viewer,
        &discoverable,
        &BTreeSet::new(),
    );
    assert_eq!(suggestions.len(), MAX_SUGGESTIONS);
    let expected: BTreeSet<UserId> = world.honest.iter().copied().collect();
    let shown: BTreeSet<UserId> = suggestions
        .iter()
        .map(|suggestion| suggestion.user)
        .collect();
    assert_eq!(
        shown,
        expected,
        "{:?}",
        named(&world.snapshot, &suggestions)
    );
    for suggestion in &suggestions {
        assert!(
            suggestion.overlap >= grapevine_core::MIN_OVERLAP,
            "{} rests on {} units of overlap",
            world.snapshot.user_name(suggestion.user),
            suggestion.overlap
        );
        assert!(suggestion.alignment >= grapevine_core::MIN_ALIGNMENT);
    }
    println!(
        "five honest lanes: strength {:.5}, ℓ {:.3}, overlap {:.2}",
        suggestions[0].strength, suggestions[0].alignment, suggestions[0].overlap
    );
}

/// Nobody the viewer is already connected to, already hears, has turned discoverability off, or
/// has waved away.
#[test]
fn suggestions_exclude_friends_the_influential_the_private_and_the_dismissed() {
    let world = taste_world();
    let discoverable = everyone(&world.snapshot, world.viewer);
    let friends: Vec<UserId> = world.snapshot.friends(world.viewer).to_vec();
    assert_eq!(friends.len(), LANES);

    let all = suggestions_for(
        &world.snapshot,
        world.viewer,
        &discoverable,
        &BTreeSet::new(),
    );
    for &friend in &friends {
        assert!(
            !all.iter().any(|suggestion| suggestion.user == friend),
            "{} is already a friend",
            world.snapshot.user_name(friend)
        );
    }

    // Somebody who agrees with the viewer as completely as the far five do, but sits two hops
    // away rather than six: `π̃·ℓ` at the on-demand budget is well over the threshold, so they
    // are not a suggestion but a person the viewer's feed already carries.
    let mut builder = world.snapshot.edit();
    let contested: Vec<Ratable> = (0..CONTESTED_ITEMS)
        .map(|index| Ratable::Item(builder.item(&format!("contested{index}"))))
        .collect();
    let near = builder.user("near");
    builder.edge(friends[1], near);
    agree_with_viewer(&mut builder, near, &contested);
    let with_near = builder.build();
    let discoverable = everyone(&with_near, world.viewer);
    let suggestions = suggestions_for(&with_near, world.viewer, &discoverable, &BTreeSet::new());
    assert!(
        !suggestions.iter().any(|suggestion| suggestion.user == near),
        "an already influential person is not a suggestion: {:?}",
        named(&with_near, &suggestions)
    );

    // Discoverability off: still walked, still carrying mass, never named.
    let mut private = everyone(&world.snapshot, world.viewer);
    private.remove(&world.honest[0]);
    let without = suggestions_for(&world.snapshot, world.viewer, &private, &BTreeSet::new());
    assert!(
        !without
            .iter()
            .any(|suggestion| suggestion.user == world.honest[0])
    );

    // Dismissed: the same absence, decided by the viewer instead.
    let dismissed: BTreeSet<UserId> = [world.honest[1]].into_iter().collect();
    let discoverable = everyone(&world.snapshot, world.viewer);
    let after = suggestions_for(&world.snapshot, world.viewer, &discoverable, &dismissed);
    assert!(
        !after
            .iter()
            .any(|suggestion| suggestion.user == world.honest[1])
    );
}

/// A farm that agrees with everyone about everything agrees about nothing informative: `ω` is
/// zero on an item with no dissenter in reach, so sixty perfect agreements are worth no overlap
/// at all and buy no place in anybody's list.
#[test]
fn a_consensus_copying_farm_yields_nothing() {
    let world = taste_world();
    let mut builder = world.snapshot.edit();
    let farm: Vec<UserId> = (0..20)
        .map(|index| builder.user(&format!("farm{index}")))
        .collect();
    for (index, &bot) in farm.iter().enumerate() {
        builder.edge(world.gate, bot);
        for &other in &farm[index + 1..] {
            builder.edge(bot, other);
        }
        // Only what nobody in reach disputes — which is what copying the crowd amounts to.
        for item_index in 0..UNANIMOUS_ITEMS {
            let item = Ratable::Item(builder.item(&format!("uncontested{item_index}")));
            builder.rate(bot, item, 1);
        }
    }
    let snapshot = builder.build();
    let discoverable = everyone(&snapshot, world.viewer);
    let suggestions = suggestions_for(&snapshot, world.viewer, &discoverable, &BTreeSet::new());
    let farm_set: BTreeSet<UserId> = farm.iter().copied().collect();
    assert!(
        !suggestions
            .iter()
            .any(|suggestion| farm_set.contains(&suggestion.user)),
        "a consensus-copying farm earned a slot: {:?}",
        named(&snapshot, &suggestions)
    );
    assert_eq!(suggestions.len(), MAX_SUGGESTIONS);
}

/// Accounts with no edges are never reached, so they are never candidates — and because `ω` is
/// the viewer's own reach-weighted consensus, they cannot move anybody else's place either.
#[test]
fn edgeless_sybils_change_nothing() {
    let world = taste_world();
    let discoverable = everyone(&world.snapshot, world.viewer);
    let before = suggestions_for(
        &world.snapshot,
        world.viewer,
        &discoverable,
        &BTreeSet::new(),
    );

    let mut builder = world.snapshot.edit();
    let contested: Vec<Ratable> = (0..CONTESTED_ITEMS)
        .map(|index| Ratable::Item(builder.item(&format!("contested{index}"))))
        .collect();
    for index in 0..500 {
        let ghost = builder.user(&format!("ghost{index}"));
        agree_with_viewer(&mut builder, ghost, &contested);
    }
    let snapshot = builder.build();
    let discoverable = everyone(&snapshot, world.viewer);
    let after = suggestions_for(&snapshot, world.viewer, &discoverable, &BTreeSet::new());

    assert_eq!(
        named(&world.snapshot, &before),
        named(&snapshot, &after),
        "five hundred edgeless accounts changed the list"
    );
    for (left, right) in before.iter().zip(after.iter()) {
        assert!((left.strength - right.strength).abs() < 1e-12);
    }
}

/// DESIGN section 5.2: a region behind one edge shares that branch's bounded mass however it is
/// wired, so it competes for one slot and not for the list — and the honest field keeps every
/// slot. A hundred accounts in a clique do not starve the deep walk: a node's expansion drains
/// everything that arrived at it in one step, so the clique costs a sweep of its edges per
/// halving and the deep walk resolves it like any other shape.
#[test]
fn a_sybil_region_behind_one_edge_takes_at_most_one_slot() {
    let world = taste_world();
    for shape in [BotShape::Clique, BotShape::Path, BotShape::OneEdgeEach] {
        for count in [1, 2, 5, 25, 100] {
            let (snapshot, bots) = add_bots(&world, count, shape);
            let discoverable = everyone(&snapshot, world.viewer);
            let suggestions =
                suggestions_for(&snapshot, world.viewer, &discoverable, &BTreeSet::new());
            let bot_set: BTreeSet<UserId> = bots.iter().copied().collect();
            let taken = suggestions
                .iter()
                .filter(|suggestion| bot_set.contains(&suggestion.user))
                .count();
            // What the whole region is worth, not what it was shown: the claim is about the
            // mass behind the one edge, and a bot that missed the list still has a number.
            let best_bot = strongest(&snapshot, world.viewer, &bots);
            let weakest_shown = suggestions
                .iter()
                .map(|suggestion| suggestion.strength)
                .fold(f64::INFINITY, f64::min);
            let deep = match compute_user_detail(&snapshot, world.viewer, &Params::deep()) {
                Ok(detail) => detail,
                Err(error) => panic!("the deep walk for {shape:?} × {count}: {error}"),
            };
            println!(
                "{shape:?} × {count}: {taken} of {MAX_SUGGESTIONS} slots, best bot π̃·ℓ \
                 {best_bot:.5}, weakest shown {weakest_shown:.5}, deep walk reached {} and \
                 left {:.4} unresolved",
                deep.final_pass.nodes_touched(),
                deep.final_pass.truncation()
            );
            assert!(
                taken <= 1,
                "{shape:?} × {count} took {taken} slots: {:?}",
                named(&snapshot, &suggestions)
            );
            assert!(
                best_bot <= weakest_shown * (1.0 + 1e-9),
                "{shape:?} × {count}: a bot outranked the honest field, {best_bot} > \
                 {weakest_shown}"
            );
            assert!(
                deep.settled && deep.final_pass.truncation() <= Params::deep().error_budget,
                "{shape:?} × {count}: the deep walk did not resolve"
            );
            assert_eq!(
                suggestions.len(),
                MAX_SUGGESTIONS,
                "{shape:?} × {count}: the honest field lost slots to the region"
            );
        }
    }
}

/// `π̃_u(v)·ℓ_{uv}` at the deep budget for the strongest of a set — the ranking quantity,
/// whether or not the person it belongs to was shown.
fn strongest(snapshot: &Snapshot, viewer: UserId, users: &[UserId]) -> f64 {
    let detail = match compute_user_detail(snapshot, viewer, &Params::deep()) {
        Ok(detail) => detail,
        Err(error) => panic!("computing for {}: {error}", viewer.0),
    };
    users
        .iter()
        .map(|&user| detail.mass(user) * detail.alignment_weight(user))
        .fold(0.0, f64::max)
}

/// The same snapshot, twice, down to the last bit of every strength.
#[test]
fn suggestions_are_deterministic() {
    let world = taste_world();
    let (snapshot, _) = add_bots(&world, 7, BotShape::Clique);
    let discoverable = everyone(&snapshot, world.viewer);
    let first = suggestions_for(&snapshot, world.viewer, &discoverable, &BTreeSet::new());
    let second = suggestions_for(&snapshot, world.viewer, &discoverable, &BTreeSet::new());
    assert_eq!(first, second);
    assert!(!first.is_empty());
}
