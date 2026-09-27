//! Estimating `κ` and `a₀` from the population, DESIGN §2.9.
//!
//! `κ` and `a₀` are moments of a distribution the data exhibits, not facts about the world,
//! so once enough people have rated enough things they can be read off the population instead
//! of chosen. Everything here is method of moments on one quantity per pair of people: the
//! agreement rate `(1 + λ̂)/2` their shared items imply under the witness channel, which is the
//! scale the prior is on. The plain share of matching thumbs is not: it counts agreement chance
//! alone produces, and on a catalogue with things nearly everyone likes it reads a pair who share
//! nothing as close.
//!
//! Every recompute reports its own `PairTallies`, in a pass of their own over the people it
//! loaded, a scheduled statement in the database adds them up, and `estimate_priors_from_tallies` is what
//! that statement computes. `estimate_priors` does the same thing in one pass over a whole
//! snapshot, which is the simulator's path and what the
//! pooled answer is checked against.
//!
//! Every field is separately `None` until its own sample is large enough, and a `None` field
//! means the table of DESIGN §2.9 stands for that field alone (`PriorEstimate::merge`). That is
//! what makes this safe on the first day: it can only ever replace a constant with a number it
//! had `N_min` observations for.

use crate::ids::{ItemId, Ratable, UserId};
use crate::params::Params;
use crate::snapshot::Snapshot;

/// `n_min`: a pair whose weighted overlap is below this says nothing about the spread of
/// agreement rates — its own rate is almost all sampling noise.
pub const MIN_PAIR_OVERLAP: f64 = 10.0;

/// `N_min`: how many pairs a distance class needs before the estimate replaces the table's
/// constant.
pub const MIN_SAMPLE: usize = 200;

/// How much of the population the pair moments look at.
///
/// The stride is a deterministic walk over the user list rather than a draw, so an estimate is
/// a function of the snapshot: same graph, same answer, and a difference between two estimates
/// is a difference in the data.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct PriorSample {
    /// How many viewers the pair moments are taken over. Every pair one of them belongs to is
    /// counted, so this is a sample of *pairs* far larger than its own size.
    pub pair_viewers: usize,
    /// `n_min`.
    pub min_overlap: f64,
    /// `N_min`.
    pub min_sample: usize,
}

impl Default for PriorSample {
    fn default() -> Self {
        PriorSample {
            pair_viewers: 400,
            min_overlap: MIN_PAIR_OVERLAP,
            min_sample: MIN_SAMPLE,
        }
    }
}

/// The mean agreement rate for each of three distance classes, each estimated on its own. Only
/// `d1` becomes a parameter (`PriorEstimate::merge`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct DistancePriors {
    pub d1: Option<f64>,
    pub d2: Option<f64>,
    pub d3plus: Option<f64>,
}

/// What each field of an estimate was computed from, so a reader can tell a number backed by a
/// population from one backed by a handful of pairs.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct PriorSamples {
    /// Qualifying pairs per distance class.
    pub d1: usize,
    pub d2: usize,
    pub d3plus: usize,
    /// Every qualifying pair, which is what the pooled `κ` rests on.
    pub pairs: usize,
    /// Mean weight of those pairs: the `n̄` the moment equation uses.
    pub mean_overlap: f64,
}

#[cfg(feature = "serde")]
fn distances_or_default<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<DistancePriors, D::Error> {
    use serde::Deserialize;
    Ok(Option::<DistancePriors>::deserialize(deserializer)?.unwrap_or_default())
}

/// One estimate of the priors. A `None` field is one whose sample was too small to say anything.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct PriorEstimate {
    pub kappa: Option<f64>,
    // A stored row may hold `a0: null` — an estimate of no class at all, written by a
    // caller that flattens its own empty object — and that is the table, not a parse error:
    // nothing read back out of `private.params` may fail a viewer's recompute.
    #[cfg_attr(
        feature = "serde",
        serde(default, deserialize_with = "distances_or_default")
    )]
    pub a0: DistancePriors,
    pub samples: PriorSamples,
}

