//! The input to every computation: a friend graph plus everyone's ratings.

use std::collections::HashMap;

use crate::graph::Graph;
use crate::ids::{ItemId, RATABLE_JOIN, Ratable, TagId, UserId};

/// A friend graph and the ratings of everyone in it, with all identifiers interned.
///
/// Nothing here is per viewer: the same snapshot answers for every user in it.
///
/// A user may be *unloaded*: present, nameable, and rateable, but with a friend list nobody has
/// read. That is a boundary node of DESIGN section 3.4 — reported for the loader's next round
/// rather than treated as a leaf, because a node with no friends and a node whose friends are
/// unknown are not the same answer. Everything a builder makes is loaded unless it says
/// otherwise.
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    user_names: Vec<String>,
    item_names: Vec<String>,
    tag_names: Vec<String>,
    adjacency: Vec<Vec<UserId>>,
    loaded: Vec<bool>,
    ratings: Vec<Vec<(Ratable, i8)>>,
    /// Beside each rating, when it was given, as an order and nothing more: a thumb with a
    /// larger stamp was given after one with a smaller. Zero is "no later than anything", which
    /// is what a snapshot without times holds, and what the boundary gives every thumb it does
    /// not mark as given after the viewer's own (DESIGN §2.3).
    stamps: Vec<Vec<u32>>,
}

impl Snapshot {
    pub fn builder() -> SnapshotBuilder {
        SnapshotBuilder::default()
    }

    pub fn user_count(&self) -> usize {
        self.user_names.len()
    }

    pub fn item_count(&self) -> usize {
        self.item_names.len()
    }

    pub fn users(&self) -> impl Iterator<Item = UserId> + use<> {
        (0..self.user_names.len() as u32).map(UserId)
    }

    /// The edges this snapshot knows about for `user`. For an unloaded user that is whatever
    /// their neighbours listed, not their own answer — `is_loaded` is what says which.
    pub fn friends(&self, user: UserId) -> &[UserId] {
        &self.adjacency[user.index()]
    }

    /// Whether this user's friend list was read. Chains run only through loaded people.
    pub fn is_loaded(&self, user: UserId) -> bool {
        self.loaded[user.index()]
    }

    /// One user's ratings, sorted by ratable, items before tags.
    pub fn ratings(&self, user: UserId) -> &[(Ratable, i8)] {
        &self.ratings[user.index()]
    }

    /// The order stamps of `ratings(user)`, position for position.
    pub fn stamps(&self, user: UserId) -> &[u32] {
        &self.stamps[user.index()]
    }

    /// When `user` rated `ratable`, as an order; zero when they did not, or when nobody knows.
    pub fn stamp(&self, user: UserId, ratable: Ratable) -> u32 {
        let owned = &self.ratings[user.index()];
        owned
            .binary_search_by_key(&ratable, |&(key, _)| key)
            .map_or(0, |position| self.stamps[user.index()][position])
    }

    pub fn rating(&self, user: UserId, ratable: Ratable) -> Option<i8> {
        let owned = &self.ratings[user.index()];
        owned
            .binary_search_by_key(&ratable, |&(key, _)| key)
            .ok()
            .map(|position| owned[position].1)
    }

    pub fn user_name(&self, user: UserId) -> &str {
        &self.user_names[user.index()]
    }

    pub fn item_name(&self, item: ItemId) -> &str {
        &self.item_names[item.index()]
    }

    pub fn tag_name(&self, tag: TagId) -> &str {
        &self.tag_names[tag.index()]
    }

    /// The one key per rated thing: the item id, or the item id and the tag joined by
    /// `RATABLE_JOIN`. This form is the core's and the wasm boundary's — never stored, never
    /// queried, never shown.
    pub fn ratable_name(&self, ratable: Ratable) -> String {
        match ratable {
            Ratable::Item(item) => self.item_name(item).to_string(),
            Ratable::Tag(item, tag) => format!(
                "{}{RATABLE_JOIN}{}",
                self.item_name(item),
                self.tag_name(tag)
            ),
        }
    }

