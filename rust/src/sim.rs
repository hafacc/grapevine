//! Synthetic worlds: latent taste, homophilous friendships, and an oracle for who really
//! agrees with whom.

use crate::ids::{ItemId, Ratable, TagId, UserId};
use crate::rng::Rng;
use crate::snapshot::Snapshot;

/// The knobs on a simulated world.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct WorldConfig {
    pub users: usize,
    pub items: usize,
    /// Dimension of the latent taste space.
    pub dimensions: usize,
    /// One entry per cluster; normalized, so `[0.6, 0.25, 0.15]` is the 60/25/15 world.
    pub cluster_proportions: Vec<f64>,
    /// How far a user's taste strays from their cluster's centre.
    pub cluster_spread: f64,
    /// Noise on a reported rating relative to true preference.
    pub noise: f64,
    /// Probability of an edge between two users in the same cluster.
    pub p_same_cluster: f64,
    /// Probability of an edge between two users in different clusters.
    pub p_other_cluster: f64,
    /// Fraction of the catalog each user rates.
    pub rated_fraction: f64,
    /// Items everyone likes and everyone rates: the unanimous tail that chance weighting
    /// discounts (DESIGN §2.2).
    pub consensus_items: usize,
    /// Size of the tag vocabulary; an item carries the tag of its category.
    pub tags: usize,
    /// Chance that a user who rates an item also rates its tag.
    pub tag_rated_fraction: f64,
    /// Factual attributes (`quiet`, `loud`, ...) with correlated truths, for DESIGN §2.8's
    /// attribute pairs. Zero draws nothing and consumes nothing from the random stream.
    pub attributes: usize,
    /// How many independent properties the attributes describe. Attribute `t` points along
    /// property `t % attribute_axes`, positively when `t / attribute_axes` is even and negatively
    /// when it is odd, so with twice as many attributes as axes every attribute has exactly one
    /// opposite, and with four times as many it also has one near-synonym.
    pub attribute_axes: usize,
    /// How far an attribute's direction strays from its axis: zero makes a pair of opposites
    /// perfectly anti-correlated.
    pub attribute_spread: f64,
    /// Chance that a user who rates an item also rates each one of the attributes.
    pub attribute_rated_fraction: f64,
    /// Noise on a reported attribute thumb relative to the item's true value.
    pub attribute_noise: f64,
}

impl Default for WorldConfig {
    fn default() -> Self {
        WorldConfig {
            users: 60,
            items: 120,
            dimensions: 6,
            cluster_proportions: vec![0.6, 0.25, 0.15],
            cluster_spread: 0.35,
            noise: 0.25,
            p_same_cluster: 0.18,
            p_other_cluster: 0.02,
            rated_fraction: 0.35,
            consensus_items: 0,
            tags: 6,
            tag_rated_fraction: 0.0,
            attributes: 0,
            attribute_axes: 3,
            attribute_spread: 0.3,
            attribute_rated_fraction: 0.1,
            attribute_noise: 0.3,
        }
    }
}

/// A simulated world and the ground truth behind it.
#[derive(Clone, Debug)]
pub struct World {
    pub config: WorldConfig,
    pub snapshot: Snapshot,
    pub cluster_of: Vec<usize>,
    /// `true_preference[user][item]`: what the user would think with no noise.
    pub true_preference: Vec<Vec<i8>>,
}

impl World {
    pub fn items(&self) -> impl Iterator<Item = ItemId> + use<> {
        (0..self.config.items as u32).map(ItemId)
    }

    /// The oracle: the fraction of the catalog on which two users' true preferences match.
    pub fn true_agreement(&self, one: UserId, other: UserId) -> f64 {
        let mine = &self.true_preference[one.index()];
        let theirs = &self.true_preference[other.index()];
        let matches = mine
            .iter()
            .zip(theirs)
            .filter(|&(&first, &second)| first == second)
            .count();
        matches as f64 / mine.len() as f64
    }
}

