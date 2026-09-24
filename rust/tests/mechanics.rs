//! The arithmetic of DESIGN sections 2.2 to 2.6 on graphs small enough to work out by hand — plus a friend triangle that cannot
//! diverge, and what the data boundary drops. The budget is checked in `tests/settling.rs`.

mod common;

use std::collections::{BTreeMap, HashMap};

use common::{
    affinity_vector, all_of, assert_close, assert_finite, branch_total_of, detail_of, result_of,
    star, walk_of,
};
use grapevine_core::alignment::Alignment;
use grapevine_core::{
    CoreError, ItemId, Params, Ratable, RatingValue, Rng, Snapshot, SnapshotData, UserId,
    WorldConfig, alignments, hop_distances, informativeness, logit, score_ratables, simulate,
};

/// Informativeness: unanimity and thin support are both worth nothing.
/// `ω = 4·n⁺·n⁻ / (n·(n + 1))` (DESIGN section 2.2): the even-split factor times the support the
/// count itself carries, so an item nobody in reach dissents on is worth exactly zero however
/// many people rated it, and two people disagreeing is worth less than twenty.
///
/// The viewer votes in their own reach at `π̃_u(u) = 1`. In the rows below the viewer has rated
/// nothing at all, so every count is the friends' alone and each of them carries exactly one
/// friend-unit; the last block is what the viewer's own thumb does.
#[test]
fn informativeness_is_zero_on_unanimity() {
    let params = Params::default();
    let (snapshot, viewer, friends, items, _) = star(10);
    let mut builder = snapshot.edit();
    // i0: ten up, no down. i1: five up, five down. i2: a single up. i3: nobody. i4: two up,
    // one down.
    for (index, &friend) in friends.iter().enumerate() {
        builder.rate(friend, Ratable::Item(items[0]), 1);
        builder.rate(
            friend,
            Ratable::Item(items[1]),
            if index < 5 { 1 } else { -1 },
        );
    }
    builder.rate(friends[0], Ratable::Item(items[2]), 1);
    // i5: one up, one down, `ω = 2/3`. The same value as 2 up / 1 down, and the
    // smallest split that is contested at all.
    builder.rate(friends[0], Ratable::Item(items[5]), 1);
    builder.rate(friends[1], Ratable::Item(items[5]), -1);
    for (index, &friend) in friends.iter().take(3).enumerate() {
        builder.rate(
            friend,
            Ratable::Item(items[4]),
            if index < 2 { 1 } else { -1 },
        );
    }
    let snapshot = builder.build();
    assert!(
        snapshot.ratings(viewer).is_empty(),
        "the viewer rates nothing here, so every count below is the friends' alone"
    );

    let result = walk_of(
        &snapshot,
        viewer,
        &vec![1.0; snapshot.user_count()],
        &params,
    );
    let mass = result.visit_mass().to_vec();
    for &friend in &friends {
        assert_close(
            mass[friend.index()],
            1.0,
            1e-12,
            "a friend carries unit mass",
        );
    }
    let omega = informativeness(&snapshot, viewer, &mass);

    let expected = |positive: f64, negative: f64| {
        let total = positive + negative;
        if total == 0.0 {
            0.0
        } else {
            4.0 * positive * negative / (total * (total + 1.0))
        }
    };
    assert_close(
        omega[items[0].index()],
        expected(10.0, 0.0),
        1e-12,
        "10 up / 0 down",
    );
    assert_close(omega[items[0].index()], 0.0, 1e-12, "unanimity is worth 0");
    assert_close(
        omega[items[1].index()],
        expected(5.0, 5.0),
        1e-12,
        "5 up / 5 down",
    );
    assert_close(
        omega[items[1].index()],
        10.0 / 11.0,
        1e-12,
        "an even split at n = 10 is n/(n+1) = 10/11",
    );
    assert_close(
        omega[items[2].index()],
        0.0,
        1e-12,
        "a single rating is unanimous within reach, so it is worth 0",
    );
    assert_close(omega[items[3].index()], 0.0, 1e-12, "nobody rated it");
    assert_close(
        omega[items[4].index()],
        expected(2.0, 1.0),
        1e-12,
        "2 up / 1 down",
    );
    assert_close(
        omega[items[4].index()],
        2.0 / 3.0,
        1e-12,
        "2 up / 1 down is 4·2·1/(3·4) = 2/3",
    );
    assert_close(
        omega[items[5].index()],
        expected(1.0, 1.0),
        1e-12,
        "1 up / 1 down",
    );
    assert_close(
        omega[items[5].index()],
        2.0 / 3.0,
        1e-12,
        "1 up / 1 down is 4·1·1/(2·3) = 2/3",
    );
    assert!(
        omega[items[4].index()] < omega[items[1].index()],
        "three votes evenly split are worth less than ten"
    );

    // DESIGN section 2.2's viewer clause: the viewer's own thumb is a vote in their own reach at
    // π̃ = 1, so their dissent is what makes a ten-up item contested at all.
    let mut builder = snapshot.edit();
    builder.rate(viewer, Ratable::Item(items[0]), -1);
    let dissenting = builder.build();
    let with_viewer = informativeness(&dissenting, viewer, &mass);
    assert_close(
        with_viewer[items[0].index()],
        expected(10.0, 1.0),
        1e-12,
        "ten friends up and the viewer down is 4·10·1/(11·12)",
    );
    assert!(
        with_viewer[items[0].index()] > 0.0,
        "the viewer's own dissent has to register, or a swarm the viewer disagrees with would \
         never look contested"
    );
}

