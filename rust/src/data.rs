//! The boundary form of everything: string ids, plain maps, one JSON document.
//!
//! The core works in interned integers; callers — the two Edge Functions, the examples, the
//! seeding scripts — work in the string ids the database stores.
//!
//! This is also where a snapshot is *sanitized*. The `ratings` row constraints refuse most of
//! what follows, but a schema is a thing that changes, and a crafted `1.5`, `true` or a key with
//! a control character in it must not fail the recompute of every viewer within reach of its
//! author. So nothing here refuses: a value that is not exactly `±1` and a key whose halves are
//! not usable ids are dropped, and the rest of the snapshot computes.

use std::collections::{BTreeMap, BTreeSet};

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

use crate::compute::UserResult;
use crate::ids::{RATABLE_JOIN, Ratable, is_normalized_id};
use crate::params::Params;
use crate::priors::PairTallies;
use crate::sim::{World, WorldConfig};
use crate::snapshot::Snapshot;
use crate::suggest::Suggestion;

/// One rating exactly as it arrived, before anything decides whether it is a thumb.
///
/// Deserialization accepts whatever JSON (or JavaScript) holds and keeps it as a number, with
/// everything that is not one becoming `NaN` — which is not `1` or `-1`, so it drops out at
/// `thumb`. The alternative, a typed `i8`, makes the *deserializer* the thing that fails, and it
/// fails for the viewer rather than for the account that wrote the value.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RatingValue(f64);

impl RatingValue {
    /// `1` or `-1`, and nothing else.
    pub fn thumb(self) -> Option<i8> {
        if self.0 == 1.0 {
            Some(1)
        } else if self.0 == -1.0 {
            Some(-1)
        } else {
            None
        }
    }
}

impl From<i8> for RatingValue {
    fn from(value: i8) -> Self {
        RatingValue(f64::from(value))
    }
}

impl From<f64> for RatingValue {
    fn from(value: f64) -> Self {
        RatingValue(value)
    }
}

#[cfg(feature = "serde")]
impl Serialize for RatingValue {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.thumb() {
            Some(thumb) => serializer.serialize_i8(thumb),
            None => serializer.serialize_f64(self.0),
        }
    }
}

#[cfg(feature = "serde")]
impl<'de> Deserialize<'de> for RatingValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use std::fmt;

        struct Anything;

        /// Everything that is not a number is a rating the core does not keep, so the visitor
        /// answers `NaN` for it instead of failing.
        impl<'de> serde::de::Visitor<'de> for Anything {
            type Value = RatingValue;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a rating")
            }

            fn visit_f64<E>(self, value: f64) -> Result<RatingValue, E> {
                Ok(RatingValue(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<RatingValue, E> {
                Ok(RatingValue(value as f64))
            }

            fn visit_u64<E>(self, value: u64) -> Result<RatingValue, E> {
                Ok(RatingValue(value as f64))
            }

            fn visit_bool<E>(self, _: bool) -> Result<RatingValue, E> {
                Ok(RatingValue(f64::NAN))
            }

            fn visit_str<E>(self, _: &str) -> Result<RatingValue, E> {
                Ok(RatingValue(f64::NAN))
            }

            fn visit_unit<E>(self) -> Result<RatingValue, E> {
                Ok(RatingValue(f64::NAN))
            }

            fn visit_none<E>(self) -> Result<RatingValue, E> {
                Ok(RatingValue(f64::NAN))
            }

            fn visit_some<D: serde::Deserializer<'de>>(
                self,
                deserializer: D,
            ) -> Result<RatingValue, D::Error> {
                deserializer.deserialize_any(Anything)
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut access: A,
            ) -> Result<RatingValue, A::Error> {
                while access.next_element::<serde::de::IgnoredAny>()?.is_some() {}
                Ok(RatingValue(f64::NAN))
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut access: A,
            ) -> Result<RatingValue, A::Error> {
                while access
                    .next_entry::<serde::de::IgnoredAny, serde::de::IgnoredAny>()?
                    .is_some()
                {}
                Ok(RatingValue(f64::NAN))
            }
        }

        deserializer.deserialize_any(Anything)
    }
}

