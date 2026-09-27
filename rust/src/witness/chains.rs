//! How reliable each directly trusted person is (DESIGN §2.3), the chains that carry trust further
//! out and the regions they define (§2.4), and how far a person's own history with the viewer may
//! move them: predictions up to the head of their chain, later thumbs up to their own chain.

use std::collections::{BTreeMap, BinaryHeap};

use crate::ids::{ItemId, Ratable, UserId};
use crate::params::Params;
use crate::snapshot::Snapshot;
use crate::witness::channel::{Reading, posterior};
use crate::witness::circle::{BaseRates, Circle};

/// Marks a person no chain reached.
pub const NONE: u32 = u32::MAX;

/// One shared item as evidence about a witness.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Evidence {
    pub item: ItemId,
    pub reading: Reading,
    /// The witness's thumb came after the holder's.
    pub later: bool,
}

/// `witness`'s item thumbs read against `holder`'s on the things both rated. A later thumb
/// carries `exposure`; with `every_thumb_exposed`, every thumb does, which is how a chain link is
/// read: a stamp orders a thumb against the viewer's and nobody else's (DESIGN §3.4), so between
/// two people who are not the viewer the order is not known.
pub fn readings(
    snapshot: &Snapshot,
    rates: &BaseRates,
    holder: UserId,
    witness: UserId,
    exposure: f64,
    every_thumb_exposed: bool,
) -> Vec<Evidence> {
    let mine = snapshot.ratings(holder);
    let my_stamps = snapshot.stamps(holder);
    let theirs = snapshot.ratings(witness);
    let their_stamps = snapshot.stamps(witness);
    let mut out = Vec::new();
    let (mut here, mut there) = (0usize, 0usize);
    while here < mine.len() && there < theirs.len() {
        let (my_ratable, my_value) = mine[here];
        let (their_ratable, their_value) = theirs[there];
        // Items sort before tags, so the first tag on either side ends the shared items.
        let (Ratable::Item(item), true) = (my_ratable, their_ratable.is_item()) else {
            break;
        };
        match my_ratable.cmp(&their_ratable) {
            std::cmp::Ordering::Less => here += 1,
            std::cmp::Ordering::Greater => there += 1,
            std::cmp::Ordering::Equal => {
                let up = rates.up(item, &[(holder, my_value), (witness, their_value)]);
                let later = their_stamps[there] > my_stamps[here];
                out.push(Evidence {
                    item,
                    reading: Reading {
                        agreed: my_value == their_value,
                        chance: if my_value > 0 { up } else { 1.0 - up },
                        exposure: if later || every_thumb_exposed {
                            exposure
                        } else {
                            0.0
                        },
                        weight: 1.0,
                    },
                    later,
                });
                here += 1;
                there += 1;
            }
        }
    }
    out
}

pub fn plain(evidence: &[Evidence]) -> Vec<Reading> {
    evidence.iter().map(|found| found.reading).collect()
}

/// The earlier thumbs only: predictions, never reactions.
pub fn earlier(evidence: &[Evidence]) -> Vec<Reading> {
    evidence
        .iter()
        .filter(|found| !found.later)
        .map(|found| found.reading)
        .collect()
}

/// Every chain, region and reliability, by user index.
#[derive(Clone, Debug)]
pub struct Chains {
    /// The strongest chain's signed reliability; zero for the viewer and anyone unreached.
    pub chain: Vec<f64>,
    /// The index of the directly trusted person heading each person's region, or `NONE`.
    pub region: Vec<u32>,
    /// The reliability each person's item thumbs are read at, after the cap.
    pub reliability: Vec<f64>,
    /// Whether the viewer trusts this person directly.
    pub direct: Vec<bool>,
    /// Each reached person's shared items with the viewer, read with their own exposure: every
    /// directly trusted person (possibly empty), and everyone else who shares any.
    pub history: BTreeMap<UserId, Vec<Evidence>>,
}

impl Chains {
    pub fn is_reached(&self, user: UserId) -> bool {
        self.region[user.index()] != NONE
    }

    /// `|λ|` of the head of `user`'s region.
    pub fn head(&self, user: UserId) -> f64 {
        self.chain[self.region[user.index()] as usize].abs()
    }
}

/// `v`'s own exposure: one voice among the people `v` trusts (DESIGN section 2.3).
fn own_exposure(snapshot: &Snapshot, user: UserId) -> f64 {
    1.0 / snapshot.friends(user).len().max(1) as f64
}

/// Ordered key for a max-heap over chain strengths in `[0, 1]`.
fn key(strength: f64) -> u64 {
    strength.max(0.0).to_bits()
}