/// Alignment: the shrunk agreement rate and its log-odds, and the fact that tag ratings
/// never enter it.
#[test]
fn alignment_shrinks_toward_the_prior() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let agreeing = builder.user("agreeing");
    let opposed = builder.user("opposed");
    let stranger = builder.user("stranger");
    let far = builder.user("far");
    builder.edge(viewer, agreeing);
    builder.edge(viewer, opposed);
    builder.edge(viewer, stranger);
    builder.edge(stranger, far);
    let contested: Vec<ItemId> = (0..8)
        .map(|index| builder.item(&format!("c{index}")))
        .collect();
    let tag = builder.tag("cheap");
    for &item in &contested {
        builder.rate(viewer, Ratable::Item(item), 1);
        builder.rate(opposed, Ratable::Item(item), -1);
    }
    for &item in &contested[..3] {
        builder.rate(agreeing, Ratable::Item(item), 1);
    }
    // 100 agreeing tag ratings between the viewer and the stranger, who shares no item rating.
    for index in 0..100 {
        let item = builder.item(&format!("tagged{index}"));
        builder.rate(viewer, Ratable::Tag(item, tag), 1);
        builder.rate(stranger, Ratable::Tag(item, tag), 1);
    }
    let snapshot = builder.build();

    // Every shared item is taken as fully contested, which is what "ω = 1" means here.
    let omega = vec![1.0; snapshot.item_count()];
    let distances = hop_distances(&snapshot, viewer);
    let mass = vec![1.0; snapshot.user_count()];
    let taste = alignments(&snapshot, viewer, &omega, &distances, &mass, &params);
    let pseudocount = params.alignment_pseudocount;
    let prior = params.prior_friend;

    let agreeing_alignment = taste[agreeing.index()].expect("a friend is in reach");
    let expected_estimate = (pseudocount * prior + 3.0) / (pseudocount + 3.0);
    assert_close(
        agreeing_alignment.estimate,
        expected_estimate,
        1e-12,
        "3 agreements, 0 disagreements at hop 1",
    );
    assert_close(
        agreeing_alignment.weight,
        logit(expected_estimate),
        1e-12,
        "ℓ from â",
    );
    assert_close(agreeing_alignment.weight, 1.0745, 1e-3, "ℓ ≈ 1.07");

    // Disagreeing on all eight shared items: (8·0.65)/(8+8) = 0.325, ℓ = −0.73 < −0.4.
    let opposed_alignment = taste[opposed.index()].expect("a friend is in reach");
    let opposed_estimate = (pseudocount * prior) / (pseudocount + 8.0);
    assert_close(
        opposed_alignment.estimate,
        opposed_estimate,
        1e-12,
        "0 agreements, 8 disagreements at hop 1",
    );
    assert_close(
        opposed_alignment.weight,
        logit(opposed_estimate),
        1e-12,
        "ℓ from â",
    );
    assert!(
        opposed_alignment.weight < -0.4,
        "a consistently opposed friend is worth ℓ = {} < −0.4",
        opposed_alignment.weight
    );
    // With κ = 8 and a₀(1) = 0.65 it takes more than 4.96 units of disagreement to reach
    // ℓ = −0.4; three disagreements give logit(5.2/11) = −0.109. "Disagreeing on
    // all 3 gives ℓ < −0.4" is what the shipped κ makes unreachable, so the exact three-
    // disagreement value is pinned here and the sign test above uses eight.
    let three_disagreements = logit(pseudocount * prior / (pseudocount + 3.0))
        .clamp(-params.alignment_clamp, params.alignment_clamp);
    assert_close(
        three_disagreements,
        -0.10924,
        1e-4,
        "3 disagreements at hop 1",
    );

    // The stranger's hundred agreeing tag ratings leave â at the prior exactly.
    let stranger_alignment = taste[stranger.index()].expect("a friend is in reach");
    assert_close(
        stranger_alignment.estimate,
        params.prior_friend,
        0.0,
        "no item overlap at hop 1 is exactly a₀(1)",
    );
    assert_eq!(stranger_alignment.agreements, 0.0);
    assert_eq!(stranger_alignment.disagreements, 0.0);

    let far_alignment = taste[far.index()].expect("a friend of a friend is in reach");
    assert_close(
        far_alignment.estimate,
        params.prior_friend_of_friend,
        0.0,
        "no overlap at hop 2 is exactly a₀(2)",
    );
}

/// The three-user graph the WebAssembly smoke script checks against: two friends, neither of
/// whom knows the other, both thumbing the same item up. Each carries exactly one friend-unit
/// and the prior alignment of a friend with no shared ratings, so the arithmetic is closed form.
#[test]
fn hand_computed_three_user_graph() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u0");
    let first = builder.user("u1");
    let second = builder.user("u2");
    let item = Ratable::Item(builder.item("i0"));
    builder.edge(viewer, first);
    builder.edge(viewer, second);
    builder.rate(first, item, 1);
    builder.rate(second, item, 1);
    let snapshot = builder.build();

    let result = result_of(&snapshot, viewer, &params);
    let weight = logit(params.prior_friend);
    let evidence = 2.0 * weight;
    assert_close(
        result.scores[&item].confidence,
        evidence,
        1e-12,
        "W = 2·π̃·ℓ with π̃ = 1 and ℓ = logit(0.65)",
    );
    assert_close(
        result.scores[&item].score,
        evidence / (params.score_shrinkage + evidence),
        1e-12,
        "s = E/(κ_s + W)",
    );
    assert_close(
        result.scores[&item].score,
        0.553_188_4,
        1e-6,
        "the smoke script's number",
    );
    assert_eq!(result.reach, 2);
}

