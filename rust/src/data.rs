//! The boundary form of everything: string ids, plain maps, one JSON document.
//!
//! The core works in interned integers; callers — the Edge Function, the examples, the
//! seeding scripts — work in the string ids the database stores.
//!
//! This is also where a snapshot is *sanitized*. The `ratings` row constraints refuse most of
//! what follows, but a schema is a thing that changes, and a crafted `1.5`, `true` or a key with
//! a control character in it must not fail the recompute of every viewer within reach of its
//! author. So nothing here refuses: a value that is not exactly `±1` or `±2` (the order bit)
//! and a key whose halves are not usable ids are dropped, and the rest of the snapshot computes.

use std::collections::{BTreeMap, BTreeSet};

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

use crate::ids::{RATABLE_JOIN, Ratable, UserId, is_normalized_id};
use crate::priors::PairTallies;
use crate::sim::{World, WorldConfig};
use crate::snapshot::Snapshot;
use crate::witness::UserResult;

/// One rating exactly as it arrived, before anything decides whether it is a thumb.
///
/// Deserialization accepts whatever JSON (or JavaScript) holds and keeps it as a number, with
/// everything that is not one becoming `NaN` — which is not `1` or `-1`, so it drops out at
/// `thumb`. The alternative, a typed `i8`, makes the *deserializer* the thing that fails, and it
/// fails for the viewer rather than for the account that wrote the value.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RatingValue(f64);

impl RatingValue {
    /// The thumb, `1` or `-1`, and nothing else. `2` and `-2` are the same thumbs marked as
    /// given after the viewer's own thumb on the same thing (DESIGN section 3.4): the order is
    /// all the neighbourhood says about time, one bit per rating and never a clock.
    pub fn thumb(self) -> Option<i8> {
        if self.0 == 1.0 || self.0 == 2.0 {
            Some(1)
        } else if self.0 == -1.0 || self.0 == -2.0 {
            Some(-1)
        } else {
            None
        }
    }

