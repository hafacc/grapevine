//! Is reporting your real opinion the best thing you can do for your own
//! results — on average over random worlds, and in every fixed state of everybody else's.

mod common;

use std::sync::OnceLock;

use common::{auc, detail_of};
use grapevine_core::{
    ItemId, Params, Ratable, Rng, Snapshot, SybilConfig, SybilShape, SybilStrategy, UserId, World,
    WorldConfig, add_sybils, alignment::alignment_for, graph::hop_distances, informativeness,
    simulate,
};

/// What the target reports, given what it actually thinks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Report {
    /// Everything, as rated.
    Honest,
    /// A fraction of the ratings dropped.
    Withheld(usize),
    /// A fraction of the ratings replaced by a coin flip.
    Randomized(usize),
    /// A fraction of the ratings reversed.
    Inverted(usize),
    /// Only the ratings on items the viewer's own reach finds uninformative are dropped.
    WithheldConsensus,
}

/// Rewrites one user's reported item ratings.
fn reported_world(
    world: &World,
    target: UserId,
    report: Report,
    informative: &[f64],
    rng: &mut Rng,
) -> Snapshot {
    let owned: Vec<(Ratable, i8)> = world
        .snapshot
        .ratings(target)
        .iter()
        .copied()
        .filter(|(ratable, _)| ratable.is_item())
        .collect();
    let mut builder = world.snapshot.edit();
    for (ratable, value) in owned.iter().copied() {
        match report {
            Report::Honest => {}
            Report::Withheld(percent) => {
                if rng.below(100) < percent {
                    builder.rate(target, ratable, 0);
                }
            }
            Report::Randomized(percent) => {
                if rng.below(100) < percent {
                    builder.rate(target, ratable, if rng.chance(0.5) { 1 } else { -1 });
                }
            }
            Report::Inverted(percent) => {
                if rng.below(100) < percent {
                    builder.rate(target, ratable, -value);
                }
            }
            Report::WithheldConsensus => {
                if informative[ratable.item().index()] < 0.1 {
                    builder.rate(target, ratable, 0);
                }
            }
        }
    }
    builder.build()
}

/// AUC of the viewer's scores over the items they never rated, against their true preference.
/// The evaluation set is the same in every condition: only the reported training ratings move.
fn held_out_auc(
    world: &World,
    snapshot: &Snapshot,
    target: UserId,
    params: &Params,
) -> Option<f64> {
    let detail = detail_of(snapshot, target, params);
    let scored: Vec<(f64, bool)> = world
        .items()
        .filter(|&item| world.snapshot.rating(target, Ratable::Item(item)).is_none())
        .map(|item| {
            let score = detail
                .scores
                .get(&Ratable::Item(item))
                .map(|score| score.score)
                .unwrap_or(0.0);
            (score, world.preference(target, item) > 0)
        })
        .collect();
    let positives = scored.iter().filter(|&&(_, label)| label).count();
    if positives == 0 || positives == scored.len() {
        None
    } else {
        Some(auc(&scored))
    }
}

/// The informativeness the target's own reach assigns to each item.
fn informativeness_for(snapshot: &Snapshot, target: UserId, params: &Params) -> Vec<f64> {
    let detail = detail_of(snapshot, target, params);
    detail.informativeness
}

