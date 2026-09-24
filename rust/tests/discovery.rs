//! The aligned path and the display floor: how far the walk follows an aligned path, and what it refuses
//! to surface from a lone stranger.

mod common;

use common::{assert_close, detail_of, fresh_friend_weight, result_of, walk_of};
use grapevine_core::{ItemId, Params, Ratable, Rng, Snapshot, UserId, WorldConfig, simulate};

/// The walk follows aligned paths: with alignment concentrating the mass, a node four
/// hops out is reached; with the uniform priors of pass 1 the same budget stops short of it.
#[test]
fn walk_follows_aligned_paths() {
    let params = Params::default();
    let (snapshot, viewer, chain, siblings) = aligned_chain(10);
    let deep = Params {
        error_budget: 0.001,
        ..params
    };
    let mut affinity = vec![1.0; snapshot.user_count()];
    for &node in &chain[1..] {
        affinity[node.index()] = params.affinity_cap();
    }

    let steered = walk_of(&snapshot, viewer, &affinity, &deep);
    let mass = steered.visit_mass().to_vec();
    let far = chain[3];
    assert!(steered.touched().contains(&far), "i is reached");
    // Nothing backtracks and every unaligned neighbour is a dead end, so each step keeps
    // exactly (1−α)·e^L/(e^L + 10) of what arrived.
    let step = (1.0 - params.decay) * params.affinity_cap() / (params.affinity_cap() + 10.0);
    assert_close(
        mass[far.index()],
        step.powi(3),
        1e-12,
        "π̃(i) = ((1−α)·e^L/(e^L+10))³",
    );
    // The unaligned node at the same depth through the same intermediaries gets the unaligned
    // share of the same arriving mass: exactly e^L times less, the most the design steers by.
    let unaligned = mass[siblings[2][0].index()];
    assert!(
        unaligned <= 0.25 * mass[far.index()] + 1e-12,
        "an unaligned node at the same depth has {unaligned}, more than a quarter of {}",
        mass[far.index()]
    );
    assert_close(
        unaligned,
        mass[far.index()] / params.affinity_cap(),
        1e-12,
        "the steering ratio is exactly e^L",
    );

    // Pass 1, where every alignment is at its prior and the transition row is uniform: most of
    // the mass goes to the 10 dead ends at each step. f passes 0.5·(1/11) = 0.045 to g, g passes
    // 0.002 to h, and what is still in flight falls under ε_total = 0.02 before h's share is
    // worth passing on — so i is never reached.
    let flat = walk_of(
        &snapshot,
        viewer,
        &vec![1.0; snapshot.user_count()],
        &params,
    );
    assert!(
        !flat.touched().contains(&far),
        "pass 1 stops before the fourth hop"
    );
    assert!(flat.truncation() <= params.error_budget);

    // A chain of degree-2 nodes has nowhere else to send the mass: h gets exactly (1−α)².
    let mut builder = Snapshot::builder();
    let thin_viewer = builder.user("u");
    let thin: Vec<UserId> = ["f", "g", "h"]
        .iter()
        .map(|name| builder.user(name))
        .collect();
    builder.edge(thin_viewer, thin[0]);
    for window in thin.windows(2) {
        builder.edge(window[0], window[1]);
    }
    let thin_snapshot = builder.build();
    let thin_walk = walk_of(
        &thin_snapshot,
        thin_viewer,
        &vec![1.0; thin_snapshot.user_count()],
        &deep,
    );
    assert_close(
        thin_walk.visit_mass()[thin[2].index()],
        (1.0 - params.decay).powi(2),
        1e-12,
        "a degree-2 chain gives h exactly (1−α)²",
    );
}

/// A chain `u – f – g – h – i` where every node also has `leaves` neighbours that lead nowhere.
/// The leaves are created first so that the push, which breaks ties by edge, drains them before
/// it looks any deeper.
fn aligned_chain(leaves: usize) -> (Snapshot, UserId, Vec<UserId>, Vec<Vec<UserId>>) {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let dead_ends: Vec<Vec<UserId>> = (0..4)
        .map(|step| {
            (0..leaves)
                .map(|index| builder.user(&format!("dead{step}_{index}")))
                .collect()
        })
        .collect();
    let chain: Vec<UserId> = ["f", "g", "h", "i"]
        .iter()
        .map(|name| builder.user(name))
        .collect();
    builder.edge(viewer, chain[0]);
    for window in chain.windows(2) {
        builder.edge(window[0], window[1]);
    }
    for (step, &node) in chain.iter().enumerate() {
        for &leaf in &dead_ends[step] {
            builder.edge(node, leaf);
        }
    }
    (builder.build(), viewer, chain, dead_ends)
}

