//! Interned integer identifiers. String ids live only at the snapshot boundary.
//!
//! The boundary also decides what an id may look like. `normalizeId` in `shared/` is the one
//! folding that produces them, the `items.id` CHECK pins the same rule in the database, and the
//! predicate here is the crate's own copy: a ratings row can hold whatever a crafted client
//! wrote, and an id nothing else in the system can parse must not become a ratable here (DESIGN
//! section 3.3).

/// What joins an item to a tag in the core's one key per rated thing. Postgres text cannot hold
/// a NUL at all, so no id anybody can type can forge the join or smuggle a second separator into
/// a half. A printable separator would need a pattern to guarantee that, and no pattern can
/// enumerate what a half may contain when an id is arbitrary Unicode.
pub const RATABLE_JOIN: char = '\0';

/// The longest an id may be, in Unicode scalar values rather than bytes: the folding refuses a
/// longer one rather than truncating it, because a cut at 128 can land inside a grapheme cluster.
pub const ID_MAX: usize = 128;

/// The structural half of DESIGN section 3.2's id rule: non-empty, no control character, and at
/// most `ID_MAX` code points. NUL falls out of the control-character refusal, which is what keeps
/// a crafted ratings row from forging `RATABLE_JOIN`.
///
/// **NFKC-normality is not checked here**, so this does not claim an id is canonical. `x is nfkc
/// normalized` is a database CHECK, and the same test in the crate would mean Unicode tables on
/// the default build. ZWNJ and ZWJ are `Cf` rather than `Cc`, so `char::is_control` already leaves
/// them alone — which is what the rule wants, since Persian, several Indic scripts and emoji
/// sequences need them.
pub fn is_normalized_id(text: &str) -> bool {
    let mut length = 0usize;
    for character in text.chars() {
        if character.is_control() {
            return false;
        }
        length += 1;
        if length > ID_MAX {
            return false;
        }
    }
    length > 0
}

/// A user (viewer, friend, or anyone in reach).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct UserId(pub u32);

/// An item in the shared catalog.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct ItemId(pub u32);

/// A tag, from the one global tag namespace.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct TagId(pub u32);

impl UserId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl ItemId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

impl TagId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// The unit that receives a thumb: an item, or a claim that an item has a tag.
///
/// `Item` sorts before `Tag`, and both sort by item, so a user's ratings sorted by `Ratable`
/// put every item rating first and group each item's tags together.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Ratable {
    Item(ItemId),
    Tag(ItemId, TagId),
}

impl Ratable {
    pub fn item(self) -> ItemId {
        match self {
            Ratable::Item(item) => item,
            Ratable::Tag(item, _) => item,
        }
    }

    pub fn is_item(self) -> bool {
        matches!(self, Ratable::Item(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_text_ids_are_accepted_and_the_structural_refusals_are_not() {
        for name in [
            "café bleu",
            "日本",
            "late night",
            "i0",
            "a~b~c",
            "zero\u{200c}width",
            &"a".repeat(ID_MAX),
        ] {
            assert!(is_normalized_id(name), "{name:?} is a usable id");
        }
        for name in ["", "caf\u{7}e", "two\nlines", &"a".repeat(ID_MAX + 1)] {
            assert!(!is_normalized_id(name), "{name:?} is not a usable id");
        }
    }

    /// The core joins an item to a tag with this, so an id that could carry one would let a
    /// crafted row name a ratable that is not its own.
    #[test]
    fn the_join_cannot_appear_inside_an_id() {
        assert!(!is_normalized_id(&format!("a{RATABLE_JOIN}b")));
    }

    /// The cap counts code points, not bytes: 128 three-byte characters are an id and 129
    /// one-byte ones are not.
    #[test]
    fn the_cap_is_in_code_points() {
        assert!(is_normalized_id(&"日".repeat(ID_MAX)));
        assert!(!is_normalized_id(&"日".repeat(ID_MAX + 1)));
    }
}
