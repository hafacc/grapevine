//! Sybil regions to run the algorithm against: the attacks of DESIGN section 2.1.

use std::collections::BTreeMap;

use crate::ids::{ItemId, Ratable, UserId};
use crate::sim::AFTER_THE_WORLD;
use crate::snapshot::Snapshot;

/// What the bots do once they are wired in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SybilStrategy {
    /// Rate the promoted ratables `+1` and nothing else.
    PromoteOnly,
    /// Rate the most-rated items with the crowd, hoping agreement reads as shared taste.
    CopyConsensus,
    /// Edgeless accounts first drive those items to an even split, then the edged bots rate
    /// them `+1`, so that copying looks like agreement on something contested.
    ManufactureContested,
    /// Tag thousands of items with their obvious category.
    TagSpam,
}

/// How the bot set is wired to itself and to the honest world.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SybilShape {
    /// Every bot friends every gatekeeper and every other bot: the gatekeeper who accepted a
    /// thousand friend requests.
    Clique,
    /// One bot friends the gatekeepers and the rest hang off it in a line. A **path**, not a
    /// ring: `windows(2)` with no wrap-around, which is strictly sparser than a ring.
    Chain,
    /// A hub friends the gatekeepers, with chains of five radiating from it.
    StarOfChains,
}

#[derive(Clone, Debug)]
pub struct SybilConfig {
    pub count: usize,
    pub gatekeepers: Vec<UserId>,
    /// Ratable names the bots push, created if they do not exist.
    pub promoted: Vec<String>,
    pub strategy: SybilStrategy,
    pub shape: SybilShape,
    /// How many of the most-rated items the consensus strategies work on.
    pub target_items: usize,
    /// How many items `TagSpam` tags.
    pub spam_items: usize,
}

impl Default for SybilConfig {
    fn default() -> Self {
        SybilConfig {
            count: 1,
            gatekeepers: Vec::new(),
            promoted: Vec::new(),
            strategy: SybilStrategy::PromoteOnly,
            shape: SybilShape::Clique,
            target_items: 30,
            spam_items: 1_000,
        }
    }
}

/// The accounts an attack added.
#[derive(Clone, Debug, Default)]
pub struct SybilSet {
    /// Bots wired to the honest world through the gatekeepers.
    pub bots: Vec<UserId>,
    /// Bots with no edges at all, which can still vote.
    pub edgeless: Vec<UserId>,
    /// The ratables the bots pushed.
    pub promoted: Vec<Ratable>,
}