/// A friend graph and everyone's ratings, as the loader read them.
///
/// Adjacency arrives *directed*, one list per node whose own row was read, because the walk stops
/// at a budget: a loaded node names people nobody loaded, and their side of the edge is simply not
/// in the snapshot. An edge survives only where both endpoints name each other, or where one of
/// them was never read (DESIGN section 3.4 step 1).
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct SnapshotData {
    pub users: Vec<String>,
    /// Who each node lists as a friend. One entry per node the loader read.
    pub friend_ids: BTreeMap<String, Vec<String>>,
    /// The nodes whose friend list was read. Everything else is a **boundary** node: present,
    /// able to rate, with unknown adjacency. An empty list means the whole graph was read, which
    /// is what a test or a simulated world hands over.
    pub loaded: Vec<String>,
    /// Undirected pairs, the form the simulator dumps and the examples read. Both endpoints of
    /// one of these list each other by construction, so nothing here needs reciprocity.
    pub edges: Vec<(String, String)>,
    /// user id to ratable — the item id, or the item id and the tag joined by `RATABLE_JOIN` —
    /// to `1` or `-1`, before sanitizing.
    pub ratings: BTreeMap<String, BTreeMap<String, RatingValue>>,
}

/// One ratable's result.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ScoreData {
    pub score: f64,
    pub confidence: f64,
}

/// A node the walk reached and could not expand, with the mass waiting on it.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BoundaryNodeData {
    pub id: String,
    pub residual: f64,
}

/// What one viewer's recompute returns.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ResultData {
    pub viewer: String,
    pub reach: usize,
    /// `π̃_u(v)` per reached person, which the caller stores against the hash of the adjacency
    /// it walked so an unchanged graph can be rescored rather than re-walked.
    pub reach_masses: BTreeMap<String, f64>,
    pub truncation: f64,
    /// What the unread nodes would have sent on, and where it sits — reported apart from
    /// `truncation` and not counted against `ε_total`. The loader reads these nodes and calls
    /// again while `N_max` has room (DESIGN section 3.4 step 4); past that, it is influence from
    /// beyond the nearest `N_max` people that the answer leaves out.
    pub boundary_residual: f64,
    pub boundary_nodes: Vec<BoundaryNodeData>,
    /// The largest movement of any score in the last pass of the settling loop, and whether
    /// the loop stopped on the tolerance or on the pass cap. The caller stores both and
    /// quantizes the bar to `max(truncation · L, settleMovement)`.
    pub settle_movement: f64,
    pub passes: usize,
    pub settled: bool,
    /// DESIGN section 2.10's per-viewer tallies. The caller stores them and a statement in the
    /// database pools them; nothing else reads them back.
    pub pairs: PairTallies,
    pub scores: BTreeMap<String, ScoreData>,
}

/// One suggestion at the boundary (DESIGN section 5.1).
///
/// Only `uid` reaches a viewer: the caller looks the name and handle up for itself, and the
/// attributes the two people agree on are asked for separately. `strength` and `overlap` exist so
/// the caller can log and the checks can assert on what it did. Neither is a number any screen
/// may render.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct SuggestionData {
    pub uid: String,
    pub strength: f64,
    pub overlap: f64,
}

/// The two parameter tables taste search runs at, as the wasm caller gives them.
///
/// Both are whole tables and both are optional: the deep walk defaults to the deep budget of
/// DESIGN section 2.8 and the live one to the on-demand budget, which is the pairing section 5.1
/// describes. A table that IS given falls back to the on-demand defaults field by field, so a
/// caller who wants the deep budget with one field moved has to say so.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct SuggestParamsData {
    pub deep: Option<Params>,
    pub live: Option<Params>,
}

impl SuggestParamsData {
    pub fn deep_params(&self) -> Params {
        self.deep.unwrap_or_else(Params::deep)
    }

    pub fn live_params(&self) -> Params {
        self.live.unwrap_or_default()
    }
}

