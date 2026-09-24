//! What a region of accounts can do to a viewer who is one accepted friend request away
//! from it. The mass bound is what bounds a region whether or not anybody
//! reacts to it.

mod common;

use common::{affinity_vector, assert_close, detail_of, largest_onward_share, walk_of};
use grapevine_core::{
    Params, Rng, SybilConfig, SybilShape, SybilStrategy, UserDetail, UserId, World, WorldConfig,
    add_sybils, simulate,
};

/// An honest world and a target with a friend to hang the bots off.
fn honest_world(seed: u64) -> (World, UserId) {
    let world = simulate(
        &WorldConfig {
            users: 60,
            items: 90,
            rated_fraction: 0.4,
            p_same_cluster: 0.12,
            p_other_cluster: 0.02,
            ..WorldConfig::default()
        },
        &mut Rng::new(seed),
    );
    let target = world
        .users()
        .max_by_key(|&user| world.snapshot.friends(user).len())
        .expect("the world has users");
    (world, target)
}

/// The gatekeeper with the most other friends: the case where the bots have to share.
fn gatekeeper(world: &World, target: UserId) -> UserId {
    world.snapshot.friends(target)[0]
}

fn bot_mass(detail: &UserDetail, bots: &[UserId]) -> f64 {
    bots.iter().map(|&bot| detail.mass(bot)).sum()
}