/// The walk's mechanics: injection, the geometric bound on a branch, non-backtracking,
/// the absorbing viewer, affinity steering, conservation at every node, and a viewer with
/// no friends.
#[test]
fn walk_mechanics() {
    let params = Params::default();
    let exact = Params {
        error_budget: 1e-9,
        node_budget: usize::MAX,
        ..params
    };

    // A friend whose only friend is the viewer: exactly one unit, nothing beyond.
    let (snapshot, viewer, friends, _, _) = star(6);
    let result = walk_of(
        &snapshot,
        viewer,
        &vec![1.0; snapshot.user_count()],
        &params,
    );
    let mass = result.visit_mass().to_vec();
    assert_close(mass[friends[0].index()], 1.0, 0.0, "π̃ of a leaf friend");
    assert_close(
        branch_total_of(
            &snapshot,
            viewer,
            friends[0],
            &vec![1.0; snapshot.user_count()],
            &params,
        ),
        0.0,
        0.0,
        "a leaf friend has no branch",
    );
    assert_close(
        mass.iter().sum::<f64>(),
        friends.len() as f64,
        1e-12,
        "a star holds exactly one unit per friend",
    );

    // An infinite-looking tree: every node the budget reaches has somewhere non-backtracking to
    // go, so no mass dies and Σ π̃ = |F_u| · Σ_j (1−α)^j = |F_u|/α, less what is still in flight.
    let (tree, tree_viewer, tree_friends) = tree_world(3, 6);
    let tree_walk = walk_of(&tree, tree_viewer, &vec![1.0; tree.user_count()], &params);
    let tree_mass = tree_walk.visit_mass().to_vec();
    let expected_total = tree_friends.len() as f64 / params.decay;
    assert_close(
        expected_total,
        2.0 * tree_friends.len() as f64,
        0.0,
        "1/α = 2",
    );
    assert!(tree_walk.truncation() <= params.error_budget);
    assert_close(
        tree_mass.iter().sum::<f64>(),
        expected_total,
        tree_walk.truncation() + 1e-9,
        "Σ π̃ = |F_u| · Σ_j (1−α)^j",
    );

    // The geometric bound: everything beyond one friend weighs at most one friend-unit, with no
    // cap needed to make it so.
    for (graph, owner, walked) in [
        (&snapshot, viewer, &result),
        (&tree, tree_viewer, &tree_walk),
    ] {
        for &friend in walked.friends() {
            let beyond = branch_total_of(
                graph,
                owner,
                friend,
                &vec![1.0; graph.user_count()],
                &params,
            );
            assert!(
                beyond <= 1.0 + 1e-12,
                "‖β^{{(f)}}‖₁ = {beyond} exceeds one friend-unit"
            );
        }
    }

    // Non-backtracking, on the path u – f – g: f keeps exactly its injection because nothing
    // comes back from g, and g has (1 − α).
    let mut builder = Snapshot::builder();
    let path_viewer = builder.user("u");
    let near = builder.user("f");
    let beyond = builder.user("g");
    builder.edge(path_viewer, near);
    builder.edge(near, beyond);
    let path = builder.build();
    let path_walk = walk_of(&path, path_viewer, &vec![1.0; path.user_count()], &exact);
    let path_mass = path_walk.visit_mass().to_vec();
    assert_close(path_mass[near.index()], 1.0, 1e-12, "π̃(f) is its injection");
    assert_close(
        path_mass[beyond.index()],
        1.0 - params.decay,
        1e-12,
        "π̃(g) = 1 − α",
    );

    // The viewer absorbs: on the triangle u – f – f' – u, f's only onward neighbour is f', so f'
    // gets its own injection plus (1 − α)·1, and from f' the walk has nowhere to go that is not
    // f (backtracking) or u (absorbing).
    let mut builder = Snapshot::builder();
    let corner_viewer = builder.user("u");
    let first = builder.user("f");
    let second = builder.user("g");
    builder.edge(corner_viewer, first);
    builder.edge(corner_viewer, second);
    builder.edge(first, second);
    let triangle = builder.build();
    let triangle_walk = walk_of(
        &triangle,
        corner_viewer,
        &vec![1.0; triangle.user_count()],
        &exact,
    );
    let triangle_mass = triangle_walk.visit_mass().to_vec();
    let share_from_first = 1.0;
    assert_close(
        triangle_mass[second.index()],
        1.0 + (1.0 - params.decay) * share_from_first,
        1e-12,
        "π̃(f') = 1 + (1−α)·(its share of f's onward mass)",
    );
    assert_close(
        branch_total_of(
            &triangle,
            corner_viewer,
            first,
            &vec![1.0; triangle.user_count()],
            &exact,
        ),
        1.0 - params.decay,
        1e-12,
        "everything beyond f is the one step to f'",
    );

    // Affinity steering: on a star centred at a friend with ten leaves, the one maximally
    // aligned leaf takes e^L/(e^L + 9) of the friend's onward mass — `aff = exp(max(ℓ, 0))`, so
    // a leaf at the alignment clamp is preferred e^L ≈ 7.39 : 1 over one the viewer knows
    // nothing about.
    let mut builder = Snapshot::builder();
    let hub_viewer = builder.user("u");
    let hub = builder.user("hub");
    builder.edge(hub_viewer, hub);
    let favourite = builder.user("favourite");
    builder.edge(hub, favourite);
    for index in 0..9 {
        let other = builder.user(&format!("other{index}"));
        builder.edge(hub, other);
    }
    let starred = builder.build();
    let mut affinity = vec![1.0; starred.user_count()];
    affinity[favourite.index()] = params.affinity_cap();
    let steered = walk_of(&starred, hub_viewer, &affinity, &exact);
    let steered_mass = steered.visit_mass().to_vec();
    let expected_share = params.affinity_cap() / (params.affinity_cap() + 9.0);
    assert_close(
        params.affinity_cap(),
        7.389_056,
        1e-6,
        "e^L is the affinity cap",
    );
    assert_close(
        steered_mass[favourite.index()],
        (1.0 - params.decay) * expected_share,
        1e-12,
        "the aligned leaf takes A_max/(A_max + 9) of the onward mass",
    );

    // A split moves mass sideways and never makes more of it. Whatever the affinity
    // weights do with a node's onward neighbours, exactly `1 − α` of what reached the node
    // leaves it — which is what bounds the total on a graph with cycles in it.
    let (tree, tree_viewer, _) = tree_world(3, 6);
    let affinity: Vec<f64> = (0..tree.user_count())
        .map(|index| 1.0 + (index % 3) as f64)
        .collect();
    let split = walk_of(&tree, tree_viewer, &affinity, &exact);
    // On a tree, a node's children receive from that node and nobody else, so what leaves a node
    // is exactly what its children hold.
    let depth = hop_distances(&tree, tree_viewer);
    let mut conserving = 0;
    for &node in split.touched() {
        let arriving = split.visit_mass()[node.index()];
        let children: Vec<UserId> = tree
            .friends(node)
            .iter()
            .copied()
            .filter(|&next| depth[next.index()] > depth[node.index()])
            .collect();
        // A leaf has nowhere to send what it got, and a node holding almost nothing is a
        // statement about the budget rather than about the split.
        if arriving < 1e-6 || children.len() < 2 {
            continue;
        }
        let leaving: f64 = children
            .iter()
            .map(|&next| split.visit_mass()[next.index()])
            .sum();
        assert_close(
            leaving / arriving,
            1.0 - params.decay,
            1e-6,
            "what leaves a node is 1 − α of what reached it, whatever the split",
        );
        conserving += 1;
    }
    assert!(
        conserving >= 20,
        "only {conserving} nodes carried enough mass to say anything about the split"
    );

    // No friends, no result, no NaN.
    let mut builder = Snapshot::builder();
    let lonely = builder.user("lonely");
    let empty = builder.build();
    let nothing = walk_of(&empty, lonely, &[1.0], &params);
    assert!(nothing.friends().is_empty());
    assert_eq!(nothing.nodes_touched(), 0);
    assert_finite(nothing.visit_mass().iter().copied(), "an empty walk");
    let lonely_result = result_of(&empty, lonely, &params);
    assert!(lonely_result.scores.is_empty());
    assert_eq!(lonely_result.settle_movement, 0.0);
}