/// A simulated world, ground truth included, as `dump-world` writes it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct WorldData {
    pub seed: u64,
    pub config: WorldConfig,
    pub snapshot: SnapshotData,
    pub items: Vec<String>,
    /// Which cluster each user was drawn from, in `snapshot.users` order.
    pub clusters: Vec<usize>,
    /// Noiseless preference per user per item, in `snapshot.users` and `items` order.
    pub true_preference: Vec<Vec<i8>>,
}

/// Is this boundary key one the core may intern?
///
/// The two halves are checked separately rather than one string parsed on a separator: an id is
/// free text, so the only thing that makes the join unforgeable is that no id may contain it.
/// A key carrying two joins therefore fails on its second half.
fn is_ratable(name: &str) -> bool {
    match name.split_once(RATABLE_JOIN) {
        Some((item, tag)) => is_normalized_id(item) && is_normalized_id(tag),
        None => is_normalized_id(name),
    }
}

impl SnapshotData {
    /// Interns everything, drops every rating the core cannot read, and keeps only the edges
    /// both endpoints agree on.
    pub fn to_snapshot(&self) -> Snapshot {
        let mut builder = Snapshot::builder();
        for name in &self.users {
            builder.user(name);
        }
        for (owner, friends) in &self.friend_ids {
            builder.user(owner);
            for friend in friends {
                builder.user(friend);
            }
        }
        for name in &self.loaded {
            builder.user(name);
        }

        let read: BTreeSet<&str> = if self.loaded.is_empty() {
            // No boundary: the whole graph is in hand, which is what a test world hands over.
            BTreeSet::new()
        } else {
            self.loaded.iter().map(String::as_str).collect()
        };
        let is_read = |name: &str| read.is_empty() || read.contains(name);
        let listed: BTreeMap<&str, BTreeSet<&str>> = self
            .friend_ids
            .iter()
            .map(|(owner, friends)| {
                (
                    owner.as_str(),
                    friends
                        .iter()
                        .map(String::as_str)
                        .collect::<BTreeSet<&str>>(),
                )
            })
            .collect();

        for (owner, friends) in &self.friend_ids {
            for friend in friends {
                // An edge to a node nobody read is a boundary edge: the walk will stop there and
                // report it, and refusing it would hide reach rather than verify it.
                let mutual = listed
                    .get(friend.as_str())
                    .is_some_and(|theirs| theirs.contains(owner.as_str()));
                if mutual || !is_read(friend) || !is_read(owner) {
                    let first = builder.user(owner);
                    let second = builder.user(friend);
                    builder.edge(first, second);
                }
            }
        }
        for (one, other) in &self.edges {
            let first = builder.user(one);
            let second = builder.user(other);
            builder.edge(first, second);
        }

        for (name, ratings) in &self.ratings {
            let user = builder.user(name);
            for (ratable_name, &value) in ratings {
                let Some(thumb) = value.thumb() else {
                    continue;
                };
                if !is_ratable(ratable_name) {
                    continue;
                }
                let ratable = builder.ratable(ratable_name);
                builder.rate(user, ratable, thumb);
            }
        }

        if !read.is_empty() {
            let unread: Vec<String> = builder
                .user_names()
                .iter()
                .filter(|name| !read.contains(name.as_str()))
                .cloned()
                .collect();
            for name in unread {
                let user = builder.user(&name);
                builder.set_loaded(user, false);
            }
        }
        builder.build()
    }
}

impl Snapshot {
    pub fn to_data(&self) -> SnapshotData {
        let friend_ids = self
            .users()
            .filter(|&user| !self.friends(user).is_empty())
            .map(|user| {
                let friends = self
                    .friends(user)
                    .iter()
                    .map(|&friend| self.user_name(friend).to_string())
                    .collect();
                (self.user_name(user).to_string(), friends)
            })
            .collect();
        let ratings = self
            .users()
            .map(|user| {
                let owned = self
                    .ratings(user)
                    .iter()
                    .map(|&(ratable, value)| (self.ratable_name(ratable), RatingValue::from(value)))
                    .collect();
                (self.user_name(user).to_string(), owned)
            })
            .collect();
        SnapshotData {
            users: self
                .users()
                .map(|user| self.user_name(user).to_string())
                .collect(),
            friend_ids,
            loaded: self
                .users()
                .filter(|&user| self.is_loaded(user))
                .map(|user| self.user_name(user).to_string())
                .collect(),
            edges: Vec::new(),
            ratings,
        }
    }