/// Builds a world: taste vectors around cluster centres, items in the same space, friendships
/// by homophily, and a random slice of the catalog rated by each user.
pub fn simulate(config: &WorldConfig, rng: &mut Rng) -> World {
    let centres: Vec<Vec<f64>> = (0..config.cluster_proportions.len())
        .map(|_| unit_vector(config.dimensions, rng))
        .collect();

    let mut cluster_of = Vec::with_capacity(config.users);
    let total_proportion: f64 = config.cluster_proportions.iter().sum();
    for index in 0..config.users {
        // Deterministic strata rather than sampling, so the 15% cluster is really 15%.
        let position = (index as f64 + 0.5) / config.users as f64 * total_proportion;
        let mut cumulative = 0.0;
        let mut cluster = config.cluster_proportions.len() - 1;
        for (candidate, proportion) in config.cluster_proportions.iter().enumerate() {
            cumulative += proportion;
            if position < cumulative {
                cluster = candidate;
                break;
            }
        }
        cluster_of.push(cluster);
    }

    let taste: Vec<Vec<f64>> = cluster_of
        .iter()
        .map(|&cluster| {
            let mut vector: Vec<f64> = centres[cluster]
                .iter()
                .map(|value| value + config.cluster_spread * rng.normal())
                .collect();
            normalize(&mut vector);
            vector
        })
        .collect();

    let consensus_direction = {
        let mut mean = vec![0.0; config.dimensions];
        for centre in &centres {
            for (slot, value) in mean.iter_mut().zip(centre) {
                *slot += value;
            }
        }
        normalize(&mut mean);
        mean
    };
    let item_vectors: Vec<Vec<f64>> = (0..config.items)
        .map(|index| {
            if index < config.consensus_items {
                consensus_direction.clone()
            } else {
                unit_vector(config.dimensions, rng)
            }
        })
        .collect();

    // The first `consensus_items` are liked by everyone, whatever their taste.
    let true_preference: Vec<Vec<i8>> = taste
        .iter()
        .map(|user_taste| {
            item_vectors
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    if index < config.consensus_items || dot(user_taste, item) >= 0.0 {
                        1
                    } else {
                        -1
                    }
                })
                .collect()
        })
        .collect();

    let mut builder = Snapshot::builder();
    let users: Vec<UserId> = (0..config.users)
        .map(|index| builder.user(&format!("u{index}")))
        .collect();
    let items: Vec<ItemId> = (0..config.items)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let tag_count = config.tags.max(1);
    let tags: Vec<TagId> = (0..tag_count)
        .map(|index| builder.tag(&format!("t{index}")))
        .collect();
    let item_tag: Vec<TagId> = (0..config.items)
        .map(|index| tags[index % tag_count])
        .collect();

    for first in 0..config.users {
        for second in (first + 1)..config.users {
            let same = cluster_of[first] == cluster_of[second];
            let probability = if same {
                config.p_same_cluster
            } else {
                config.p_other_cluster
            };
            if rng.chance(probability) {
                builder.edge(users[first], users[second]);
            }
        }
    }

    let mut rated_by: Vec<Vec<usize>> = vec![Vec::new(); config.users];
    for (index, user) in users.iter().enumerate() {
        for (item_index, &item) in items.iter().enumerate() {
            let always = item_index < config.consensus_items;
            if !always && !rng.chance(config.rated_fraction) {
                continue;
            }
            rated_by[index].push(item_index);
            let value = if always {
                1
            } else {
                reported(
                    dot(&taste[index], &item_vectors[item_index]),
                    config.noise,
                    rng,
                )
            };
            builder.rate_at(
                *user,
                Ratable::Item(item),
                value,
                order_stamp(*user, Ratable::Item(item)),
            );
            if config.tag_rated_fraction > 0.0 && rng.chance(config.tag_rated_fraction) {
                let tagged = Ratable::Tag(item, item_tag[item_index]);
                builder.rate_at(*user, tagged, 1, order_stamp(*user, tagged));
            }
        }
    }

    // Drawn after everything above, so adding attributes to a world leaves the rest of it as it
    // was.
    if config.attributes > 0 {
        add_attributes(config, &users, &items, &rated_by, &mut builder, rng);
    }

    World {
        config: config.clone(),
        snapshot: builder.build(),
        cluster_of,
        true_preference,
    }
}