/// The push is a linear solve, not a simulation: it reproduces the resolvent row
/// `e_uᵀ (I − (1−α)B_u)^{−1}` of DESIGN section 2.4 on directed edges, with the affinity split
/// on the operator.
#[test]
fn walk_equals_the_exact_resolvent() {
    let params = Params {
        error_budget: 1e-10,
        node_budget: usize::MAX,
        ..Params::default()
    };
    let mut rng = Rng::new(31);
    let mut builder = Snapshot::builder();
    let people: Vec<UserId> = (0..30)
        .map(|index| builder.user(&format!("p{index}")))
        .collect();
    for (index, &person) in people.iter().enumerate() {
        for &other in &people[index + 1..] {
            if rng.chance(0.18) {
                builder.edge(person, other);
            }
        }
    }
    // Make sure the viewer has friends to inject into.
    for &other in &people[1..4] {
        builder.edge(people[0], other);
    }
    let snapshot = builder.build();
    let viewer = people[0];
    let affinity: Vec<f64> = (0..snapshot.user_count())
        .map(|_| 1.0 + 3.0 * rng.next_f64())
        .collect();

    // A uniform operator first, then one the affinity weights skew hard: the push has to solve
    // the operator the weights describe, not only the neutral one where every onward neighbour
    // takes an equal share.
    let skewed: Vec<f64> = (0..snapshot.user_count())
        .map(|_| (2.0 * rng.next_f64()).exp())
        .collect();
    for (label, weights) in [("uniform", &affinity), ("skewed", &skewed)] {
        let pushed = walk_of(&snapshot, viewer, weights, &params)
            .visit_mass()
            .to_vec();
        let solved = resolvent_visit_mass(&snapshot, viewer, weights, &params);
        assert!(
            solved.iter().sum::<f64>() > 1.0,
            "the {label} solve found real mass"
        );
        for user in snapshot.users() {
            assert_close(
                pushed[user.index()],
                solved[user.index()],
                1e-8,
                &format!("the {label} push matches the resolvent"),
            );
        }
    }
}