    pub fn user_id(&self, name: &str) -> Option<UserId> {
        self.user_names
            .iter()
            .position(|candidate| candidate == name)
            .map(|index| UserId(index as u32))
    }

    pub fn item_id(&self, name: &str) -> Option<ItemId> {
        self.item_names
            .iter()
            .position(|candidate| candidate == name)
            .map(|index| ItemId(index as u32))
    }

    pub fn tag_id(&self, name: &str) -> Option<TagId> {
        self.tag_names
            .iter()
            .position(|candidate| candidate == name)
            .map(|index| TagId(index as u32))
    }

    /// A builder seeded with this snapshot, for adding users, edges or ratings to a world.
    pub fn edit(&self) -> SnapshotBuilder {
        let user_index = self
            .user_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.clone(), UserId(index as u32)))
            .collect();
        let item_index = self
            .item_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.clone(), ItemId(index as u32)))
            .collect();
        let tag_index = self
            .tag_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.clone(), TagId(index as u32)))
            .collect();
        SnapshotBuilder {
            user_names: self.user_names.clone(),
            item_names: self.item_names.clone(),
            tag_names: self.tag_names.clone(),
            adjacency: self.adjacency.clone(),
            loaded: self.loaded.clone(),
            ratings: self
                .ratings
                .iter()
                .zip(&self.stamps)
                .map(|(owned, stamps)| {
                    owned
                        .iter()
                        .zip(stamps)
                        .map(|(&(ratable, value), &stamp)| (ratable, value, stamp))
                        .collect()
                })
                .collect(),
            user_index,
            item_index,
            tag_index,
        }
    }
}

impl Graph for Snapshot {
    fn user_count(&self) -> usize {
        self.user_names.len()
    }

    fn neighbors(&self, user: UserId) -> Option<&[UserId]> {
        if self.loaded.get(user.index()).copied().unwrap_or(false) {
            self.adjacency.get(user.index()).map(Vec::as_slice)
        } else {
            None
        }
    }
}

/// Interns names and accumulates edges and ratings.
#[derive(Clone, Debug, Default)]
pub struct SnapshotBuilder {
    user_names: Vec<String>,
    item_names: Vec<String>,
    tag_names: Vec<String>,
    adjacency: Vec<Vec<UserId>>,
    loaded: Vec<bool>,
    ratings: Vec<Vec<(Ratable, i8, u32)>>,
    user_index: HashMap<String, UserId>,
    item_index: HashMap<String, ItemId>,
    tag_index: HashMap<String, TagId>,
}

impl SnapshotBuilder {
    pub fn user(&mut self, name: &str) -> UserId {
        if let Some(&existing) = self.user_index.get(name) {
            existing
        } else {
            let id = UserId(self.user_names.len() as u32);
            self.user_names.push(name.to_string());
            self.adjacency.push(Vec::new());
            self.loaded.push(true);
            self.ratings.push(Vec::new());
            self.user_index.insert(name.to_string(), id);
            id
        }
    }

    /// Every user interned so far, in id order.
    pub fn user_names(&self) -> &[String] {
        &self.user_names
    }

    pub fn item(&mut self, name: &str) -> ItemId {
        if let Some(&existing) = self.item_index.get(name) {
            existing
        } else {
            let id = ItemId(self.item_names.len() as u32);
            self.item_names.push(name.to_string());
            self.item_index.insert(name.to_string(), id);
            id
        }
    }

    pub fn tag(&mut self, name: &str) -> TagId {
        if let Some(&existing) = self.tag_index.get(name) {
            existing
        } else {
            let id = TagId(self.tag_names.len() as u32);
            self.tag_names.push(name.to_string());
            self.tag_index.insert(name.to_string(), id);
            id
        }
    }

    /// Adds a mutual friend edge. Self-loops and repeats are ignored.
    pub fn edge(&mut self, one: UserId, other: UserId) -> &mut Self {
        if one != other {
            self.adjacency[one.index()].push(other);
            self.adjacency[other.index()].push(one);
        }
        self
    }