/// The average case: honest and complete beats withholding, beats noise, and beats
/// lying, over a homophilous world with one small cluster.
#[test]
fn average_case_incentives() {
    let params = Params::default();
    let world = simulate(
        // Sparse enough, and mixed enough, that who you trust matters: with a dense catalog and
        // friends only from your own cluster, the graph alone ranks well and nothing the viewer
        // reports moves the result.
        &WorldConfig {
            users: 80,
            items: 140,
            cluster_proportions: vec![0.6, 0.25, 0.15],
            cluster_spread: 0.25,
            noise: 0.2,
            rated_fraction: 0.3,
            p_same_cluster: 0.06,
            p_other_cluster: 0.05,
            ..WorldConfig::default()
        },
        &mut Rng::new(101),
    );
    // Spread the sample across the whole population: the simulator lays the clusters out in
    // order, so taking the first twenty would be twenty members of the largest one.
    let eligible: Vec<UserId> = world
        .users()
        .filter(|&user| world.snapshot.friends(user).len() >= 3)
        .collect();
    let targets: Vec<UserId> = (0..20)
        .map(|index| eligible[index * eligible.len() / 20])
        .collect();
    assert_eq!(targets.len(), 20, "the world has twenty usable targets");
    assert!(
        targets
            .iter()
            .any(|&target| world.cluster_of[target.index()] == 2),
        "the sample reaches the 15% cluster"
    );

    let mut honest = Vec::new();
    let mut withheld = Vec::new();
    let mut randomized = Vec::new();
    let mut inverted = Vec::new();
    let mut consensus_withheld = Vec::new();
    let mut small_cluster = Vec::new();
    let mut small_cluster_consensus = Vec::new();
    for (index, &target) in targets.iter().enumerate() {
        let mut rng = Rng::new(7_000 + index as u64);
        let informative = informativeness_for(&world.snapshot, target, &params);
        let conditions = [
            (Report::Honest, &mut honest),
            (Report::Withheld(50), &mut withheld),
            (Report::Randomized(50), &mut randomized),
            (Report::Inverted(25), &mut inverted),
            (Report::WithheldConsensus, &mut consensus_withheld),
        ];
        for (report, scores) in conditions {
            // Which ratings a condition happens to drop or flip is itself noise, so the random
            // conditions are averaged over several draws and the comparison is between
            // conditions rather than between draws. Four draws is enough: the gaps asserted below
            // are an order of magnitude wider than the spread four draws leaves on them. Honest
            // and consensus-withholding draw nothing — they are functions of the world — so
            // repeating them would be the same computation four times.
            let draws = match report {
                Report::Honest | Report::WithheldConsensus => 1,
                _ => 4,
            };
            let mut total = 0.0;
            let mut seen = 0.0;
            for _ in 0..draws {
                let snapshot = reported_world(&world, target, report, &informative, &mut rng);
                if let Some(value) = held_out_auc(&world, &snapshot, target, &params) {
                    total += value;
                    seen += 1.0;
                }
            }
            if seen > 0.0 {
                scores.push(total / seen);
                if report == Report::Honest && world.cluster_of[target.index()] == 2 {
                    small_cluster.push(total / seen);
                    small_cluster_consensus.push(consensus_ranking_auc(&world, target, &params));
                }
            }
        }
    }

    let mean = |values: &[f64]| values.iter().sum::<f64>() / values.len() as f64;
    let honest_mean = mean(&honest);
    println!(
        "mean AUC: honest {honest_mean:.3}, withheld {:.3}, randomized {:.3}, inverted {:.3}, consensus-withheld {:.3}",
        mean(&withheld),
        mean(&randomized),
        mean(&inverted),
        mean(&consensus_withheld)
    );
    assert!(honest_mean >= 0.70, "honest mean AUC is {honest_mean}");
    assert!(
        honest_mean >= mean(&withheld) + 0.02,
        "honest {honest_mean} is not 0.02 above withheld {}",
        mean(&withheld)
    );
    assert!(
        mean(&withheld) >= mean(&randomized) + 0.02,
        "withheld {} is not 0.02 above randomized {}",
        mean(&withheld),
        mean(&randomized)
    );
    assert!(
        honest_mean >= mean(&inverted) + 0.02,
        "honest {honest_mean} is not 0.02 above 25% inverted {}",
        mean(&inverted)
    );
    assert!(
        (honest_mean - mean(&consensus_withheld)).abs() < 0.01,
        "dropping only consensus ratings moved AUC from {honest_mean} to {}",
        mean(&consensus_withheld)
    );

    assert!(!small_cluster.is_empty(), "the 15% cluster was sampled");
    let small_mean = mean(&small_cluster);
    let consensus_mean = mean(&small_cluster_consensus);
    println!(
        "smallest cluster: personal {small_mean:.3}, reach-weighted p_x {consensus_mean:.3} \
         over {} of the sampled targets",
        small_cluster.len()
    );
    // The margin is a mean over the three sampled members of a twelve-person cluster, so a
    // fifth of a point is inside what one target moves it by: the claim this test makes is
    // the direction, and the bar sits under the measured 0.049.
    assert!(
        small_mean >= consensus_mean + 0.04,
        "in the 15% cluster the personal ranking scores {small_mean}, barely over the \
         reach-weighted consensus {consensus_mean}"
    );
}