/// The error bound: what the walk reports as truncation really does bound how far its
/// masses and scores are from the walk run to convergence, and a tighter budget only ever looks
/// at more nodes.
///
/// The comparison holds the affinity and the alignments fixed at the values the settled
/// computation produced, and moves only the push's budget. It has to: the settling loop walks
/// the graph once a pass, so two *computations* at two budgets differ in how far they settled
/// as well as in what they truncated, and the claim under test here is the push's alone.
#[test]
fn walk_error_bound() {
    let params = Params::default();
    let world = simulate(
        // Sparse enough that the reference run below, which pushes until the residual is
        // 1e-9, is quick: the push's cost is a multiple of the number of directed edges.
        &WorldConfig {
            users: 500,
            items: 120,
            rated_fraction: 0.25,
            p_same_cluster: 0.03,
            p_other_cluster: 0.004,
            ..WorldConfig::default()
        },
        &mut Rng::new(17),
    );
    let viewer = UserId(3);
    // The reference is a *walk* run to convergence, not a whole computation: one budget covers
    // every pass of the settling loop, so a computation asked for `1e-9` would spend it on the
    // early passes and truncate the pass this test is about.
    let exact_params = Params {
        error_budget: 1e-9,
        node_budget: usize::MAX,
        edge_budget: 100_000_000,
        ..params
    };
    let settled = detail_of(&world.snapshot, viewer, &params);
    let affinity = affinity_vector(&settled, &params);
    let exact = walk_of(&world.snapshot, viewer, &affinity, &exact_params);
    assert!(exact.truncation() <= exact_params.error_budget);
    let exact_scores = score_ratables(
        &world.snapshot,
        viewer,
        exact.visit_mass(),
        &settled.alignments,
        &params,
    );

    let mut previous_touched = 0;
    for budget in [0.1, 0.02, 0.001] {
        let coarse = Params {
            error_budget: budget,
            ..params
        };
        let walked = walk_of(&world.snapshot, viewer, &affinity, &coarse);
        let truncation = walked.truncation();
        assert!(
            truncation <= budget + 1e-12,
            "reported truncation {truncation} exceeds ε_total {budget}"
        );
        for user in world.users() {
            assert_close(
                walked.visit_mass()[user.index()],
                exact.visit_mass()[user.index()],
                truncation + 1e-9,
                "π̃ within the reported truncation",
            );
        }
        let scores = score_ratables(
            &world.snapshot,
            viewer,
            walked.visit_mass(),
            &settled.alignments,
            &params,
        );
        for (&ratable, score) in &scores {
            let reference = exact_scores.get(&ratable).copied().unwrap_or_default();
            let bound = params.alignment_clamp * truncation
                / (params.score_shrinkage + score.confidence.min(reference.confidence));
            assert_close(
                score.score,
                reference.score,
                bound + 1e-9,
                "score within L · truncation / (κ_s + W)",
            );
        }
        assert!(
            walked.nodes_touched() >= previous_touched,
            "a tighter budget touches at least as many nodes"
        );
        previous_touched = walked.nodes_touched();
    }

    // The node budget can stop the walk long before the error budget is met; what it reports as
    // truncation still bounds the error.
    let starved = Params {
        node_budget: 50,
        ..params
    };
    let walked = walk_of(&world.snapshot, viewer, &affinity, &starved);
    let truncation = walked.truncation();
    assert!(
        truncation > starved.error_budget,
        "the node budget bound first"
    );
    for user in world.users() {
        assert_close(
            walked.visit_mass()[user.index()],
            exact.visit_mass()[user.index()],
            truncation + 1e-9,
            "π̃ within the reported truncation even when the node budget stopped the walk",
        );
    }

    // The pop order is fixed by the graph — buckets by binary exponent, first come first served
    // inside one, deposits in neighbour order — so the same graph gives the same walk, and the
    // same settling loop over it.
    let once = detail_of(&world.snapshot, viewer, &params);
    let twice = detail_of(&world.snapshot, viewer, &params);
    assert_eq!(once.visit_mass, twice.visit_mass);
    assert_eq!(once.final_pass.touched(), twice.final_pass.touched());
    assert_eq!(
        once.movements, twice.movements,
        "the settling loop is a function of the snapshot"
    );
}

/// Sign symmetry: an anti-aligned account rating `−1` is exactly as much evidence
/// as an aligned one rating `+1`. Documented, not a defense.
#[test]
fn sign_symmetry() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let aligned = builder.user("aligned");
    let opposed = builder.user("opposed");
    let liked = Ratable::Item(builder.item("liked"));
    let hated = Ratable::Item(builder.item("hated"));
    builder.edge(viewer, aligned);
    builder.edge(viewer, opposed);
    builder.rate(aligned, liked, 1);
    builder.rate(opposed, hated, -1);
    let snapshot = builder.build();

    let mut taste: Vec<Option<Alignment>> = vec![None; snapshot.user_count()];
    taste[aligned.index()] = Some(Alignment {
        agreements: 0.0,
        disagreements: 0.0,
        estimate: 0.0,
        weight: 1.5,
    });
    taste[opposed.index()] = Some(Alignment {
        agreements: 0.0,
        disagreements: 0.0,
        estimate: 0.0,
        weight: -1.5,
    });
    let mass = vec![1.0; snapshot.user_count()];
    let scores = score_ratables(&snapshot, viewer, &mass, &taste, &params);
    assert_close(
        scores[&liked].score,
        scores[&hated].score,
        1e-12,
        "E is invariant under flipping both signs",
    );
    assert_close(
        scores[&liked].confidence,
        scores[&hated].confidence,
        1e-12,
        "W is invariant under flipping both signs",
    );
}

/// Determinism and degenerate inputs.
#[test]
fn determinism_and_degenerate_inputs() {
    let params = Params::default();
    let config = WorldConfig {
        users: 40,
        items: 40,
        ..WorldConfig::default()
    };
    let world = simulate(&config, &mut Rng::new(5));
    let again = simulate(&config, &mut Rng::new(5));
    assert_eq!(world.snapshot.to_data(), again.snapshot.to_data());
    assert_eq!(world.true_preference, again.true_preference);

    let first = all_of(&world.snapshot, &params);
    let second = all_of(&world.snapshot, &params);
    assert_eq!(first, second);
    for result in &first {
        assert_finite(
            result
                .scores
                .values()
                .flat_map(|score| [score.score, score.confidence]),
            "a simulated result",
        );
        for score in result.scores.values() {
            assert!(
                score.confidence >= params.min_weight,
                "nothing below W_min is returned",
            );
        }
    }

    // Friends, but nobody in reach has rated anything: an empty result, no NaN.
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let silent = builder.user("silent");
    let also_silent = builder.user("also-silent");
    builder.edge(viewer, silent);
    builder.edge(silent, also_silent);
    let quiet = builder.build();
    let detail = detail_of(&quiet, viewer, &params);
    let result = detail.result(&params);
    assert!(result.scores.is_empty());
    assert_finite(detail.visit_mass.iter().copied(), "a silent world");
    assert!(
        result.settled,
        "with no scores to move, the loop settles on its first pass"
    );
    assert_eq!(result.settle_movement, 0.0);

    // A friend with no ratings contributes nothing: adding one changes no score.
    let viewer = UserId(0);
    let mut builder = world.snapshot.edit();
    let mute = builder.user("mute");
    builder.edge(viewer, mute);
    let extended = builder.build();
    let before: BTreeMap<String, f64> = result_of(&world.snapshot, viewer, &params)
        .scores
        .into_iter()
        .map(|(ratable, score)| (world.snapshot.ratable_name(ratable), score.score))
        .collect();
    let after: BTreeMap<String, f64> = result_of(&extended, viewer, &params)
        .scores
        .into_iter()
        .map(|(ratable, score)| (extended.ratable_name(ratable), score.score))
        .collect();
    assert_eq!(
        before.keys().collect::<Vec<_>>(),
        after.keys().collect::<Vec<_>>(),
        "a friend with no ratings surfaces nothing new"
    );
}

