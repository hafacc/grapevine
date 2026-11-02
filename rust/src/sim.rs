//! Synthetic worlds: latent taste, people who mostly follow others like themselves, and an
//! oracle for who really agrees with whom.

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
    /// Probability that two users in the same cluster follow each other.
    pub p_same_cluster: f64,
    /// Probability that two users in different clusters follow each other.
    pub p_other_cluster: f64,
    /// Fraction of the catalog each user rates.
    pub rated_fraction: f64,
    /// How far a user's liking for a whole category strays from what their taste says of its
    /// things, in the units of an affinity: each user draws one offset per category. Zero draws
    /// nothing and consumes nothing from the random stream.
    pub category_bias: f64,
    /// Kinds inside each category: an item carries its category's tag and, with this above
    /// zero, the tag of one of that many kinds within it, as a `fantasy` is a `book`. Zero
    /// draws nothing and consumes nothing from the random stream.
    pub subcategories: usize,
    /// `category_bias`, for the kinds inside a category: one further offset per user per kind.
    pub subcategory_bias: f64,
    /// Items everyone likes and everyone rates.
    pub consensus_items: usize,
    /// Size of the tag vocabulary; an item carries the tag of its category.
    pub tags: usize,
    /// Chance that a user who rates an item also puts its category's tag on it.
    pub tag_rated_fraction: f64,
    /// Factual attributes (`quiet`, `loud`, ...) with correlated truths. Zero draws nothing and
    /// consumes nothing from the random stream.
    pub attributes: usize,
    /// How many independent properties the attributes describe. Attribute `t` points along
    /// property `t % attribute_axes`, positively when `t / attribute_axes` is even and negatively
    /// when it is odd, so with twice as many attributes as axes every attribute has exactly one
    /// opposite, and with four times as many it also has one near-synonym.
    pub attribute_axes: usize,
    /// How far an attribute's direction strays from its axis: zero makes a pair of opposites
    /// perfectly anti-correlated.
    pub attribute_spread: f64,
    /// Chance that a user who rates an item considers each one of the attributes for it.
    pub attribute_rated_fraction: f64,
    /// Noise on whether a user sees an attribute as applying, relative to the item's truth.
    pub attribute_noise: f64,
    /// The chance a user's thumb on an attribute is simply their thumb on the item. Otherwise
    /// it is a judgment of its own, of how good an example the item is, which every user sees
    /// alike plus noise. One consumes nothing from the random stream.
    pub example_follows_liking: f64,
    /// The share of users who put attributes on at the flip of a coin: people whose use of a
    /// word says nothing about anybody else's. Zero consumes nothing from the random stream.
    pub careless_taggers: f64,
    /// Added to every affinity: above zero, most thumbs are up. An affinity's spread is about
    /// `1/√dimensions`.
    pub generosity: f64,
    /// How far an item's affinity for everyone strays from zero: some things nearly everyone
    /// likes and some nearly no one does, so the rate of a like differs by thing. Zero draws
    /// nothing and consumes nothing from the random stream.
    pub quality_spread: f64,
    /// How much less often a user rates a thing they would not like: at one, nobody rates what
    /// they would dislike. What is rated is then liked more often than what is not. Zero
    /// consumes nothing more from the random stream.
    pub selectivity: f64,
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
            category_bias: 0.0,
            subcategories: 0,
            subcategory_bias: 0.0,
            consensus_items: 0,
            tags: 6,
            tag_rated_fraction: 0.0,
            attributes: 0,
            attribute_axes: 3,
            attribute_spread: 0.3,
            attribute_rated_fraction: 0.1,
            attribute_noise: 0.3,
            example_follows_liking: 1.0,
            careless_taggers: 0.0,
            generosity: 0.0,
            quality_spread: 0.0,
            selectivity: 0.0,
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