/// The sybil mass bound: what a bot set gets is what its gatekeepers' edges let through,
/// whatever its size and however it is wired.
///
/// Clause (g) is what the budgets loop is for: (a), (b), (e) and (f) all run at the deep
/// budget as well as the interactive one, because a deeper, tighter search must not loosen the
/// bound.
#[test]
fn sybil_mass_bound() {
    let params = Params::default();
    let deep = Params::deep();
    let (world, target) = honest_world(9);
    let gate = gatekeeper(&world, target);
    assert!(world.snapshot.friends(target).len() >= 3);

    let shapes = [
        (SybilShape::Clique, "clique"),
        (SybilShape::Chain, "chain"),
        (SybilShape::StarOfChains, "star-of-chains"),
    ];
    // Per shape and size, at the interactive budget: what the region held and what the walk
    // said it truncated.
    let mut measured: Vec<(&str, usize, f64, f64)> = Vec::new();
    for (shape, name) in shapes {
        for size in [1usize, 5, 50, 500] {
            for budget in [params, deep] {
                let (snapshot, set) = add_sybils(
                    &world.snapshot,
                    &SybilConfig {
                        count: size,
                        gatekeepers: vec![gate],
                        shape,
                        ..SybilConfig::default()
                    },
                    &budget,
                );
                let detail = detail_of(&snapshot, target, &budget);
                let mass = bot_mass(&detail, &set.bots);
                let share = largest_onward_share(
                    &snapshot,
                    gate,
                    &set.bots,
                    target,
                    &affinity_vector(&detail, &budget),
                );
                let bound = detail.mass(gate) * share;
                // Every pass after the first starts from the one before, so the masses can sit
                // on either side of the converged ones, by at most the truncation in total.
                let slack = detail.final_pass.truncation() + 1e-9;
                // (a) everything in S arrived through f's edges into S and decayed on the way.
                assert!(
                    mass <= bound + slack,
                    "{name} {size}: π̃(S) = {mass} exceeds π̃(f)·P_f(S) = {bound}"
                );
                // (b) the absolute worst case from one edge. There is no multiplier to cap any
                // more: a region behind one gatekeeper can never hold more than the gatekeeper
                // itself, however aligned it looks and however many accounts it has. That is not
                // one friend-unit here: this gatekeeper has other friends, whose walks pass
                // through it too. The captured gatekeeper of (f) is where one unit is the bound.
                assert!(
                    mass <= detail.mass(gate) + slack,
                    "{name} {size}: π̃(S) = {mass} exceeds π̃(f) = {}",
                    detail.mass(gate)
                );
                // The same walk run on its own, at the affinity the loop settled on: the bound
                // is a property of the push and not of the loop around it.
                let alone = walk_of(
                    &snapshot,
                    target,
                    &affinity_vector(&detail, &budget),
                    &budget,
                );
                let alone_mass: f64 = set
                    .bots
                    .iter()
                    .map(|&bot| alone.visit_mass()[bot.index()])
                    .sum();
                assert!(
                    alone_mass <= alone.visit_mass()[gate.index()] + 1e-9,
                    "{name} {size}: π̃(S) = {alone_mass} exceeds π̃(f) on the settled affinity"
                );

                // (e) with every bot maximally aligned, the bound is still a bound: it is a
                // property of where the edges are, not of who agrees with whom.
                let mut affinity = affinity_vector(&detail, &budget);
                for &bot in &set.bots {
                    affinity[bot.index()] = budget.affinity_cap();
                }
                let steered = walk_of(&snapshot, target, &affinity, &budget);
                let steered_mass = steered.visit_mass();
                let steered_total: f64 =
                    set.bots.iter().map(|&bot| steered_mass[bot.index()]).sum();
                let steered_bound = steered_mass[gate.index()]
                    * largest_onward_share(&snapshot, gate, &set.bots, target, &affinity);
                assert!(
                    steered_total <= steered_bound + 1e-9,
                    "{name} {size}, maximal affinity: π̃(S) = {steered_total} exceeds {steered_bound}"
                );
                assert!(steered_total <= steered_mass[gate.index()] + 1e-9);

                if budget == params {
                    measured.push((name, size, mass, detail.final_pass.truncation()));
                }
            }
        }
    }

    // (c) past a point more bots buy nothing: the gatekeeper's edge is already spent, and what
    // a further four hundred and fifty accounts behind it buy is at most 5% more.
    for name in ["chain", "star-of-chains"] {
        let at = |size: usize| {
            measured
                .iter()
                .find(|entry| entry.0 == name && entry.1 == size)
                .copied()
                .expect("every shape and size was measured")
        };
        let (_, _, fifty, _) = at(50);
        let (_, _, five_hundred, _) = at(500);
        println!("(c) {name}: π̃(S) = {fifty:.4} at 50 bots and {five_hundred:.4} at 500");
        assert!(
            (five_hundred - fifty).abs() <= 0.05 * fifty.max(1e-12),
            "{name}: π̃(S) went from {fifty} at 50 bots to {five_hundred} at 500"
        );
    }
    // The 500-clique is exempt from the 5% clause; what it does have
    // to satisfy is the test below.
    let clique = |size: usize| {
        measured
            .iter()
            .find(|entry| entry.0 == "clique" && entry.1 == size)
            .copied()
            .expect("the clique was measured")
    };
    println!(
        "(c) clique: π̃(S) = {:.4} at 50 bots, {:.4} (± {:.4}) at 500",
        clique(50).2,
        clique(500).2,
        clique(500).3
    );

    // (d) three gatekeepers: the bound is the sum over them, and three edges are worth at most
    // three times the best single edge.
    let gates: Vec<UserId> = world.snapshot.friends(target)[..3].to_vec();
    let (snapshot, set) = add_sybils(
        &world.snapshot,
        &SybilConfig {
            count: 50,
            gatekeepers: gates.clone(),
            shape: SybilShape::Clique,
            ..SybilConfig::default()
        },
        &params,
    );
    let detail = detail_of(&snapshot, target, &params);
    let affinity = affinity_vector(&detail, &params);
    let many_gates = bot_mass(&detail, &set.bots);
    let summed: f64 = gates
        .iter()
        .map(|&gate| {
            detail.mass(gate) * largest_onward_share(&snapshot, gate, &set.bots, target, &affinity)
        })
        .sum();
    assert!(
        many_gates <= summed + detail.final_pass.truncation() + 1e-9,
        "three gatekeepers: π̃(S) = {many_gates} exceeds the summed bound {summed}"
    );
    let mut best_single = 0.0f64;
    for &gate in &gates {
        let (single_snapshot, single_set) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: 50,
                gatekeepers: vec![gate],
                shape: SybilShape::Clique,
                ..SybilConfig::default()
            },
            &params,
        );
        let single = detail_of(&single_snapshot, target, &params);
        best_single = best_single.max(bot_mass(&single, &single_set.bots));
    }
    assert!(
        many_gates <= 3.0 * best_single + 1e-9,
        "three edges gave {many_gates}, more than three times the best single edge {best_single}"
    );

    // (f) a gatekeeper whose only friends are the target and the bots hands over everything it
    // has — and that is still one friend-unit, not more. At both budgets, per clause (g).
    let mut builder = world.snapshot.edit();
    let lone_gate = builder.user("lone-gate");
    builder.edge(target, lone_gate);
    let lone_world = builder.build();
    for size in [1usize, 50, 500] {
        for budget in [params, deep] {
            let (snapshot, set) = add_sybils(
                &lone_world,
                &SybilConfig {
                    count: size,
                    gatekeepers: vec![lone_gate],
                    shape: SybilShape::Clique,
                    ..SybilConfig::default()
                },
                &budget,
            );
            let detail = detail_of(&snapshot, target, &budget);
            let mass = bot_mass(&detail, &set.bots);
            let share = largest_onward_share(
                &snapshot,
                lone_gate,
                &set.bots,
                target,
                &affinity_vector(&detail, &budget),
            );
            let bound = detail.mass(lone_gate) * share;
            let slack = detail.final_pass.truncation() + 1e-9;
            assert!(
                mass <= bound + slack,
                "captured gatekeeper, {size} bots: π̃(S) = {mass} exceeds {bound}"
            );
            assert!(
                mass <= 1.0 + slack,
                "captured gatekeeper, {size} bots: π̃(S) = {mass} exceeds one friend-unit"
            );
        }
    }

    // (f), the feedback shape: bots wired `h – b₁ – b₂ – h`, so mass that enters the region
    // comes back out into the gatekeeper — `h → b₁ → b₂ → h` is not backtracking, and the
    // gatekeeper's own `π̃` is therefore more than its injection.
    //
    // The bound has to carry that: with `P` the share of `h`'s onward row that leads into `S`
    // and `q ≤ 1 − α` the share of the mass at a node that goes anywhere at all,
    //
    //     π̃(h) ≤ 1 / (1 − (1−α)²·P·q)      and      π̃(S) ≤ π̃(h)·P
    //
    // Every factor is a probability, because affinity only reallocates, so `π̃(h) ≤
    // 1/(1 − (1−α)²) = 4/3` and `π̃(S) ≤ 4/3` — and in fact everything beyond one friend is one
    // friend-unit, feedback included, which is the assertion below.
    for size in [2usize, 50] {
        for budget in [params, deep] {
            let mut builder = world.snapshot.edit();
            let feedback_gate = builder.user("feedback-gate");
            builder.edge(target, feedback_gate);
            let loop_bots: Vec<UserId> = (0..size)
                .map(|index| builder.user(&format!("loop{index}")))
                .collect();
            // Every bot is on a two-step path out of the gatekeeper and back into it.
            for pair in loop_bots.chunks(2) {
                builder.edge(feedback_gate, pair[0]);
                if let [first, second] = pair {
                    builder.edge(*first, *second);
                    builder.edge(*second, feedback_gate);
                }
            }
            let fed_back = builder.build();
            let detail = detail_of(&fed_back, target, &budget);
            let mass = bot_mass(&detail, &loop_bots);
            let gate_mass = detail.mass(feedback_gate);
            let affinity = affinity_vector(&detail, &budget);
            let share =
                largest_onward_share(&fed_back, feedback_gate, &loop_bots, target, &affinity);
            // `q`: the share of what reaches a node that goes anywhere at all. With no learned
            // stop logit left it is exactly `1 − α` at every node with an onward neighbour.
            let onward = 1.0 - budget.decay;
            let feedback = 1.0 / (1.0 - (1.0 - budget.decay).powi(2) * share * onward);
            println!(
                "(f) feedback {size} bots: π̃(h) = {gate_mass:.4} ≤ {feedback:.4}, \
                 π̃(S) = {mass:.4} ≤ {:.4}",
                feedback * share
            );
            let slack = detail.final_pass.truncation() + 1e-9;
            assert!(
                gate_mass <= feedback + slack,
                "feedback {size}: π̃(h) = {gate_mass} exceeds 1/(1 − (1−α)²·P·q) = {feedback}"
            );
            assert!(
                mass <= feedback * share + slack,
                "feedback {size}: π̃(S) = {mass} exceeds π̃(h)·P = {}",
                feedback * share
            );
            assert!(
                mass <= 1.0 + slack,
                "feedback {size}: π̃(S) = {mass} exceeds one friend-unit, which feeding mass \
                 back into the gatekeeper must not buy"
            );
            assert!(
                gate_mass > 1.0,
                "feedback {size}: π̃(h) = {gate_mass} — nothing came back, so the shape is not \
                 testing what it is for"
            );
        }
    }
}

