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
    /// Items everyone likes and everyone rates: the unanimous tail that `ω` discounts.
    pub consensus_items: usize,
    /// Size of the tag vocabulary; an item carries the tag of its category.
    pub tags: usize,
    /// Chance that a user who rates an item also rates its tag.
    pub tag_rated_fraction: f64,
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
        }
    }
}

/// A simulated world and the ground truth behind it.
#[derive(Clone, Debug)]
pub struct World {
    pub config: WorldConfig,
    pub snapshot: Snapshot,
    pub cluster_of: Vec<usize>,
    pub taste: Vec<Vec<f64>>,
    pub item_vectors: Vec<Vec<f64>>,
    /// `true_preference[user][item]`: what the user would think with no noise.
    pub true_preference: Vec<Vec<i8>>,
    /// The tag each item carries, by item index.
    pub item_tag: Vec<TagId>,
}

impl World {
    pub fn users(&self) -> impl Iterator<Item = UserId> + use<> {
        (0..self.cluster_of.len() as u32).map(UserId)
    }

    pub fn items(&self) -> impl Iterator<Item = ItemId> + use<> {
        (0..self.item_vectors.len() as u32).map(ItemId)
    }

    pub fn preference(&self, user: UserId, item: ItemId) -> i8 {
        self.true_preference[user.index()][item.index()]
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

    // The first `consensus_items` are liked by everyone, whatever their taste: they are the
    // near-unanimous tail that informativeness is supposed to discount.
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

    for (index, user) in users.iter().enumerate() {
        for (item_index, &item) in items.iter().enumerate() {
            let always = item_index < config.consensus_items;
            if !always && !rng.chance(config.rated_fraction) {
                continue;
            }
            let value = if always {
                1
            } else {
                reported(
                    dot(&taste[index], &item_vectors[item_index]),
                    config.noise,
                    rng,
                )
            };
            builder.rate(*user, Ratable::Item(item), value);
            if config.tag_rated_fraction > 0.0 && rng.chance(config.tag_rated_fraction) {
                builder.rate(*user, Ratable::Tag(item, item_tag[item_index]), 1);
            }
        }
    }

    World {
        config: config.clone(),
        snapshot: builder.build(),
        cluster_of,
        taste,
        item_vectors,
        true_preference,
        item_tag,
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