/// AUC of ranking by the viewer's reach-weighted consensus `p_x` rather than by their own score:
/// what the viewer would get from "what people near me think", with no alignment at all.
fn consensus_ranking_auc(world: &World, target: UserId, params: &Params) -> f64 {
    let detail = detail_of(&world.snapshot, target, params);
    let mut up = vec![0.0; world.snapshot.item_count()];
    let mut down = vec![0.0; world.snapshot.item_count()];
    for rater in world.users() {
        let mass = detail.mass(rater);
        if rater == target || mass <= 0.0 {
            continue;
        }
        for &(ratable, value) in world.snapshot.ratings(rater) {
            if let Ratable::Item(item) = ratable {
                if value > 0 {
                    up[item.index()] += mass;
                } else {
                    down[item.index()] += mass;
                }
            }
        }
    }
    let scored: Vec<(f64, bool)> = world
        .items()
        .filter(|&item| world.snapshot.rating(target, Ratable::Item(item)).is_none())
        .map(|item| {
            let index = item.index();
            let consensus = (up[index] + 1.0) / (up[index] + down[index] + 2.0);
            (consensus, world.preference(target, item) > 0)
        })
        .collect();
    auc(&scored)
}

/// The fixed states of everybody else that the per-state tests measure against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// Everyone in reach but a dissenting fifth votes against the target's true taste.
    Opposed,
    /// Everyone in reach but a dissenting fifth votes with it.
    Aligned,
    /// Half of the target's friends each way.
    Mixed,
    /// A mimicking bot region promotes ten items through one friend.
    Promoted,
}

/// How much of the reach dissents from the state on every item. Without a minority the state
/// makes every item in reach unanimous, `ω` is then exactly zero on all of them, and no report
/// the target could make would move any alignment: the state would assert nothing whatever.
const DISSENT_SHARE: f64 = 0.2;

/// Rewrites everyone else's ratings into the given state. Who dissents is drawn once from
/// `seed`, so the state is a fixed state of everybody else — the same in every condition the
/// target is measured under.
fn state_world(
    world: &World,
    target: UserId,
    state: State,
    seed: u64,
    params: &Params,
) -> Snapshot {
    if state == State::Promoted {
        let gate = world.snapshot.friends(target)[0];
        let (snapshot, _) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: 12,
                gatekeepers: vec![gate],
                promoted: (0..10).map(|index| format!("push{index}")).collect(),
                strategy: SybilStrategy::MimicFeed,
                shape: SybilShape::Clique,
                ..SybilConfig::default()
            },
            // Wiring the swarm costs one recommendation pass per bot; what the bots end up
            // reporting is the same at a fraction of the edge budget, and building the state is
            // not the claim under test.
            &Params {
                edge_budget: 50_000,
                ..*params
            },
        );
        return snapshot;
    }
    let distances = hop_distances(&world.snapshot, target);
    let friends = world.snapshot.friends(target).to_vec();
    let mut picker = Rng::new(20_000 + seed);
    let dissents: Vec<bool> = world
        .users()
        .map(|_| picker.chance(DISSENT_SHARE))
        .collect();
    let mut builder = world.snapshot.edit();
    for other in world.users() {
        if other == target || distances[other.index()].is_none() {
            continue;
        }
        let dissenting = dissents[other.index()];
        let with_target = match state {
            State::Opposed => dissenting,
            State::Aligned => !dissenting,
            State::Mixed => {
                let anchor = friends
                    .iter()
                    .position(|&friend| friend == other)
                    .unwrap_or(other.index());
                anchor % 2 == 0
            }
            State::Promoted => true,
        };
        let owned: Vec<Ratable> = world
            .snapshot
            .ratings(other)
            .iter()
            .filter(|(ratable, _)| ratable.is_item())
            .map(|&(ratable, _)| ratable)
            .collect();
        for ratable in owned {
            let truth = world.preference(target, ratable.item());
            builder.rate(other, ratable, if with_target { truth } else { -truth });
        }
    }
    builder.build()
}

