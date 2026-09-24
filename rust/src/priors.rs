//! Estimating `κ` and `a₀(d)` from the population, DESIGN section 2.10.
//!
//! `κ` and `a₀(d)` are moments of a distribution the data exhibits, not facts about the world,
//! so once enough people have rated enough things they can be read off the population instead
//! of chosen. Everything here is method of moments on one quantity the core already computes:
//! the agreement rate between a pair of people.
//!
//! Every recompute reports its own `PairTallies` over the pairs it had to align anyway, a
//! scheduled statement in the database adds them up, and `estimate_priors_from_tallies` is what
//! that statement computes. `estimate_priors` does the
//! same thing in one pass over a whole snapshot, which is the simulator's path and what the
//! pooled answer is checked against.
//!
//! Every field is separately `None` until its own sample is large enough, and a `None` field
//! means the table of section 2.8 stands for that field alone (`PriorEstimate::merge`). That is
//! what makes this safe on the first day: it can only ever replace a constant with a number it
//! had `N_min` observations for.

use crate::alignment::{Alignment, shared_item_counts};
use crate::ids::UserId;
use crate::informativeness::informativeness;
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

/// `a₀(d)` for the three distance classes of DESIGN section 2.3, each estimated on its own.
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
    /// Mean weighted overlap of those pairs: the `n̄` the moment equation uses.
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
    /// Fallback is per field and never wholesale: an estimate that read `a₀(1)` off thousands
    /// of pairs and saw ten pairs three hops out keeps the first and leaves the second at the
    /// table's `0.50`. A value outside the range `Params::validate` accepts is treated as no
    /// estimate at all — the row this came from is written by a database statement, but it is
    /// still a stored row, and a table that fails validation would fail every viewer's recompute
    /// rather than one field of one estimate.
    pub fn merge(&self, params: &Params) -> Params {
        let positive =
            |value: Option<f64>| value.filter(|number| number.is_finite() && *number > 0.0);
        let rate = |value: Option<f64>| {
            value.filter(|number| number.is_finite() && *number > 0.0 && *number < 1.0)
        };
        Params {
            alignment_pseudocount: positive(self.kappa).unwrap_or(params.alignment_pseudocount),
            prior_friend: rate(self.a0.d1).unwrap_or(params.prior_friend),
            prior_friend_of_friend: rate(self.a0.d2).unwrap_or(params.prior_friend_of_friend),
            prior_distant: rate(self.a0.d3plus).unwrap_or(params.prior_distant),
            ..*params
        }
    }
}

/// What one recompute has to say about the population's priors: DESIGN section 2.10's moments
/// over the pairs it already worked the alignment out for, by distance class.
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

/// One viewer's contribution, off the alignments their own recompute produced.
///
/// The rates here are weighted by the **viewer's** reach-local `ω` (section 2.2), where
/// `estimate_priors` weights by a population `ω`. Both are the same moment of the same
/// distribution and neither is the other's approximation, so the two land in the same place to
/// within sampling error and not exactly — which is what `tests/priors.rs` checks and the width
/// it has to allow.
pub fn tally_pairs(alignments: &[Option<Alignment>], distances: &[Option<u32>]) -> PairTallies {
    let mut tallies = PairTallies::default();
    for (index, entry) in alignments.iter().enumerate() {
        let Some(alignment) = entry else { continue };
        let overlap = alignment.agreements + alignment.disagreements;
        // Spelled out rather than `overlap < MIN_PAIR_OVERLAP`, which admits a `NaN` overlap and
        // poisons every tally pooled from it.
        if !overlap.is_finite() || overlap < MIN_PAIR_OVERLAP {
            continue;
        }
        let class = match distances.get(index).copied().flatten() {
            Some(0 | 1) => &mut tallies.d1,
            Some(2) => &mut tallies.d2,
            _ => &mut tallies.d3plus,
        };
        class.add(alignment.agreements / overlap, overlap);
    }
    tallies
}

/// The three classes of DESIGN section 2.3, which is all the distance an alignment prior sees.
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
    pub rate_total: f64,
    pub rate_squares: f64,
    /// `Σ (A + D)`, which `κ` needs for the mean overlap `n̄`: this divided by `pairs`.
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

