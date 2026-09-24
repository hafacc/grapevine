//! The priors `κ` and `a₀(d)` estimated from a population, against what
//! generated it — the only check that they are the population's numbers rather than plausible
//! ones — and against the per-recompute tallies the database pools.

mod common;

use grapevine_core::alignment::alignment_for;
use grapevine_core::{
    MIN_SAMPLE, PairTallies, Params, PriorEstimate, PriorSample, Rng, UserId, World, WorldConfig,
    compute_user_detail, estimate_priors, estimate_priors_from_tallies, hop_distances,
    informativeness, simulate, tally_pairs,
};

/// One pair of the population: how much they agreed, how much they did not, and how far apart
/// they are in the graph.
struct Pair {
    one: UserId,
    other: UserId,
    agreements: f64,
    disagreements: f64,
    class: usize,
}

fn world_of(config: WorldConfig, seed: u64) -> World {
    simulate(&config, &mut Rng::new(seed))
}

/// Every pair of the world with its weighted counts, rebuilt in the test from the public
/// alignment so that nothing about the estimate's own pair enumeration is taken on trust.
fn pairs_of(world: &World, params: &Params) -> Vec<Pair> {
    let snapshot = &world.snapshot;
    let count = snapshot.user_count();
    let omega = informativeness(snapshot, UserId(0), &vec![1.0; count]);
    let mut pairs = Vec::new();
    for one in snapshot.users() {
        let distances = hop_distances(snapshot, one);
        for other in snapshot.users() {
            if other <= one {
                continue;
            }
            let alignment = alignment_for(snapshot, one, other, &omega, &distances, params);
            let class = match distances[other.index()] {
                Some(1) => 0,
                Some(2) => 1,
                _ => 2,
            };
            pairs.push(Pair {
                one,
                other,
                agreements: alignment.agreements,
                disagreements: alignment.disagreements,
                class,
            });
        }
    }
    pairs
}

fn qualifying(pairs: &[Pair], min_overlap: f64) -> Vec<&Pair> {
    pairs
        .iter()
        .filter(|pair| pair.agreements + pair.disagreements >= min_overlap)
        .collect()
}

/// `ln Γ(x)` by the Lanczos approximation, so the reference fit below can be a likelihood and
/// not a moment. Test-only: nothing in the crate needs it.
fn ln_gamma(value: f64) -> f64 {
    const COEFFICIENTS: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if value < 0.5 {
        // Reflection, so the search below may take the whole line without a special case here.
        (std::f64::consts::PI / (std::f64::consts::PI * value).sin()).ln() - ln_gamma(1.0 - value)
    } else {
        let shifted = value - 1.0;
        let mut series = COEFFICIENTS[0];
        for (index, coefficient) in COEFFICIENTS.iter().enumerate().skip(1) {
            series += coefficient / (shifted + index as f64);
        }
        let intermediate = shifted + 7.5;
        0.5 * (2.0 * std::f64::consts::PI).ln() + (shifted + 0.5) * intermediate.ln() - intermediate
            + series.ln()
    }
}

/// The Beta-binomial log-likelihood of the observed agreement counts under one `κ`, with each
/// class at its own observed mean. The binomial coefficient does not depend on `κ`, so it is
/// dropped: this is the reference the method of moments is checked against, not a number with
/// a meaning of its own.
fn log_likelihood(pairs: &[&Pair], means: &[f64; 3], pseudocount: f64) -> f64 {
    let mut total = 0.0;
    for pair in pairs {
        let prior = means[pair.class];
        let up = pseudocount * prior;
        let down = pseudocount * (1.0 - prior);
        total += ln_gamma(pseudocount) - ln_gamma(up) - ln_gamma(down)
            + ln_gamma(pair.agreements + up)
            + ln_gamma(pair.disagreements + down)
            - ln_gamma(pair.agreements + pair.disagreements + pseudocount);
    }
    total
}

/// The `κ` that best explains the observed spread, by golden-section search on `ln κ`.
fn maximum_likelihood_pseudocount(pairs: &[&Pair], means: &[f64; 3]) -> f64 {
    let golden = (5.0_f64.sqrt() - 1.0) / 2.0;
    let (mut low, mut high) = (0.05_f64.ln(), 400.0_f64.ln());
    let mut left = high - golden * (high - low);
    let mut right = low + golden * (high - low);
    let mut left_value = log_likelihood(pairs, means, left.exp());
    let mut right_value = log_likelihood(pairs, means, right.exp());
    for _ in 0..80 {
        if left_value > right_value {
            high = right;
            right = left;
            right_value = left_value;
            left = high - golden * (high - low);
            left_value = log_likelihood(pairs, means, left.exp());
        } else {
            low = left;
            left = right;
            left_value = right_value;
            right = low + golden * (high - low);
            right_value = log_likelihood(pairs, means, right.exp());
        }
    }
    ((low + high) / 2.0).exp()
}

