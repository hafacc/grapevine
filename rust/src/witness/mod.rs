//! The witness model of DESIGN §2.
//!
//! For one viewer over the loaded neighbourhood: base rates, direct reliability, chains and
//! regions, own history under two caps, per-attribute reliability, region-pooled scores with a
//! starting point, certainty, attribute facts and filled gaps, the boundary for the loader's next
//! round, and the pair tallies. Every step is one pass over what was loaded, apart from the
//! linked share's EM over attribute pairs, and nothing is kept between calls.

pub mod chains;
pub mod channel;
pub mod circle;
pub mod facts;
pub mod score;
pub mod topics;

use std::collections::BTreeMap;

use crate::error::CoreError;
use crate::ids::{Ratable, TagId, UserId};
pub use crate::params::Params;
use crate::priors::{PairTallies, shared_item_chances, tally_pairs};
pub use crate::score::Score;
use crate::snapshot::Snapshot;
pub use facts::PairLink;

/// A person the snapshot names but whose connections were not loaded, and how strongly a chain
/// would reach them: `max |chain(w)| · |2a₀ − 1|` over their loaded neighbours `w`, the viewer
/// counting as a chain of one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoundaryNode {
    pub user: UserId,
    pub strength: f64,
}

/// What one viewer gets back.
#[derive(Clone, Debug, PartialEq)]
pub struct UserResult {
    pub viewer: UserId,
    /// Every item and tag anyone reached rated, and every filled gap, in ratable order. There is
    /// no floor: certainty orders, it does not hide.
    pub scores: BTreeMap<Ratable, Score>,
    /// People with a non-zero chain.
    pub reached: usize,
    /// Strongest first, ties by user.
    pub boundary: Vec<BoundaryNode>,
    /// This viewer's contribution to the population's `κ` and `a₀` (DESIGN §2.9).
    pub pairs: PairTallies,
}

/// Everything per person, for tests.
#[derive(Clone, Debug, PartialEq)]
pub struct UserDetail {
    pub result: UserResult,
    /// Per person, by `UserId::index`: the strongest chain's signed reliability; zero for the
    /// viewer and anyone no chain reached.
    pub chain: Vec<f64>,
    /// Per person: the directly trusted person heading their region.
    pub region: Vec<Option<UserId>>,
    /// Per person: the reliability their item thumbs are read at overall, after the cap.
    pub reliability: Vec<f64>,
    /// Per person: reliability on things carrying each attribute, after the cap.
    pub attribute_reliability: Vec<BTreeMap<TagId, f64>>,
    /// Per attribute and region head: the `κ_a` chosen.
    pub attribute_strength: BTreeMap<(TagId, UserId), f64>,
    /// Every attribute pair co-tagged in reach, `(a, b)` with `a < b`.
    pub pairs: BTreeMap<(TagId, TagId), PairLink>,
    /// The share of linked pairs, by empirical Bayes.
    pub linked_share: f64,
    /// `λ_fact`, the one reliability every attribute thumb is read at.
    pub fact_reliability: f64,
}

/// Everything DESIGN §2 says about one viewer, per person.
pub fn compute_user_detail(
    snapshot: &Snapshot,
    viewer: UserId,
    params: &Params,
) -> Result<UserDetail, CoreError> {
    params.validate()?;
    if viewer.index() >= snapshot.user_count() {
        return Err(CoreError::UnknownUser {
            name: format!("#{}", viewer.0),
        });
    }
    let circle = circle::Circle::of(snapshot, viewer);
    let rates = circle::BaseRates::over(snapshot, &circle);
    let found = chains::chains(snapshot, viewer, &rates, &circle, params);
    let attributes = topics::attributes_of(snapshot, &circle);
    let topical = topics::topical(snapshot, &found, &attributes, params);
    let reliability_on =
        |user: UserId, item| topical.reliability_on(&found, &attributes, user, item);
    let mut scores = score::item_scores(snapshot, viewer, &rates, &found, &reliability_on, params);
    let facts = facts::facts(snapshot, viewer, &circle, &found, params);
    scores.extend(facts.scores);
    for score in scores.values() {
        for value in [score.score, score.confidence] {
            if !value.is_finite() {
                return Err(CoreError::Divergent { viewer, value });
            }
        }
    }

    let reached = snapshot
        .users()
        .filter(|&user| {
            user != viewer && found.is_reached(user) && found.chain[user.index()] != 0.0
        })
        .count();
    let prior = params.prior_reliability().abs();
    let mut strength: BTreeMap<UserId, f64> = BTreeMap::new();
    for near in snapshot.users() {
        if !snapshot.is_loaded(near) {
            continue;
        }
        let through = if near == viewer {
            1.0
        } else {
            found.chain[near.index()].abs()
        };
        for &far in snapshot.friends(near) {
            if snapshot.is_loaded(far) {
                continue;
            }
            let entry = strength.entry(far).or_insert(0.0);
            *entry = entry.max(through * prior);
        }
    }
    let mut boundary: Vec<BoundaryNode> = strength
        .into_iter()
        .map(|(user, strength)| BoundaryNode { user, strength })
        .collect();
    boundary.sort_by(|left, right| {
        right
            .strength
            .total_cmp(&left.strength)
            .then(left.user.cmp(&right.user))
    });

    let pairs = tally_pairs(
        snapshot
            .users()
            .filter(|&other| other != viewer && circle.is_counted(other))
            .map(|other| {
                let counts = shared_item_chances(
                    snapshot.ratings(viewer),
                    snapshot.ratings(other),
                    |item, mine, theirs| {
                        let up = rates.up(item, &[(viewer, mine), (other, theirs)]);
                        if mine > 0 { up } else { 1.0 - up }
                    },
                );
                (Some(circle.hops[other.index()]), counts)
            }),
    );

    Ok(UserDetail {
        result: UserResult {
            viewer,
            scores,
            reached,
            boundary,
            pairs,
        },
        region: found
            .region
            .iter()
            .map(|&head| (head != chains::NONE).then_some(UserId(head)))
            .collect(),
        chain: found.chain,
        reliability: found.reliability,
        attribute_reliability: topical.reliability,
        attribute_strength: topical.strength,
        pairs: facts.pairs,
        linked_share: facts.linked_share,
        fact_reliability: facts.reliability,
    })
}