/// `π̃` by solving `(I − (1−α)B_u) m = e` on directed edges with dense Gaussian elimination and
/// summing the edge masses onto their targets. `B_u` is the non-backtracking operator of DESIGN
/// section 2.4: an edge `(w → v)` feeds `(v → y)` for every neighbour `y` of `v` other than `w`
/// and the viewer, in proportion to affinity. Edges into the viewer do not exist, which is what
/// "absorbed at the viewer" means, and the injection edges `(u → f)` carry one unit each.
fn resolvent_visit_mass(
    snapshot: &Snapshot,
    viewer: UserId,
    affinity: &[f64],
    params: &Params,
) -> Vec<f64> {
    let mut edges: Vec<(UserId, UserId)> = Vec::new();
    let mut index_of: HashMap<(UserId, UserId), usize> = HashMap::new();
    for source in snapshot.users() {
        for &target in snapshot.friends(source) {
            if target != viewer {
                index_of.insert((source, target), edges.len());
                edges.push((source, target));
            }
        }
    }
    let count = edges.len();
    let mut system = vec![vec![0.0; count + 1]; count];
    for (row, equation) in system.iter_mut().enumerate() {
        equation[row] = 1.0;
    }
    for &friend in snapshot.friends(viewer) {
        system[index_of[&(viewer, friend)]][count] = 1.0;
    }
    for (edge, &(came_from, node)) in edges.iter().enumerate() {
        let onward: Vec<UserId> = snapshot
            .friends(node)
            .iter()
            .copied()
            .filter(|&next| next != came_from && next != viewer)
            .collect();
        let weight = |next: UserId| affinity[next.index()];
        let total: f64 = onward.iter().copied().map(weight).sum();
        if total <= 0.0 {
            continue;
        }
        // The row of the operator: `1 − α` of what is at `v` goes anywhere at all, split over
        // `v`'s onward neighbours in proportion to affinity (DESIGN section 2.4).
        let onward_probability = 1.0 - params.decay;
        for &next in &onward {
            let share = onward_probability * weight(next) / total;
            system[index_of[&(node, next)]][edge] -= share;
        }
    }

    let solution = solve(system);
    let mut mass = vec![0.0; snapshot.user_count()];
    for (edge, &(_, target)) in edges.iter().enumerate() {
        mass[target.index()] += solution[edge];
    }
    mass
}

/// Dense Gaussian elimination with partial pivoting on an augmented matrix.
fn solve(mut system: Vec<Vec<f64>>) -> Vec<f64> {
    let count = system.len();
    for column in 0..count {
        let mut pivot = column;
        for row in column + 1..count {
            if system[row][column].abs() > system[pivot][column].abs() {
                pivot = row;
            }
        }
        system.swap(column, pivot);
        let divisor = system[column][column];
        assert!(divisor.abs() > 1e-12, "the resolvent is singular");
        for entry in system[column][column..].iter_mut() {
            *entry /= divisor;
        }
        for row in 0..count {
            if row == column {
                continue;
            }
            let factor = system[row][column];
            if factor == 0.0 {
                continue;
            }
            let (pivot_row, target_row) = if row < column {
                let (left, right) = system.split_at_mut(column);
                (&right[0], &mut left[row])
            } else {
                let (left, right) = system.split_at_mut(row);
                (&left[column], &mut right[0])
            };
            for (entry, pivot) in target_row[column..=count]
                .iter_mut()
                .zip(&pivot_row[column..=count])
            {
                *entry -= factor * pivot;
            }
        }
    }
    system.iter().map(|equation| equation[count]).collect()
}

/// A tree of depth `depth` with `branching` children per node, hung off the viewer. Nothing in
/// it is a dead end within the budget, so the walk loses no mass.
fn tree_world(branching: usize, depth: usize) -> (Snapshot, UserId, Vec<UserId>) {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let root = builder.user("root");
    builder.edge(viewer, root);
    let mut frontier = vec![root];
    for level in 0..depth {
        let mut next = Vec::new();
        for (position, &parent) in frontier.iter().enumerate() {
            for child in 0..branching {
                let node = builder.user(&format!("n{level}_{position}_{child}"));
                builder.edge(parent, node);
                next.push(node);
            }
        }
        frontier = next;
    }
    (builder.build(), viewer, vec![root])
}

