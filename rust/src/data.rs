//! The boundary form of everything: string ids, plain maps, one JSON document.
//!
//! The core works in interned integers; callers — the browser, the examples — work in the
//! string ids the database stores.
//!
//! This is also where a snapshot is *sanitized*. The `ratings` row constraints refuse most of
//! what follows, but a schema is a thing that changes, and a crafted `1.5`, `true` or a key with
//! a control character in it must not fail the list of everyone who follows its author. So
//! nothing here refuses: a value that is not exactly `±1` and a key whose halves are not usable
//! ids are dropped, and the rest of the snapshot computes.

use std::collections::BTreeMap;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

use crate::ids::{RATABLE_JOIN, Ratable, is_normalized_id};
use crate::sim::{World, WorldConfig};
use crate::snapshot::Snapshot;
use crate::tensor::Fit;

/// One rating exactly as it arrived, before anything decides whether it is a thumb.
///
/// Deserialization accepts whatever JSON (or JavaScript) holds and keeps it as a number, with
/// everything that is not one becoming `NaN` — which is not `1` or `-1`, so it drops out at
/// `thumb`. The alternative, a typed `i8`, makes the *deserializer* the thing that fails, and it
/// fails for the viewer rather than for the account that wrote the value.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RatingValue(f64);

impl RatingValue {
    /// The thumb, `1` or `-1`, and nothing else.
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
            Some(_) => serializer.serialize_i8(self.0 as i8),
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

/// Who follows whom and everyone's thumbs, as the browser read them.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct SnapshotData {
    pub users: Vec<String>,
    /// Who each account follows. The browser sends one entry, the viewer's.
    pub follows: BTreeMap<String, Vec<String>>,
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
    /// One for a thing itself; for a tag on a thing, `score` on `(0, 1)`.
    pub applies: f64,
}

/// What one viewer's computation returns.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ResultData {
    pub viewer: String,
    pub scores: BTreeMap<String, ScoreData>,
    pub plot: PlotData,
}

/// The viewer's picture of how they depart from the accounts they follow
/// (`crate::tensor::Plot`): a point per thing and a point per attribute, whose inner product is
/// the viewer's score for the pair less what the accounts say of it.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct PlotData {
    /// As many numbers a point as the rank the result was computed at.
    pub things: BTreeMap<String, Vec<f64>>,
    /// By attribute; the empty name is liking the thing itself.
    pub attributes: BTreeMap<String, Vec<f64>>,
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
    /// Interns everything and drops every rating the core cannot read.
    pub fn to_snapshot(&self) -> Snapshot {
        let mut builder = Snapshot::builder();
        for name in &self.users {
            builder.user(name);
        }
        for (follower, followed) in &self.follows {
            let from = builder.user(follower);
            for name in followed {
                let to = builder.user(name);
                builder.follow(from, to);
            }
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
        builder.build()
    }
}

impl Snapshot {
    /// The boundary form of the whole snapshot.
    pub fn to_data(&self) -> SnapshotData {
        SnapshotData {
            users: self
                .users()
                .map(|user| self.user_name(user).to_string())
                .collect(),
            follows: self
                .users()
                .filter(|&user| !self.follows(user).is_empty())
                .map(|user| {
                    let followed = self
                        .follows(user)
                        .iter()
                        .map(|&other| self.user_name(other).to_string())
                        .collect();
                    (self.user_name(user).to_string(), followed)
                })
                .collect(),
            ratings: self
                .users()
                .map(|user| {
                    let owned = self
                        .ratings(user)
                        .iter()
                        .map(|&(ratable, value)| {
                            (self.ratable_name(ratable), RatingValue::from(value))
                        })
                        .collect();
                    (self.user_name(user).to_string(), owned)
                })
                .collect(),
        }
    }