impl PriorEstimate {
    /// The parameter table this estimate implies, field by field.
    ///
    /// `κ` becomes the prior's strength and `d1` its mean `a₀`. `d2` and `d3plus` are read and
    /// ignored: a chain of learned links replaces a prior by distance (DESIGN §2.9), and they are
    /// still pooled only because dropping them is a later migration.
    ///
    /// Fallback is per field and never wholesale. A value outside the range `Params::validate`
    /// accepts is treated as no estimate at all — the row this came from is written by a
    /// database statement, but it is still a stored row, and a table that fails validation would
    /// fail every viewer's recompute rather than one field of one estimate.
    pub fn merge(&self, params: &Params) -> Params {
        let positive =
            |value: Option<f64>| value.filter(|number| number.is_finite() && *number > 0.0);
        let rate = |value: Option<f64>| {
            value.filter(|number| number.is_finite() && *number > 0.0 && *number < 1.0)
        };
        Params {
            prior_strength: positive(self.kappa).unwrap_or(params.prior_strength),
            prior_agreement: rate(self.a0.d1).unwrap_or(params.prior_agreement),
            ..*params
        }
    }
}

/// What one recompute has to say about the population's priors: DESIGN §2.9's moments over the
/// people it loaded, by distance class.
///
/// It is twelve numbers per viewer, written to `user_model` by the recompute that produced them
/// and pooled by a statement in the database.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct PairTallies {
    pub d1: PairMoments,
    pub d2: PairMoments,
    pub d3plus: PairMoments,
}

impl PairTallies {
    pub fn merge(&mut self, other: &PairTallies) {
        self.d1.merge(&other.d1);
        self.d2.merge(&other.d2);
        self.d3plus.merge(&other.d3plus);
    }

    fn classes(&self) -> [PairMoments; 3] {
        [self.d1, self.d2, self.d3plus]
    }
}

/// What one pair's shared items say about how well one predicts the other: the plain counts, and
/// the chance each match had with nothing shared, `c_i` — the base rate of the holder's thumb, as
/// `channel::Reading::chance` has it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PairCounts {
    pub agreements: f64,
    pub disagreements: f64,
    /// `Σ c_i`.
    pub chance_total: f64,
    /// `Σ c_i²`.
    pub chance_squares: f64,
}

impl PairCounts {
    pub fn overlap(&self) -> f64 {
        self.agreements + self.disagreements
    }

    /// `(1 + λ̂)/2` and the number of fair coins it is as noisy as.
    ///
    /// `λ̂` inverts the channel's mean agreement, `c̄ + λ(1 − c̄)` above zero and `c̄(1 + λ)` below.
    /// The count is what makes the pooled `κ` right: the pooling statement takes the sampling
    /// spread of a rate `m` over `n̄` things to be `m(1 − m)/n̄`, which holds for the plain rate at
    /// `c = ½` and nowhere else. A thing nearly everyone likes (`c_i` near 1) moves `λ̂` by almost
    /// nothing whichever way the pair rate it, so it counts for almost nothing. The count is
    /// `r(1 − r)` over the delta-method variance of `r` at `λ̂`, in closed form so it has no `0/0`
    /// at `λ̂ = ±1`.
    pub fn rate_and_weight(&self) -> (f64, f64) {
        let overlap = self.overlap();
        let chance = (self.chance_total / overlap).clamp(1e-9, 1.0 - 1e-9);
        let agreement = self.agreements / overlap;
        let (reliability, spread) = if agreement >= chance {
            let reliability = ((agreement - chance) / (1.0 - chance)).min(1.0);
            // `Σ p_i(1 − c_i)` with `p_i = c_i + λ(1 − c_i)`.
            let spread = self.chance_total - self.chance_squares
                + reliability * (overlap - 2.0 * self.chance_total + self.chance_squares);
            (
                reliability,
                (1.0 + reliability) * (1.0 - chance).powi(2) / spread,
            )
        } else {
            let reliability = (agreement / chance - 1.0).max(-1.0);
            // `Σ c_i(1 − p_i)` with `p_i = c_i(1 + λ)`.
            let spread = self.chance_total - (1.0 + reliability) * self.chance_squares;
            (reliability, (1.0 - reliability) * chance.powi(2) / spread)
        };
        ((1.0 + reliability) / 2.0, spread * overlap * overlap)
    }
}

