//! Every reciprocal graph up to six nodes, which at this size is a proof and not a sample.
//!
//! The rest of the suite is seeded random worlds: it says the algorithm behaves on the graphs
//! somebody thought to generate. This says it behaves on **all** of them. Enumerating every
//! labelled graph is the same thing as enumerating every unlabelled one with all `n!`
//! relabellings, so nothing here has to reason about isomorphism — `2^15` masks on six nodes is
//! cheaper than deciding which of them are the same graph.
//!
//! What is checked, for every graph, every rating pattern and every viewer: the computation has
//! an answer at all; every score is a real number inside the scale the bar draws; the settling
//! loop reports a movement rather than a `NaN`; and the mass bounds of DESIGN section 2.4 hold —
//! total mass at most `|F|/α`, nothing beyond the friends worth more than the friends
//! themselves, which is the sybil bound with the bot set taken to be *everyone* who is not a
//! friend. Beside that the pushed walk is compared against the resolvent it approximates, solved
//! by elimination rather than iterated, so the two disagree only by the truncation the walk
//! reports.

use std::collections::HashMap;

use grapevine_core::{Params, Ratable, Snapshot, UserId, compute_user, walk};

/// Six is where `2^15` masks still runs in seconds; seven would be `2^21`.
const MAX_NODES: usize = 6;

/// Four is enough for a pattern to make an item unanimous, contested or unrated while keeping
/// the whole enumeration cheap.
const ITEMS: usize = 4;

/// The thumb `user` gives `item` under one pattern, or nothing at all.
///
/// The patterns are the shapes the algorithm treats differently: nobody rating anything, a
/// unanimous item (`ω = 0`, the case an account that copies consensus is supposed to gain
/// nothing from), an item split down the middle, and two sparse mixtures where most pairs share
/// no rating at all.
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

const PATTERNS: usize = 5;

/// How many undirected pairs `nodes` nodes have, which is how many bits a graph's mask needs.
fn pair_count(nodes: usize) -> usize {
    nodes * (nodes - 1) / 2
}

/// One graph and one rating pattern, with original node `original` interned as user
/// `position[original]`.
///
/// The indirection is there for the relabelling check and is the identity everywhere else.
fn snapshot_of(nodes: usize, mask: u32, pattern: usize, position: &[usize]) -> Snapshot {
    let mut builder = Snapshot::builder();
    let users: Vec<UserId> = (0..nodes)
        .map(|index| builder.user(&format!("u{index}")))
        .collect();
    let items: Vec<Ratable> = (0..ITEMS)
        .map(|index| Ratable::Item(builder.item(&format!("i{index}"))))
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
        for (index, &item) in items.iter().enumerate() {
            if let Some(thumb) = thumb_of(pattern, original, index) {
                builder.rate(users[position[original]], item, thumb);
            }
        }
    }
    builder.build()
}

fn identity(nodes: usize) -> Vec<usize> {
    (0..nodes).collect()
}

/// Everything DESIGN section 2.4 promises about one viewer's masses, on one snapshot.
fn check_one(snapshot: &Snapshot, viewer: UserId, params: &Params, what: &str) {
    let result = compute_user(snapshot, viewer, params)
        .unwrap_or_else(|error| panic!("{what}: no result at all: {error}"));

    assert!(
        result.settle_movement.is_finite() && result.settle_movement >= 0.0,
        "{what}: the loop reported {} as its last movement",
        result.settle_movement
    );
    assert!(
        result.truncation.is_finite() && result.truncation >= 0.0,
        "{what}: truncation {}",
        result.truncation
    );
    assert!(
        result.error(params).is_finite(),
        "{what}: the bar would be quantized to a non-number"
    );
    assert!(result.passes >= 1, "{what}: no pass was run");

    for (ratable, score) in &result.scores {
        assert!(
            score.score.is_finite() && score.score.abs() <= 1.0,
            "{what}: {ratable:?} scored {}",
            score.score
        );
        assert!(
            score.confidence.is_finite() && score.confidence >= params.min_weight,
            "{what}: {ratable:?} was shown at weight {}",
            score.confidence
        );
    }

    let friends = snapshot.friends(viewer);
    let friend_count = friends.len() as f64;
    let mut total = 0.0;
    let mut beyond = 0.0;
    for &(user, mass) in &result.reach_masses {
        assert!(
            mass.is_finite() && mass >= 0.0,
            "{what}: {} holds {mass}",
            snapshot.user_name(user)
        );
        total += mass;
        if user != viewer && !friends.contains(&user) {
            beyond += mass;
        }
    }
    // Both bounds hold of the converged masses. The settling loop starts every pass after the
    // first from the one before, so its residual is signed and the answer can sit on either side
    // of the converged one — by at most the truncation it reports, in total.
    let slack = result.truncation + 1e-9;
    assert!(
        total <= friend_count / params.decay + slack,
        "{what}: {total} in total against {friend_count} friends"
    );
    // The sybil bound with the bot set taken to be everyone who is not a friend: whatever they
    // are wired to each other, they are together worth no more than the friends who let them in.
    assert!(
        beyond <= friend_count + slack,
        "{what}: {beyond} beyond the friends against {friend_count} friends"
    );
}