    /// Whether this thumb was given after the viewer's own on the same thing.
    pub fn is_later(self) -> bool {
        self.0 == 2.0 || self.0 == -2.0
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
        // `±2` stays `±2`: the order bit is part of the value.
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

/// A friend graph and everyone's ratings, as the loader read them.
///
/// Adjacency arrives *directed*, one list per node whose own row was read, because the loader stops
/// at a budget: a loaded node names people nobody loaded, and their side of the edge is simply not
/// in the snapshot. An edge survives only where both endpoints name each other, or where one of
/// them was never read (DESIGN section 3.4).
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
    /// Undirected pairs, taken as given with no reciprocity check: a test's shorthand for
    /// `friend_ids`.
    pub edges: Vec<(String, String)>,
    /// user id to ratable — the item id, or the item id and the tag joined by `RATABLE_JOIN` —
    /// to `1` or `-1`, or `2` or `-2` for a thumb given after the viewer's own, before
    /// sanitizing.
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

/// A person whose connections were not loaded, and how strongly a chain would reach them: the
/// loader reads the strongest next (DESIGN section 3.4).
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BoundaryNodeData {
    pub id: String,
    pub strength: f64,
}

/// What one viewer's recompute returns.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ResultData {
    pub viewer: String,
    /// People with a non-zero chain.
    pub reached: usize,
    /// Strongest first. The loader reads those with `strength > 0` while `N_max` has room.
    pub boundary_nodes: Vec<BoundaryNodeData>,
    /// DESIGN section 2.9's per-viewer tallies. The caller stores them and a statement in the
    /// database pools them; nothing else reads them back.
    pub pairs: PairTallies,
    pub scores: BTreeMap<String, ScoreData>,
}

/// A simulated world, ground truth included, as `dump-world` writes it.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct WorldData {
    pub seed: u64,
    pub config: WorldConfig,
    /// Every thumb as `±1`: the world is nobody's view of it, so it carries no viewer's bit.
    pub snapshot: SnapshotData,
    /// User id to ratable key to when that thumb was given, as an order (`Snapshot::stamps`); an
    /// absent thumb has stamp zero. This is what the loader's `±2` is read from, as `rated_at`
    /// is in the database, and seeding writes it there in the same order, so a seeded stack and
    /// `WorldData::to_snapshot` agree on every viewer's bit.
    pub stamps: BTreeMap<String, BTreeMap<String, u32>>,
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
        self.build(None)
    }

    /// `to_snapshot`, with each thumb's order taken from `stamps` when given, in place of the
    /// viewer's bit.
    fn build(&self, stamps: Option<&BTreeMap<String, BTreeMap<String, u32>>>) -> Snapshot {
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
                // An edge to a node nobody read is a boundary edge: the model reports it for the
                // loader's next round, and refusing it would hide reach rather than verify it.
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
                let stamp = match stamps {
                    Some(given) => given
                        .get(name)
                        .and_then(|owned| owned.get(ratable_name))
                        .copied()
                        .unwrap_or(0),
                    // An order stamp relative to the viewer only: a thumb given after the
                    // viewer's sorts after it, everything else sorts with it.
                    None => {
                        if value.is_later() {
                            2
                        } else {
                            0
                        }
                    }
                };
                builder.rate_at(user, ratable, thumb, stamp);
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
    /// The boundary form as the loader sends it to `viewer`: `±2` for a thumb given after the
    /// viewer's own on the same thing, `±1` for every other (0015's `load_nodes`).
    pub fn to_data(&self, viewer: UserId) -> SnapshotData {
        self.data_with(|user, ratable, stamp| {
            user != viewer
                && self.rating(viewer, ratable).is_some()
                && stamp > self.stamp(viewer, ratable)
        })
    }

    fn data_with(&self, is_later: impl Fn(UserId, Ratable, u32) -> bool) -> SnapshotData {
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
                    .zip(self.stamps(user))
                    .map(|(&(ratable, value), &stamp)| {
                        let scale = if is_later(user, ratable, stamp) { 2 } else { 1 };
                        (self.ratable_name(ratable), RatingValue::from(value * scale))
                    })
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
            reached: result.reached,
            boundary_nodes: result
                .boundary
                .iter()
                .map(|node| BoundaryNodeData {
                    id: self.user_name(node.user).to_string(),
                    strength: node.strength,
                })
                .collect(),
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
            snapshot: self.snapshot.data_with(|_, _, _| false),
            stamps: self
                .snapshot
                .users()
                .map(|user| {
                    let owned = self
                        .snapshot
                        .ratings(user)
                        .iter()
                        .zip(self.snapshot.stamps(user))
                        .filter(|&(_, &stamp)| stamp != 0)
                        .map(|(&(ratable, _), &stamp)| (self.snapshot.ratable_name(ratable), stamp))
                        .collect();
                    (self.snapshot.user_name(user).to_string(), owned)
                })
                .collect(),
            items: self
                .items()
                .map(|item| self.snapshot.item_name(item).to_string())
                .collect(),
            clusters: self.cluster_of.clone(),
            true_preference: self.true_preference.clone(),
        }
    }
}

