//! The settling loop — that it settles, what it says when it does not, the budget it is allowed to spend, and the cheap update that
//! reuses what it produced.

mod common;

use common::{assert_finite, detail_of, result_of};
use grapevine_core::{
    Budget, CoreError, Params, Ratable, Rng, Snapshot, SybilConfig, SybilShape, SybilStrategy,
    UserId, WalkReport, WorldConfig, add_sybils, compute_user, rescore_user, simulate,
};

/// It settles: over random worlds and under the copying attack, the largest score
/// movement in a pass falls below `SETTLE_TOLERANCE` inside `SETTLE_MAX_PASSES`, the movements
/// shrink from pass to pass, and the movement the result carries is the one the last pass
/// measured.
///
/// The swarm is wired as a chain here and as a clique in the test below, where the budget is
/// squeezed until the loop cannot finish.
#[test]
fn the_loop_settles_and_reports_the_movement_it_stopped_at() {
    let params = Params::default();
    let mut worlds = Vec::new();
    for seed in [3u64, 17, 41, 59] {
        let world = simulate(
            &WorldConfig {
                users: 60,
                items: 80,
                rated_fraction: 0.45,
                p_same_cluster: 0.12,
                p_other_cluster: 0.03,
                ..WorldConfig::default()
            },
            &mut Rng::new(seed),
        );
        worlds.push((format!("random world {seed}"), world.snapshot));
    }
    worlds.push((
        "the copying attack".to_string(),
        copying_attack(SybilShape::Chain).0,
    ));

    let mut worst_passes = 0;
    let mut wobbles = 0;
    for (label, snapshot) in &worlds {
        for viewer in snapshot.users() {
            let detail = detail_of(snapshot, viewer, &params);
            assert_finite(detail.movements.iter().copied(), label);
            assert!(
                detail.settled,
                "{label}: viewer {} ran out of passes at a movement of {:?}",
                viewer.0, detail.movements
            );
            let stopped_at = *detail
                .movements
                .last()
                .expect("a settled loop measured at least one pass");
            assert!(
                stopped_at < params.settle_tolerance,
                "{label}: the loop claims to have settled at a movement of {stopped_at}"
            );
            let result = detail.result(&params);
            assert_eq!(
                result.settle_movement, stopped_at,
                "{label}: the result carries a movement no pass measured"
            );
            assert_eq!(result.passes, detail.movements.len() + 1);
            // The composition contracts, so the movements shrink. The first pass after the
            // graph-only one is exempt: it is the whole distance from uniform alignments to
            // measured ones, which is a starting point rather than a step. Each pass is a walk
            // started from the one before and stopped at its own truncation, so a pass can land
            // a rounding of that size further off than the one before it — a single step can
            // wobble, two cannot.
            for window in detail.movements[1..].windows(3) {
                assert!(
                    window[2] < window[0],
                    "{label}: the movements did not shrink over two passes, {:?}",
                    detail.movements
                );
            }
            wobbles += detail.movements[1..]
                .windows(2)
                .filter(|window| window[1] > window[0])
                .count();
            worst_passes = worst_passes.max(detail.movements.len());
        }
    }
    println!(
        "the slowest viewer settled in {worst_passes} passes; {wobbles} single-pass \
         wobbles"
    );
    assert!(
        worst_passes < params.settle_max_passes,
        "some viewer needed every pass there is, so the cap is what stopped it"
    );
}