    /// The boundary form of one result.
    pub fn result_data(&self, result: &UserResult) -> ResultData {
        ResultData {
            viewer: self.user_name(result.viewer).to_string(),
            reach: result.reach,
            reach_masses: result
                .reach_masses
                .iter()
                .map(|&(user, mass)| (self.user_name(user).to_string(), mass))
                .collect(),
            truncation: result.truncation,
            boundary_residual: result.boundary_residual,
            boundary_nodes: result
                .boundary_nodes
                .iter()
                .map(|node| BoundaryNodeData {
                    id: self.user_name(node.user).to_string(),
                    residual: node.residual,
                })
                .collect(),
            settle_movement: result.settle_movement,
            passes: result.passes,
            settled: result.settled,
            pairs: result.pairs,
            scores: result
                .scores
                .iter()
                .map(|(&ratable, score)| {
                    (
                        self.ratable_name(ratable),
                        ScoreData {
                            score: score.score,
                            confidence: score.confidence,
                        },
                    )
                })
                .collect(),
        }
    }

    /// One viewer's suggestions in the string ids the database stores.
    pub fn suggestion_data(&self, suggestions: &[Suggestion]) -> Vec<SuggestionData> {
        suggestions
            .iter()
            .map(|suggestion| SuggestionData {
                uid: self.user_name(suggestion.user).to_string(),
                strength: suggestion.strength,
                overlap: suggestion.overlap,
            })
            .collect()
    }

    /// The ratable a boundary key names, if both halves are known here.
    pub fn ratable_id(&self, name: &str) -> Option<Ratable> {
        match name.split_once(RATABLE_JOIN) {
            Some((item_name, tag_name)) => {
                let item = self.item_id(item_name)?;
                let tag = self.tag_id(tag_name)?;
                Some(Ratable::Tag(item, tag))
            }
            None => self.item_id(name).map(Ratable::Item),
        }
    }
}