/// One viewer's contribution: for each person the recompute compared with the viewer, their hop
/// distance and what their shared items say (`PairCounts::rate_and_weight`).
///
/// `estimate_priors` computes the same rate over every pair of a snapshot, with chances from the
/// whole snapshot rather than a circle; the recompute sees only the pairs its own neighbourhood
/// holds, so the two land in the same place to within sampling error and not exactly — which is
/// what `tests/priors.rs` checks and the width it has to allow.
pub fn tally_pairs(pairs: impl IntoIterator<Item = (Option<u32>, PairCounts)>) -> PairTallies {
    let mut tallies = PairTallies::default();
    for (distance, counts) in pairs {
        let overlap = counts.overlap();
        // Spelled out rather than `overlap < MIN_PAIR_OVERLAP`, which admits a `NaN` overlap and
        // poisons every tally pooled from it.
        if !overlap.is_finite() || overlap < MIN_PAIR_OVERLAP {
            continue;
        }
        let (rate, weight) = counts.rate_and_weight();
        if !(rate.is_finite() && weight.is_finite() && weight > 0.0) {
            continue;
        }
        let class = match distance {
            Some(0 | 1) => &mut tallies.d1,
            Some(2) => &mut tallies.d2,
            _ => &mut tallies.d3plus,
        };
        class.add(rate, weight);
    }
    tallies
}

/// Agreements and disagreements over the items both rating lists contain. Both lists are sorted
/// by ratable with items first, so one merge pass covers them.
pub fn shared_item_counts(mine: &[(Ratable, i8)], theirs: &[(Ratable, i8)]) -> (f64, f64) {
    let counts = shared_item_chances(mine, theirs, |_, _, _| 0.5);
    (counts.agreements, counts.disagreements)
}

/// The same pass, with `chance(item, mine, theirs)` the chance of a match on each shared item.
pub fn shared_item_chances(
    mine: &[(Ratable, i8)],
    theirs: &[(Ratable, i8)],
    mut chance: impl FnMut(ItemId, i8, i8) -> f64,
) -> PairCounts {
    let mut counts = PairCounts::default();
    let mut here = 0;
    let mut there = 0;
    while here < mine.len() && there < theirs.len() {
        let (my_ratable, my_value) = mine[here];
        let (their_ratable, their_value) = theirs[there];
        let (Ratable::Item(item), true) = (my_ratable, their_ratable.is_item()) else {
            break;
        };
        match my_ratable.cmp(&their_ratable) {
            std::cmp::Ordering::Less => here += 1,
            std::cmp::Ordering::Greater => there += 1,
            std::cmp::Ordering::Equal => {
                if my_value == their_value {
                    counts.agreements += 1.0;
                } else {
                    counts.disagreements += 1.0;
                }
                let matched = chance(item, my_value, their_value);
                counts.chance_total += matched;
                counts.chance_squares += matched * matched;
                here += 1;
                there += 1;
            }
        }
    }
    counts
}

/// Up and total thumbs per item over a whole snapshot: the batch's base rates, where a recompute
/// uses its circle's.
fn item_rates(snapshot: &Snapshot) -> Vec<(f64, f64)> {
    let mut rates = vec![(0.0, 0.0); snapshot.item_count()];
    for user in snapshot.users() {
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Item(item) = ratable else {
                break;
            };
            let entry = &mut rates[item.index()];
            entry.1 += 1.0;
            if value > 0 {
                entry.0 += 1.0;
            }
        }
    }
    rates
}

/// The chance of a match on `item`: the Beta(1, 1) base rate with the pair's own two thumbs left
/// out, of the holder's thumb — `BaseRates::up` over the whole snapshot.
fn match_chance(rates: &[(f64, f64)], item: ItemId, mine: i8, theirs: i8) -> f64 {
    let (mut up, mut total) = rates[item.index()];
    for value in [mine, theirs] {
        total -= 1.0;
        if value > 0 {
            up -= 1.0;
        }
    }
    let rate = (up + 1.0) / (total + 2.0);
    if mine > 0 { rate } else { 1.0 - rate }
}