/// A loop the budget stops says so instead of claiming to have settled, and what it hands over
/// is the last pass it **finished** — never a walk the budget cut short, which would have less
/// reach than the pass before it and masses nobody should rank by.
///
/// The budget is squeezed from a tenth of what an unconstrained loop spends up to all of it, on
/// the copying attack wired as a clique, for every viewer.
#[test]
fn a_loop_the_budget_stops_keeps_its_last_complete_pass_and_says_so() {
    let params = Params::default();
    let (attacked, target) = copying_attack(SybilShape::Clique);
    let (mut first_only, mut starved_first, mut settled) = (0, 0, 0);
    for viewer in attacked.users() {
        let unconstrained = detail_of(&attacked, viewer, &params);
        let first_cost = unconstrained.first_pass.edge_pushes();
        for tenths in 1..=10 {
            let squeezed = Params {
                edge_budget: (unconstrained.work * tenths / 10).max(1),
                ..params
            };
            let detail = detail_of(&attacked, viewer, &squeezed);
            let result = detail.result(&squeezed);
            assert_finite(
                [
                    result.settle_movement,
                    result.truncation,
                    result.error(&squeezed),
                ],
                "a starved computation",
            );
            if detail.movements.is_empty() {
                // Nothing after the first pass could be paid for, so that pass is the answer and
                // the movement is its distance from nothing at all, not a zero nobody measured.
                assert!(!result.settled);
                assert_eq!(result.passes, 1);
                assert!(result.scores.is_empty() || result.settle_movement > 0.0);
                if detail.first_pass.stopped_early() {
                    starved_first += 1;
                    assert!(squeezed.edge_budget < first_cost + attacked.user_count());
                } else {
                    first_only += 1;
                }
                continue;
            }
            // A later pass is kept only whole.
            assert!(
                !detail.final_pass.stopped_early(),
                "viewer {} at {tenths}/10 kept a pass the budget cut short: truncation {}",
                viewer.0,
                detail.final_pass.truncation()
            );
            assert!(detail.final_pass.truncation() < squeezed.error_budget);
            assert!(
                detail.final_pass.nodes_touched() * 2 >= detail.first_pass.nodes_touched(),
                "viewer {} at {tenths}/10 lost its reach: {} then {}",
                viewer.0,
                detail.first_pass.nodes_touched(),
                detail.final_pass.nodes_touched()
            );
            assert_eq!(
                result.settle_movement,
                *detail.movements.last().expect("a pass")
            );
            if result.settled {
                settled += 1;
                assert!(result.settle_movement < squeezed.settle_tolerance);
            }
        }
    }
    println!(
        "squeezed budgets: {starved_first} first passes starved, {first_only} stopped after the \
         first pass, {settled} settled"
    );
    assert!(starved_first > 0 && first_only > 0 && settled > 0);
    assert!(
        !result_of(&attacked, target, &params).scores.is_empty(),
        "the target got no feed at all"
    );
}

/// Fifty accounts that rate by the viewer's own feed, behind one of the target's friends: the
/// input designed to make alignment chase flow and flow chase alignment.
fn copying_attack(shape: SybilShape) -> (Snapshot, UserId) {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 60,
            items: 90,
            rated_fraction: 0.4,
            p_same_cluster: 0.12,
            p_other_cluster: 0.02,
            ..WorldConfig::default()
        },
        &mut Rng::new(9),
    );
    let target = world
        .users()
        .max_by_key(|&user| world.snapshot.friends(user).len())
        .expect("the world has users");
    let gate = world.snapshot.friends(target)[0];
    let (attacked, _) = add_sybils(
        &world.snapshot,
        &SybilConfig {
            count: 50,
            gatekeepers: vec![gate],
            strategy: SybilStrategy::MimicFeed,
            shape,
            ..SybilConfig::default()
        },
        &params,
    );
    (attacked, target)
}

/// The other half of settling: reaching the cap is **not** an error. The loop says where it stopped and
/// hands the caller a result to weigh.
#[test]
fn reaching_the_pass_cap_is_reported_and_not_an_error() {
    // A tolerance no finite loop can meet, so the only thing that can stop this is the cap.
    let params = Params {
        settle_tolerance: 1e-18,
        settle_max_passes: 4,
        ..Params::default()
    };
    let world = simulate(
        &WorldConfig {
            users: 50,
            items: 80,
            rated_fraction: 0.45,
            p_same_cluster: 0.12,
            p_other_cluster: 0.03,
            ..WorldConfig::default()
        },
        &mut Rng::new(23),
    );
    let viewer = UserId(0);
    let detail = detail_of(&world.snapshot, viewer, &params);
    assert!(!detail.settled, "the loop claims to have met 1e-18");
    assert_eq!(detail.movements.len(), params.settle_max_passes);
    let result = compute_user(&world.snapshot, viewer, &params)
        .expect("a loop that hit its cap is still a result");
    assert!(!result.settled);
    assert_eq!(result.passes, params.settle_max_passes + 1);
    assert!(result.settle_movement > 0.0 && result.settle_movement.is_finite());
    assert!(!result.scores.is_empty(), "a capped loop still scores");
}