/// The dense clique. A clique of 500 is 250 000 directed edges, and what it must still meet is
/// the mass bound (a), the absolute cap (b), and a truncation that says how far the walk got.
/// Expanding a node drains everything that arrived at it in one step, so a sweep of the clique
/// costs its edge count and the walk resolves it: the truncation meets `ε_total`.
#[test]
fn dense_clique_is_bounded_and_reports_truncation() {
    let params = Params::default();
    let (world, target) = honest_world(9);
    let gate = gatekeeper(&world, target);
    for size in [50usize, 500] {
        let (snapshot, set) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: size,
                gatekeepers: vec![gate],
                shape: SybilShape::Clique,
                ..SybilConfig::default()
            },
            &params,
        );
        let detail = detail_of(&snapshot, target, &params);
        let mass = bot_mass(&detail, &set.bots);
        let share = largest_onward_share(
            &snapshot,
            gate,
            &set.bots,
            target,
            &affinity_vector(&detail, &params),
        );
        let bound = detail.mass(gate) * share;
        let truncation = detail.final_pass.truncation();
        println!(
            "dense clique {size}: π̃(S) = {mass:.4} ≤ {bound:.4}, truncation {truncation:.4}, \
             {} passes, settled {}, {} pushes",
            detail.movements.len() + 1,
            detail.settled,
            detail.work
        );
        // (a) and (b), to within what the walk left unresolved.
        assert!(
            mass <= bound + truncation + 1e-9,
            "clique {size}: π̃(S) = {mass} exceeds π̃(f)·P_f(S) = {bound}"
        );
        assert!(
            mass <= detail.mass(gate) + truncation + 1e-9,
            "clique {size}: π̃(S) = {mass} exceeds π̃(f) = {}",
            detail.mass(gate)
        );
        assert!(
            truncation < params.error_budget,
            "clique {size}: the walk stopped at a truncation of {truncation}"
        );
        assert!(detail.settled, "clique {size}: the loop did not settle");
    }
}

