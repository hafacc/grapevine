//! Pairwise taste alignment, DESIGN section 2.3.

use crate::ids::{Ratable, UserId};
use crate::params::Params;
use crate::snapshot::Snapshot;

/// How much the viewer should believe one other person, and the evidence behind it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Alignment {
    /// `A_{uv}`: informativeness-weighted agreements over items both rated.
    pub agreements: f64,
    /// `D_{uv}`: informativeness-weighted disagreements.
    pub disagreements: f64,
    /// `â_{uv}`: the shrunk agreement rate.
    pub estimate: f64,
    /// `ℓ_{uv}`: the clamped log-odds of `â`.
    pub weight: f64,
}

/// Log-odds, finite for any input strictly inside `(0, 1)`.
pub fn logit(probability: f64) -> f64 {
    (probability / (1.0 - probability)).ln()
}

/// Shrinks a weighted agreement count toward the prior for a given distance and takes the
/// clamped log-odds: the two steps of DESIGN section 2.3 that everything else reuses.
pub fn alignment_from_counts(
    agreements: f64,
    disagreements: f64,
    prior: f64,
    params: &Params,
) -> Alignment {
    let pseudocount = params.alignment_pseudocount;
    let estimate = (pseudocount * prior + agreements) / (pseudocount + agreements + disagreements);
    let clamp = params.alignment_clamp;
    Alignment {
        agreements,
        disagreements,
        estimate,
        weight: logit(estimate).clamp(-clamp, clamp),
    }
}

/// `â` and `ℓ` for everyone the walk reached, over **item** ratables only: a tag rating says
/// whether a restaurant is cheap, not whether two people share taste, so tags are scored
/// (section 2.6) but never counted here.
pub fn alignments(
    snapshot: &Snapshot,
    viewer: UserId,
    informativeness: &[f64],
    distances: &[Option<u32>],
    visit_mass: &[f64],
    params: &Params,
) -> Vec<Option<Alignment>> {
    let mut result = vec![None; snapshot.user_count()];
    for other in snapshot.users() {
        if other != viewer && visit_mass[other.index()] > 0.0 {
            result[other.index()] = Some(alignment_for(
                snapshot,
                viewer,
                other,
                informativeness,
                distances,
                params,
            ));
        }
    }
    result
}

/// The alignment between the viewer and one other person.
pub fn alignment_for(
    snapshot: &Snapshot,
    viewer: UserId,
    other: UserId,
    informativeness: &[f64],
    distances: &[Option<u32>],
    params: &Params,
) -> Alignment {
    let prior = params.prior(distances[other.index()].unwrap_or(u32::MAX));
    let (agreements, disagreements) = shared_item_counts(
        snapshot.ratings(viewer),
        snapshot.ratings(other),
        informativeness,
    );
    alignment_from_counts(agreements, disagreements, prior, params)
}

/// Weighted agreements and disagreements over the items both rating lists contain. Both lists
/// are sorted by ratable with items first, so one merge pass covers them.
pub(crate) fn shared_item_counts(
    mine: &[(Ratable, i8)],
    theirs: &[(Ratable, i8)],
    informativeness: &[f64],
) -> (f64, f64) {
    let mut agreements = 0.0;
    let mut disagreements = 0.0;
    let mut here = 0;
    let mut there = 0;
    while here < mine.len() && there < theirs.len() {
        let (my_ratable, my_value) = mine[here];
        let (their_ratable, their_value) = theirs[there];
        if !my_ratable.is_item() || !their_ratable.is_item() {
            break;
        }
        match my_ratable.cmp(&their_ratable) {
            std::cmp::Ordering::Less => here += 1,
            std::cmp::Ordering::Greater => there += 1,
            std::cmp::Ordering::Equal => {
                let weight = informativeness[my_ratable.item().index()];
                if my_value == their_value {
                    agreements += weight;
                } else {
                    disagreements += weight;
                }
                here += 1;
                there += 1;
            }
        }
    }
    (agreements, disagreements)
}
