//! Which attributes a thing carries, and each person's reliability on things carrying each
//! attribute, shrunk toward their reliability on everything else by a strength `κ_a` the data
//! chooses (DESIGN §2.8).

use std::collections::{BTreeMap, BTreeSet};

use crate::ids::{ItemId, Ratable, TagId, UserId};
use crate::params::Params;
use crate::snapshot::Snapshot;
use crate::witness::chains::{Chains, Evidence, capped, plain};
use crate::witness::channel::posterior;
use crate::witness::circle::Circle;

/// The grid `κ_a` is chosen from, in things. The largest stands in for "kinds don't matter".
pub const ATTRIBUTE_STRENGTHS: [f64; 11] = [
    1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 256.0, 512.0, 1024.0,
];

/// The attributes each thing is agreed to carry: tagged up by more of the circle — the viewer
/// and the people they trust directly — than tagged it down. Read over everyone reached, accounts
/// behind one person could decide what kind of thing anything is, and through that move everyone's
/// per-attribute reliability (`circle.rs`). Each list is sorted.
pub fn attributes_of(snapshot: &Snapshot, circle: &Circle) -> BTreeMap<ItemId, Vec<TagId>> {
    let mut votes: BTreeMap<(ItemId, TagId), i32> = BTreeMap::new();
    for user in circle.members() {
        for &(ratable, value) in snapshot.ratings(user) {
            if let Ratable::Tag(item, tag) = ratable {
                *votes.entry((item, tag)).or_insert(0) += i32::from(value);
            }
        }
    }
    let mut out: BTreeMap<ItemId, Vec<TagId>> = BTreeMap::new();
    for ((item, tag), sum) in votes {
        if sum > 0 {
            out.entry(item).or_default().push(tag);
        }
    }
    out
}

#[derive(Clone, Debug, Default)]
pub struct Topical {
    /// Per person, by index: reliability on things carrying each attribute, after the cap.
    pub reliability: Vec<BTreeMap<TagId, f64>>,
    /// Per attribute and region head: the `κ_a` chosen.
    pub strength: BTreeMap<(TagId, UserId), f64>,
}

impl Topical {
    /// The reliability `user`'s thumb on `item` is read at: the mean over the item's attributes
    /// that have one, else the overall reliability.
    pub fn reliability_on(
        &self,
        chains: &Chains,
        attributes: &BTreeMap<ItemId, Vec<TagId>>,
        user: UserId,
        item: ItemId,
    ) -> f64 {
        let overall = chains.reliability[user.index()];
        let Some(table) = self.reliability.get(user.index()) else {
            return overall;
        };
        if table.is_empty() {
            return overall;
        }
        let Some(list) = attributes.get(&item) else {
            return overall;
        };
        let (mut sum, mut found) = (0.0, 0usize);
        for tag in list {
            if let Some(&value) = table.get(tag) {
                sum += value;
                found += 1;
            }
        }
        if found == 0 {
            overall
        } else {
            sum / found as f64
        }
    }
}

/// A person's evidence on one attribute: the prior centre (their reliability off it) and their
/// readings on it.
struct OnAttribute {
    user: UserId,
    centre: f64,
    inside: Vec<Evidence>,
}