/// DESIGN section 2.10 over one whole snapshot.
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
/// **It is not the same estimator as `estimate_priors`, and the gap is definitional rather
/// than sampling noise.** The batch weights every pair by `population_informativeness`, counts
/// a pair once, and includes every pair with enough overlap. These tallies come from
/// `tally_pairs` over one viewer's own alignments, so they are weighted by *that viewer's*
/// reach-weighted `ω`, cover only the pairs that viewer's walk reached, and count a pair once
/// from each end. The two agree where reach is wide enough that a viewer's `ω` approaches the
/// population's: measured, `a₀` lands within 0.02 at fifteen friends each and within 0.10 at
/// four. **This path is the definition**, not an approximation of the batch one — DESIGN
/// section 2.10's prior is over the pairs a recompute aligns — and `MIN_SAMPLE` bounds how many
/// pairs went in, not how far one viewer's `ω` may sit from the population's.
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

/// `ω` over the whole population: everybody's thumb counted once.
///
/// A viewer's own `ω` is reach-weighted, because what is contested is a question about the
/// people they can hear (section 2.2). A population moment belongs to nobody, so there is no
/// reach to weight by and one person is one vote. Sybils are not what this buys or loses: an
/// account with no edges moves nobody's `ω` inside the algorithm, and here it moves a prior
/// that is shared by everyone and bounded by `N_min` observations of it.
fn population_informativeness(snapshot: &Snapshot) -> Vec<f64> {
    match snapshot.users().next() {
        // The first user is only the one whose ratings are counted directly rather than through
        // the mass vector; both paths count them once, so the answer does not depend on which.
        Some(anyone) => informativeness(snapshot, anyone, &vec![1.0; snapshot.user_count()]),
        None => Vec::new(),
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

/// The observed agreement rates, by distance class, over the sampled viewers' pairs.
///
/// Distance is read off the graph directly instead of by a breadth-first search per viewer:
/// the prior has three classes, so all that is needed is who is a friend, who is a friend of
/// one, and everybody else — the same reading `Params::prior` gives an unreachable pair.
fn pair_moments(snapshot: &Snapshot, sample: &PriorSample) -> [PairMoments; 3] {
    let omega = population_informativeness(snapshot);
    let viewers = sampled_users(snapshot.user_count(), sample.pair_viewers);
    let mut is_sampled = vec![false; snapshot.user_count()];
    for &viewer in &viewers {
        is_sampled[viewer.index()] = true;
    }

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
            let (agreements, disagreements) =
                shared_item_counts(snapshot.ratings(viewer), snapshot.ratings(other), &omega);
            let overlap = agreements + disagreements;
            if overlap < sample.min_overlap {
                continue;
            }
            classes[class_of[other.index()].index()].add(agreements / overlap, overlap);
        }

        for other in snapshot.users() {
            class_of[other.index()] = DistanceClass::Distant;
        }
    }
    classes
}

/// `κ` from the excess of the observed spread of agreement rates over what sampling alone would
/// produce, pooled across the three classes (DESIGN section 2.10).
///
/// A Beta-binomial proportion over `n̄` trials has variance `m(1−m)(1 + (n̄−1)/(κ+1))/n̄`, so the
/// ratio of the observed variance to the sampling variance `m(1−m)/n̄` pins `κ` down. Each class
/// is centred on its own mean before pooling — the difference *between* the classes is `a₀(d)`,
/// and counting it here would read the prior's whole point as noise.
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
                d1: Some(0.7),
                d2: None,
                d3plus: Some(0.49),
            },
            ..PriorEstimate::default()
        };
        let merged = estimate.merge(&table);
        assert_eq!(merged.alignment_pseudocount, 12.5);
        assert_eq!(merged.prior_friend, 0.7);
        assert_eq!(merged.prior_friend_of_friend, table.prior_friend_of_friend);
        assert_eq!(merged.prior_distant, 0.49);
        assert_eq!(merged.error_budget, table.error_budget);
    }

    /// The fields are read out of a stored row, so every one of them can hold a number the
    /// algorithm has no answer for. A merged table must always validate.
    #[test]
    fn a_value_out_of_range_is_not_an_estimate() {
        let refused = PriorEstimate {
            kappa: Some(-1.0),
            a0: DistancePriors {
                d1: Some(1.0),
                d2: Some(0.0),
                d3plus: Some(f64::NAN),
            },
            ..PriorEstimate::default()
        };
        assert_eq!(refused.merge(&Params::default()), Params::default());
        assert_eq!(refused.merge(&Params::default()).validate(), Ok(()));
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