impl WorldData {
    /// The world with every thumb's order, so any viewer's bit is the one a seeded stack gives.
    pub fn to_snapshot(&self) -> Snapshot {
        self.snapshot.build(Some(&self.stamps))
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
        // every one but the thumbs, with and without the order bit, has to come out as no
        // rating at all.
        for (document, thumb) in [
            ("1", Some(1)),
            ("-1", Some(-1)),
            ("1.0", Some(1)),
            ("2", Some(1)),
            ("-2", Some(-1)),
            ("2.0", Some(1)),
            ("3", None),
            ("-3", None),
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

    #[test]
    fn a_later_thumb_keeps_its_value_and_sorts_after_the_viewers() {
        let data = SnapshotData {
            users: vec!["u0".into(), "u1".into()],
            ratings: ratings(&[("u0", &[("i0", 1.0)]), ("u1", &[("i0", -2.0), ("i1", 2.0)])]),
            ..SnapshotData::default()
        };
        let snapshot = data.to_snapshot();
        let viewer = snapshot.user_id("u0").expect("u0");
        let other = snapshot.user_id("u1").expect("u1");
        let item = snapshot.ratable_id("i0").expect("i0");
        assert_eq!(snapshot.rating(other, item), Some(-1));
        assert!(snapshot.stamp(other, item) > snapshot.stamp(viewer, item));
    }

    fn result_of(snapshot: &Snapshot, viewer: &str) -> ResultData {
        let id = snapshot
            .user_id(viewer)
            .expect("the viewer is in every form");
        let result = crate::witness::compute_user(snapshot, id, &crate::params::Params::default())
            .unwrap_or_else(|error| panic!("{viewer}: {error}"));
        snapshot.result_data(&result)
    }

    /// A world leaves the crate in two forms: the dump, which keeps every stamp, and what the
    /// loader sends one viewer, which keeps only that viewer's bit. Both have to give each viewer
    /// the bits and the result of the snapshot they came from, or `check:recs-parity` compares
    /// two different questions.
    #[test]
    fn both_data_forms_keep_every_viewers_order() {
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
        let dumped = world.to_data(5).to_snapshot();
        let (mut later, mut earlier) = (0usize, 0usize);
        for viewer in original.users() {
            let viewer_name = original.user_name(viewer);
            let loaded = original.to_data(viewer).to_snapshot();
            for other in original.users().filter(|&other| other != viewer) {
                let other_name = original.user_name(other);
                for &(ratable, _) in original.ratings(other) {
                    if original.rating(viewer, ratable).is_none() {
                        continue;
                    }
                    let bit = original.stamp(other, ratable) > original.stamp(viewer, ratable);
                    if bit {
                        later += 1;
                    } else {
                        earlier += 1;
                    }
                    let key = original.ratable_name(ratable);
                    for (form, what) in [(&dumped, "dump"), (&loaded, "loaded")] {
                        let (Some(mine), Some(theirs), Some(thing)) = (
                            form.user_id(viewer_name),
                            form.user_id(other_name),
                            form.ratable_id(&key),
                        ) else {
                            panic!("{what}: {viewer_name}, {other_name} or {key:?} went missing");
                        };
                        assert_eq!(
                            form.stamp(theirs, thing) > form.stamp(mine, thing),
                            bit,
                            "{what}: {other_name}'s {key:?} against {viewer_name}'s"
                        );
                    }
                }
            }

            let expected = result_of(original, viewer_name);
            for (form, what) in [(&dumped, "dump"), (&loaded, "loaded")] {
                let got = result_of(form, viewer_name);
                assert_eq!(got.reached, expected.reached, "{what}: {viewer_name}");
                assert_eq!(
                    got.scores.keys().collect::<Vec<_>>(),
                    expected.scores.keys().collect::<Vec<_>>(),
                    "{what}: {viewer_name}"
                );
                for (key, score) in &expected.scores {
                    let theirs = got.scores[key];
                    assert!(
                        (theirs.score - score.score).abs() <= 1e-12
                            && (theirs.confidence - score.confidence).abs() <= 1e-12,
                        "{what}: {viewer_name}'s {key:?} is {theirs:?}, not {score:?}"
                    );
                }
            }
        }
        assert!(
            later > 0 && earlier > 0,
            "the world has to hold both orders: {later} later, {earlier} not"
        );
    }

    #[cfg(feature = "serde")]
    #[test]
    fn the_order_survives_json() {
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
        assert_eq!(
            (&read.snapshot, &read.stamps),
            (&dump.snapshot, &dump.stamps)
        );

        let viewer = world.snapshot.users().next().expect("a viewer");
        let loaded = world.snapshot.to_data(viewer);
        let read: SnapshotData =
            serde_json::from_str(&serde_json::to_string(&loaded).expect("a snapshot"))
                .expect("a snapshot reads back");
        assert_eq!(read, loaded);
        assert!(
            loaded
                .ratings
                .values()
                .flat_map(BTreeMap::values)
                .any(|value| value.is_later()),
            "somebody rated after the viewer"
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
            "u2 does not list u0 back, so that edge is dropped"
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
