//! Helpers shared by the property suites.

#![allow(dead_code)]

use grapevine_core::{
    ItemId, Params, Ratable, Snapshot, UserDetail, UserId, UserResult, Walk, affinity_of,
    compute_all, compute_user, compute_user_detail, walk,
};

/// Every computation in the suites goes through these four, so that a `CoreError` — a walk that
/// did not resolve — fails the test that produced it instead of being handled away. A
/// non-finite mass is an error and never a result; in a test that means a panic with the error
/// in it.
pub fn detail_of(snapshot: &Snapshot, viewer: UserId, params: &Params) -> UserDetail {
    match compute_user_detail(snapshot, viewer, params) {
        Ok(detail) => detail,
        Err(error) => panic!("computing for {}: {error}", viewer.0),
    }
}

pub fn result_of(snapshot: &Snapshot, viewer: UserId, params: &Params) -> UserResult {
    match compute_user(snapshot, viewer, params) {
        Ok(result) => result,
        Err(error) => panic!("computing for {}: {error}", viewer.0),
    }
}

pub fn all_of(snapshot: &Snapshot, params: &Params) -> Vec<UserResult> {
    match compute_all(snapshot, params) {
        Ok(results) => results,
        Err(error) => panic!("computing every viewer: {error}"),
    }
}

pub fn walk_of(snapshot: &Snapshot, viewer: UserId, affinity: &[f64], params: &Params) -> Walk {
    match walk(snapshot, viewer, affinity, params) {
        Ok(walked) => walked,
        Err(error) => panic!("walking for {}: {error}", viewer.0),
    }
}

/// `‖β^{(f)}‖₁`: everything the walk carries beyond one friend, injection excluded.
///
/// Measured by injecting at `friend` alone. The viewer is removed from every transition row and
/// the row renormalized, so the viewer's *own* edges appear in no row at all: dropping the
/// other injections changes which mass exists, never where any of it goes. Computing this
/// inside the walk instead costs a per-branch vector on every residual, which is an allocation
/// on the hot path of every push for a number only this suite reads.
pub fn branch_total_of(
    snapshot: &Snapshot,
    viewer: UserId,
    friend: UserId,
    affinity: &[f64],
    params: &Params,
) -> f64 {
    let mut builder = Snapshot::builder();
    for name in 0..snapshot.user_count() {
        builder.user(snapshot.user_name(UserId(name as u32)));
    }
    for user in snapshot.users() {
        for &other in snapshot.friends(user) {
            if user < other && !(user == viewer || other == viewer) {
                builder.edge(user, other);
            }
        }
    }
    builder.edge(viewer, friend);
    let alone = builder.build();
    let walked = walk_of(&alone, viewer, affinity, params);
    walked.visit_mass().iter().sum::<f64>() - 1.0
}

/// `logit(0.65)`: the weight of a direct friend the viewer has no shared ratings with, and the
/// unit that several of the bounds in DESIGN section 2.9 are quoted in.
pub fn fresh_friend_weight(params: &Params) -> f64 {
    grapevine_core::logit(params.prior_friend)
}

/// The score an item gets when exactly one fresh direct friend rates it `+1`.
pub fn fresh_friend_score(params: &Params) -> f64 {
    let weight = fresh_friend_weight(params);
    weight / (params.score_shrinkage + weight)
}

/// A viewer with `friend_count` friends and no other edges: every friend has `π̃ = 1` and
/// there is nothing beyond them.
pub fn star(friend_count: usize) -> (Snapshot, UserId, Vec<UserId>, Vec<ItemId>, usize) {
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let friends: Vec<UserId> = (0..friend_count)
        .map(|index| builder.user(&format!("f{index}")))
        .collect();
    for &friend in &friends {
        builder.edge(viewer, friend);
    }
    let items: Vec<ItemId> = (0..16)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let item_count = items.len();
    (builder.build(), viewer, friends, items, item_count)
}

/// Area under the ROC curve of `scores` against `labels`, by rank. Ties count as half.
pub fn auc(scored: &[(f64, bool)]) -> f64 {
    let positives = scored.iter().filter(|&&(_, label)| label).count();
    let negatives = scored.len() - positives;
    if positives == 0 || negatives == 0 {
        return 0.5;
    }
    let mut concordant = 0.0;
    for &(positive_score, positive_label) in scored {
        if !positive_label {
            continue;
        }
        for &(negative_score, negative_label) in scored {
            if negative_label {
                continue;
            }
            if positive_score > negative_score {
                concordant += 1.0;
            } else if positive_score == negative_score {
                concordant += 0.5;
            }
        }
    }
    concordant / (positives * negatives) as f64
}

pub fn assert_close(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: expected {expected}, got {actual} (tolerance {tolerance})"
    );
}

/// Every finite check the suites make on a result.
pub fn assert_finite(values: impl IntoIterator<Item = f64>, what: &str) {
    for value in values {
        assert!(value.is_finite(), "{what} produced {value}");
    }
}

pub fn item_ratable(snapshot: &Snapshot, name: &str) -> Ratable {
    Ratable::Item(
        snapshot
            .item_id(name)
            .unwrap_or_else(|| panic!("no item {name}")),
    )
}

/// `aff_u(y)` per user, as the last pass of a computation used it.
pub fn affinity_vector(detail: &UserDetail, _params: &Params) -> Vec<f64> {
    detail
        .alignments
        .iter()
        .map(|alignment| match alignment {
            Some(alignment) => affinity_of(alignment.weight),
            None => 1.0,
        })
        .collect()
}

/// `P_h(S)`: the largest share of a node's onward transitions that leads into `set`, over every
/// edge the non-backtracking walk could have entered that node by, under the affinity split of
/// DESIGN section 2.4. Stopping is left out of both halves, so this is a share of what goes
/// *anywhere*: the bound `π̃(S) ≤ π̃(h)·P_h(S)` already carries the `(1−α)·(1/α) = 1` that turns
/// it into a share of the mass.
pub fn largest_onward_share(
    snapshot: &Snapshot,
    node: UserId,
    set: &[UserId],
    viewer: UserId,
    affinity: &[f64],
) -> f64 {
    let neighbors = snapshot.friends(node);
    let weight = |next: UserId| affinity[next.index()];
    let mut largest: f64 = 0.0;
    for &came_from in neighbors {
        let onward: Vec<UserId> = neighbors
            .iter()
            .copied()
            .filter(|&next| next != came_from && next != viewer)
            .collect();
        let total: f64 = onward.iter().copied().map(weight).sum();
        if total <= 0.0 {
            continue;
        }
        let into_set: f64 = onward
            .iter()
            .filter(|next| set.contains(next))
            .copied()
            .map(weight)
            .sum();
        largest = largest.max(into_set / total);
    }
    largest
}