/// The distance classes the tallies are kept in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DistanceClass {
    Friend,
    FriendOfFriend,
    Distant,
}

impl DistanceClass {
    fn index(self) -> usize {
        match self {
            DistanceClass::Friend => 0,
            DistanceClass::FriendOfFriend => 1,
            DistanceClass::Distant => 2,
        }
    }
}

/// The running sums one class of pairs contributes. Streaming rather than a list of rates: a
/// few hundred viewers on a large graph is already millions of pairs, and the database pools
/// these across the population with four `sum()`s and no list at all.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct PairMoments {
    pub pairs: usize,
    /// `Σ (1 + λ̂)/2`.
    pub rate_total: f64,
    pub rate_squares: f64,
    /// `Σ` of each pair's weight (`PairCounts::rate_and_weight`), which `κ` needs for the mean
    /// overlap `n̄`: this divided by `pairs`. Not the number of shared items; that is only what
    /// qualifies a pair.
    pub overlap_total: f64,
}

impl PairMoments {
    fn add(&mut self, rate: f64, overlap: f64) {
        self.pairs += 1;
        self.rate_total += rate;
        self.rate_squares += rate * rate;
        self.overlap_total += overlap;
    }

    /// One more viewer's tallies folded in, which is what the pooling statement does in SQL.
    pub fn merge(&mut self, other: &PairMoments) {
        self.pairs += other.pairs;
        self.rate_total += other.rate_total;
        self.rate_squares += other.rate_squares;
        self.overlap_total += other.overlap_total;
    }

    fn mean(&self) -> Option<f64> {
        if self.pairs == 0 {
            None
        } else {
            Some(self.rate_total / self.pairs as f64)
        }
    }

    /// `Σ (p − m)²` around this class's own mean.
    fn spread(&self) -> f64 {
        match self.mean() {
            Some(mean) => (self.rate_squares - self.pairs as f64 * mean * mean).max(0.0),
            None => 0.0,
        }
    }
}

/// DESIGN section 2.9 over one whole snapshot.
///
/// This is the simulator's path and the tests': one sweep of the pairs, no recompute of
/// anybody, and an answer that is a function of the snapshot alone. Production never calls it —
/// there, each viewer's own recompute reports `PairTallies` and the database pools them into
/// `estimate_priors_from_tallies`.
pub fn estimate_priors(snapshot: &Snapshot, sample: &PriorSample) -> PriorEstimate {
    let classes = pair_moments(snapshot, sample);
    estimate_from_classes(&classes, sample.min_sample)
}

/// The same estimate over tallies somebody else summed: exactly what the pooling statement in
/// the database computes, so nothing has to read the whole graph.
///
/// **It is not the same estimator as `estimate_priors`.** The batch counts a pair once and
/// includes every pair with enough overlap; these tallies cover only the people a viewer's recompute
/// loaded, and count a pair once from each end. **This path is the definition** — DESIGN §2.9's
/// prior is over the pairs a recompute measures — and the batch is the simulator's cheaper
/// stand-in for it.
pub fn estimate_priors_from_tallies(tallies: &PairTallies, min_sample: usize) -> PriorEstimate {
    estimate_from_classes(&tallies.classes(), min_sample)
}

fn estimate_from_classes(classes: &[PairMoments; 3], min_sample: usize) -> PriorEstimate {
    let pairs: usize = classes.iter().map(|moments| moments.pairs).sum();
    let overlap_total: f64 = classes.iter().map(|moments| moments.overlap_total).sum();
    let mean_overlap = if pairs == 0 {
        0.0
    } else {
        overlap_total / pairs as f64
    };
    let class_prior = |class: DistanceClass| {
        let moments = classes[class.index()];
        if moments.pairs >= min_sample {
            moments.mean()
        } else {
            None
        }
    };

    PriorEstimate {
        kappa: pooled_pseudocount(classes, mean_overlap, min_sample),
        a0: DistancePriors {
            d1: class_prior(DistanceClass::Friend),
            d2: class_prior(DistanceClass::FriendOfFriend),
            d3plus: class_prior(DistanceClass::Distant),
        },
        samples: PriorSamples {
            d1: classes[0].pairs,
            d2: classes[1].pairs,
            d3plus: classes[2].pairs,
            pairs,
            mean_overlap,
        },
    }
}