/// Adds a sybil region to a snapshot and returns the new snapshot and the accounts it created.
pub fn add_sybils(snapshot: &Snapshot, config: &SybilConfig) -> (Snapshot, SybilSet) {
    let mut builder = snapshot.edit();
    let prefix = format!("s{}", snapshot.user_count());
    let bots: Vec<UserId> = (0..config.count)
        .map(|index| builder.user(&format!("{prefix}b{index}")))
        .collect();
    let promoted: Vec<Ratable> = config
        .promoted
        .iter()
        .map(|name| builder.ratable(name))
        .collect();

    match config.shape {
        SybilShape::Clique => {
            for &bot in &bots {
                for &gatekeeper in &config.gatekeepers {
                    builder.edge(bot, gatekeeper);
                }
            }
            for (index, &bot) in bots.iter().enumerate() {
                for &other in &bots[index + 1..] {
                    builder.edge(bot, other);
                }
            }
        }
        SybilShape::Chain => {
            if let Some(&head) = bots.first() {
                for &gatekeeper in &config.gatekeepers {
                    builder.edge(head, gatekeeper);
                }
            }
            for window in bots.windows(2) {
                builder.edge(window[0], window[1]);
            }
        }
        SybilShape::StarOfChains => {
            if let Some(&hub) = bots.first() {
                for &gatekeeper in &config.gatekeepers {
                    builder.edge(hub, gatekeeper);
                }
                for (index, &bot) in bots.iter().enumerate().skip(1) {
                    if index % 5 == 1 {
                        builder.edge(hub, bot);
                    } else {
                        builder.edge(bots[index - 1], bot);
                    }
                }
            }
        }
    }

    let mut set = SybilSet {
        bots,
        edgeless: Vec::new(),
        promoted,
    };

    match config.strategy {
        SybilStrategy::PromoteOnly => {}
        SybilStrategy::CopyConsensus => {
            let targets = popular_items(snapshot, config.target_items);
            for &bot in &set.bots {
                for &(item, majority) in &targets {
                    builder.rate_at(bot, Ratable::Item(item), majority, AFTER_THE_WORLD);
                }
            }
        }
        SybilStrategy::ManufactureContested => {
            let targets = popular_items(snapshot, config.target_items);
            let imbalance = item_imbalance(snapshot, &targets);
            let needed = imbalance
                .values()
                .map(|&(count, _)| count)
                .max()
                .unwrap_or(0);
            set.edgeless = (0..needed)
                .map(|index| builder.user(&format!("{prefix}e{index}")))
                .collect();
            for (&item, &(count, minority)) in &imbalance {
                for &voter in set.edgeless.iter().take(count) {
                    builder.rate_at(voter, Ratable::Item(item), minority, AFTER_THE_WORLD);
                }
            }
            for &bot in &set.bots {
                for &(item, _) in &targets {
                    builder.rate_at(bot, Ratable::Item(item), 1, AFTER_THE_WORLD);
                }
            }
        }
        SybilStrategy::TagSpam => {
            let category = builder.tag("category");
            let spam: Vec<ItemId> = (0..snapshot.item_count().min(config.spam_items))
                .map(|index| ItemId(index as u32))
                .collect();
            for &bot in &set.bots {
                for &item in &spam {
                    builder.rate_at(bot, Ratable::Tag(item, category), 1, AFTER_THE_WORLD);
                }
            }
        }
    }

    for &bot in &set.bots {
        for &ratable in &set.promoted {
            builder.rate_at(bot, ratable, 1, AFTER_THE_WORLD);
        }
    }

    (builder.build(), set)
}

/// The most-rated items, with the sign the crowd gave each.
fn popular_items(snapshot: &Snapshot, count: usize) -> Vec<(ItemId, i8)> {
    let mut up = vec![0usize; snapshot.item_count()];
    let mut down = vec![0usize; snapshot.item_count()];
    for user in snapshot.users() {
        for &(ratable, value) in snapshot.ratings(user) {
            if let Ratable::Item(item) = ratable {
                if value > 0 {
                    up[item.index()] += 1;
                } else {
                    down[item.index()] += 1;
                }
            }
        }
    }
    let mut ranked: Vec<(ItemId, i8, usize)> = (0..snapshot.item_count())
        .map(|index| {
            let total = up[index] + down[index];
            let majority = if up[index] >= down[index] { 1 } else { -1 };
            (ItemId(index as u32), majority, total)
        })
        .collect();
    ranked.sort_by(|left, right| right.2.cmp(&left.2).then(left.0.cmp(&right.0)));
    ranked
        .into_iter()
        .take(count)
        .map(|(item, majority, _)| (item, majority))
        .collect()
}

/// How many votes on the minority side each target item needs to reach an even split.
fn item_imbalance(snapshot: &Snapshot, targets: &[(ItemId, i8)]) -> BTreeMap<ItemId, (usize, i8)> {
    let mut counts: BTreeMap<ItemId, (usize, usize)> = targets
        .iter()
        .map(|&(item, _)| (item, (0usize, 0usize)))
        .collect();
    for user in snapshot.users() {
        for &(ratable, value) in snapshot.ratings(user) {
            if let Ratable::Item(item) = ratable
                && let Some(entry) = counts.get_mut(&item)
            {
                if value > 0 {
                    entry.0 += 1;
                } else {
                    entry.1 += 1;
                }
            }
        }
    }
    counts
        .into_iter()
        .map(|(item, (up, down))| {
            let minority = if up >= down { -1 } else { 1 };
            (item, (up.abs_diff(down), minority))
        })
        .collect()
}
