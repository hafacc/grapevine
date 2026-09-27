//! The arithmetic of DESIGN section 2 on graphs small enough to work out by hand, what the data
//! boundary drops, and the boundary a partly loaded neighbourhood reports.

mod common;

use std::collections::BTreeMap;

use common::{all_of, assert_close, assert_finite, detail_of, result_of, star};
use grapevine_core::witness::channel::{answer_share, posterior, thumb_evidence};
use grapevine_core::{
    CoreError, ItemId, Params, Ratable, RatingValue, Rng, Snapshot, SnapshotData, UserId,
    WorldConfig, simulate,
};

/// The three-user graph the WebAssembly smoke script checks against: two friends, neither of
/// whom knows the other, both thumbing the same item up, and nobody sharing anything with the
/// viewer. Each friend is read at the prior, is their own region, and speaks at the thumb's
/// ratio against a base rate of `2/3` (the other two people's thumbs, Beta(1,1)).
#[test]
fn hand_computed_three_user_graph() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u0");
    let first = builder.user("u1");
    let second = builder.user("u2");
    let item = Ratable::Item(builder.item("i0"));
    builder
        .edge(viewer, first)
        .edge(viewer, second)
        .rate(first, item, 1)
        .rate(second, item, 1);
    let snapshot = builder.build();

    let detail = detail_of(&snapshot, viewer, &params);
    let lambda = posterior(&[], params.prior_agreement, params.prior_strength).mean;
    assert_close(
        detail.chain[first.index()],
        lambda,
        1e-12,
        "a friend with no history",
    );
    assert_close(lambda, 0.3, 0.01, "the grid's prior mean is 2a₀ − 1");
    let up = 2.0 / 3.0;
    let evidence = 2.0 * thumb_evidence(lambda, up, 1, params.clip);
    let rate = (1.0 + 2.0 * lambda) / (2.0 + 2.0 * lambda);
    let score = (((rate / (1.0 - rate)).ln() + evidence) / 2.0).tanh();
    let result = &detail.result;
    assert_close(result.scores[&item].score, score, 1e-12, "the score");
    assert_close(
        result.scores[&item].confidence,
        2.0 * answer_share(lambda, up, 1, (score + 1.0) / 2.0),
        1e-12,
        "W: each region's one thumb, at its chance of being the viewer's answer",
    );
    assert_close(
        result.scores[&item].score,
        0.624_306,
        1e-6,
        "the smoke script's number",
    );
    assert_eq!(result.reached, 2);
    assert!(result.boundary.is_empty());
}

/// Every ratable any reached person rated has an entry — items, tags — and nothing anyone
/// unreached rated does.
#[test]
fn every_rated_thing_is_shown_and_nothing_unreached() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("viewer");
    let friend = builder.user("friend");
    let far = builder.user("far");
    let stranger = builder.user("stranger");
    let item = builder.item("seen");
    let unseen = builder.item("unseen");
    let cheap = builder.tag("cheap");
    builder
        .edge(viewer, friend)
        .edge(friend, far)
        .rate(far, Ratable::Item(item), -1)
        .rate(friend, Ratable::Tag(item, cheap), 1)
        .rate(stranger, Ratable::Item(unseen), 1);
    let snapshot = builder.build();
    let result = result_of(&snapshot, viewer, &params);
    assert!(result.scores[&Ratable::Item(item)].score < 0.0);
    assert!(result.scores[&Ratable::Tag(item, cheap)].score > 0.0);
    assert!(!result.scores.contains_key(&Ratable::Item(unseen)));
    assert_eq!(result.reached, 2);
}

/// A viewer with no connections is an empty answer, not an error; so is one whose friends rated
/// nothing.
#[test]
fn nobody_to_hear_is_an_empty_answer() {
    let params = Params::default();
    let (snapshot, viewer, friends, items, _) = star(3);
    let result = result_of(&snapshot, viewer, &params);
    assert!(result.scores.is_empty());
    assert_eq!(result.reached, 3);
    let mut builder = snapshot.edit();
    let alone = builder.user("alone");
    builder.rate(friends[0], Ratable::Item(items[0]), 1);
    let snapshot = builder.build();
    let lonely = result_of(&snapshot, alone, &params);
    assert!(lonely.scores.is_empty());
    assert_eq!(lonely.reached, 0);
}

/// A dense friend triangle, every item contested, is finite and bounded: every score inside
/// `(−1, 1)` and no region worth more than one of the viewer's own thumbs.
#[test]
fn a_friend_triangle_stays_bounded() {
    let params = Params::default();
    let mut builder = Snapshot::builder();
    let viewer = builder.user("u");
    let items: Vec<ItemId> = (0..100)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let mine = |index: usize| if index.is_multiple_of(2) { 1 } else { -1 };
    for (index, &item) in items.iter().enumerate() {
        builder.rate(viewer, Ratable::Item(item), mine(index));
    }
    let friends: Vec<UserId> = (0..3)
        .map(|index| builder.user(&format!("f{index}")))
        .collect();
    for (index, &friend) in friends.iter().enumerate() {
        builder
            .edge(viewer, friend)
            .edge(friend, friends[(index + 1) % friends.len()]);
        let dissenter = builder.user(&format!("d{index}"));
        builder.edge(friend, dissenter);
        for (position, &item) in items.iter().enumerate() {
            builder
                .rate(friend, Ratable::Item(item), mine(position))
                .rate(dissenter, Ratable::Item(item), -mine(position));
        }
    }
    let snapshot = builder.build();
    let result = result_of(&snapshot, viewer, &params);
    for score in result.scores.values() {
        assert_finite([score.score, score.confidence], "the triangle");
        assert!(score.score.abs() < 1.0);
        assert!(score.confidence <= friends.len() as f64 + 1e-9);
    }
}