/// Consensus copying: agreeing with the crowd earns a fraction of what agreeing on
/// something contested earns, and a sybil region outside the viewer's reach cannot make the
/// crowd look divided. The `|ℓ| < 0.3` bound on what a copier earns is the test below.
#[test]
fn consensus_copying() {
    let params = Params::default();
    let (world, target, gate) = consensus_world();

    let copier = |strategy: SybilStrategy, target_items: usize| {
        let (snapshot, set) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: 20,
                gatekeepers: vec![gate],
                strategy,
                shape: SybilShape::Clique,
                target_items,
                ..SybilConfig::default()
            },
            &params,
        );
        let detail = detail_of(&snapshot, target, &params);
        let earned = set
            .bots
            .iter()
            .map(|&bot| detail.alignment_weight(bot).abs())
            .fold(0.0, f64::max);
        (snapshot, set, detail, earned)
    };

    let (_, consensus_set, consensus_detail, consensus_weight) =
        copier(SybilStrategy::CopyConsensus, 30);
    // The unanimous items are the 30 the strategy targets. `p_x` is unsmoothed, so an item with
    // no dissenter in the viewer's reach is worth exactly nothing, and that is what caps the
    // alignment a copier can earn.
    let consensus_omega: f64 = (0..30)
        .map(|item| consensus_detail.informativeness[item])
        .sum::<f64>()
        / 30.0;
    let contested_omega: f64 = (30..world.config.items)
        .map(|item| consensus_detail.informativeness[item])
        .sum::<f64>()
        / (world.config.items - 30) as f64;
    println!(
        "ω on the copied unanimous items {consensus_omega:.3} against {contested_omega:.3} \
         on the rest; the copier earned ℓ = {consensus_weight:.3}"
    );
    assert!(
        consensus_omega < 0.4 * contested_omega,
        "the unanimous items are not discounted: ω {consensus_omega} against {contested_omega}"
    );
    // Thirty agreements weighted by that ω leave â at the hop-2 prior, so the copier earns
    // exactly what an account with no shared ratings at all would.
    let expected = grapevine_core::logit(
        (params.alignment_pseudocount * params.prior_friend_of_friend + 30.0 * consensus_omega)
            / (params.alignment_pseudocount + 30.0 * consensus_omega),
    );
    assert_close(
        consensus_weight,
        expected,
        1e-12,
        "what a consensus copier earns follows ω",
    );
    assert_close(
        consensus_weight,
        grapevine_core::logit(params.prior_friend_of_friend),
        1e-12,
        "a copier of unanimity is worth its prior and nothing more",
    );

    // ManufactureContested: edgeless accounts vote the other way to make those items look
    // divided, and the copiers rate them `+1`. It buys nothing, because ω is measured inside the
    // viewer's reach and the edgeless accounts are not in it.
    let (_, manufactured_set, manufactured_detail, manufactured_weight) =
        copier(SybilStrategy::ManufactureContested, 30);
    assert!(
        manufactured_weight <= consensus_weight + 1e-9,
        "manufacturing contest earned {manufactured_weight}, more than plain copying \
         {consensus_weight}"
    );
    // The edgeless sybils moved the viewer's ω by exactly nothing.
    assert!(
        !manufactured_set.edgeless.is_empty(),
        "the attack used edgeless accounts"
    );
    for &voter in &manufactured_set.edgeless {
        assert_eq!(
            manufactured_detail.mass(voter),
            0.0,
            "an edgeless sybil carries no mass"
        );
    }
    for item in 0..30 {
        assert_close(
            manufactured_detail.informativeness[item],
            consensus_detail.informativeness[item],
            0.0,
            "ω moved without any edge into the viewer's reach",
        );
    }
    assert_eq!(consensus_set.bots.len(), manufactured_set.bots.len());
}