/// `(I − A)⁻¹ b` over the walk's edge states: what the push converges to, solved rather than
/// iterated.
///
/// A state is a directed edge `(source, target)` the mass crossed. One friend-unit is injected
/// into each `(viewer, friend)`, and mass at `(source, target)` moves on to `(target, next)`
/// with the affinity share `onward_shares` gives it — every neighbour of `target` but the viewer
/// and the one it came from, totalling `1 − α`.
fn exact_visit_mass(
    snapshot: &Snapshot,
    viewer: UserId,
    affinity: &[f64],
    params: &Params,
) -> Vec<f64> {
    let mut states: Vec<(UserId, UserId)> = Vec::new();
    for source in snapshot.users() {
        for &target in snapshot.friends(source) {
            if target != viewer {
                states.push((source, target));
            }
        }
    }
    let slot: HashMap<(UserId, UserId), usize> = states
        .iter()
        .enumerate()
        .map(|(index, &edge)| (edge, index))
        .collect();
    let size = states.len();
    // Row `state`, augmented with the injection in its last column.
    let width = size + 1;
    let mut system = vec![0.0f64; size * width];
    for (row, &(source, target)) in states.iter().enumerate() {
        system[row * width + row] = 1.0;
        if source == viewer {
            system[row * width + size] = 1.0;
        }
        for &came_from in snapshot.friends(source) {
            let Some(&column) = slot.get(&(came_from, source)) else {
                continue;
            };
            let share = onward_share(
                snapshot, source, came_from, target, viewer, affinity, params,
            );
            system[row * width + column] -= share;
        }
    }

    let solution = solve(&mut system, size);
    let mut mass = vec![0.0; snapshot.user_count()];
    for (index, &(_, target)) in states.iter().enumerate() {
        mass[target.index()] += solution[index];
    }
    mass
}

/// The share of what arrived at `node` from `came_from` that goes on to `target`.
fn onward_share(
    snapshot: &Snapshot,
    node: UserId,
    came_from: UserId,
    target: UserId,
    viewer: UserId,
    affinity: &[f64],
    params: &Params,
) -> f64 {
    if target == viewer || target == came_from {
        return 0.0;
    }
    let total: f64 = snapshot
        .friends(node)
        .iter()
        .filter(|&&other| other != viewer && other != came_from)
        .map(|&other| affinity[other.index()])
        .sum();
    if total <= 0.0 {
        0.0
    } else {
        (1.0 - params.decay) * affinity[target.index()] / total
    }
}

/// Gauss–Jordan with partial pivoting over an augmented row-major system.
fn solve(system: &mut [f64], size: usize) -> Vec<f64> {
    let width = size + 1;
    for column in 0..size {
        let mut pivot = column;
        for row in (column + 1)..size {
            if system[row * width + column].abs() > system[pivot * width + column].abs() {
                pivot = row;
            }
        }
        if pivot != column {
            for offset in 0..width {
                system.swap(column * width + offset, pivot * width + offset);
            }
        }
        let head = system[column * width + column];
        assert!(
            head.abs() > 1e-12,
            "the resolvent is singular, which a killing rate below one forbids"
        );
        for offset in column..width {
            system[column * width + offset] /= head;
        }
        for row in 0..size {
            if row == column {
                continue;
            }
            let factor = system[row * width + column];
            if factor == 0.0 {
                continue;
            }
            for offset in column..width {
                system[row * width + offset] -= factor * system[column * width + offset];
            }
        }
    }
    (0..size).map(|row| system[row * width + size]).collect()
}

/// Every labelled graph on one to six nodes, every rating pattern, every viewer.
///
/// Six nodes carry two patterns rather than five: `2^15` masks times six viewers is already the
/// bulk of the run, and the patterns a sixth node adds nothing to are the ones the five-node
/// sweep has already covered exhaustively.
#[test]
fn every_small_graph_has_an_answer_inside_its_bounds() {
    let params = Params::default();
    for nodes in 1..=MAX_NODES {
        let patterns = if nodes == MAX_NODES { 2 } else { PATTERNS };
        let position = identity(nodes);
        for mask in 0..(1u32 << pair_count(nodes)) {
            for pattern in 0..patterns {
                let snapshot = snapshot_of(nodes, mask, pattern, &position);
                for viewer in snapshot.users() {
                    check_one(
                        &snapshot,
                        viewer,
                        &params,
                        &format!("n={nodes} mask={mask} pattern={pattern} viewer={viewer:?}"),
                    );
                }
            }
        }
    }
}