/// Every `stride`-th user, so the sample is a function of the snapshot and nothing else.
fn sampled_users(user_count: usize, wanted: usize) -> Vec<UserId> {
    if wanted == 0 || user_count == 0 {
        return Vec::new();
    }
    let stride = user_count.div_ceil(wanted).max(1);
    (0..user_count)
        .step_by(stride)
        .map(|index| UserId(index as u32))
        .collect()
}

/// The pairs' rates `(1 + λ̂)/2`, by distance class, over the sampled viewers' pairs.
///
/// Distance is read off the graph directly instead of by a breadth-first search per viewer:
/// there are three classes, so all that is needed is who is a friend, who is a friend of one,
/// and everybody else, unreachable included.
fn pair_moments(snapshot: &Snapshot, sample: &PriorSample) -> [PairMoments; 3] {
    let viewers = sampled_users(snapshot.user_count(), sample.pair_viewers);
    let mut is_sampled = vec![false; snapshot.user_count()];
    for &viewer in &viewers {
        is_sampled[viewer.index()] = true;
    }

    let rates = item_rates(snapshot);
    let mut classes = [PairMoments::default(); 3];
    let mut class_of = vec![DistanceClass::Distant; snapshot.user_count()];
    for &viewer in &viewers {
        for &friend in snapshot.friends(viewer) {
            class_of[friend.index()] = DistanceClass::Friend;
        }
        for &friend in snapshot.friends(viewer) {
            for &second in snapshot.friends(friend) {
                if second != viewer && class_of[second.index()] == DistanceClass::Distant {
                    class_of[second.index()] = DistanceClass::FriendOfFriend;
                }
            }
        }

        for other in snapshot.users() {
            // A pair with two sampled viewers in it is one pair, not two.
            if other == viewer || (is_sampled[other.index()] && other < viewer) {
                continue;
            }
            let counts = shared_item_chances(
                snapshot.ratings(viewer),
                snapshot.ratings(other),
                |item, mine, theirs| match_chance(&rates, item, mine, theirs),
            );
            if counts.overlap() < sample.min_overlap {
                continue;
            }
            let (rate, weight) = counts.rate_and_weight();
            classes[class_of[other.index()].index()].add(rate, weight);
        }

        for other in snapshot.users() {
            class_of[other.index()] = DistanceClass::Distant;
        }
    }
    classes
}