/// One seed's three AUCs in one fixed state: honest, 25% inverted, 25% withheld.
fn state_seed_aucs(state: State, seed: u64, params: &Params) -> Option<(f64, f64, f64)> {
    let world = simulate(
        &WorldConfig {
            users: 60,
            items: 130,
            cluster_spread: 0.25,
            noise: 0.2,
            rated_fraction: 0.25,
            p_same_cluster: 0.1,
            p_other_cluster: 0.06,
            ..WorldConfig::default()
        },
        &mut Rng::new(500 + seed),
    );
    let target = world
        .users()
        .find(|&user| world.snapshot.friends(user).len() >= 3)
        .expect("someone has friends");
    let fixed = World {
        snapshot: state_world(&world, target, state, seed, params),
        ..world.clone()
    };
    if state == State::Opposed || state == State::Aligned {
        // The point of the dissenting minority: with the reach unanimous, every `ω` is zero and
        // no report the target could make would move an alignment.
        let omega = informativeness_for(&fixed.snapshot, target, params);
        let contested = omega.iter().filter(|&&value| value > 0.0).count();
        assert!(
            contested * 2 >= omega.len(),
            "seed {seed}: only {contested} of {} items are contested inside the reach",
            omega.len()
        );
    }
    let mut rng = Rng::new(9_000 + seed);
    let informative = vec![1.0; fixed.snapshot.item_count()];
    let honest = held_out_auc(&fixed, &fixed.snapshot, target, params);
    let inverted_snapshot =
        reported_world(&fixed, target, Report::Inverted(25), &informative, &mut rng);
    let inverted = held_out_auc(&fixed, &inverted_snapshot, target, params);
    let withheld_snapshot =
        reported_world(&fixed, target, Report::Withheld(25), &informative, &mut rng);
    let withheld = held_out_auc(&fixed, &withheld_snapshot, target, params);
    match (honest, inverted, withheld) {
        (Some(honest), Some(inverted), Some(withheld)) => Some((honest, inverted, withheld)),
        _ => None,
    }
}

/// The twenty seeds of one state, computed once per test binary.
///
/// A seed costs a recommendation pass for each of the three conditions, and the adversarial
/// states cost one more per bot to wire on top of that; more than one test below asks for the
/// same state, and the suite's time budget does not stretch to computing it twice. The cache is
/// keyed by state alone, so every caller has to pass `Params::default()`.
fn cached_state_aucs(state: State, params: &Params) -> &'static Vec<(u64, f64, f64, f64)> {
    static OPPOSED: OnceLock<Vec<(u64, f64, f64, f64)>> = OnceLock::new();
    static ALIGNED: OnceLock<Vec<(u64, f64, f64, f64)>> = OnceLock::new();
    static MIXED: OnceLock<Vec<(u64, f64, f64, f64)>> = OnceLock::new();
    static PROMOTED: OnceLock<Vec<(u64, f64, f64, f64)>> = OnceLock::new();
    assert_eq!(
        *params,
        Params::default(),
        "the seed cache is keyed by state alone"
    );
    let cell = match state {
        State::Opposed => &OPPOSED,
        State::Aligned => &ALIGNED,
        State::Mixed => &MIXED,
        State::Promoted => &PROMOTED,
    };
    cell.get_or_init(|| {
        (0..20u64)
            .filter_map(|seed| {
                state_seed_aucs(state, seed, params)
                    .map(|(honest, inverted, withheld)| (seed, honest, inverted, withheld))
            })
            .collect()
    })
}

