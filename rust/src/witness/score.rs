//! Every item's score as the sum of its regions' averages plus a starting point, and the certainty
//! behind it (DESIGN §2.2, §2.4, §2.6).

use std::collections::BTreeMap;

use crate::ids::{ItemId, Ratable, UserId};
use crate::params::Params;
use crate::score::Score;
use crate::snapshot::Snapshot;
use crate::witness::chains::Chains;
use crate::witness::channel::{answer_share, thumb_evidence};
use crate::witness::circle::BaseRates;

/// `tanh(half_log_odds)`, strictly inside `(−1, 1)`: past about 19 the hyperbolic tangent rounds
/// to exactly one, and a score of one is a certainty no finite evidence gives.
pub fn inside(half_log_odds: f64) -> f64 {
    const EDGE: f64 = 1.0 - f64::EPSILON;
    half_log_odds.tanh().clamp(-EDGE, EDGE)
}

/// One region's pool on one item.
#[derive(Clone, Copy, Debug, Default)]
struct Pool {
    region: u32,
    /// `Σ |λ| · clip(LLR)`.
    evidence: f64,
    /// `Σ |λ|`.
    weight: f64,
    /// `Σ |λ|` over the ups.
    ups: f64,
    /// The strongest rater's `|λ|`: the region's say on the starting point.
    strongest: f64,
    /// `Σ |λ| · ρ`, filled once the score is known.
    known: f64,
}

/// One thumb that entered a pool.
struct Thumb {
    item: ItemId,
    pool: usize,
    lambda: f64,
    up: f64,
    value: i8,
}