impl World {
    pub fn to_data(&self, seed: u64) -> WorldData {
        WorldData {
            seed,
            config: self.config.clone(),
            snapshot: self.snapshot.to_data(),
            items: self
                .items()
                .map(|item| self.snapshot.item_name(item).to_string())
                .collect(),
            clusters: self.cluster_of.clone(),
            true_preference: self.true_preference.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ratings(
        entries: &[(&str, &[(&str, f64)])],
    ) -> BTreeMap<String, BTreeMap<String, RatingValue>> {
        entries
            .iter()
            .map(|&(user, owned)| {
                (
                    user.to_string(),
                    owned
                        .iter()
                        .map(|&(name, value)| (name.to_string(), RatingValue(value)))
                        .collect(),
                )
            })
            .collect()
    }

    #[cfg(feature = "serde")]
    #[test]
    fn nothing_a_rating_map_can_hold_fails_the_boundary() {
        // Values a changed schema could let through, as JSON. Every one of them has to
        // deserialize — a snapshot that fails here fails the recompute of every viewer in reach of it — and
        // every one but the two thumbs has to come out as no rating at all.
        for (document, thumb) in [
            ("1", Some(1)),
            ("-1", Some(-1)),
            ("1.0", Some(1)),
            ("1.5", None),
            ("300", None),
            ("0", None),
            ("true", None),
            ("\"yes\"", None),
            ("null", None),
            ("[1]", None),
            ("{\"r\":1}", None),
        ] {
            let value: RatingValue = serde_json::from_str(document)
                .unwrap_or_else(|error| panic!("{document}: {error}"));
            assert_eq!(value.thumb(), thumb, "{document}");
        }
    }

    #[cfg(feature = "serde")]
    #[test]
    fn a_walk_report_crosses_the_boundary_whole_or_not_at_all() {
        use crate::compute::WalkReport;
        let report: WalkReport = serde_json::from_str(
            r#"{"truncation":0.01,"boundaryResidual":0.3,"settleMovement":2e-5,"passes":5,"settled":true}"#,
        )
        .expect("the report computeUser's result carries");
        assert_eq!(
            report,
            WalkReport {
                truncation: 0.01,
                boundary_residual: 0.3,
                settle_movement: 2e-5,
                passes: 5,
                settled: true,
            }
        );
        // A report missing a field is refused rather than defaulted: a rescore that invented
        // `settled: false` or a zero truncation would store a claim no walk made.
        assert!(
            serde_json::from_str::<WalkReport>(r#"{"truncation":0.01,"settleMovement":0}"#)
                .is_err()
        );
    }

    #[test]
    fn only_thumbs_and_usable_ids_survive() {
        let data = SnapshotData {
            users: vec!["u0".into(), "u1".into()],
            ratings: ratings(&[(
                "u1",
                &[
                    ("i0", 1.0),
                    ("i1", 1.5),
                    ("i2", 300.0),
                    ("i3", f64::NAN),
                    ("i4", -1.0),
                    ("", 1.0),
                    ("\u{0}cheap", 1.0),
                    ("a\u{0}b\u{0}c", 1.0),
                    ("caf\u{7}e", 1.0),
                ],
            )]),
            ..SnapshotData::default()
        };
        let snapshot = data.to_snapshot();
        let user = snapshot.user_id("u1").expect("u1 is in the snapshot");
        let kept: Vec<String> = snapshot
            .ratings(user)
            .iter()
            .map(|&(ratable, _)| snapshot.ratable_name(ratable))
            .collect();
        assert_eq!(kept, vec!["i0".to_string(), "i4".to_string()]);
    }

    /// A NUL-joined key splits back into the item and the tag it was built from, and no typed
    /// name can forge one. NFKC-normality is not tested here and is not meant to be: it is a
    /// database CHECK, and the crate carries no Unicode tables.
    #[test]
    fn the_nul_join_round_trips_and_cannot_be_forged() {
        let tagged = format!("café bleu{RATABLE_JOIN}late~night ☕");
        let data = SnapshotData {
            users: vec!["u0".into()],
            ratings: ratings(&[("u0", &[(tagged.as_str(), 1.0), ("a", 1.0)])]),
            ..SnapshotData::default()
        };
        let snapshot = data.to_snapshot();
        let ratable = snapshot.ratable_id(&tagged).expect("both halves interned");
        assert_eq!(snapshot.ratable_name(ratable), tagged);

        // An item `a` with tag `b` and an item literally named `a\0b` would be the same key, so
        // the second must never exist: the join is refused inside a half, here and in Postgres.
        assert!(!is_normalized_id(&format!("a{RATABLE_JOIN}b")));
        assert!(is_ratable(&format!("a{RATABLE_JOIN}b")));
        assert!(!is_ratable(&format!("a{RATABLE_JOIN}b{RATABLE_JOIN}c")));
    }

    #[test]
    fn an_edge_one_side_forgot_is_dropped() {
        let data = SnapshotData {
            users: vec!["u0".into(), "u1".into(), "u2".into(), "far".into()],
            friend_ids: [
                ("u0".to_string(), vec!["u1".to_string(), "u2".to_string()]),
                ("u1".to_string(), vec!["u0".to_string(), "far".to_string()]),
                ("u2".to_string(), Vec::new()),
            ]
            .into_iter()
            .collect(),
            loaded: vec!["u0".into(), "u1".into(), "u2".into()],
            ..SnapshotData::default()
        };
        let snapshot = data.to_snapshot();
        let viewer = snapshot.user_id("u0").expect("u0");
        let stale = snapshot.user_id("u2").expect("u2");
        let boundary = snapshot.user_id("far").expect("far");
        assert_eq!(
            snapshot.friends(viewer).len(),
            1,
            "u2 does not list u0 back, so that edge is not walkable"
        );
        assert!(!snapshot.friends(viewer).contains(&stale));
        assert!(
            snapshot.is_loaded(viewer) && !snapshot.is_loaded(boundary),
            "a node outside the loaded set has unknown adjacency"
        );
        let far_friend = snapshot.user_id("u1").expect("u1");
        assert!(
            snapshot.friends(far_friend).contains(&boundary),
            "an edge into an unread node is a boundary edge, not a stale one"
        );
    }
}