/// One viewer's result.
pub fn compute_user(
    snapshot: &Snapshot,
    viewer: UserId,
    params: &Params,
) -> Result<UserResult, CoreError> {
    compute_user_detail(snapshot, viewer, params).map(|detail| detail.result)
}

/// Every viewer in the snapshot, for tests and the simulator.
pub fn compute_all(snapshot: &Snapshot, params: &Params) -> Result<Vec<UserResult>, CoreError> {
    snapshot
        .users()
        .map(|viewer| compute_user(snapshot, viewer, params))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_viewer_outside_the_snapshot_is_refused() {
        let snapshot = Snapshot::builder().build();
        assert!(matches!(
            compute_user(&snapshot, UserId(0), &Params::default()),
            Err(CoreError::UnknownUser { .. })
        ));
    }

    #[test]
    fn a_table_the_model_has_no_answer_for_is_refused() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let snapshot = builder.build();
        let params = Params {
            prior_strength: 0.0,
            ..Params::default()
        };
        assert!(matches!(
            compute_user(&snapshot, viewer, &params),
            Err(CoreError::InvalidParameter { .. })
        ));
    }

    #[test]
    fn the_boundary_is_every_unloaded_neighbour_strongest_first() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let near = builder.user("near");
        let far = builder.user("far");
        let next = builder.user("next");
        builder
            .edge(viewer, friend)
            .edge(viewer, near)
            .edge(friend, far)
            .edge(far, next)
            .set_loaded(near, false)
            .set_loaded(far, false)
            .set_loaded(next, false);
        let snapshot = builder.build();
        let detail = compute_user_detail(&snapshot, viewer, &Params::default()).expect("finite");
        let prior = Params::default().prior_reliability();
        let found: Vec<(UserId, f64)> = detail
            .result
            .boundary
            .iter()
            .map(|node| (node.user, node.strength))
            .collect();
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!(found[0].0, near);
        assert!((found[0].1 - prior).abs() < 1e-12);
        assert_eq!(found[1].0, far);
        assert!((found[1].1 - detail.chain[friend.index()].abs() * prior).abs() < 1e-12);
        assert_eq!(detail.result.reached, 1);
        assert_eq!(detail.region[friend.index()], Some(friend));
        assert_eq!(detail.region[near.index()], None);
    }

    #[test]
    fn the_tallies_count_people_with_ten_things_shared() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let other = builder.user("other");
        builder.edge(viewer, friend).edge(friend, other);
        for index in 0..12 {
            let item = Ratable::Item(builder.item(&format!("i{index}")));
            builder.rate(viewer, item, 1).rate(friend, item, 1);
            if index < 10 {
                builder.rate(other, item, if index < 5 { 1 } else { -1 });
            }
        }
        let snapshot = builder.build();
        let result = compute_user(&snapshot, viewer, &Params::default()).expect("finite");
        assert_eq!(result.pairs.d1.pairs, 1);
        assert!((result.pairs.d1.rate_total - 1.0).abs() < 1e-12);
        assert!((result.pairs.d1.overlap_total - 12.0).abs() < 1e-12);
        // Against the friend's ups, a match with the viewer had chance 2/3 on each item, so half
        // matching is `λ̂ = ½ / ⅔ − 1 = −¼` and a rate of 3/8, as noisy as 50/3 fair coins.
        assert_eq!(result.pairs.d2.pairs, 1);
        assert!((result.pairs.d2.rate_total - 0.375).abs() < 1e-12);
        assert!((result.pairs.d2.overlap_total - 50.0 / 3.0).abs() < 1e-9);
    }
}