    /// Marks a user's friend list as read or unread. An unread one makes them a boundary node
    /// (DESIGN section 3.4).
    pub fn set_loaded(&mut self, user: UserId, loaded: bool) -> &mut Self {
        self.loaded[user.index()] = loaded;
        self
    }

    /// Records a thumb. Anything but `1` or `-1` removes the rating rather than failing the
    /// build, so one crafted row cannot fail every recompute that reaches it.
    pub fn rate(&mut self, user: UserId, ratable: Ratable, value: i8) -> &mut Self {
        self.rate_at(user, ratable, value, 0)
    }

    /// Records a thumb with the order it was given in (`Snapshot::stamps`).
    pub fn rate_at(&mut self, user: UserId, ratable: Ratable, value: i8, stamp: u32) -> &mut Self {
        let owned = &mut self.ratings[user.index()];
        if value == 1 || value == -1 {
            owned.push((ratable, value, stamp));
        } else {
            owned.retain(|&(key, ..)| key != ratable);
        }
        self
    }

    /// Parses a `ratable_name` back into a ratable, interning both halves.
    pub fn ratable(&mut self, name: &str) -> Ratable {
        match name.split_once(RATABLE_JOIN) {
            Some((item_name, tag_name)) => {
                let item = self.item(item_name);
                let tag = self.tag(tag_name);
                Ratable::Tag(item, tag)
            }
            None => Ratable::Item(self.item(name)),
        }
    }

    pub fn build(mut self) -> Snapshot {
        for neighbors in &mut self.adjacency {
            neighbors.sort_unstable();
            neighbors.dedup();
        }
        for owned in &mut self.ratings {
            // A later thumb on the same ratable replaces an earlier one.
            owned.reverse();
            owned.sort_by_key(|&(ratable, ..)| ratable);
            owned.dedup_by_key(|&mut (ratable, ..)| ratable);
        }
        let (ratings, stamps) = self
            .ratings
            .into_iter()
            .map(|owned| {
                owned
                    .into_iter()
                    .map(|(ratable, value, stamp)| ((ratable, value), stamp))
                    .unzip()
            })
            .unzip();
        Snapshot {
            user_names: self.user_names,
            item_names: self.item_names,
            tag_names: self.tag_names,
            adjacency: self.adjacency,
            loaded: self.loaded,
            ratings,
            stamps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_rating_replaces_earlier() {
        let mut builder = Snapshot::builder();
        let user = builder.user("u0");
        let item = Ratable::Item(builder.item("i0"));
        builder.rate(user, item, 1);
        builder.rate(user, item, -1);
        let snapshot = builder.build();
        assert_eq!(snapshot.rating(user, item), Some(-1));
        assert_eq!(snapshot.ratings(user).len(), 1);
    }

    #[test]
    fn zero_clears_a_rating() {
        let mut builder = Snapshot::builder();
        let user = builder.user("u0");
        let item = Ratable::Item(builder.item("i0"));
        builder.rate(user, item, 1);
        builder.rate(user, item, 0);
        let snapshot = builder.build();
        assert_eq!(snapshot.rating(user, item), None);
    }

    #[test]
    fn edges_are_mutual_deduped_and_sorted() {
        let mut builder = Snapshot::builder();
        let first = builder.user("u0");
        let second = builder.user("u1");
        builder.edge(first, second);
        builder.edge(second, first);
        builder.edge(first, first);
        let snapshot = builder.build();
        assert_eq!(snapshot.friends(first), &[second]);
        assert_eq!(snapshot.friends(second), &[first]);
    }

    #[test]
    fn ratable_names_round_trip() {
        let mut builder = Snapshot::builder();
        // A tag is free text, so the halves must round-trip whatever punctuation they carry.
        let tagged = builder.ratable(&format!("café bleu{RATABLE_JOIN}late~night"));
        let plain = builder.ratable("café bleu");
        let snapshot = builder.build();
        assert_eq!(
            snapshot.ratable_name(tagged),
            format!("café bleu{RATABLE_JOIN}late~night")
        );
        assert_eq!(snapshot.ratable_name(plain), "café bleu");
    }
}