/// Mutual friends: the shape every real friend group has.
///
/// Three friends who all know each other are a triangle the non-backtracking walk circles
/// forever: from any of them the only step that is neither backtracking nor onto the viewer is
/// the next one round. A weight that *multiplied* the mass crossing an edge by more than
/// `1/(1−α) = 2` on that ring would make the resolvent diverge. Section 2.4's affinity split
/// only reallocates, so what leaves a node is `1 − α` of what reached it however aligned the
/// ring is, and the settling loop on top of it has nothing to amplify either.
#[test]
fn a_friend_triangle_stays_bounded_and_settles() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let items: Vec<ItemId> = (0..100)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let mine: Vec<i8> = (0..items.len())
        .map(|index| if index % 2 == 0 { 1 } else { -1 })
        .collect();
    for (index, &item) in items.iter().enumerate() {
        builder.rate(viewer, Ratable::Item(item), mine[index]);
    }
    // K4: the viewer and three friends, all six edges present. Each friend has one dissenting
    // outsider, so every item is contested and ω is above zero — without that no alignment
    // moves off its prior and the shape proves nothing.
    let friends: Vec<UserId> = (0..3)
        .map(|index| builder.user(&format!("f{index}")))
        .collect();
    for (index, &friend) in friends.iter().enumerate() {
        builder.edge(viewer, friend);
        builder.edge(friend, friends[(index + 1) % friends.len()]);
        for (position, &item) in items.iter().enumerate() {
            builder.rate(friend, Ratable::Item(item), mine[position]);
        }
        let dissenter = builder.user(&format!("d{index}"));
        builder.edge(friend, dissenter);
        for (position, &item) in items.iter().enumerate() {
            builder.rate(dissenter, Ratable::Item(item), -mine[position]);
        }
    }
    let world = builder.build();

    // Three bounds, asked of any walk on this world: no friend holds more
    // than two friend-units, the whole reach holds at most `|F_u|/α`, and what sits beyond the
    // friends themselves is at most one unit per friend.
    let bounded = |mass: &[f64], label: &str| {
        assert_finite(mass.iter().copied(), label);
        for &friend in &friends {
            assert!(
                mass[friend.index()] <= 2.0,
                "{label}: π̃({}) = {}",
                world.user_name(friend),
                mass[friend.index()]
            );
        }
        let total: f64 = mass.iter().sum::<f64>() - mass[viewer.index()];
        assert!(
            total <= friends.len() as f64 / params.decay + 1e-9,
            "{label}: Σ π̃ = {total} exceeds |F_u|/α"
        );
        let friend_mass: f64 = friends.iter().map(|&friend| mass[friend.index()]).sum();
        assert!(
            total - friend_mass <= friends.len() as f64 + 1e-9,
            "{label}: {} beyond the friends exceeds |F_u|",
            total - friend_mass
        );
    };

    let detail = detail_of(&world, viewer, &params);
    bounded(&detail.visit_mass, "π̃ on a friend triangle");
    assert!(
        detail.final_pass.truncation() <= params.error_budget,
        "the last pass did not converge: truncation {}",
        detail.final_pass.truncation()
    );
    assert!(
        detail.settled,
        "the loop ran out of passes on a triangle, stopping at a movement of {:?}",
        detail.movements.last()
    );
    println!(
        "the friend triangle: π̃(f) = {:.4}, {:.4}, {:.4}; truncation {:.5}; movements {:?}",
        detail.mass(friends[0]),
        detail.mass(friends[1]),
        detail.mass(friends[2]),
        detail.final_pass.truncation(),
        detail
            .movements
            .iter()
            .map(|moved| format!("{moved:.2e}"))
            .collect::<Vec<_>>()
    );
}

/// What the data boundary accepts.
///
/// The core reads anything but `1`/`-1` as absent, and it has to do that by *dropping* the value
/// rather than refusing the snapshot: one crafted account inside a viewer's reach would
/// otherwise fail that viewer's whole recompute, and every viewer's within reach of it.
#[test]
fn the_data_boundary_drops_what_it_cannot_read() {
    let params = Params::default();
    let mut ratings: BTreeMap<String, BTreeMap<String, RatingValue>> = BTreeMap::new();
    let crafted: BTreeMap<String, RatingValue> = [
        ("café bleu", RatingValue::from(1)),
        ("real-item", RatingValue::from(-1)),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect();
    ratings.insert("u1".to_string(), crafted);
    // Everything the core must not keep: values that are not thumbs, and keys whose halves are
    // not usable ids. Case and accents are NOT among them — an id is the text a person typed,
    // and NFKC-normality is the database's CHECK.
    // `true` and `"yes"` deserialize to `NaN` rather than failing, which is the half of this
    // the `serde` feature carries (`nothing_a_rating_map_can_hold_fails_the_boundary` in
    // `data.rs`); what `to_snapshot` then does with them is the half under test here.
    let junk: BTreeMap<String, RatingValue> = [
        ("café bleu", 1.5),
        ("real-item", 300.0),
        ("other-item", f64::NAN),
        ("third-item", f64::NAN),
        ("", 1.0),
        ("\u{0}cheap", 1.0),
        ("a\u{0}b\u{0}c", 1.0),
        ("caf\u{7}e", 1.0),
        ("two\nlines", 1.0),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), RatingValue::from(value)))
    .collect();
    ratings.insert("u2".to_string(), junk);
    ratings.insert(
        "u3".to_string(),
        [("café bleu".to_string(), RatingValue::from(1))]
            .into_iter()
            .collect(),
    );
    let data = SnapshotData {
        users: vec!["u0".into(), "u1".into(), "u2".into(), "u3".into()],
        edges: vec![
            ("u0".into(), "u1".into()),
            ("u0".into(), "u2".into()),
            ("u0".into(), "u3".into()),
        ],
        ratings,
        ..SnapshotData::default()
    };
    let snapshot = data.to_snapshot();
    let crafted = snapshot.user_id("u2").expect("u2 is in the snapshot");
    assert!(
        snapshot.ratings(crafted).is_empty(),
        "the crafted account kept {:?}",
        snapshot
            .ratings(crafted)
            .iter()
            .map(|&(ratable, _)| snapshot.ratable_name(ratable))
            .collect::<Vec<_>>()
    );
    let viewer = snapshot.user_id("u0").expect("u0 is in the snapshot");
    let result = result_of(&snapshot, viewer, &params);
    let bleu = snapshot
        .ratable_id("café bleu")
        .expect("two accounts rated it");
    assert!(
        result.scores.contains_key(&bleu),
        "the rest of the snapshot has to compute: {:?}",
        result.scores.keys().collect::<Vec<_>>()
    );

    // Every parameter DESIGN section 2.8 gives a range is refused outside it, at the boundary
    // rather than as a `NaN` three passes later.
    assert_eq!(params.validate(), Ok(()));
    for (name, broken) in [
        (
            "decay",
            Params {
                decay: 0.0,
                ..params
            },
        ),
        (
            "decay",
            Params {
                decay: 1.5,
                ..params
            },
        ),
        (
            "alignmentPseudocount",
            Params {
                alignment_pseudocount: 0.0,
                ..params
            },
        ),
        (
            "priorFriend",
            Params {
                prior_friend: 1.0,
                ..params
            },
        ),
        (
            "edgeBudget",
            Params {
                edge_budget: 0,
                ..params
            },
        ),
        // A loop that may never stop on its tolerance is one that always runs to its cap, and a
        // cap of zero is a computation with no pass in it at all.
        (
            "settleTolerance",
            Params {
                settle_tolerance: 0.0,
                ..params
            },
        ),
        (
            "settleMaxPasses",
            Params {
                settle_max_passes: 0,
                ..params
            },
        ),
    ] {
        match broken.validate() {
            Err(CoreError::InvalidParameter { name: refused, .. }) => assert_eq!(refused, name),
            other => panic!("{name} out of range was accepted: {other:?}"),
        }
    }
}

