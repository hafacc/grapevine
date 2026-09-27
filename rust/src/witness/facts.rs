//! Attribute thumbs as facts (DESIGN §2.8): one fact reliability shared by everyone, scores
//! averaged per region, and gaps — a `(thing, attribute)` nobody reached tagged — filled from
//! attribute pairs that are more likely linked than not.

use std::collections::{BTreeMap, BTreeSet};

use crate::ids::{ItemId, Ratable, TagId, UserId};
use crate::params::Params;
use crate::score::Score;
use crate::snapshot::Snapshot;
use crate::witness::chains::Chains;
use crate::witness::channel::{Reading, answer_share, log_likelihood, posterior, thumb_evidence};
use crate::witness::circle::Circle;
use crate::witness::score::inside;

/// One attribute pair's spike-and-slab posterior.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PairLink {
    /// The posterior chance the pair is linked at all.
    pub linked: f64,
    /// The slab's posterior mean: the pair's reliability if it is linked.
    pub reliability: f64,
}

impl PairLink {
    /// A pair fills gaps when it is more likely linked than not.
    pub fn used(&self) -> bool {
        self.linked > 0.5
    }
}

#[derive(Clone, Debug, Default)]
pub struct Facts {
    /// Every `(thing, attribute)` anyone reached tagged, and every filled gap.
    pub scores: BTreeMap<Ratable, Score>,
    /// `λ_fact = √(2A − 1)`, `A` how often two of the circle agree about one `(thing, attribute)`.
    pub reliability: f64,
    /// Every pair co-tagged in reach, `(a, b)` with `a < b`.
    pub pairs: BTreeMap<(TagId, TagId), PairLink>,
    /// The share of linked pairs, by empirical Bayes; zero when there are no pairs.
    pub linked_share: f64,
}

/// `(sum of values, count)` per region.
type Regions = BTreeMap<u32, (f64, f64)>;

/// Every reached person's co-tagging, averaged per region by chain strength, as one reading per
/// region per outcome; then a spike-and-slab posterior per pair and the linked share over all.
fn attribute_pairs(
    snapshot: &Snapshot,
    viewer: UserId,
    chains: &Chains,
) -> (BTreeMap<(TagId, TagId), PairLink>, f64) {
    // Per tag, the chain-weighted ups and total. A pair's reading only fills a gap, which is its
    // whole score, so what reaches it through this base rate stays inside the one gap's `±L`.
    let mut base: BTreeMap<TagId, (f64, f64)> = BTreeMap::new();
    type Tally = BTreeMap<(TagId, TagId), (f64, f64, f64)>;
    let mut by_region: BTreeMap<u32, Tally> = BTreeMap::new();
    for user in snapshot.users() {
        if user == viewer || !chains.is_reached(user) {
            continue;
        }
        let weight = chains.chain[user.index()].abs();
        if weight == 0.0 {
            continue;
        }
        let mut own: BTreeMap<(TagId, TagId), (u32, u32)> = BTreeMap::new();
        let mut on_item: Vec<(TagId, i8)> = Vec::new();
        let mut current: Option<ItemId> = None;
        let flush = |on_item: &mut Vec<(TagId, i8)>,
                     own: &mut BTreeMap<(TagId, TagId), (u32, u32)>| {
            for (index, &(first, first_value)) in on_item.iter().enumerate() {
                for &(second, second_value) in &on_item[index + 1..] {
                    let entry = own.entry((first, second)).or_insert((0, 0));
                    if first_value == second_value {
                        entry.0 += 1;
                    } else {
                        entry.1 += 1;
                    }
                }
            }
            on_item.clear();
        };
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Tag(item, tag) = ratable else {
                continue;
            };
            let entry = base.entry(tag).or_insert((0.0, 0.0));
            entry.1 += weight;
            if value > 0 {
                entry.0 += weight;
            }
            if current != Some(item) {
                flush(&mut on_item, &mut own);
                current = Some(item);
            }
            on_item.push((tag, value));
        }
        flush(&mut on_item, &mut own);
        let tally = by_region.entry(chains.region[user.index()]).or_default();
        for (pair, (agreed, disagreed)) in own {
            let entry = tally.entry(pair).or_insert((0.0, 0.0, 0.0));
            entry.0 += weight * f64::from(agreed);
            entry.1 += weight * f64::from(disagreed);
            entry.2 += weight;
        }
    }
    let up = |tag: TagId| {
        base.get(&tag)
            .map_or(0.5, |&(up, total)| (up + 1.0) / (total + 2.0))
    };
    let mut readings: BTreeMap<(TagId, TagId), Vec<Reading>> = BTreeMap::new();
    for tally in by_region.values() {
        for (&(first, second), &(agreed, disagreed, weight)) in tally {
            let (one, other) = (up(first), up(second));
            let chance = one * other + (1.0 - one) * (1.0 - other);
            let list = readings.entry((first, second)).or_default();
            for (was, amount) in [(true, agreed / weight), (false, disagreed / weight)] {
                list.push(Reading {
                    agreed: was,
                    chance,
                    exposure: 0.0,
                    weight: amount,
                });
            }
        }
    }
    // (pair, slab log-marginal, spike log-likelihood, slab mean)
    let evidence: Vec<((TagId, TagId), f64, f64, f64)> = readings
        .into_iter()
        .map(|(pair, list)| {
            let slab = posterior(&list, 0.5, 2.0);
            (
                pair,
                slab.log_marginal,
                log_likelihood(&list, 0.0),
                slab.mean,
            )
        })
        .collect();
    if evidence.is_empty() {
        return (BTreeMap::new(), 0.0);
    }
    let mut share = 0.5f64;
    for _ in 0..200 {
        let next = evidence
            .iter()
            .map(|&(_, slab, spike, _)| linked(share, slab, spike))
            .sum::<f64>()
            / evidence.len() as f64;
        if (next - share).abs() < 1e-9 {
            break;
        }
        share = next.clamp(1e-6, 1.0 - 1e-6);
    }
    let pairs = evidence
        .into_iter()
        .map(|(pair, slab, spike, lambda)| {
            (
                pair,
                PairLink {
                    linked: linked(share, slab, spike),
                    reliability: lambda,
                },
            )
        })
        .collect();
    (pairs, share)
}