/// The larger in magnitude of two capped posteriors (DESIGN §2.4): one over the thumbs given
/// before the viewer's, capped at the head's reliability, and one over all of them, capped at the
/// person's own chain. Also the rule per attribute, with a different prior centre and strength.
pub fn capped(
    evidence: &[Evidence],
    centre: f64,
    strength: f64,
    head: f64,
    own: f64,
) -> (f64, Vec<Reading>) {
    let all = plain(evidence);
    let lambda = posterior(&all, (1.0 + centre) / 2.0, strength).mean;
    let before = earlier(evidence);
    let predicted = if before.is_empty() {
        centre
    } else {
        posterior(&before, (1.0 + centre) / 2.0, strength).mean
    };
    let by_predictions = predicted.signum() * predicted.abs().min(head);
    let by_all = lambda.signum() * lambda.abs().min(own);
    let chosen = if by_predictions.abs() >= by_all.abs() {
        by_predictions
    } else {
        by_all
    };
    (chosen, all)
}

/// Chains, regions and capped reliabilities for one viewer. Only the loaded people connected to
/// the viewer are reached.
pub fn chains(
    snapshot: &Snapshot,
    viewer: UserId,
    rates: &BaseRates,
    circle: &Circle,
    params: &Params,
) -> Chains {
    let hops = &circle.hops;
    let count = snapshot.user_count();
    let (rate, strength) = (params.prior_agreement, params.prior_strength);
    let mut chain = vec![0.0f64; count];
    let mut region = vec![NONE; count];
    let mut done = vec![false; count];
    let mut direct = vec![false; count];
    let mut history: BTreeMap<UserId, Vec<Evidence>> = BTreeMap::new();
    let mut heap: BinaryHeap<(u64, u32)> = BinaryHeap::new();
    for &friend in snapshot.friends(viewer) {
        if !circle.is_counted(friend) {
            continue;
        }
        direct[friend.index()] = true;
        let evidence = readings(
            snapshot,
            rates,
            viewer,
            friend,
            own_exposure(snapshot, friend),
            false,
        );
        let lambda = posterior(&plain(&evidence), rate, strength).mean;
        history.insert(friend, evidence);
        chain[friend.index()] = lambda;
        region[friend.index()] = friend.0;
        heap.push((key(lambda.abs()), friend.0));
    }
    while let Some((_, node)) = heap.pop() {
        let node = UserId(node);
        if done[node.index()] {
            continue;
        }
        done[node.index()] = true;
        for &other in snapshot.friends(node) {
            // A link can only shrink a chain, so one that cannot beat what `other` has is not
            // worth learning.
            if other == viewer
                || !circle.is_counted(other)
                || done[other.index()]
                || direct[other.index()]
                || chain[node.index()].abs() <= chain[other.index()].abs()
            {
                continue;
            }
            // The link's exposure: `other` hears `node` through their connections nearer the
            // viewer, so a bot whose only way toward the viewer is its gatekeeper saw everything
            // the gatekeeper said, however many other bots it is connected to.
            let upstream = snapshot
                .friends(other)
                .iter()
                .filter(|&&next| hops[next.index()] < hops[other.index()])
                .count()
                .max(1) as f64;
            let link = posterior(
                &plain(&readings(
                    snapshot,
                    rates,
                    node,
                    other,
                    1.0 / upstream,
                    true,
                )),
                rate,
                strength,
            )
            .mean;
            let candidate = chain[node.index()] * link;
            if candidate.abs() > chain[other.index()].abs() {
                chain[other.index()] = candidate;
                region[other.index()] = region[node.index()];
                heap.push((key(candidate.abs()), other.0));
            }
        }
    }

    let mut reliability = vec![0.0f64; count];
    for user in snapshot.users() {
        if region[user.index()] == NONE {
            continue;
        }
        if direct[user.index()] {
            reliability[user.index()] = chain[user.index()];
            continue;
        }
        let evidence = readings(
            snapshot,
            rates,
            viewer,
            user,
            own_exposure(snapshot, user),
            false,
        );
        if evidence.is_empty() {
            reliability[user.index()] = chain[user.index()];
            continue;
        }
        let head = chain[region[user.index()] as usize].abs();
        let own = chain[user.index()];
        let (chosen, _) = capped(&evidence, own, strength, head, own.abs());
        reliability[user.index()] = chosen;
        history.insert(user, evidence);
    }
    Chains {
        chain,
        region,
        reliability,
        direct,
        history,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(snapshot: &Snapshot, viewer: UserId) -> Chains {
        let circle = Circle::of(snapshot, viewer);
        let rates = BaseRates::over(snapshot, &circle);
        chains(snapshot, viewer, &rates, &circle, &Params::default())
    }

    /// viewer — friend — middle — far, and a stranger nobody is connected to.
    fn line() -> (Snapshot, [UserId; 5]) {
        let mut builder = Snapshot::builder();
        let people = [
            builder.user("viewer"),
            builder.user("friend"),
            builder.user("middle"),
            builder.user("far"),
            builder.user("stranger"),
        ];
        builder
            .edge(people[0], people[1])
            .edge(people[1], people[2])
            .edge(people[2], people[3]);
        (builder.build(), people)
    }

    #[test]
    fn a_later_thumb_is_marked_and_carries_exposure() {
        let mut builder = Snapshot::builder();
        let holder = builder.user("holder");
        let witness = builder.user("witness");
        let first = Ratable::Item(builder.item("first"));
        let second = Ratable::Item(builder.item("second"));
        builder
            .rate_at(holder, first, 1, 0)
            .rate_at(witness, first, 1, 0)
            .rate_at(holder, second, 1, 0)
            .rate_at(witness, second, -1, 2);
        builder.edge(holder, witness);
        let snapshot = builder.build();
        let circle = Circle::of(&snapshot, holder);
        let rates = BaseRates::over(&snapshot, &circle);
        let found = readings(&snapshot, &rates, holder, witness, 0.25, false);
        assert_eq!(found.len(), 2);
        assert!(!found[0].later && found[0].reading.exposure == 0.0 && found[0].reading.agreed);
        assert!(found[1].later && found[1].reading.exposure == 0.25 && !found[1].reading.agreed);
        let link = readings(&snapshot, &rates, holder, witness, 0.25, true);
        assert!(
            link.iter()
                .all(|evidence| evidence.reading.exposure == 0.25)
        );
    }

    #[test]
    fn chains_multiply_along_the_strongest_path_and_stop_at_the_unconnected() {
        let (snapshot, [viewer, friend, middle, far, stranger]) = line();
        let found = run(&snapshot, viewer);
        let prior = Params::default().prior_reliability();
        // No history anywhere: every link sits at its prior, so the chain is its power.
        assert!((found.chain[friend.index()] - prior).abs() < 0.01);
        let link = found.chain[middle.index()] / found.chain[friend.index()];
        assert!((found.chain[far.index()] - found.chain[middle.index()] * link).abs() < 1e-12);
        for user in [friend, middle, far] {
            assert_eq!(found.region[user.index()], friend.0);
            assert_eq!(found.reliability[user.index()], found.chain[user.index()]);
        }
        assert!(!found.is_reached(stranger) && !found.is_reached(viewer));
        assert!(found.direct[friend.index()] && !found.direct[middle.index()]);
    }

    #[test]
    fn an_unloaded_person_is_not_reached() {
        let (snapshot, [viewer, _, middle, far, _]) = line();
        let mut builder = snapshot.edit();
        builder.set_loaded(middle, false);
        let partial = builder.build();
        let found = run(&partial, viewer);
        assert!(!found.is_reached(middle) && !found.is_reached(far));
    }

    #[test]
    fn own_history_raises_nobody_past_the_head_and_later_thumbs_not_past_the_chain() {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let friend = builder.user("friend");
        let early = builder.user("early");
        let late = builder.user("late");
        builder
            .edge(viewer, friend)
            .edge(friend, early)
            .edge(friend, late);
        for index in 0..30 {
            let item = Ratable::Item(builder.item(&format!("i{index}")));
            let value = if index % 3 == 0 { -1 } else { 1 };
            builder
                .rate_at(viewer, item, value, 1)
                .rate_at(early, item, value, 0)
                .rate_at(late, item, value, 2);
        }
        let snapshot = builder.build();
        let found = run(&snapshot, viewer);
        let head = found.chain[friend.index()].abs();
        // Thirty predictions: raised past the chain, but no further than the head.
        assert!(found.reliability[early.index()] > found.chain[early.index()]);
        assert!(found.reliability[early.index()] <= head + 1e-12);
        // Thirty copies after the fact: no further than their own chain.
        assert!(found.reliability[late.index()] <= found.chain[late.index()].abs() + 1e-12);
    }

    #[test]
    fn the_cap_picks_the_larger_of_the_two_limits() {
        let reading = |agreed: bool, later: bool| Evidence {
            item: ItemId(0),
            reading: Reading {
                agreed,
                chance: 0.5,
                exposure: if later { 0.1 } else { 0.0 },
                weight: 1.0,
            },
            later,
        };
        let predictions = vec![reading(true, false); 20];
        let (chosen, _) = capped(&predictions, 0.1, 8.0, 0.4, 0.1);
        assert!((chosen - 0.4).abs() < 1e-12, "predictions reach the head");
        let copies = vec![reading(true, true); 20];
        let (chosen, _) = capped(&copies, 0.1, 8.0, 0.4, 0.1);
        assert!((chosen - 0.1).abs() < 1e-12, "copies stay at the chain");
    }
}