    /// The boundary form of one result.
    pub fn result_data<const K: usize>(&self, fit: &Fit<K>) -> ResultData {
        let result = &fit.result;
        ResultData {
            viewer: self.user_name(result.viewer).to_string(),
            plot: PlotData {
                things: fit
                    .plot
                    .things
                    .iter()
                    .map(|(&item, point)| (self.item_name(item).to_string(), point.to_vec()))
                    .collect(),
                attributes: fit
                    .plot
                    .attributes
                    .iter()
                    .map(|(&tag, point)| {
                        let name = tag.map_or(String::new(), |tag| self.tag_name(tag).to_string());
                        (name, point.to_vec())
                    })
                    .collect(),
            },
            scores: result
                .scores
                .iter()
                .map(|(&ratable, score)| {
                    (
                        self.ratable_name(ratable),
                        ScoreData {
                            score: score.score,
                            confidence: score.confidence,
                            applies: score.applies,
                        },
                    )
                })
                .collect(),
        }
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
        // deserialize — a snapshot that fails here fails the list of everyone who follows its
        // author — and every one but the two thumbs has to come out as no rating at all.
        for (document, thumb) in [
            ("1", Some(1)),
            ("-1", Some(-1)),
            ("1.0", Some(1)),
            ("2", None),
            ("-2", None),
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

    /// The form a world leaves the crate in gives every viewer the result of the snapshot it
    /// came from.
    #[test]
    fn the_data_form_computes_what_the_snapshot_does() {
        let world = crate::sim::simulate(
            &crate::sim::WorldConfig {
                users: 30,
                items: 60,
                tag_rated_fraction: 0.3,
                ..crate::sim::WorldConfig::default()
            },
            &mut crate::rng::Rng::new(5),
        );
        let original = &world.snapshot;
        let read = world.to_data(5).snapshot.to_snapshot();
        for viewer in original.users() {
            let name = original.user_name(viewer);
            let options = crate::tensor::Options::default();
            let expected = crate::tensor::decompose::<3>(original, viewer, &options)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            let other = read.user_id(name).expect("the viewer is in both forms");
            let got = crate::tensor::decompose::<3>(&read, other, &options)
                .unwrap_or_else(|error| panic!("{name}: {error}"));
            // The data form interns in name order, so sums run in another order, and a fit that
            // differs in its last digits can stop a sweep apart: equal to what a sweep still
            // moves, not to the bit.
            let (expected, got) = (original.result_data(&expected), read.result_data(&got));
            assert_eq!(
                got.scores.keys().collect::<Vec<_>>(),
                expected.scores.keys().collect::<Vec<_>>(),
                "{name}"
            );
            for (key, score) in &expected.scores {
                let theirs = got.scores[key];
                assert!(
                    (theirs.score - score.score).abs() <= 1e-3
                        && (theirs.confidence - score.confidence).abs() <= 1e-9,
                    "{name}'s {key:?} is {theirs:?}, not {score:?}"
                );
            }
        }
    }

    #[cfg(feature = "serde")]
    #[test]
    fn a_world_survives_json() {
        let world = crate::sim::simulate(
            &crate::sim::WorldConfig {
                users: 12,
                items: 20,
                ..crate::sim::WorldConfig::default()
            },
            &mut crate::rng::Rng::new(3),
        );
        let dump = world.to_data(3);
        let read: WorldData = serde_json::from_str(&serde_json::to_string(&dump).expect("a dump"))
            .expect("a dump reads back");
        assert_eq!(read, dump);
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
                    ("i5", 2.0),
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
    fn following_is_read_one_way() {
        let data = SnapshotData {
            users: vec!["u0".into(), "u1".into()],
            follows: [("u0".to_string(), vec!["u1".to_string(), "u0".to_string()])]
                .into_iter()
                .collect(),
            ..SnapshotData::default()
        };
        let snapshot = data.to_snapshot();
        let viewer = snapshot.user_id("u0").expect("u0");
        let other = snapshot.user_id("u1").expect("u1");
        assert_eq!(snapshot.follows(viewer), &[other]);
        assert!(snapshot.follows(other).is_empty());
    }
}