/// The oracle's mean agreement over a set of pairs: what the population really does, with no
/// sampling and no reporting noise in it.
fn true_mean(world: &World, pairs: &[&Pair], class: usize) -> (f64, usize) {
    let mut total = 0.0;
    let mut count = 0;
    for pair in pairs.iter().filter(|pair| pair.class == class) {
        total += world.true_agreement(pair.one, pair.other);
        count += 1;
    }
    (
        if count == 0 {
            0.0
        } else {
            total / count as f64
        },
        count,
    )
}

/// A population big enough to have all three distance classes in it and sparse enough that most
/// pairs are three or more hops apart.
///
/// Two settings are what make the oracle the right thing to compare against. Reporting noise is
/// off, so the agreement the estimate sees is the agreement the oracle knows about rather than
/// that agreement seen through a coin flip. And taste is spread over eight dimensions rather
/// than the default six, which keeps every item close to an even split (`ω` from 0.68 to 1) —
/// the estimate weights each shared item by `ω` and the oracle weights them all alike, so a
/// catalog with near-unanimous items in it, which everybody agrees about and `ω` discounts,
/// would put a real gap between two numbers that are both correct.
fn population() -> World {
    world_of(
        WorldConfig {
            users: 200,
            items: 150,
            dimensions: 8,
            cluster_spread: 0.40,
            rated_fraction: 0.5,
            noise: 0.0,
            p_same_cluster: 0.04,
            p_other_cluster: 0.004,
            ..WorldConfig::default()
        },
        7,
    )
}

/// The recovered `a₀(d)` lands on the population's own mean agreement by distance, and the
/// recovered `κ` near the one that best explains the spread.
#[test]
fn the_estimate_recovers_what_generated_the_world() {
    let world = population();
    let table = Params::default();
    let sample = PriorSample {
        pair_viewers: world.snapshot.user_count(),
        ..PriorSample::default()
    };
    let estimate = estimate_priors(&world.snapshot, &sample);
    let pairs = pairs_of(&world, &table);
    let qualified = qualifying(&pairs, sample.min_overlap);

    let recovered = [estimate.a0.d1, estimate.a0.d2, estimate.a0.d3plus];
    let counted = [
        estimate.samples.d1,
        estimate.samples.d2,
        estimate.samples.d3plus,
    ];
    let mut means = [0.0; 3];
    for class in 0..3 {
        let (oracle, count) = true_mean(&world, &qualified, class);
        means[class] = qualified
            .iter()
            .filter(|pair| pair.class == class)
            .map(|pair| pair.agreements / (pair.agreements + pair.disagreements))
            .sum::<f64>()
            / count.max(1) as f64;
        println!(
            "d{}: {} pairs, recovered {:?}, population mean {:.4}, observed mean {:.4}",
            class + 1,
            count,
            recovered[class],
            oracle,
            means[class],
        );
        assert_eq!(
            counted[class],
            count,
            "class {} pair count differs from the test's own enumeration",
            class + 1
        );
        if count >= MIN_SAMPLE {
            let estimated = recovered[class].expect("a class with enough pairs is estimated");
            common::assert_close(estimated, oracle, 0.03, &format!("a0(d{})", class + 1));
        } else {
            assert_eq!(recovered[class], None, "class {} is under N_min", class + 1);
        }
    }

    let reference = maximum_likelihood_pseudocount(&qualified, &means);
    let recovered_pseudocount = estimate.kappa.expect("the pooled sample is over N_min");
    println!(
        "kappa: recovered {recovered_pseudocount:.3}, maximum likelihood {reference:.3}, \
         {} pairs at mean overlap {:.2}",
        estimate.samples.pairs, estimate.samples.mean_overlap
    );
    assert!(
        (recovered_pseudocount - reference).abs() <= 0.25 * reference,
        "kappa {recovered_pseudocount} is not within 25% of the maximum likelihood {reference}"
    );
}

/// A class below `N_min` is not estimated, and what is not estimated is the table.
#[test]
fn a_class_below_the_floor_keeps_the_table() {
    let world = population();
    let table = Params::default();
    let thin = PriorSample {
        pair_viewers: world.snapshot.user_count(),
        min_sample: 1_000_000,
        ..PriorSample::default()
    };
    let starved = estimate_priors(&world.snapshot, &thin);
    assert_eq!(starved.kappa, None);
    assert_eq!(starved.a0.d1, None);
    assert_eq!(starved.a0.d2, None);
    assert_eq!(starved.a0.d3plus, None);
    assert_eq!(
        starved.merge(&table),
        table,
        "nothing estimated, nothing moved"
    );
    assert!(
        starved.samples.pairs > 0,
        "the sample sizes are reported whether or not they were enough"
    );

    let met = PriorSample {
        pair_viewers: world.snapshot.user_count(),
        ..PriorSample::default()
    };
    let estimate = estimate_priors(&world.snapshot, &met);
    let merged = estimate.merge(&table);
    assert_ne!(merged, table, "a met sample moves the table");
    assert_eq!(merged.validate(), Ok(()));
    assert_ne!(merged.prior_friend, table.prior_friend);
    assert_ne!(merged.alignment_pseudocount, table.alignment_pseudocount);
    // Nothing outside the three priors is touched by any estimate.
    assert_eq!(merged.decay, table.decay);
    assert_eq!(merged.alignment_clamp, table.alignment_clamp);
    assert_eq!(merged.min_weight, table.min_weight);
    assert_eq!(merged.node_budget, table.node_budget);
}