/// Every item anyone reached rated, scored for the viewer. `reliability_on` is the reliability a
/// person's thumb on an item is read at, per attribute where the item carries any (DESIGN §2.8).
pub fn item_scores(
    snapshot: &Snapshot,
    viewer: UserId,
    rates: &BaseRates,
    chains: &Chains,
    reliability_on: &dyn Fn(UserId, ItemId) -> f64,
    params: &Params,
) -> BTreeMap<Ratable, Score> {
    // A thumb's evidence is judged against the base rate a guess would be drawn from: how the thing
    // is rated around the guesser, which is the circle and the guesser's own region. The region can
    // only move its own members' evidence this way, and a swarm agreeing with itself on a thing only
    // it rated is no surprise to itself. Against the circle alone, a promoted thing nobody in it had
    // rated sat at an even chance, and every bot's thumb on it was a surprise: `+0.13` against
    // `+0.09`. Reliabilities are learned against the circle alone (`chains.rs`), because the
    // regions are not known until the chains are, and a head's reliability must not depend on who
    // is behind them.
    //
    // Per item, per region: the ups and thumbs of its members outside the circle.
    let mut around: Vec<BTreeMap<u32, (u32, u32)>> = vec![BTreeMap::new(); snapshot.item_count()];
    for user in snapshot.users() {
        if user == viewer || !chains.is_reached(user) || rates.is_member(user) {
            continue;
        }
        let home = chains.region[user.index()];
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Item(item) = ratable else {
                break;
            };
            let entry = around[item.index()].entry(home).or_insert((0, 0));
            entry.1 += 1;
            if value > 0 {
                entry.0 += 1;
            }
        }
    }
    let mut pools: Vec<Vec<Pool>> = vec![Vec::new(); snapshot.item_count()];
    let mut thumbs: Vec<Thumb> = Vec::new();
    for user in snapshot.users() {
        if user == viewer || !chains.is_reached(user) {
            continue;
        }
        let home = chains.region[user.index()];
        for &(ratable, value) in snapshot.ratings(user) {
            let Ratable::Item(item) = ratable else {
                break;
            };
            let slot = &mut pools[item.index()];
            let pool = match slot.iter().position(|pool| pool.region == home) {
                Some(found) => found,
                None => {
                    slot.push(Pool {
                        region: home,
                        ..Pool::default()
                    });
                    slot.len() - 1
                }
            };
            let lambda = reliability_on(user, item);
            if lambda == 0.0 {
                continue;
            }
            let knows = lambda.abs();
            let (mut region_up, mut region_total) =
                around[item.index()].get(&home).copied().unwrap_or((0, 0));
            if !rates.is_member(user) {
                region_total -= 1;
                if value > 0 {
                    region_up -= 1;
                }
            }
            let up = rates.up_with(item, (region_up, region_total), &[(user, value)]);
            let entry = &mut slot[pool];
            entry.evidence += knows * thumb_evidence(lambda, up, value, params.clip);
            entry.weight += knows;
            if value > 0 {
                entry.ups += knows;
            }
            entry.strongest = entry.strongest.max(knows);
            thumbs.push(Thumb {
                item,
                pool,
                lambda,
                up,
                value,
            });
        }
    }
    let mut chance = vec![0.5f64; snapshot.item_count()];
    let mut scores: BTreeMap<Ratable, f64> = BTreeMap::new();
    for (index, slot) in pools.iter().enumerate() {
        if slot.is_empty() {
            continue;
        }
        // (evidence, the regions' weighted ups, the regions' say)
        let (mut evidence, mut ups, mut say) = (0.0, 0.0, 0.0);
        for pool in slot.iter().filter(|pool| pool.weight > 0.0) {
            evidence += pool.evidence / pool.weight;
            ups += pool.strongest * pool.ups / pool.weight;
            say += pool.strongest;
        }
        let rate = (1.0 + ups) / (2.0 + say);
        let score = inside(((rate / (1.0 - rate)).ln() + evidence) / 2.0);
        chance[index] = (score + 1.0) / 2.0;
        scores.insert(Ratable::Item(ItemId(index as u32)), score);
    }
    // Each thumb's chance of being the viewer's own answer rather than a guess, averaged per
    // region as its evidence is and summed over regions: the thumbs are worth that many of the
    // viewer's own.
    for thumb in &thumbs {
        let share = answer_share(
            thumb.lambda,
            thumb.up,
            thumb.value,
            chance[thumb.item.index()],
        );
        pools[thumb.item.index()][thumb.pool].known += thumb.lambda.abs() * share;
    }
    scores
        .into_iter()
        .map(|(ratable, score)| {
            let worth: f64 = pools[ratable.item().index()]
                .iter()
                .filter(|pool| pool.weight > 0.0)
                .map(|pool| pool.known / pool.weight)
                .sum();
            (
                ratable,
                Score {
                    score,
                    confidence: worth,
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::witness::chains::chains;
    use crate::witness::circle::Circle;

    fn scored(snapshot: &Snapshot, viewer: UserId) -> (BTreeMap<Ratable, Score>, Chains) {
        let circle = Circle::of(snapshot, viewer);
        let rates = BaseRates::over(snapshot, &circle);
        let params = Params::default();
        let found = chains(snapshot, viewer, &rates, &circle, &params);
        let reliability = |user: UserId, _: ItemId| found.reliability[user.index()];
        (
            item_scores(snapshot, viewer, &rates, &found, &reliability, &params),
            found.clone(),
        )
    }

    /// One friend with no history, one up: the region's evidence is that thumb's clipped ratio
    /// at the prior reliability, the starting point `(1 + λ)/(2 + λ)`.
    #[test]
    fn one_friend_one_thumb_by_hand() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let item = Ratable::Item(builder.item("thing"));
        builder.edge(viewer, friend).rate(friend, item, 1);
        let snapshot = builder.build();
        let (scores, found) = scored(&snapshot, viewer);
        let lambda = found.reliability[friend.index()];
        let up = 0.5;
        let evidence = thumb_evidence(lambda, up, 1, 2.0);
        let rate = (1.0 + lambda) / (2.0 + lambda);
        let expected = (((rate / (1.0 - rate)).ln() + evidence) / 2.0).tanh();
        assert!((scores[&item].score - expected).abs() < 1e-12);
        let share = answer_share(lambda, up, 1, (expected + 1.0) / 2.0);
        assert!((scores[&item].confidence - share).abs() < 1e-12);
        assert!(scores[&item].confidence > 0.0 && scores[&item].confidence < 1.0);
    }

    /// A thousand accounts behind one friend say what one of them says when they all agree.
    #[test]
    fn a_region_is_one_voice() {
        let build = |behind: usize| {
            let mut builder = Snapshot::builder();
            let viewer = builder.user("viewer");
            let friend = builder.user("friend");
            let item = Ratable::Item(builder.item("thing"));
            builder.edge(viewer, friend);
            for index in 0..behind {
                let bot = builder.user(&format!("bot{index}"));
                builder.edge(friend, bot).rate(bot, item, 1);
            }
            (builder.build(), viewer, item)
        };
        let (one, viewer, item) = build(1);
        let (many, _, _) = build(200);
        let (one_scores, _) = scored(&one, viewer);
        let (many_scores, _) = scored(&many, viewer);
        assert!(one_scores[&item].score > 0.0);
        assert!(many_scores[&item].score <= one_scores[&item].score + 1e-12);
        assert!(many_scores[&item].confidence <= 1.0);
    }

    /// Two friends who split on a thing leave it at the middle, with evidence behind it.
    #[test]
    fn a_split_sits_at_the_middle_with_evidence_behind_it() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let one = builder.user("one");
        let other = builder.user("other");
        let item = Ratable::Item(builder.item("thing"));
        builder
            .edge(viewer, one)
            .edge(viewer, other)
            .rate(one, item, 1)
            .rate(other, item, -1);
        let snapshot = builder.build();
        let (scores, _) = scored(&snapshot, viewer);
        assert!(scores[&item].score.abs() < 1e-12);
        assert!(scores[&item].confidence > 0.0);
    }

    #[test]
    fn nobody_reached_means_no_entry() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let stranger = builder.user("stranger");
        let item = Ratable::Item(builder.item("thing"));
        builder.rate(stranger, item, 1);
        let snapshot = builder.build();
        let (scores, _) = scored(&snapshot, viewer);
        assert!(scores.is_empty());
    }
}
