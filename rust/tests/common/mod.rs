//! Helpers shared by the property suites.

#![allow(dead_code)]

use grapevine_core::{
    ItemId, Params, Ratable, Snapshot, UserDetail, UserId, UserResult, compute_all, compute_user,
    compute_user_detail,
};

/// Every computation in the suites goes through these three, so that a `CoreError` fails the
/// test that produced it instead of being handled away: a non-finite score is an error and never
/// a result, and in a test that means a panic with the error in it.
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

/// A viewer with `friend_count` friends and no other edges, and sixteen items nobody has rated.
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