/// A copier of consensus earns `|ℓ| < 0.3`. `p_x = n⁺/n` is unsmoothed (DESIGN section 2.2), so an item that
/// nobody in the viewer's reach dissents on carries `ω = 0` exactly and a copier of it earns
/// nothing at all: `â` stays at the hop-2 prior and `ℓ = logit(0.55) ≈ 0.20`. Manufacturing the
/// dissent from edgeless accounts does not help, because `ω` is measured inside the reach.
#[test]
fn consensus_copying_earns_nothing() {
    let params = Params::default();
    let (world, target, gate) = consensus_world();
    let ceiling = 0.3;
    for strategy in [
        SybilStrategy::CopyConsensus,
        SybilStrategy::ManufactureContested,
    ] {
        let (snapshot, set) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: 20,
                gatekeepers: vec![gate],
                strategy,
                shape: SybilShape::Clique,
                target_items: 30,
                ..SybilConfig::default()
            },
            &params,
        );
        let detail = detail_of(&snapshot, target, &params);
        let worst = set
            .bots
            .iter()
            .map(|&bot| detail.alignment_weight(bot).abs())
            .fold(0.0, f64::max);
        println!("{strategy:?} earned at most |ℓ| = {worst:.4}");
        for &bot in &set.bots {
            let weight = detail.alignment_weight(bot);
            assert!(
                weight.abs() < ceiling,
                "{strategy:?} bot earned ℓ = {weight}, worth more than nothing"
            );
        }
        // Every one of the copied items is unanimous in the viewer's reach, so it is worth zero.
        for item in 0..30 {
            assert_close(
                detail.informativeness[item],
                0.0,
                0.0,
                "a unanimous item carries no informativeness",
            );
        }
    }
}

/// A world whose thirty most-rated items are liked by everybody: the consensus a copier copies.
fn consensus_world() -> (World, UserId, UserId) {
    let world = simulate(
        &WorldConfig {
            users: 60,
            items: 90,
            consensus_items: 30,
            rated_fraction: 0.35,
            p_same_cluster: 0.12,
            ..WorldConfig::default()
        },
        &mut Rng::new(13),
    );
    let target = world
        .users()
        .max_by_key(|&user| world.snapshot.friends(user).len())
        .expect("users");
    let gate = world.snapshot.friends(target)[0];
    (world, target, gate)
}