/// The estimate is a function of the snapshot, so two estimates over one world agree exactly.
#[test]
fn one_world_gives_one_estimate() {
    let world = world_of(
        WorldConfig {
            users: 40,
            items: 60,
            ..WorldConfig::default()
        },
        3,
    );
    let sample = PriorSample {
        pair_viewers: 20,
        min_sample: 1,
        ..PriorSample::default()
    };
    let once = estimate_priors(&world.snapshot, &sample);
    let twice = estimate_priors(&world.snapshot, &sample);
    assert_eq!(once, twice);
    assert_ne!(once, PriorEstimate::default());
}

/// The tallies match the batch: `κ` and `a₀(d)` pooled from what each viewer's own
/// recompute reported land where `estimate_priors` puts them on the same world.
///
/// The two are not the same arithmetic. `estimate_priors` sweeps every pair of the snapshot once
/// and weights each shared item by a population `ω`; a recompute sees only the people its own
/// walk reached and weights by its own reach-local `ω` (DESIGN section 2.2), and every unordered
/// pair inside two viewers' reach is reported twice.
///
/// **The gap between them is one-sided and grows as a neighbourhood shrinks**, which is worth
/// stating because nothing else does. Reach-local `ω` is measured over about `2·|F_u|`
/// friend-units of votes, and the people holding most of that mass are the ones who agree with
/// the viewer — so the items a friend agreed on look unanimous inside the reach and are
/// discounted, while the ones they disagreed on stay contested. The pooled `a₀` therefore reads
/// *lower* than the batch: by about 0.02 on the world below, where people have fifteen friends
/// each, and by 0.10 on a world where they have four. The world here is one where both
/// estimators are looking at the same moment; a sparser one is not a failure of either.
#[test]
fn the_pooled_tallies_land_where_the_batch_estimate_does() {
    let world = world_of(
        WorldConfig {
            users: 100,
            items: 150,
            dimensions: 8,
            cluster_spread: 0.40,
            rated_fraction: 0.5,
            noise: 0.0,
            p_same_cluster: 0.16,
            p_other_cluster: 0.10,
            ..WorldConfig::default()
        },
        7,
    );
    let params = Params::default();
    let sample = PriorSample {
        pair_viewers: world.snapshot.user_count(),
        ..PriorSample::default()
    };
    let batch = estimate_priors(&world.snapshot, &sample);

    let mut pooled = PairTallies::default();
    for viewer in world.snapshot.users() {
        let detail = compute_user_detail(&world.snapshot, viewer, &params)
            .unwrap_or_else(|error| panic!("computing for {}: {error}", viewer.0));
        // What a recompute writes to `user_model` is exactly this. Driving both halves is the
        // point: reading `detail.pairs` alone would check only that a field was copied.
        assert_eq!(
            detail.pairs,
            tally_pairs(&detail.alignments, &detail.distances),
            "the detail's tallies are not the ones its own alignments imply"
        );
        pooled.merge(&detail.pairs);
    }
    let derived = estimate_priors_from_tallies(&pooled, MIN_SAMPLE);

    println!(
        "pairs: batch {}/{}/{}, pooled {}/{}/{}",
        batch.samples.d1,
        batch.samples.d2,
        batch.samples.d3plus,
        derived.samples.d1,
        derived.samples.d2,
        derived.samples.d3plus
    );
    println!(
        "a0: batch {:?}, pooled {:?}; kappa: batch {:?}, pooled {:?}",
        [batch.a0.d1, batch.a0.d2, batch.a0.d3plus],
        [derived.a0.d1, derived.a0.d2, derived.a0.d3plus],
        batch.kappa,
        derived.kappa
    );

    for (class, (batched, from_tallies)) in [
        (batch.a0.d1, derived.a0.d1),
        (batch.a0.d2, derived.a0.d2),
        (batch.a0.d3plus, derived.a0.d3plus),
    ]
    .into_iter()
    .enumerate()
    {
        let batched = batched.unwrap_or_else(|| panic!("the batch estimated d{}", class + 1));
        let from_tallies =
            from_tallies.unwrap_or_else(|| panic!("the tallies estimated d{}", class + 1));
        common::assert_close(
            from_tallies,
            batched,
            0.03,
            &format!("a0(d{}) pooled against the batch", class + 1),
        );
    }
    let batched = batch.kappa.expect("the batch estimated kappa");
    let from_tallies = derived.kappa.expect("the tallies estimated kappa");
    assert!(
        (from_tallies - batched).abs() <= 0.25 * batched,
        "kappa pooled from the recomputes is {from_tallies}, not within 25% of the batch {batched}"
    );
}