/// Per-attribute reliability for one viewer. Each person's reliability off an attribute is worked
/// out by the same rule as their overall one, over the things not carrying it: for a directly
/// trusted person the posterior from the population prior, for anyone else the two capped
/// posteriors of `chains::capped` with their chain as the prior. Their reliability on the attribute
/// is then that rule again, centred on that, at strength `κ_a` — so it is capped at the head for
/// predictions and at their own chain for later thumbs, exactly as their overall reliability is.
///
/// `κ_a` is chosen per region, over the people with history both on and off the attribute (the
/// only ones who say how far the two differ) who are in the circle or in that region: the same
/// population a region's thumbs are judged against (`score.rs`). Chosen over everyone, a swarm
/// behind one person that copies the viewer would pick the `κ_a` every other region is read at;
/// chosen over the circle alone, it was too few people, and per-attribute reliability cost
/// accuracy on every world measured.
pub fn topical(
    snapshot: &Snapshot,
    chains: &Chains,
    attributes: &BTreeMap<ItemId, Vec<TagId>>,
    params: &Params,
) -> Topical {
    let mut out = Topical {
        reliability: vec![BTreeMap::new(); snapshot.user_count()],
        strength: BTreeMap::new(),
    };
    if attributes.is_empty() {
        return out;
    }
    let carries = |item: ItemId, tag: TagId| {
        attributes
            .get(&item)
            .is_some_and(|list| list.binary_search(&tag).is_ok())
    };
    let mut tags: BTreeSet<TagId> = BTreeSet::new();
    for evidence in chains.history.values() {
        for found in evidence {
            if let Some(list) = attributes.get(&found.item) {
                tags.extend(list.iter().copied());
            }
        }
    }
    for tag in tags {
        let mut people: Vec<OnAttribute> = Vec::new();
        for (&user, history) in &chains.history {
            let (inside, outside): (Vec<Evidence>, Vec<Evidence>) =
                history.iter().partition(|found| carries(found.item, tag));
            if inside.is_empty() {
                continue;
            }
            // All of this person's history carries the attribute: there is nothing their taste
            // on it could differ from, so it is their overall reliability, and they say nothing
            // about `κ_a`.
            if outside.is_empty() {
                out.reliability[user.index()].insert(tag, chains.reliability[user.index()]);
                continue;
            }
            let centre = if chains.direct[user.index()] {
                posterior(
                    &plain(&outside),
                    params.prior_agreement,
                    params.prior_strength,
                )
                .mean
            } else {
                let own = chains.chain[user.index()];
                capped(
                    &outside,
                    own,
                    params.prior_strength,
                    chains.head(user),
                    own.abs(),
                )
                .0
            };
            people.push(OnAttribute {
                user,
                centre,
                inside,
            });
        }
        let readings: Vec<_> = people.iter().map(|person| plain(&person.inside)).collect();
        // Each person's log-marginal at every strength, then each region's `κ_a` over the people
        // the viewer trusts directly and the region's own members.
        let marginals: Vec<Vec<f64>> = people
            .iter()
            .zip(&readings)
            .map(|(person, inside)| {
                ATTRIBUTE_STRENGTHS
                    .iter()
                    .map(|&strength| {
                        posterior(inside, (1.0 + person.centre) / 2.0, strength).log_marginal
                    })
                    .collect()
            })
            .collect();
        let homes: BTreeSet<u32> = people
            .iter()
            .map(|person| chains.region[person.user.index()])
            .collect();
        let mut chosen: BTreeMap<u32, f64> = BTreeMap::new();
        for home in homes {
            let (mut best, mut best_evidence) = (ATTRIBUTE_STRENGTHS[0], f64::NEG_INFINITY);
            for (index, &strength) in ATTRIBUTE_STRENGTHS.iter().enumerate() {
                let evidence: f64 = people
                    .iter()
                    .zip(&marginals)
                    .filter(|(person, _)| {
                        chains.direct[person.user.index()]
                            || chains.region[person.user.index()] == home
                    })
                    .map(|(_, marginal)| marginal[index])
                    .sum();
                // Ties go to the larger strength: nothing says kinds matter.
                if evidence >= best_evidence {
                    (best, best_evidence) = (strength, evidence);
                }
            }
            chosen.insert(home, best);
            out.strength.insert((tag, UserId(home)), best);
        }
        for (person, inside) in people.iter().zip(&readings) {
            let strength = chosen[&chains.region[person.user.index()]];
            let value = if chains.direct[person.user.index()] {
                posterior(inside, (1.0 + person.centre) / 2.0, strength).mean
            } else {
                let own = chains.chain[person.user.index()].abs();
                capped(
                    &person.inside,
                    person.centre,
                    strength,
                    chains.head(person.user),
                    own,
                )
                .0
            };
            out.reliability[person.user.index()].insert(tag, value);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::witness::chains::chains;
    use crate::witness::circle::BaseRates;

    fn setup(snapshot: &Snapshot, viewer: UserId) -> (Chains, BTreeMap<ItemId, Vec<TagId>>) {
        let circle = Circle::of(snapshot, viewer);
        let rates = BaseRates::over(snapshot, &circle);
        (
            chains(snapshot, viewer, &rates, &circle, &Params::default()),
            attributes_of(snapshot, &circle),
        )
    }

    #[test]
    fn a_thing_carries_what_most_of_the_circle_says() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let people: Vec<UserId> = (0..3)
            .map(|index| builder.user(&format!("p{index}")))
            .collect();
        let item = builder.item("thing");
        let quiet = builder.tag("quiet");
        let loud = builder.tag("loud");
        for &person in &people {
            builder.edge(viewer, person);
        }
        builder
            .rate(people[0], Ratable::Tag(item, quiet), 1)
            .rate(people[1], Ratable::Tag(item, quiet), 1)
            .rate(people[2], Ratable::Tag(item, quiet), -1)
            .rate(people[0], Ratable::Tag(item, loud), -1)
            .rate(people[1], Ratable::Tag(item, loud), -1)
            .rate(people[2], Ratable::Tag(item, loud), 1);
        let stranger = builder.user("stranger");
        builder.rate(stranger, Ratable::Tag(item, loud), 1);
        let behind: Vec<UserId> = (0..5)
            .map(|index| builder.user(&format!("b{index}")))
            .collect();
        for &account in &behind {
            builder
                .edge(people[2], account)
                .rate(account, Ratable::Tag(item, loud), 1);
        }
        let snapshot = builder.build();
        let found = attributes_of(&snapshot, &Circle::of(&snapshot, viewer));
        // Seven accounts say loud against two, but only one of them is in the circle.
        assert_eq!(found.get(&item), Some(&vec![quiet]));
    }

    /// A friend who shares the viewer's taste in films and has the opposite taste in food.
    #[test]
    fn a_friend_right_about_one_kind_and_wrong_about_another_is_read_per_kind() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        builder.edge(viewer, friend);
        let film = builder.tag("film");
        let food = builder.tag("food");
        for index in 0..40 {
            let item = builder.item(&format!("i{index}"));
            let (tag, same) = if index % 2 == 0 {
                (film, true)
            } else {
                (food, false)
            };
            let mine = if index % 4 < 2 { 1 } else { -1 };
            builder
                .rate(viewer, Ratable::Item(item), mine)
                .rate(friend, Ratable::Item(item), if same { mine } else { -mine })
                .rate(friend, Ratable::Tag(item, tag), 1);
        }
        let snapshot = builder.build();
        let (found, attributes) = setup(&snapshot, viewer);
        let topics = topical(&snapshot, &found, &attributes, &Params::default());
        let on = |tag: TagId| topics.reliability[friend.index()][&tag];
        assert!(on(film) > 0.5, "film {}", on(film));
        assert!(on(food) < -0.5, "food {}", on(food));
        assert!(topics.strength[&(film, friend)] <= 4.0 && topics.strength[&(food, friend)] <= 4.0);
        let film_item = ItemId(0);
        assert_eq!(
            topics.reliability_on(&found, &attributes, friend, film_item),
            on(film)
        );
    }

    #[test]
    fn with_no_attributes_everyone_reads_at_the_overall_reliability() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let item = builder.item("thing");
        builder
            .edge(viewer, friend)
            .rate(viewer, Ratable::Item(item), 1)
            .rate(friend, Ratable::Item(item), 1);
        let snapshot = builder.build();
        let (found, attributes) = setup(&snapshot, viewer);
        let topics = topical(&snapshot, &found, &attributes, &Params::default());
        assert!(topics.strength.is_empty());
        assert_eq!(
            topics.reliability_on(&found, &attributes, friend, item),
            found.reliability[friend.index()]
        );
    }

    /// Someone reached through a friend who copies the viewer after the fact, on things carrying
    /// one attribute, is held at their own chain on it, as they are overall.
    #[test]
    fn copying_the_viewer_on_one_attribute_raises_nobody_past_their_chain() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let copier = builder.user("copier");
        builder.edge(viewer, friend).edge(friend, copier);
        let film = builder.tag("film");
        for index in 0..30 {
            let item = builder.item(&format!("i{index}"));
            let mine = if index % 3 == 0 { -1 } else { 1 };
            builder
                .rate_at(viewer, Ratable::Item(item), mine, 1)
                .rate_at(copier, Ratable::Item(item), mine, 2)
                .rate(friend, Ratable::Tag(item, film), 1);
        }
        let snapshot = builder.build();
        let (found, attributes) = setup(&snapshot, viewer);
        let topics = topical(&snapshot, &found, &attributes, &Params::default());
        let on_film = topics.reliability[copier.index()][&film];
        assert!(on_film.abs() <= found.chain[copier.index()].abs() + 1e-12);
    }
}