/// Same snapshot, same answer; and `compute_all` is each viewer's `compute_user`.
#[test]
fn determinism_and_compute_all() {
    let params = Params::default();
    let world = simulate(
        &WorldConfig {
            users: 40,
            items: 60,
            tag_rated_fraction: 0.2,
            attributes: 6,
            ..WorldConfig::default()
        },
        &mut Rng::new(5),
    );
    let every = all_of(&world.snapshot, &params);
    for (index, result) in every.iter().enumerate() {
        let viewer = UserId(index as u32);
        assert_eq!(result, &result_of(&world.snapshot, viewer, &params));
        assert_eq!(result, &result_of(&world.snapshot.clone(), viewer, &params));
        for score in result.scores.values() {
            assert_finite([score.score, score.confidence], "a simulated world");
            assert!(score.score.abs() < 1.0 && score.confidence >= 0.0);
        }
    }
}

/// What the data boundary accepts.
///
/// The core reads anything but `±1` (or `±2`, the same thumbs given after the viewer's) as absent,
/// and it has to do that by *dropping* the value rather than refusing the snapshot: one crafted
/// account inside a viewer's reach would otherwise fail that viewer's whole recompute, and every
/// viewer's within reach of it.
#[test]
fn the_data_boundary_drops_what_it_cannot_read() {
    let params = Params::default();
    let mut ratings: BTreeMap<String, BTreeMap<String, RatingValue>> = BTreeMap::new();
    let honest: BTreeMap<String, RatingValue> = [
        ("café bleu", RatingValue::from(1)),
        ("real-item", RatingValue::from(-1)),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value))
    .collect();
    ratings.insert("u1".to_string(), honest);
    let junk: BTreeMap<String, RatingValue> = [
        ("café bleu", 1.5),
        ("real-item", 300.0),
        ("other-item", f64::NAN),
        ("", 1.0),
        ("\u{0}cheap", 1.0),
        ("a\u{0}b\u{0}c", 1.0),
        ("caf\u{7}e", 1.0),
        ("two\nlines", 1.0),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), RatingValue::from(value)))
    .collect();
    ratings.insert("u2".to_string(), junk);
    let data = SnapshotData {
        users: vec!["u0".into(), "u1".into(), "u2".into()],
        edges: vec![("u0".into(), "u1".into()), ("u0".into(), "u2".into())],
        ratings,
        ..SnapshotData::default()
    };
    let snapshot = data.to_snapshot();
    let crafted = snapshot.user_id("u2").expect("u2 is in the snapshot");
    assert!(snapshot.ratings(crafted).is_empty());
    let viewer = snapshot.user_id("u0").expect("u0 is in the snapshot");
    let result = result_of(&snapshot, viewer, &params);
    let bleu = snapshot.ratable_id("café bleu").expect("u1 rated it");
    assert!(result.scores.contains_key(&bleu));

    // Every parameter DESIGN section 2.9 gives a range is refused outside it, at the boundary.
    for (name, broken) in [
        (
            "priorAgreement",
            Params {
                prior_agreement: 0.0,
                ..params
            },
        ),
        (
            "priorStrength",
            Params {
                prior_strength: -8.0,
                ..params
            },
        ),
        (
            "clip",
            Params {
                clip: f64::NAN,
                ..params
            },
        ),
    ] {
        match grapevine_core::compute_user(&snapshot, viewer, &broken) {
            Err(CoreError::InvalidParameter { name: refused, .. }) => assert_eq!(refused, name),
            other => panic!("{name} out of range was accepted: {other:?}"),
        }
    }
}

/// The partial graph of DESIGN section 3.4: a person whose friend list was never read is on the
/// boundary, at the strength a chain would reach them, and reading them moves it one hop out.
#[test]
fn partial_graph_reports_its_boundary() {
    let params = Params::default();
    let mut data = SnapshotData {
        users: vec!["u0".into(), "u1".into(), "u2".into(), "u3".into()],
        friend_ids: [
            ("u0", vec!["u1"]),
            ("u1", vec!["u0", "u2"]),
            ("u2", vec!["u1", "u3"]),
            ("u3", vec!["u2"]),
        ]
        .into_iter()
        .map(|(owner, friends)| {
            (
                owner.to_string(),
                friends.iter().map(|name| name.to_string()).collect(),
            )
        })
        .collect(),
        loaded: vec!["u0".into(), "u1".into()],
        ..SnapshotData::default()
    };
    let snapshot = data.to_snapshot();
    let viewer = snapshot.user_id("u0").expect("u0");
    let first = snapshot.user_id("u1").expect("u1");
    let frontier = snapshot.user_id("u2").expect("u2");
    let partial = detail_of(&snapshot, viewer, &params);
    assert_eq!(partial.result.boundary.len(), 1);
    assert_eq!(partial.result.boundary[0].user, frontier);
    assert_close(
        partial.result.boundary[0].strength,
        partial.chain[first.index()].abs() * params.prior_reliability(),
        1e-12,
        "the chain to the loaded neighbour times a link at its prior",
    );
    assert_eq!(partial.result.reached, 1, "an unread person is not reached");

    data.loaded.push("u2".into());
    let wider = data.to_snapshot();
    let second = result_of(&wider, viewer, &params);
    assert_eq!(second.boundary.len(), 1);
    assert_eq!(second.boundary[0].user, wider.user_id("u3").expect("u3"));
    assert!(second.boundary[0].strength < partial.result.boundary[0].strength);
    data.loaded.push("u3".into());
    let whole = data.to_snapshot();
    assert!(result_of(&whole, viewer, &params).boundary.is_empty());
}
