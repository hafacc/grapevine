//! Scoring a ratable, DESIGN section 2.6.

use std::collections::BTreeMap;

use crate::alignment::Alignment;
use crate::ids::{Ratable, UserId};
use crate::params::Params;
use crate::snapshot::Snapshot;

/// What the viewer's network says about one ratable.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Score {
    /// `s_u(x) ∈ (−1, 1)`.
    pub score: f64,
    /// `W_u(x)`: how much weighted reach is behind it. Below `W_min` nothing is shown.
    pub confidence: f64,
}

/// `E`, `W` and `s` for every ratable anyone in reach has rated, unfiltered.
///
/// An item vote carries the rater's alignment; a tag vote asks a mostly factual question — is
/// this place cheap — so it carries no alignment at all and is weighted by reach mass alone.
pub fn score_ratables(
    snapshot: &Snapshot,
    viewer: UserId,
    visit_mass: &[f64],
    alignments: &[Option<Alignment>],
    params: &Params,
) -> BTreeMap<Ratable, Score> {
    let mut evidence: BTreeMap<Ratable, (f64, f64)> = BTreeMap::new();
    for rater in snapshot.users() {
        if rater == viewer {
            continue;
        }
        let mass = visit_mass[rater.index()];
        if mass <= 0.0 {
            continue;
        }
        let Some(alignment) = alignments[rater.index()] else {
            continue;
        };
        for &(ratable, value) in snapshot.ratings(rater) {
            let weight = match ratable {
                Ratable::Item(_) => alignment.weight,
                Ratable::Tag(..) => 1.0,
            };
            if weight == 0.0 {
                continue;
            }
            let entry = evidence.entry(ratable).or_insert((0.0, 0.0));
            entry.0 += mass * weight * f64::from(value);
            entry.1 += mass * weight.abs();
        }
    }
    evidence
        .into_iter()
        .map(|(ratable, (signed, total))| {
            (
                ratable,
                Score {
                    score: signed / (params.score_shrinkage + total),
                    confidence: total,
                },
            )
        })
        .collect()
}