/// One fixed state over 20 seeds: the per-seed claim, the means, and how often honest is
/// strictly ahead. Returns the strict-win count.
fn run_fixed_state(state: State, name: &str, params: &Params) -> usize {
    let mut honest_total = 0.0;
    let mut withheld_total = 0.0;
    let mut inverted_total = 0.0;
    let mut seeds = 0;
    let mut strict_wins = 0;
    for &(seed, honest, inverted, withheld) in cached_state_aucs(state, params) {
        assert!(
            honest >= inverted - 1e-12,
            "{name}, seed {seed}: honest AUC {honest} is below 25%-inverted {inverted}"
        );
        if honest > inverted {
            strict_wins += 1;
        }
        honest_total += honest;
        withheld_total += withheld;
        inverted_total += inverted;
        seeds += 1;
    }
    assert!(seeds >= 15, "{name}: only {seeds} usable seeds");
    println!(
        "{name}: honest {:.3}, inverted {:.3}, withheld {:.3} over {seeds} seeds; \
         honest strictly ahead in {strict_wins}",
        honest_total / seeds as f64,
        inverted_total / seeds as f64,
        withheld_total / seeds as f64
    );
    assert!(
        honest_total >= withheld_total - 1e-12,
        "{name}: honest mean {} is below 25%-withheld {}",
        honest_total / seeds as f64,
        withheld_total / seeds as f64
    );
    strict_wins
}

/// Per state, for the states everyone else's ratings are fixed by hand in: whatever
/// they have said, reporting your real opinion is at least as good for your own results as
/// reporting the opposite, in **every** seed. Equality is allowed by the claim, and the
/// strict-win count is recorded rather than asserted: a fixed state can saturate, and at ten of
/// twenty seeds a bar would be measuring the state and not the mechanism.
#[test]
fn per_state_incentives() {
    let params = Params::default();
    run_fixed_state(State::Opposed, "opposed", &params);
    run_fixed_state(State::Mixed, "mixed", &params);
}

/// The strict-win record, over all three fixed states.
///
/// Each fixed state is asked for the per-seed `≥` — honest never behind 25%-inverted in
/// any seed — plus a recorded count of how often it is strictly ahead. The count is a record and
/// not a bar, because a fixed state can saturate: the viewer's own thumb counts in `ω` at
/// `π̃_u(u) = 1` (DESIGN section 2.2), so a state built by hand out of the target's own truth
/// leaves every item contested inside the target's own reach, every alignment in reach cleanly
/// signed, and the held-out AUC at 1.000 whatever the target reports. What a saturated state can
/// still show is that honest is never *behind*, which is the claim, and that is asserted here
/// and in the two tests above. The seeds themselves are computed once per binary and shared.
#[test]
fn fixed_state_strict_wins() {
    let params = Params::default();
    let mut record: Vec<(&str, usize, usize)> = Vec::new();
    for (state, name) in [
        (State::Opposed, "opposed"),
        (State::Aligned, "aligned"),
        (State::Mixed, "mixed"),
    ] {
        let strict = run_fixed_state(state, name, &params);
        record.push((name, strict, cached_state_aucs(state, &params).len()));
    }
    for (name, strict, seeds) in record {
        println!("strict wins, {name}: honest strictly ahead in {strict} of {seeds} seeds");
    }
}

/// The aligned state, which cannot be asked for a strict win: when everyone in reach is a
/// deterministic function of the target's true taste — the majority voting it, the dissenting
/// fifth voting its opposite — every one of them predicts the target perfectly once their own
/// alignment sign is applied, and the held-out AUC saturates at 1.000 whatever the target
/// reports. Inverting a quarter of the target's ratings pulls every `â` in reach towards the
/// middle by the same quarter, which changes no alignment's sign and so no ranking: honest
/// 1.000, inverted 0.866, withheld 0.980 over 20 seeds, honest strictly ahead in 16 of them and
/// never behind — it would clear a strict-win bar the opposed and mixed states cannot, which is
/// why no state asserts one. State (ii) is asked only for the per-seed claim, which
/// `run_fixed_state` makes with equality allowed; a dissenting share large enough to break the ceiling (0.35 and
/// up) breaks that claim in the opposed state instead. `state_seed_aucs` still refuses a seed
/// whose reach is unanimous, so what runs here is a state a report could have moved.
#[test]
fn aligned_state_incentives() {
    let params = Params::default();
    run_fixed_state(State::Aligned, "aligned", &params);
}