/// The bar's step is the larger of the two errors, in the one unit both can be read in.
///
/// A friend-unit of unresolved mass moves a score by at most `L`, which is what converts the
/// truncation; the settling distance is already a distance between two scores. Which of them is
/// larger is the whole reason the column is not called `truncation`.
#[test]
fn the_error_is_the_larger_of_the_two() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 80,
            items: 100,
            rated_fraction: 0.45,
            p_same_cluster: 0.12,
            p_other_cluster: 0.03,
            ..WorldConfig::default()
        },
        &mut Rng::new(31),
    );
    let mut settling_dominated = 0;
    for viewer in world.users() {
        let result = result_of(&world.snapshot, viewer, &params);
        let error = result.error(&params);
        assert!(error.is_finite() && error >= 0.0, "ε = {error}");
        assert!(error >= result.settle_movement);
        assert!(error >= result.truncation * params.alignment_clamp);
        assert_eq!(
            error,
            (result.truncation * params.alignment_clamp).max(result.settle_movement)
        );
        if result.settle_movement > result.truncation * params.alignment_clamp {
            settling_dominated += 1;
        }
    }
    println!(
        "the settling distance was the larger error for {settling_dominated} of {} viewers",
        world.snapshot.user_count()
    );

    // A viewer whose whole reach is one leaf friend has nothing left in flight and nothing left
    // to move, so the bar is handed a step of exactly zero — the case the screen has to draw as
    // "nothing known yet" rather than picking a default.
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let friend = builder.user("f");
    let pick = Ratable::Item(builder.item("pick"));
    builder.edge(viewer, friend);
    builder.rate(friend, pick, 1);
    let lone = builder.build();
    let result = result_of(&lone, viewer, &params);
    assert_eq!(result.truncation, 0.0);
    assert_eq!(result.settle_movement, 0.0);
    assert_eq!(result.error(&params), 0.0);
}

/// The budget is what a whole loop over the loaded neighbourhood can cost, capped by `E_max`
/// (DESIGN section 2.8): for the graph-only pass and each of `SETTLE_MAX_PASSES` more, one deposit
/// at each friend and, counting the warm start, one sweep more than a cold walk needs to shrink
/// `F` friend-units below `ε_total`, a sweep being one push along every directed edge of the
/// loaded nodes.
#[test]
fn the_budget_is_read_off_the_graph() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 80,
            items: 60,
            rated_fraction: 0.4,
            p_same_cluster: 0.12,
            p_other_cluster: 0.03,
            ..WorldConfig::default()
        },
        &mut Rng::new(37),
    );
    let snapshot = &world.snapshot;
    let sweep: usize = snapshot
        .users()
        .map(|user| snapshot.friends(user).len())
        .sum();
    for viewer in world.users() {
        let budget = Budget::for_snapshot(snapshot, viewer, &params);
        let friends = snapshot.friends(viewer).len().max(1);
        let sweeps = ((friends as f64 * params.residual_reach() / params.error_budget).ln()
            / (1.0 / (1.0 - params.decay)).ln())
        .ceil()
        .max(1.0) as usize;
        let expected = ((params.settle_max_passes + 1) * (friends + (sweeps + 1) * sweep))
            .min(params.edge_budget);
        assert_eq!(
            budget.remaining(),
            expected,
            "the budget for viewer {} is not the reservation the neighbourhood implies",
            viewer.0
        );
        assert_eq!(budget.spent(), 0);
        let detail = detail_of(snapshot, viewer, &params);
        assert!(
            detail.work <= expected / 4,
            "viewer {} spent {} of a reservation of {expected}",
            viewer.0,
            detail.work
        );
    }
}