/// Builds a world: taste vectors around cluster centres, items in the same space, follows by
/// homophily, and a random slice of the catalog rated by each user.
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

    let tag_count = config.tags.max(1);
    let bias: Vec<Vec<f64>> = (0..config.users)
        .map(|_| {
            if config.category_bias > 0.0 {
                (0..tag_count)
                    .map(|_| config.category_bias * rng.normal())
                    .collect()
            } else {
                vec![0.0; tag_count]
            }
        })
        .collect();
    let kinds = config.subcategories;
    let kind_of =
        |item: usize| (item % tag_count) * kinds.max(1) + (item / tag_count) % kinds.max(1);
    let kind_bias: Vec<Vec<f64>> = (0..config.users)
        .map(|_| {
            if kinds > 0 && config.subcategory_bias > 0.0 {
                (0..tag_count * kinds)
                    .map(|_| config.subcategory_bias * rng.normal())
                    .collect()
            } else {
                Vec::new()
            }
        })
        .collect();
    let quality: Vec<f64> = if config.quality_spread > 0.0 {
        (0..config.items)
            .map(|_| config.quality_spread * rng.normal())
            .collect()
    } else {
        Vec::new()
    };
    let affinity = |user: usize, item: usize| {
        dot(&taste[user], &item_vectors[item])
            + bias[user][item % tag_count]
            + kind_bias[user].get(kind_of(item)).copied().unwrap_or(0.0)
            + config.generosity
            + quality.get(item).copied().unwrap_or(0.0)
    };

    // The first `consensus_items` are liked by everyone, whatever their taste.
    let true_preference: Vec<Vec<i8>> = (0..config.users)
        .map(|user| {
            (0..config.items)
                .map(|item| {
                    if item < config.consensus_items || affinity(user, item) >= 0.0 {
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
    let tags: Vec<TagId> = (0..tag_count)
        .map(|index| builder.tag(&format!("t{index}")))
        .collect();
    let item_tag: Vec<TagId> = (0..config.items)
        .map(|index| tags[index % tag_count])
        .collect();
    let kind_tags: Vec<TagId> = (0..tag_count * kinds)
        .map(|index| builder.tag(&format!("t{}.{}", index / kinds, index % kinds)))
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
                builder
                    .follow(users[first], users[second])
                    .follow(users[second], users[first]);
            }
        }
    }

    let mut rated_by: Vec<Vec<(usize, i8)>> = vec![Vec::new(); config.users];
    for (index, user) in users.iter().enumerate() {
        for (item_index, &item) in items.iter().enumerate() {
            let always = item_index < config.consensus_items;
            if !always && !rng.chance(config.rated_fraction) {
                continue;
            }
            if !always
                && config.selectivity > 0.0
                && affinity(index, item_index) < 0.0
                && rng.chance(config.selectivity)
            {
                continue;
            }
            let value = if always {
                1
            } else {
                reported(affinity(index, item_index), config.noise, rng)
            };
            rated_by[index].push((item_index, value));
            builder.rate(*user, Ratable::Item(item), value);
            if config.tag_rated_fraction > 0.0 && rng.chance(config.tag_rated_fraction) {
                // A good thing of its kind is, here, a good example of the kind.
                let tagged = Ratable::Tag(item, item_tag[item_index]);
                builder.rate(*user, tagged, value);
                if kinds > 0 {
                    let narrower = Ratable::Tag(item, kind_tags[kind_of(item_index)]);
                    builder.rate(*user, narrower, value);
                }
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
/// Whether an attribute applies is a fact about the item, so every user sees the same truth plus
/// noise, and puts the attribute on when they see it.
fn add_attributes(
    config: &WorldConfig,
    users: &[UserId],
    items: &[ItemId],
    rated_by: &[Vec<(usize, i8)>],
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
    let separate = config.example_follows_liking < 1.0;
    let quality: Vec<Vec<f64>> = if separate {
        (0..items.len())
            .map(|_| (0..config.attributes).map(|_| rng.normal()).collect())
            .collect()
    } else {
        Vec::new()
    };
    for (index, &user) in users.iter().enumerate() {
        let careless = config.careless_taggers > 0.0 && rng.chance(config.careless_taggers);
        for &(item_index, value) in &rated_by[index] {
            for (attribute_index, &attribute) in attributes.iter().enumerate() {
                if !rng.chance(config.attribute_rated_fraction) {
                    continue;
                }
                let applies = if careless {
                    rng.chance(0.5)
                } else {
                    reported(
                        dot(&properties[item_index], &directions[attribute_index]),
                        config.attribute_noise,
                        rng,
                    ) > 0
                };
                // Whoever thinks it applies puts it on. Their thumb on it is their thumb on the
                // thing, or their own reading of how good an example the thing is.
                if applies {
                    let thumb = if separate && !rng.chance(config.example_follows_liking) {
                        reported(
                            quality[item_index][attribute_index],
                            config.attribute_noise,
                            rng,
                        )
                    } else {
                        value
                    };
                    builder.rate(user, Ratable::Tag(items[item_index], attribute), thumb);
                }
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