/// The pushed walk against the resolvent it approximates, on every graph up to five nodes.
///
/// The push stops early on purpose, so the two do not agree exactly — they agree to within the
/// walk's own `truncation`, which is the whole of what that number claims. Two affinity vectors:
/// the uniform one the first pass runs at, and a spread one inside `[1, e^L]`.
#[test]
fn the_push_lands_where_the_resolvent_says_within_the_reported_truncation() {
    let params = Params::default();
    for nodes in 1..=5 {
        let position = identity(nodes);
        for mask in 0..(1u32 << pair_count(nodes)) {
            let snapshot = snapshot_of(nodes, mask, 2, &position);
            let uniform = vec![1.0; nodes];
            let spread: Vec<f64> = (0..nodes)
                .map(|index| (index as f64 * 0.5).min(params.alignment_clamp).exp())
                .collect();
            for affinity in [&uniform, &spread] {
                for viewer in snapshot.users() {
                    let pushed = walk(&snapshot, viewer, affinity, &params)
                        .unwrap_or_else(|error| panic!("n={nodes} mask={mask}: {error}"));
                    let exact = exact_visit_mass(&snapshot, viewer, affinity, &params);
                    let mut shortfall = 0.0;
                    for user in snapshot.users() {
                        let walked = pushed.visit_mass()[user.index()];
                        let solved = exact[user.index()];
                        assert!(
                            walked <= solved + 1e-9,
                            "n={nodes} mask={mask}: the push put {walked} on {} where the solve says {solved}",
                            snapshot.user_name(user)
                        );
                        shortfall += solved - walked;
                    }
                    assert!(
                        shortfall <= pushed.truncation() + 1e-9,
                        "n={nodes} mask={mask}: {shortfall} unaccounted for against a reported truncation of {}",
                        pushed.truncation()
                    );
                }
            }
        }
    }
}

/// Renaming everybody permutes the answer and changes nothing a viewer could be shown.
///
/// Not to the last bit, and the reason is worth stating: the push pops the heaviest pending edge
/// first and breaks ties on the ids, so renaming people changes which of two equally loaded
/// edges is expanded before the walk stops on `ε_total`. What the walk claims is that what it
/// left unresolved is inside the error it reports, so that error is the tolerance here — and it
/// is also the bar's own step, which makes the statement the one that matters: no relabelling
/// moves a score far enough to be drawn differently.
///
/// Every permutation on four nodes, and four of them on five and six, which is enough because
/// the graph the permutation produces is itself somewhere in the enumeration above.
#[test]
fn relabelling_leaves_the_answer_alone() {
    let params = Params::default();
    for nodes in 2..=MAX_NODES {
        let plain = identity(nodes);
        for positions in relabellings(nodes) {
            for mask in relabelling_masks(nodes) {
                for pattern in [1usize, 2, 4] {
                    let before = snapshot_of(nodes, mask, pattern, &plain);
                    let after = snapshot_of(nodes, mask, pattern, &positions);
                    for (original, &renamed) in positions.iter().enumerate() {
                        let here = compute_user(&before, UserId(original as u32), &params)
                            .expect("a result before relabelling");
                        let there = compute_user(&after, UserId(renamed as u32), &params)
                            .expect("a result after relabelling");
                        let tolerance = here.error(&params).max(there.error(&params)) + 1e-12;
                        for (ratable, score) in &here.scores {
                            match there.scores.get(ratable) {
                                Some(moved) => assert!(
                                    (score.score - moved.score).abs() <= tolerance,
                                    "n={nodes} mask={mask} pattern={pattern}: relabelling moved {ratable:?} from {score:?} to {moved:?}, past the {tolerance} it reported"
                                ),
                                // Dropped by one of the two and not the other: the display floor
                                // is a cut, so the same unresolved mass that moves a score can
                                // move a ratable across `W_min`. It has to be sitting on the
                                // cut, not anywhere above it.
                                None => assert!(
                                    (score.confidence - params.min_weight).abs() <= tolerance,
                                    "n={nodes} mask={mask} pattern={pattern}: relabelling dropped {ratable:?} at weight {}",
                                    score.confidence
                                ),
                            }
                        }
                        for (ratable, score) in &there.scores {
                            if !here.scores.contains_key(ratable) {
                                assert!(
                                    (score.confidence - params.min_weight).abs() <= tolerance,
                                    "n={nodes} mask={mask} pattern={pattern}: relabelling added {ratable:?} at weight {}",
                                    score.confidence
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Which masks the relabelling sweep takes: all of them while `n!` permutations over every graph
/// is cheap, and one in sixty-four on six nodes, where the product is millions of walks and the
/// six-node graphs are swept exhaustively by the check above anyway.
fn relabelling_masks(nodes: usize) -> impl Iterator<Item = u32> {
    let stride = if nodes == MAX_NODES { 64 } else { 1 };
    (0..(1u32 << pair_count(nodes))).step_by(stride)
}

/// The permutations the relabelling check runs: all of them while that is cheap, and a handful
/// with no fixed point once it is not.
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
