//! The input to every computation: who follows whom, and everyone's thumbs.

use std::collections::HashMap;

use crate::ids::{ItemId, RATABLE_JOIN, Ratable, TagId, UserId};

/// Who follows whom and the thumbs of everyone named, with all identifiers interned.
///
/// Nothing here is per viewer: the same snapshot answers for every user in it. Following is one
/// way: `follows(a)` holding `b` says nothing about `follows(b)`.
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    user_names: Vec<String>,
    item_names: Vec<String>,
    tag_names: Vec<String>,
    follows: Vec<Vec<UserId>>,
    ratings: Vec<Vec<(Ratable, i8)>>,
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

    pub fn tag_count(&self) -> usize {
        self.tag_names.len()
    }

    /// The accounts `user` follows, sorted.
    pub fn follows(&self, user: UserId) -> &[UserId] {
        &self.follows[user.index()]
    }

    /// One user's ratings, sorted by ratable, items before tags.
    pub fn ratings(&self, user: UserId) -> &[(Ratable, i8)] {
        &self.ratings[user.index()]
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

    /// A builder seeded with this snapshot, for adding users, follows or ratings to a world.
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
            follows: self.follows.clone(),
            ratings: self.ratings.clone(),
            user_index,
            item_index,
            tag_index,
        }
    }
}

/// Interns names and accumulates follows and ratings.
#[derive(Clone, Debug, Default)]
pub struct SnapshotBuilder {
    user_names: Vec<String>,
    item_names: Vec<String>,
    tag_names: Vec<String>,
    follows: Vec<Vec<UserId>>,
    ratings: Vec<Vec<(Ratable, i8)>>,
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
            self.follows.push(Vec::new());
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

    /// `follower` follows `followed`. Following oneself and repeats are ignored.
    pub fn follow(&mut self, follower: UserId, followed: UserId) -> &mut Self {
        if follower != followed {
            self.follows[follower.index()].push(followed);
        }
        self
    }

    /// Records a thumb. Anything but `1` or `-1` removes the rating rather than failing the
    /// build, so one crafted row cannot fail the list of everyone who follows its author.
    pub fn rate(&mut self, user: UserId, ratable: Ratable, value: i8) -> &mut Self {
        debug_assert!(
            match ratable {
                Ratable::Item(item) => item.index() < self.item_names.len(),
                Ratable::Tag(item, tag) =>
                    item.index() < self.item_names.len() && tag.index() < self.tag_names.len(),
            },
            "a rating names a thing or a tag this builder never interned"
        );
        let owned = &mut self.ratings[user.index()];
        if value == 1 || value == -1 {
            owned.push((ratable, value));
        } else {
            owned.retain(|&(key, _)| key != ratable);
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
        for followed in &mut self.follows {
            followed.sort_unstable();
            followed.dedup();
        }
        for owned in &mut self.ratings {
            // A later thumb on the same ratable replaces an earlier one.
            owned.reverse();
            owned.sort_by_key(|&(ratable, _)| ratable);
            owned.dedup_by_key(|&mut (ratable, _)| ratable);
        }
        Snapshot {
            user_names: self.user_names,
            item_names: self.item_names,
            tag_names: self.tag_names,
            follows: self.follows,
            ratings: self.ratings,
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
    fn follows_are_one_way_deduped_and_sorted() {
        let mut builder = Snapshot::builder();
        let first = builder.user("u0");
        let second = builder.user("u1");
        let third = builder.user("u2");
        builder.follow(first, third);
        builder.follow(first, second);
        builder.follow(first, second);
        builder.follow(first, first);
        let snapshot = builder.build();
        assert_eq!(snapshot.follows(first), &[second, third]);
        assert!(snapshot.follows(second).is_empty());
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