/// On the product path — the snapshot as the Edge Function hands it over, through
/// `SnapshotData::to_snapshot` — every viewer of a realistic neighbourhood gets a feed whose
/// truncation meets `ε_total`, with nothing unloaded. Trimming the neighbourhood to fit a flat
/// `E_max` instead would unload most of it: on these worlds, 72 to 104 nodes kept and a boundary
/// residual of 0.5 to 4.8 against an `ε_total` of 0.02, which is no feed at all for anyone with a
/// hundred people within reach.
#[test]
fn every_viewer_of_a_realistic_neighbourhood_meets_the_error_budget() {
    let params = Params::default();
    let worlds = [
        (120, 0.18, 0.02, 3u64),
        (120, 0.22, 0.03, 5),
        (300, 0.07, 0.01, 7),
        (300, 0.09, 0.012, 11),
    ];
    for (users, p_same_cluster, p_other_cluster, seed) in worlds {
        let world = simulate(
            &WorldConfig {
                users,
                items: 150,
                rated_fraction: 0.35,
                p_same_cluster,
                p_other_cluster,
                ..WorldConfig::default()
            },
            &mut Rng::new(seed),
        );
        let degree = world
            .users()
            .map(|user| world.snapshot.friends(user).len())
            .sum::<usize>() as f64
            / users as f64;
        assert!(
            (9.0..=14.0).contains(&degree),
            "{users} users at {degree:.1} friends each is not the neighbourhood this is about"
        );
        let snapshot = world.snapshot.to_data().to_snapshot();
        let mut worst: f64 = 0.0;
        for viewer in snapshot.users() {
            let result = compute_user(&snapshot, viewer, &params).expect("a finite result");
            assert_eq!(result.boundary_residual, 0.0);
            assert!(result.boundary_nodes.is_empty());
            assert!(
                result.truncation <= params.error_budget,
                "{users} users, viewer {}: truncation {}",
                viewer.0,
                result.truncation
            );
            assert!(
                result.settled,
                "{users} users, viewer {} did not settle",
                viewer.0
            );
            worst = worst.max(result.truncation);
        }
        println!("{users} users at {degree:.1} friends: worst truncation {worst:.4}");
    }
}

/// The cheap update agrees with the full recompute. With the graph and the ratings
/// unchanged, rescoring from the masses the last walk produced is the same answer to the bit:
/// the scores are a function of the masses and the thumbs, and neither moved.
#[test]
fn rescoring_cached_masses_is_the_same_answer() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 70,
            items: 90,
            rated_fraction: 0.45,
            p_same_cluster: 0.12,
            p_other_cluster: 0.03,
            ..WorldConfig::default()
        },
        &mut Rng::new(43),
    );
    for viewer in world.users() {
        let full = result_of(&world.snapshot, viewer, &params);
        let mut masses = vec![0.0; world.snapshot.user_count()];
        for &(user, mass) in &full.reach_masses {
            masses[user.index()] = mass;
        }
        let cheap = rescore_user(
            &world.snapshot,
            viewer,
            &masses,
            full.walk_report(),
            &params,
        )
        .expect("the cached masses are finite");
        assert_eq!(
            cheap.scores, full.scores,
            "viewer {} rescored to a different feed",
            viewer.0
        );
        assert_eq!(cheap.reach, full.reach);
        assert_eq!(cheap.reach_masses, full.reach_masses);
        assert_eq!(cheap.pairs, full.pairs);
        // The bounds are carried through rather than recomputed: they bound the error in the
        // masses, and the masses are the ones being reused.
        assert_eq!(cheap.walk_report(), full.walk_report());
        assert_eq!(cheap.error(&params), full.error(&params));
    }

    // A mass vector that is not the snapshot's is refused rather than scored against the wrong
    // people, and a non-finite one is an error and never a result.
    let viewer = UserId(0);
    let report = WalkReport {
        truncation: 0.0,
        boundary_residual: 0.0,
        settle_movement: 0.0,
        passes: 1,
        settled: true,
    };
    assert_eq!(
        rescore_user(&world.snapshot, viewer, &[1.0], report, &params),
        Err(CoreError::MassLengthMismatch {
            expected: world.snapshot.user_count(),
            got: 1
        })
    );
    let broken = vec![f64::NAN; world.snapshot.user_count()];
    assert!(rescore_user(&world.snapshot, viewer, &broken, report, &params).is_err());
    let masses = vec![0.0; world.snapshot.user_count()];
    let unbounded = WalkReport {
        truncation: f64::INFINITY,
        ..report
    };
    assert!(rescore_user(&world.snapshot, viewer, &masses, unbounded, &params).is_err());
}