/// Factual attributes whose truths are correlated because several describe the same property
/// of an item, some the opposite way round: `a0` and `a{axes}` are a `quiet` and a `loud`.
/// An attribute is a fact about the item, not a taste, so every user's thumb on it is the same
/// truth plus noise.
fn add_attributes(
    config: &WorldConfig,
    users: &[UserId],
    items: &[ItemId],
    rated_by: &[Vec<usize>],
    builder: &mut crate::snapshot::SnapshotBuilder,
    rng: &mut Rng,
) {
    let axes = config.attribute_axes.max(1);
    let attributes: Vec<TagId> = (0..config.attributes)
        .map(|index| builder.tag(&format!("a{index}")))
        .collect();
    let directions: Vec<Vec<f64>> = (0..config.attributes)
        .map(|index| {
            let sign = if (index / axes).is_multiple_of(2) {
                1.0
            } else {
                -1.0
            };
            let mut direction: Vec<f64> = (0..axes)
                .map(|axis| {
                    let base = if axis == index % axes { sign } else { 0.0 };
                    base + config.attribute_spread * rng.normal()
                })
                .collect();
            normalize(&mut direction);
            direction
        })
        .collect();
    let properties: Vec<Vec<f64>> = (0..items.len()).map(|_| unit_vector(axes, rng)).collect();
    for (index, &user) in users.iter().enumerate() {
        for &item_index in &rated_by[index] {
            for (attribute_index, &attribute) in attributes.iter().enumerate() {
                if !rng.chance(config.attribute_rated_fraction) {
                    continue;
                }
                let value = reported(
                    dot(&properties[item_index], &directions[attribute_index]),
                    config.attribute_noise,
                    rng,
                );
                let tagged = Ratable::Tag(items[item_index], attribute);
                builder.rate_at(user, tagged, value, order_stamp(user, tagged));
            }
        }
    }
}

fn reported(affinity: f64, noise: f64, rng: &mut Rng) -> i8 {
    if affinity + noise * rng.normal() >= 0.0 {
        1
    } else {
        -1
    }
}

fn unit_vector(dimensions: usize, rng: &mut Rng) -> Vec<f64> {
    let mut vector: Vec<f64> = (0..dimensions).map(|_| rng.normal()).collect();
    normalize(&mut vector);
    vector
}

fn normalize(vector: &mut [f64]) {
    let length = vector.iter().map(|value| value * value).sum::<f64>().sqrt();
    if length > 0.0 {
        for value in vector.iter_mut() {
            *value /= length;
        }
    }
}

fn dot(one: &[f64], other: &[f64]) -> f64 {
    one.iter()
        .zip(other)
        .map(|(left, right)| left * right)
        .sum()
}

/// When a simulated person gave a thumb, as an order stamp (`Snapshot::stamps`): a hash of who
/// and what, so that of any two people who rated the same thing each went first about half the
/// time, and so that drawing it takes nothing from the random stream a world is built from.
/// Always in `[1, 2³¹)`: zero is "no order known", and everything above is left for accounts
/// added to a world afterwards, which rate after everyone in it.
fn order_stamp(user: UserId, ratable: Ratable) -> u32 {
    let key = match ratable {
        Ratable::Item(item) => u64::from(item.0),
        Ratable::Tag(item, tag) => (1 << 40) | (u64::from(item.0) << 20) | u64::from(tag.0),
    };
    let mut value = (u64::from(user.0) << 42) ^ key;
    value = value.wrapping_add(0x9E37_79B9_7F4A_7C15);
    value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    value ^= value >> 31;
    1 + (value % ((1 << 31) - 1)) as u32
}

/// The stamp of a thumb given after every thumb of a simulated world: what an account added to
/// it afterwards, a bot, necessarily has.
pub const AFTER_THE_WORLD: u32 = u32::MAX;
