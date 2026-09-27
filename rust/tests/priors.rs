//! The priors `κ` and `a₀` estimated from a population, against what
//! generated it — the only check that they are the population's numbers rather than plausible
//! ones — and against the per-recompute tallies the database pools.

mod common;

use grapevine_core::{
    MIN_SAMPLE, PairTallies, Params, PriorEstimate, PriorSample, Rng, UserId, World, WorldConfig,
    compute_user, estimate_priors, estimate_priors_from_tallies, hop_distances, shared_item_counts,
    simulate,
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

/// Every pair of the world with its counts, rebuilt in the test from the public counting so that
/// nothing about the estimate's own pair enumeration is taken on trust.
fn pairs_of(world: &World) -> Vec<Pair> {
    let snapshot = &world.snapshot;
    let mut pairs = Vec::new();
    for one in snapshot.users() {
        let distances = hop_distances(snapshot, one);
        for other in snapshot.users() {
            if other <= one {
                continue;
            }
            let (agreements, disagreements) =
                shared_item_counts(snapshot.ratings(one), snapshot.ratings(other));
            let class = match distances[other.index()] {
                Some(1) => 0,
                Some(2) => 1,
                _ => 2,
            };
            pairs.push(Pair {
                one,
                other,
                agreements,
                disagreements,
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

/// Each item's share of the population that truly likes it.
fn true_up_rates(world: &World) -> Vec<f64> {
    let users = world.true_preference.len() as f64;
    (0..world.config.items)
        .map(|item| {
            world
                .true_preference
                .iter()
                .filter(|preferences| preferences[item] > 0)
                .count() as f64
                / users
        })
        .collect()
}

/// The oracle: `(1 + λ)/2` for a pair under the witness channel, over the whole catalogue and the
/// true preferences, a match on each item having the chance of `one`'s answer in the population.
/// This is the quantity `a₀` and `κ` describe; the plain share of matches is not.
fn true_rate(world: &World, up: &[f64], one: UserId, other: UserId) -> f64 {
    let mine = &world.true_preference[one.index()];
    let theirs = &world.true_preference[other.index()];
    let (mut matches, mut chance) = (0.0, 0.0);
    for (item, (&my_value, &their_value)) in mine.iter().zip(theirs).enumerate() {
        if my_value == their_value {
            matches += 1.0;
        }
        chance += if my_value > 0 {
            up[item]
        } else {
            1.0 - up[item]
        };
    }
    let (agreement, chance) = (matches / mine.len() as f64, chance / mine.len() as f64);
    let reliability = if agreement >= chance {
        (agreement - chance) / (1.0 - chance)
    } else {
        agreement / chance - 1.0
    };
    (1.0 + reliability) / 2.0
}

/// The oracle's mean rate per class over a set of pairs, and the `κ` of a Beta with the same
/// spread around each class's own mean: what the population really is, with no sampling in it.
fn oracle(world: &World, pairs: &[&Pair]) -> ([f64; 3], [usize; 3], f64) {
    let up = true_up_rates(world);
    let mut totals = [0.0; 3];
    let mut squares = [0.0; 3];
    let mut counts = [0usize; 3];
    for pair in pairs {
        let rate = true_rate(world, &up, pair.one, pair.other);
        totals[pair.class] += rate;
        squares[pair.class] += rate * rate;
        counts[pair.class] += 1;
    }
    let mut means = [0.0; 3];
    let (mut spread, mut binomial) = (0.0, 0.0);
    for class in 0..3 {
        if counts[class] == 0 {
            continue;
        }
        let count = counts[class] as f64;
        means[class] = totals[class] / count;
        spread += squares[class] - count * means[class] * means[class];
        binomial += count * means[class] * (1.0 - means[class]);
    }
    (means, counts, binomial / spread - 1.0)
}

fn plain_mean(pairs: &[&Pair], class: usize) -> f64 {
    let rates: Vec<f64> = pairs
        .iter()
        .filter(|pair| pair.class == class)
        .map(|pair| pair.agreements / (pair.agreements + pair.disagreements))
        .collect();
    rates.iter().sum::<f64>() / rates.len().max(1) as f64
}

/// A population big enough to have all three distance classes in it and sparse enough that most
/// pairs are three or more hops apart.
///
/// Reporting noise is off, so the thumbs the estimate sees are the preferences the oracle reads
/// rather than those preferences seen through a coin flip.
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

fn full_sample(world: &World) -> PriorSample {
    PriorSample {
        pair_viewers: world.snapshot.user_count(),
        ..PriorSample::default()
    }
}

/// The recovered rates land on the population's own mean `(1 + λ)/2` by distance, and the
/// recovered `κ` near the strength of a Beta with the population's spread.
#[test]
fn the_estimate_recovers_what_generated_the_world() {
    let world = population();
    let sample = full_sample(&world);
    let estimate = estimate_priors(&world.snapshot, &sample);
    let pairs = pairs_of(&world);
    let qualified = qualifying(&pairs, sample.min_overlap);
    let (means, counts, true_kappa) = oracle(&world, &qualified);

    let recovered = [estimate.a0.d1, estimate.a0.d2, estimate.a0.d3plus];
    let counted = [
        estimate.samples.d1,
        estimate.samples.d2,
        estimate.samples.d3plus,
    ];
    for class in 0..3 {
        println!(
            "d{}: {} pairs, recovered {:?}, population {:.4}, plain share of matches {:.4}",
            class + 1,
            counts[class],
            recovered[class],
            means[class],
            plain_mean(&qualified, class),
        );
        assert_eq!(
            counted[class],
            counts[class],
            "class {} pair count differs from the test's own enumeration",
            class + 1
        );
        if counts[class] >= MIN_SAMPLE {
            let estimated = recovered[class].expect("a class with enough pairs is estimated");
            common::assert_close(
                estimated,
                means[class],
                0.03,
                &format!("a0(d{})", class + 1),
            );
        } else {
            assert_eq!(recovered[class], None, "class {} is under N_min", class + 1);
        }
    }

    let recovered_pseudocount = estimate.kappa.expect("the pooled sample is over N_min");
    println!(
        "kappa: recovered {recovered_pseudocount:.3}, population {true_kappa:.3}, \
         {} pairs at mean weight {:.2}",
        estimate.samples.pairs, estimate.samples.mean_overlap
    );
    assert!(
        (recovered_pseudocount - true_kappa).abs() <= 0.25 * true_kappa,
        "kappa {recovered_pseudocount} is not within 25% of the population's {true_kappa}"
    );
}

/// Things everyone likes make everyone match. The plain share of matches reads that as closeness
/// (0.82 against a population at 0.59 on this world, and a `κ` of 36 against 12.7); the channel's
/// chance takes it back out.
#[test]
fn agreement_chance_alone_produces_is_not_counted() {
    let world = world_of(
        WorldConfig {
            consensus_items: 30,
            ..population().config
        },
        7,
    );
    let sample = full_sample(&world);
    let estimate = estimate_priors(&world.snapshot, &sample);
    let pairs = pairs_of(&world);
    let qualified = qualifying(&pairs, sample.min_overlap);
    let (means, _, true_kappa) = oracle(&world, &qualified);

    let plain = plain_mean(&qualified, 0);
    let estimated = estimate.a0.d1.expect("d1 is estimated");
    let kappa = estimate.kappa.expect("kappa is estimated");
    println!(
        "a0(d1): recovered {estimated:.4}, population {:.4}, plain {plain:.4}; \
         kappa: recovered {kappa:.3}, population {true_kappa:.3}",
        means[0]
    );
    assert!(
        plain > means[0] + 0.2,
        "the world does not test the chance: plain {plain} against {}",
        means[0]
    );
    common::assert_close(estimated, means[0], 0.03, "a0(d1)");
    assert!(
        (kappa - true_kappa).abs() <= 0.5 * true_kappa,
        "kappa {kappa} is not within 50% of the population's {true_kappa}"
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
    assert_ne!(merged.prior_agreement, table.prior_agreement);
    assert_ne!(merged.prior_strength, table.prior_strength);
    // Nothing outside the two priors is touched by any estimate.
    assert_eq!(merged.clip, table.clip);
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

/// The tallies match the batch: `κ` and the agreement rates pooled from what each viewer's own
/// recompute reported land where `estimate_priors` puts them on the same world.
///
/// The two are not the same arithmetic. `estimate_priors` sweeps every pair of the snapshot once;
/// a recompute sees only the people connected to its viewer, and every unordered pair inside two
/// viewers' reach is reported twice. Both count every shared item once.
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
    let sample = full_sample(&world);
    let batch = estimate_priors(&world.snapshot, &sample);

    let mut pooled = PairTallies::default();
    for viewer in world.snapshot.users() {
        let result = compute_user(&world.snapshot, viewer, &params)
            .unwrap_or_else(|error| panic!("computing for {}: {error}", viewer.0));
        pooled.merge(&result.pairs);
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
    let pairs = pairs_of(&world);
    let (means, _, _) = oracle(&world, &qualifying(&pairs, sample.min_overlap));
    common::assert_close(
        derived.a0.d1.expect("the tallies estimated d1"),
        means[0],
        0.03,
        "a0(d1) pooled against the population",
    );
    let batched = batch.kappa.expect("the batch estimated kappa");
    let from_tallies = derived.kappa.expect("the tallies estimated kappa");
    assert!(
        (from_tallies - batched).abs() <= 0.25 * batched,
        "kappa pooled from the recomputes is {from_tallies}, not within 25% of the batch {batched}"
    );
}