/// The display floor: in a world with no shared taste, a lone stranger's coincidental
/// agreement never carries an item over it. The rule is `W ≥ W_min` and nothing else, so the two
/// controls are what say the floor sits in the right place — one fresh direct friend is enough,
/// and one maximally aligned person two hops out behind a friend with ten other friends is not.
#[test]
fn nothing_surfaces_on_one_stranger() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 20,
            items: 260,
            rated_fraction: 0.77,
            cluster_proportions: vec![1.0],
            cluster_spread: 4.0,
            noise: 0.6,
            p_same_cluster: 0.35,
            p_other_cluster: 0.35,
            ..WorldConfig::default()
        },
        &mut Rng::new(64),
    );
    let mut surfaced = 0;
    let mut from_one_stranger = 0;
    for viewer in world.users() {
        let detail = detail_of(&world.snapshot, viewer, &params);
        let result = detail.result(&params);
        let friends = world.snapshot.friends(viewer);
        for (&ratable, score) in &result.scores {
            assert!(
                score.confidence >= params.min_weight,
                "a result below W_min was returned"
            );
            surfaced += 1;
            let raters: Vec<UserId> = world
                .users()
                .filter(|&rater| {
                    rater != viewer
                        && detail.mass(rater) > 0.0
                        && world.snapshot.rating(rater, ratable).is_some()
                })
                .collect();
            if raters.len() == 1 && !friends.contains(&raters[0]) {
                from_one_stranger += 1;
            }
        }
    }
    assert!(
        surfaced > 200,
        "the world surfaced enough to measure: {surfaced}"
    );
    assert_eq!(
        from_one_stranger, 0,
        "{from_one_stranger} of {surfaced} surfaced ratables rest on a single non-friend"
    );

    // Positive control: one fresh direct friend, π̃ = 1 and ℓ = logit(0.65), is above the floor.
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let friend = builder.user("f");
    let pick = Ratable::Item(builder.item("pick"));
    builder.edge(viewer, friend);
    builder.rate(friend, pick, 1);
    let lone_friend = builder.build();
    let shown = result_of(&lone_friend, viewer, &params);
    assert!(
        shown.scores.contains_key(&pick),
        "one fresh direct friend has to be enough to surface something"
    );
    assert_close(
        shown.scores[&pick].confidence,
        fresh_friend_weight(&params),
        1e-12,
        "W is one friend-unit at the friend prior",
    );

    // Negative control: one maximally aligned person two hops out, behind a friend with ten
    // other friends. DESIGN section 2.9 prices that at (1−α)·e^L/(e^L + 10)·L = 0.425, below
    // W_min however perfectly they mimic — and the ten others sit at the hop-2 prior rather
    // than at affinity 1, which only makes the mimic's share of the friend's onward mass
    // smaller.
    let (two_hop, two_hop_viewer, stranger, stranger_pick) = one_aligned_stranger(10);
    let detail = detail_of(&two_hop, two_hop_viewer, &params);
    let ceiling = (1.0 - params.decay) * params.affinity_cap() / (params.affinity_cap() + 10.0)
        * params.alignment_clamp;
    let carried = detail.mass(stranger) * detail.alignment_weight(stranger).abs();
    println!(
        "the hop-2 mimic's own pick carries W = {carried:.4} against a ceiling of {ceiling:.4}"
    );
    assert!(
        carried <= ceiling + 1e-9,
        "the hop-2 person's pick carries W = {carried}, above the section 2.9 ceiling {ceiling}"
    );
    assert!(
        carried < params.min_weight,
        "a lone hop-2 person clears W_min on reach alone: {carried}"
    );
    assert!(
        ceiling < params.min_weight,
        "the section 2.9 ceiling {ceiling} is not below W_min {}",
        params.min_weight
    );
    assert!(
        !detail.result(&params).scores.contains_key(&stranger_pick),
        "the hop-2 mimic's own pick displayed"
    );
}

/// A viewer, one friend with `others` friends who have rated nothing, and one friend of that
/// friend who agrees with the viewer on everything — the shape DESIGN section 2.9 prices. The
/// returned ratable is an item only that person has rated.
fn one_aligned_stranger(others: usize) -> (Snapshot, UserId, UserId, Ratable) {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let friend = builder.user("f");
    let stranger = builder.user("g");
    builder.edge(viewer, friend);
    builder.edge(friend, stranger);
    for index in 0..others {
        let other = builder.user(&format!("f-other{index}"));
        builder.edge(friend, other);
    }
    // A dissenting friend, so the shared catalog is contested inside the viewer's reach and the
    // mimic's agreement is worth the alignment clamp.
    let dissenter = builder.user("dissenter");
    builder.edge(viewer, dissenter);
    let contested: Vec<ItemId> = (0..60)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    for (index, &item) in contested.iter().enumerate() {
        let mine: i8 = if index % 2 == 0 { 1 } else { -1 };
        builder.rate(viewer, Ratable::Item(item), mine);
        builder.rate(stranger, Ratable::Item(item), mine);
        builder.rate(dissenter, Ratable::Item(item), -mine);
    }
    let pick = Ratable::Item(builder.item("their-own-pick"));
    builder.rate(stranger, pick, 1);
    (builder.build(), viewer, stranger, pick)
}