/// The posterior chance a pair is linked, given the share of linked pairs.
fn linked(share: f64, slab: f64, spike: f64) -> f64 {
    let top = slab.max(spike);
    let yes = share * (slab - top).exp();
    let no = (1.0 - share) * (spike - top).exp();
    yes / (yes + no)
}

/// The fact reliability and each attribute's base rate are read over the
/// circle (`circle.rs`): `λ_fact = √(2A − 1)` for `A` the share of pairs of its members who agree
/// about one `(thing, attribute)`, and an attribute's base rate its members' up-share.
pub fn facts(
    snapshot: &Snapshot,
    viewer: UserId,
    circle: &Circle,
    chains: &Chains,
    params: &Params,
) -> Facts {
    let clip = params.clip;
    let mut regions: BTreeMap<(ItemId, TagId), Regions> = BTreeMap::new();
    for user in snapshot.users() {
        if user == viewer || !chains.is_reached(user) {
            continue;
        }
        let home = chains.region[user.index()];
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Tag(item, tag) = ratable else {
                continue;
            };
            let slot = regions
                .entry((item, tag))
                .or_default()
                .entry(home)
                .or_insert((0.0, 0.0));
            slot.0 += f64::from(value);
            slot.1 += 1.0;
        }
    }
    // Per `(thing, attribute)`, the circle's ups and total.
    let mut circle_tags: BTreeMap<(ItemId, TagId), (f64, f64)> = BTreeMap::new();
    for user in circle.members() {
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Tag(item, tag) = ratable else {
                continue;
            };
            let entry = circle_tags.entry((item, tag)).or_insert((0.0, 0.0));
            entry.1 += 1.0;
            if value > 0 {
                entry.0 += 1.0;
            }
        }
    }
    let (mut agreeing, mut pairs_seen) = (0.0, 0.0);
    let mut tag_totals: BTreeMap<TagId, (f64, f64)> = BTreeMap::new();
    for (&(_, tag), &(up, total)) in &circle_tags {
        let down = total - up;
        agreeing += up * (up - 1.0) / 2.0 + down * (down - 1.0) / 2.0;
        pairs_seen += total * (total - 1.0) / 2.0;
        let entry = tag_totals.entry(tag).or_insert((0.0, 0.0));
        entry.0 += up;
        entry.1 += total;
    }
    let agreement = if pairs_seen > 0.0 {
        agreeing / pairs_seen
    } else {
        0.75
    };
    let reliability = (2.0 * agreement - 1.0).max(0.0).sqrt();
    let tag_up: BTreeMap<TagId, f64> = tag_totals
        .into_iter()
        .map(|(tag, (up, total))| (tag, (up + 1.0) / (total + 2.0)))
        .collect();
    let up_of = |tag: TagId| tag_up.get(&tag).copied().unwrap_or(0.5);

    let mut scores: BTreeMap<Ratable, Score> = BTreeMap::new();
    for (&(item, tag), by_region) in &regions {
        let up = up_of(tag);
        let evidence: f64 = by_region
            .values()
            .map(|&(sum, count)| {
                let ups = (sum + count) / 2.0;
                (ups * thumb_evidence(reliability, up, 1, clip)
                    + (count - ups) * thumb_evidence(reliability, up, -1, clip))
                    / count
            })
            .sum();
        let score = inside(evidence / 2.0);
        let chance = (score + 1.0) / 2.0;
        // Everyone in a region is read at the one fact reliability, so its average is plain.
        let worth: f64 = if reliability == 0.0 {
            0.0
        } else {
            by_region
                .values()
                .map(|&(sum, count)| {
                    let ups = (sum + count) / 2.0;
                    (ups * answer_share(reliability, up, 1, chance)
                        + (count - ups) * answer_share(reliability, up, -1, chance))
                        / count
                })
                .sum()
        };
        scores.insert(
            Ratable::Tag(item, tag),
            Score {
                score,
                confidence: worth,
            },
        );
    }

    let (pairs, linked_share) = attribute_pairs(snapshot, viewer, chains);
    let mut partners: BTreeMap<TagId, Vec<(TagId, f64)>> = BTreeMap::new();
    for (&(first, second), link) in &pairs {
        if link.used() {
            partners
                .entry(first)
                .or_default()
                .push((second, link.reliability));
            partners
                .entry(second)
                .or_default()
                .push((first, link.reliability));
        }
    }
    if !partners.is_empty() {
        let items: BTreeSet<ItemId> = regions.keys().map(|&(item, _)| item).collect();
        let tags: BTreeSet<TagId> = regions.keys().map(|&(_, tag)| tag).collect();
        for &item in &items {
            for &target in &tags {
                if regions.contains_key(&(item, target)) {
                    continue;
                }
                let Some(list) = partners.get(&target) else {
                    continue;
                };
                let up = up_of(target);
                // Only tagged partners are sources: a gap filled earlier in this loop would make
                // the fill depend on tag order and count its own sources twice.
                let sources: Vec<f64> = list
                    .iter()
                    .filter_map(|&(source, lambda)| {
                        if !regions.contains_key(&(item, source)) {
                            return None;
                        }
                        let score = scores.get(&Ratable::Tag(item, source))?.score;
                        let composed = lambda * score;
                        (composed != 0.0).then_some(composed)
                    })
                    .collect();
                let weight: f64 = sources.iter().map(|composed| composed.abs()).sum();
                let evidence: f64 = sources
                    .iter()
                    .map(|&composed| composed.abs() * thumb_evidence(composed, up, 1, clip))
                    .sum();
                if weight == 0.0 || evidence == 0.0 {
                    continue;
                }
                // The sources pointing at one gap are one voice.
                let score = inside(evidence / weight / 2.0);
                let chance = (score + 1.0) / 2.0;
                let worth = sources
                    .iter()
                    .map(|&composed| composed.abs() * answer_share(composed, up, 1, chance))
                    .sum::<f64>()
                    / weight;
                scores.insert(
                    Ratable::Tag(item, target),
                    Score {
                        score,
                        confidence: worth,
                    },
                );
            }
        }
    }
    Facts {
        scores,
        reliability,
        pairs,
        linked_share,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::witness::chains::chains;
    use crate::witness::circle::BaseRates;

    fn run(snapshot: &Snapshot, viewer: UserId) -> Facts {
        let circle = Circle::of(snapshot, viewer);
        let rates = BaseRates::over(snapshot, &circle);
        let params = Params::default();
        let found = chains(snapshot, viewer, &rates, &circle, &params);
        facts(snapshot, viewer, &circle, &found, &params)
    }

    #[test]
    fn agreeing_taggers_make_a_confident_fact_and_a_fact_reliability() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friends: Vec<UserId> = (0..4)
            .map(|index| builder.user(&format!("f{index}")))
            .collect();
        let quiet = builder.tag("quiet");
        let cafe = builder.item("cafe");
        let bar = builder.item("bar");
        for &friend in &friends {
            builder
                .edge(viewer, friend)
                .rate(friend, Ratable::Tag(cafe, quiet), 1)
                .rate(friend, Ratable::Tag(bar, quiet), -1);
        }
        let snapshot = builder.build();
        let found = run(&snapshot, viewer);
        assert!((found.reliability - 1.0).abs() < 1e-12, "everyone agrees");
        assert!(found.scores[&Ratable::Tag(cafe, quiet)].score > 0.5);
        assert!(found.scores[&Ratable::Tag(bar, quiet)].score < -0.5);
        assert!(found.scores[&Ratable::Tag(cafe, quiet)].confidence > 1.0);
    }

    /// A thousand bots behind one friend tagging a thing are one region's voice.
    #[test]
    fn taggers_behind_one_friend_are_one_voice() {
        let build = |bots: usize| {
            let mut builder = Snapshot::builder();
            let viewer = builder.user("viewer");
            let friend = builder.user("friend");
            let honest = builder.user("honest");
            let tag = builder.tag("cheap");
            let item = builder.item("place");
            let other = builder.item("other");
            builder
                .edge(viewer, friend)
                .edge(viewer, honest)
                .rate(honest, Ratable::Tag(other, tag), 1)
                .rate(friend, Ratable::Tag(other, tag), 1);
            for index in 0..bots {
                let bot = builder.user(&format!("b{index}"));
                builder
                    .edge(friend, bot)
                    .rate(bot, Ratable::Tag(item, tag), 1);
            }
            (builder.build(), viewer, Ratable::Tag(item, tag))
        };
        let (few, viewer, ratable) = build(1);
        let (many, _, _) = build(300);
        let one = run(&few, viewer).scores[&ratable];
        let lots = run(&many, viewer).scores[&ratable];
        assert!(
            lots.score <= one.score + 0.05,
            "{} against {}",
            lots.score,
            one.score
        );
        assert!(lots.confidence <= 1.0 + 1e-12);
    }

    #[test]
    fn a_pair_that_always_goes_together_fills_a_gap_and_independent_ones_do_not() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friends: Vec<UserId> = (0..6)
            .map(|index| builder.user(&format!("f{index}")))
            .collect();
        let quiet = builder.tag("quiet");
        let loud = builder.tag("loud");
        for &friend in &friends {
            builder.edge(viewer, friend);
        }
        for index in 0..40 {
            let item = builder.item(&format!("i{index}"));
            let is_quiet = if index % 2 == 0 { 1 } else { -1 };
            for &friend in &friends {
                builder
                    .rate(friend, Ratable::Tag(item, quiet), is_quiet)
                    .rate(friend, Ratable::Tag(item, loud), -is_quiet);
            }
        }
        let gap_item = builder.item("gap");
        builder.rate(friends[0], Ratable::Tag(gap_item, quiet), 1);
        let snapshot = builder.build();
        let found = run(&snapshot, viewer);
        let link = found.pairs[&(quiet, loud)];
        assert!(link.used() && link.reliability < -0.5, "{link:?}");
        let filled = found.scores[&Ratable::Tag(gap_item, loud)];
        assert!(filled.score < 0.0, "quiet reads as not loud: {filled:?}");
        assert!(filled.confidence > 0.0 && filled.confidence <= 1.0);
    }

    /// `quiet` and `loud` go together, and `loud` and `calm`, but nobody co-tagged `quiet` with
    /// `calm`. A thing tagged only `quiet` fills `loud` and leaves `calm` unscored: a filled gap
    /// is not a source for another.
    #[test]
    fn a_filled_gap_fills_no_other() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friends: Vec<UserId> = (0..6)
            .map(|index| builder.user(&format!("f{index}")))
            .collect();
        let quiet = builder.tag("quiet");
        let loud = builder.tag("loud");
        let calm = builder.tag("calm");
        for &friend in &friends {
            builder.edge(viewer, friend);
        }
        for index in 0..40 {
            let item = builder.item(&format!("i{index}"));
            let value = if index % 2 == 0 { 1 } else { -1 };
            let (first, second, together) = if index < 20 {
                (quiet, loud, -value)
            } else {
                (loud, calm, value)
            };
            for &friend in &friends {
                builder.rate(friend, Ratable::Tag(item, first), value).rate(
                    friend,
                    Ratable::Tag(item, second),
                    together,
                );
            }
        }
        let gap_item = builder.item("gap");
        builder.rate(friends[0], Ratable::Tag(gap_item, quiet), 1);
        let snapshot = builder.build();
        let found = run(&snapshot, viewer);
        assert!(found.pairs[&(quiet, loud)].used() && found.pairs[&(loud, calm)].used());
        assert!(!found.pairs.contains_key(&(quiet, calm)));
        assert!(found.scores.contains_key(&Ratable::Tag(gap_item, loud)));
        assert!(!found.scores.contains_key(&Ratable::Tag(gap_item, calm)));
    }

    #[test]
    fn nobody_tagging_anything_is_an_empty_answer() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        builder.edge(viewer, friend);
        let snapshot = builder.build();
        let found = run(&snapshot, viewer);
        assert!(found.scores.is_empty() && found.pairs.is_empty());
        assert_eq!(found.linked_share, 0.0);
    }

    #[test]
    fn the_linked_chance_follows_the_share() {
        assert!((linked(0.5, 0.0, 0.0) - 0.5).abs() < 1e-12);
        assert!(linked(0.5, 2.0, 0.0) > 0.5);
        assert!(linked(0.1, 0.0, 0.0) < 0.5);
    }
}