/// `κ` from the excess of the observed spread of the rates over what sampling alone would
/// produce, pooled across the three classes (DESIGN §2.9).
///
/// A Beta-binomial proportion over `n̄` trials has variance `m(1−m)(1 + (n̄−1)/(κ+1))/n̄`, so the
/// ratio of the observed variance to the sampling variance `m(1−m)/n̄` pins `κ` down; `n̄` is the
/// mean of the pairs' weights, which is what makes a rate `(1 + λ̂)/2` behave like that
/// proportion. Each class
/// is centred on its own mean before pooling — the difference *between* the classes is a
/// difference of means, and counting it here would read it as noise.
///
/// No excess at all means the population is as uniform as chance would make it look, which is
/// evidence for an arbitrarily strong prior rather than for any particular one: that is `None`,
/// and the table's `8` stands.
fn pooled_pseudocount(
    classes: &[PairMoments; 3],
    mean_overlap: f64,
    min_sample: usize,
) -> Option<f64> {
    let pairs: usize = classes.iter().map(|moments| moments.pairs).sum();
    if pairs < min_sample || mean_overlap <= 1.0 {
        return None;
    }
    let observed = classes.iter().map(|moments| moments.spread()).sum::<f64>() / pairs as f64;
    let sampling = classes
        .iter()
        .filter_map(|moments| {
            let mean = moments.mean()?;
            Some(moments.pairs as f64 * mean * (1.0 - mean))
        })
        .sum::<f64>()
        / pairs as f64
        / mean_overlap;
    if observed <= sampling || sampling <= 0.0 {
        return None;
    }
    let pseudocount = (mean_overlap - 1.0) * sampling / (observed - sampling) - 1.0;
    if pseudocount.is_finite() && pseudocount > 0.0 {
        Some(pseudocount)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_field_leaves_the_table_alone() {
        let table = Params::default();
        let estimate = PriorEstimate {
            kappa: Some(12.5),
            a0: DistancePriors {
                d1: None,
                d2: Some(0.55),
                d3plus: Some(0.49),
            },
            ..PriorEstimate::default()
        };
        let merged = estimate.merge(&table);
        assert_eq!(merged.prior_strength, 12.5);
        assert_eq!(merged.prior_agreement, table.prior_agreement);
        assert_eq!(merged.clip, table.clip);
        let with_rate = PriorEstimate {
            a0: DistancePriors {
                d1: Some(0.7),
                ..DistancePriors::default()
            },
            ..PriorEstimate::default()
        };
        assert_eq!(with_rate.merge(&table).prior_agreement, 0.7);
        assert_eq!(with_rate.merge(&table).prior_strength, table.prior_strength);
    }

    /// The fields are read out of a stored row, so every one of them can hold a number the
    /// algorithm has no answer for. A merged table must always validate.
    #[test]
    fn a_value_out_of_range_is_not_an_estimate() {
        for (kappa, d1) in [(-1.0, 1.0), (f64::NAN, 0.0), (f64::INFINITY, f64::NAN)] {
            let refused = PriorEstimate {
                kappa: Some(kappa),
                a0: DistancePriors {
                    d1: Some(d1),
                    d2: Some(0.0),
                    d3plus: Some(f64::NAN),
                },
                ..PriorEstimate::default()
            };
            assert_eq!(refused.merge(&Params::default()), Params::default());
            assert_eq!(refused.merge(&Params::default()).validate(), Ok(()));
        }
    }

    fn counts(matches: f64, misses: f64, chance: f64) -> PairCounts {
        let overlap = matches + misses;
        PairCounts {
            agreements: matches,
            disagreements: misses,
            chance_total: overlap * chance,
            chance_squares: overlap * chance * chance,
        }
    }

    /// At a chance of one half the channel's rate is the plain share of matches and every thing is
    /// one fair coin, which is where the pooling statement's sampling term was right all along.
    #[test]
    fn at_even_chance_the_rate_is_the_share_of_matches() {
        for (matches, misses) in [(7.0, 3.0), (2.0, 10.0), (12.0, 0.0), (0.0, 12.0)] {
            let (rate, weight) = counts(matches, misses, 0.5).rate_and_weight();
            assert!((rate - matches / (matches + misses)).abs() < 1e-12);
            assert!((weight - (matches + misses)).abs() < 1e-9);
        }
    }

    /// Ten matches on things nine in ten people like say little: `λ̂ = 1`, but as noisy as two
    /// coins, not ten. One match in ten on them is an opposite.
    #[test]
    fn matches_chance_made_likely_count_for_little() {
        let (rate, weight) = counts(10.0, 0.0, 0.9).rate_and_weight();
        assert!((rate - 1.0).abs() < 1e-12);
        assert!((weight - 2.0).abs() < 1e-9, "{weight}");
        let (rate, _) = counts(9.0, 1.0, 0.9).rate_and_weight();
        assert!((rate - 0.5).abs() < 1e-12, "{rate}");
        let (rate, weight) = counts(1.0, 9.0, 0.9).rate_and_weight();
        assert!((rate - 1.0 / 18.0).abs() < 1e-12, "{rate}");
        assert!(weight.is_finite() && weight > 0.0);
    }

    #[test]
    fn the_sample_is_a_stride_over_the_user_list() {
        assert_eq!(sampled_users(4, 10).len(), 4);
        assert_eq!(sampled_users(100, 10), sampled_users(100, 10));
        assert_eq!(sampled_users(100, 10).len(), 10);
        assert_eq!(sampled_users(100, 10)[1], UserId(10));
        assert!(sampled_users(100, 0).is_empty());
    }
}