/// The partial graph of DESIGN section 3.4: a node whose friend list was never read is a
/// boundary, not a leaf.
///
/// The difference matters because the loader pushes over what it has read so far. A node with no
/// onward shares and a node whose onward shares are unknown produce the same walk otherwise —
/// the mass simply stops — and the viewer is handed a result that under-reports what it missed.
#[test]
fn partial_graph_reports_its_boundary() {
    let params = Params::default();
    // A four-hop chain, with the loader having read only the first two nodes.
    let mut data = SnapshotData {
        users: vec!["u0".into(), "u1".into(), "u2".into(), "u3".into()],
        friend_ids: [
            ("u0", vec!["u1"]),
            ("u1", vec!["u0", "u2"]),
            ("u2", vec!["u1", "u3"]),
            ("u3", vec!["u2"]),
        ]
        .into_iter()
        .map(|(owner, friends)| {
            (
                owner.to_string(),
                friends.iter().map(|name| name.to_string()).collect(),
            )
        })
        .collect(),
        loaded: vec!["u0".into(), "u1".into()],
        ..SnapshotData::default()
    };
    let snapshot = data.to_snapshot();
    let viewer = snapshot.user_id("u0").expect("u0");
    let frontier = snapshot.user_id("u2").expect("u2");
    assert!(!snapshot.is_loaded(frontier));
    let partial = result_of(&snapshot, viewer, &params);
    assert_eq!(
        partial.boundary_nodes.len(),
        1,
        "the walk stopped at exactly one unread node"
    );
    assert_eq!(partial.boundary_nodes[0].user, frontier);
    assert!(
        partial.boundary_residual > params.error_budget,
        "the mass waiting on u2 is {} and worth reading",
        partial.boundary_residual
    );
    assert_close(
        partial.boundary_nodes[0].residual,
        partial.boundary_residual,
        1e-12,
        "one boundary node holds all of it",
    );
    // Reported apart, not folded in: the loader is what decides whether an unread frontier is
    // error it keeps or mass it goes and fetches (DESIGN section 3.4 step 4).
    assert_close(
        partial.truncation,
        0.0,
        1e-12,
        "the boundary residual is not counted as truncation",
    );

    // Reading the boundary node reduces it, which is the loop of DESIGN section 3.4 step 4.
    data.loaded.push("u2".into());
    let wider = data.to_snapshot();
    let second = result_of(&wider, viewer, &params);
    assert!(
        second.boundary_residual < partial.boundary_residual,
        "reading u2 left as much waiting as before: {} then {}",
        partial.boundary_residual,
        second.boundary_residual
    );
    assert_eq!(
        second.boundary_nodes[0].user,
        wider.user_id("u3").expect("u3"),
        "the frontier moved one hop out"
    );
    data.loaded.push("u3".into());
    let whole = data.to_snapshot();
    let complete = result_of(&whole, viewer, &params);
    assert!(complete.boundary_nodes.is_empty());
    assert_eq!(complete.boundary_residual, 0.0);

    // Reciprocity: an id one side lists and the other does not is not an edge. An id pointing at
    // a node nobody read is, because an unread node cannot have dropped anybody.
    let stale = SnapshotData {
        users: vec!["u0".into(), "u1".into(), "gone".into(), "unread".into()],
        friend_ids: [
            ("u0", vec!["u1", "gone", "unread"]),
            ("u1", vec!["u0"]),
            ("gone", vec![]),
        ]
        .into_iter()
        .map(|(owner, friends)| {
            (
                owner.to_string(),
                friends.iter().map(|name| name.to_string()).collect(),
            )
        })
        .collect(),
        loaded: vec!["u0".into(), "u1".into(), "gone".into()],
        ..SnapshotData::default()
    };
    let snapshot = stale.to_snapshot();
    let viewer = snapshot.user_id("u0").expect("u0");
    let dropped = snapshot.user_id("gone").expect("gone");
    let boundary = snapshot.user_id("unread").expect("unread");
    assert!(
        !snapshot.friends(viewer).contains(&dropped),
        "an id the other side has dropped is not an edge"
    );
    assert!(
        snapshot.friends(viewer).contains(&boundary),
        "an id pointing at an unread node is a boundary edge"
    );
    let walked = walk_of(
        &snapshot,
        viewer,
        &vec![1.0; snapshot.user_count()],
        &params,
    );
    assert_eq!(walked.visit_mass()[dropped.index()], 0.0);
    assert!(walked.visit_mass()[boundary.index()] > 0.0);
}