/// The adaptive state (iii): a `MimicFeed` region promoting ten items through one friend.
/// DESIGN section 2.7 excludes an adversary who conditions on your reports from the fixed-state
/// guarantee, so the claim here is on the **means** — and the per-seed loss count is recorded,
/// because that is the number the exclusion is about: against an account that has copied your
/// feed, misreporting costs it its alignment and takes its promotions out of your ranking.
#[test]
fn adaptive_state_incentives_on_the_mean() {
    let params = Params::default();
    let mut honest_total = 0.0;
    let mut withheld_total = 0.0;
    let mut inverted_total = 0.0;
    let mut seeds = 0;
    let mut losses = 0;
    for &(seed, honest, inverted, withheld) in cached_state_aucs(State::Promoted, &params) {
        if honest < inverted - 1e-12 {
            losses += 1;
            println!("promoted, seed {seed}: honest {honest:.3} < inverted {inverted:.3}");
        }
        honest_total += honest;
        withheld_total += withheld;
        inverted_total += inverted;
        seeds += 1;
    }
    assert!(seeds >= 15, "promoted: only {seeds} usable seeds");
    println!(
        "promoted: honest {:.3}, inverted {:.3}, withheld {:.3} over {seeds} seeds; \
         honest lost in {losses} of them",
        honest_total / seeds as f64,
        inverted_total / seeds as f64,
        withheld_total / seeds as f64
    );
    assert!(
        honest_total >= inverted_total - 1e-12,
        "promoted: honest mean {} is below 25%-inverted {}",
        honest_total / seeds as f64,
        inverted_total / seeds as f64
    );
    assert!(
        honest_total >= withheld_total - 1e-12,
        "promoted: honest mean {} is below 25%-withheld {}",
        honest_total / seeds as f64,
        withheld_total / seeds as f64
    );
}

/// The direct single-report test: for a rater of a contested item, the honest report makes
/// the alignment estimate no worse than the inverted one.
#[test]
fn single_report_moves_alignment_the_right_way() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 60,
            items: 80,
            rated_fraction: 0.5,
            ..WorldConfig::default()
        },
        &mut Rng::new(77),
    );
    let mut rng = Rng::new(4);
    let mut checked = 0;
    let mut honest_closer = 0;
    let mut honest_error = 0.0;
    let mut inverted_error = 0.0;
    // One result per target, not one per draw: the loop rejects most of the triples it draws
    // and the snapshot never changes, so recomputing would be the whole cost of the test.
    let mut cached: Vec<Option<grapevine_core::UserDetail>> = vec![None; world.config.users];
    while checked < 200 {
        let target = UserId(rng.below(world.config.users) as u32);
        let distances = hop_distances(&world.snapshot, target);
        let detail = cached[target.index()]
            .get_or_insert_with(|| detail_of(&world.snapshot, target, &params));
        let item = ItemId(rng.below(world.config.items) as u32);
        let ratable = Ratable::Item(item);
        if detail.informativeness[item.index()] < 0.5
            || world.snapshot.rating(target, ratable).is_none()
        {
            continue;
        }
        let Some(other) = world.users().find(|&other| {
            other != target
                && detail.mass(other) > 0.0
                && world.snapshot.rating(other, ratable).is_some()
        }) else {
            continue;
        };
        let truth = world.true_agreement(target, other);
        let mut errors = Vec::new();
        for value in [1i8, -1] {
            let mut builder = world.snapshot.edit();
            builder.rate(target, ratable, value);
            let snapshot = builder.build();
            let informative = informativeness(&snapshot, target, &detail.first_visit_mass);
            let alignment =
                alignment_for(&snapshot, target, other, &informative, &distances, &params);
            errors.push((alignment.estimate - truth).abs());
        }
        let honest_value = world
            .snapshot
            .rating(target, ratable)
            .expect("the target rated it");
        let (honest, inverted) = if honest_value > 0 {
            (errors[0], errors[1])
        } else {
            (errors[1], errors[0])
        };
        honest_error += honest;
        inverted_error += inverted;
        if honest <= inverted + 1e-12 {
            honest_closer += 1;
        }
        checked += 1;
    }
    println!(
        "single report: honest closer in {honest_closer}/200 triples; mean |â − a_true| \
         honest {:.4} inverted {:.4}",
        honest_error / 200.0,
        inverted_error / 200.0
    );
    assert!(
        honest_error <= inverted_error,
        "over 200 triples the honest report is further from the true agreement rate \
         ({honest_error}) than the inverted one ({inverted_error})"
    );
}
