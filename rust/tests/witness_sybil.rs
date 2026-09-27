//! DESIGN §2.5's bound on the witness model, as a property over every attack plan below.
//!
//! The claim (`docs/witness-model.md` §1.4): a set of accounts `S` every trust path to which passes
//! a person `h` sits inside the region of `h`'s head `f`, reads at most `|λ_f|`, and moves the
//! viewer's log-odds on any one thing by at most `2L + ln 2` — the region's average swung from one
//! end of `[−L, L]` to the other, plus the starting point — per accepted connection, whatever the
//! number of accounts. `λ_f` itself moves only through the one caveat: bots connected to `f` lower
//! `f`'s exposure, so `f`'s later thumbs count differently.
//!
//! Every plan, every shape of `attack.rs`, one to two hundred accounts, behind one to three of the
//! viewer's connections. The plans that copy a feed copy this model's, through `compute_user`.
//! The claims below are numbered as the steps of that proof.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use grapevine_core::witness::{Params, UserDetail, compute_user, compute_user_detail};
use grapevine_core::{
    Ratable, Rng, Snapshot, SnapshotBuilder, SybilConfig, SybilShape, SybilStrategy, TagId, UserId,
    WorldConfig, add_sybils, simulate,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Plan {
    PromoteOnly,
    CopyViewer,
    /// Copy the viewer, and tag every other thing copied and the promoted thing with the attribute
    /// most often tagged on the viewer's things: per-attribute reliability, aimed at.
    CopyViewerTagged,
    CopyConsensus,
    ManufactureContested,
    TagSpam,
    CopyWitnessFeed,
    /// Copy this model's feed, then half of each group inverts what it copied.
    SplitWitnessFeed,
}

const PLANS: [Plan; 8] = [
    Plan::PromoteOnly,
    Plan::CopyViewer,
    Plan::CopyViewerTagged,
    Plan::CopyConsensus,
    Plan::ManufactureContested,
    Plan::TagSpam,
    Plan::CopyWitnessFeed,
    Plan::SplitWitnessFeed,
];

const SHAPES: [SybilShape; 3] = [
    SybilShape::Clique,
    SybilShape::Chain,
    SybilShape::StarOfChains,
];

const PROMOTED: &str = "the-business";

/// Stamps: the viewer's thumbs are given in the world's order, and every bot's after all of them.
const BOT_STAMP: u32 = u32::MAX - 1;

fn world() -> Snapshot {
    simulate(
        &WorldConfig {
            users: 60,
            items: 120,
            consensus_items: 10,
            // Kinds of thing, so that bots copying rated things are also read per attribute.
            tag_rated_fraction: 0.3,
            cluster_proportions: vec![1.0 / 3.0; 3],
            ..WorldConfig::default()
        },
        &mut Rng::new(31),
    )
    .snapshot
}

fn detail_of(snapshot: &Snapshot, viewer: UserId, params: &Params, what: &str) -> UserDetail {
    compute_user_detail(snapshot, viewer, params)
        .unwrap_or_else(|error| panic!("{what}: no result: {error}"))
}

/// The viewers the suite attacks: the first two with at least three connections.
fn viewers(snapshot: &Snapshot) -> Vec<UserId> {
    snapshot
        .users()
        .filter(|&user| snapshot.friends(user).len() >= 3)
        .take(2)
        .collect()
}

/// `attack.rs`'s shapes, for the plans `add_sybils` does not carry.
fn wire(builder: &mut SnapshotBuilder, bots: &[UserId], gatekeeper: UserId, shape: SybilShape) {
    match shape {
        SybilShape::Clique => {
            for (index, &bot) in bots.iter().enumerate() {
                builder.edge(bot, gatekeeper);
                for &other in &bots[index + 1..] {
                    builder.edge(bot, other);
                }
            }
        }
        SybilShape::Chain => {
            if let Some(&head) = bots.first() {
                builder.edge(head, gatekeeper);
            }
            for pair in bots.windows(2) {
                builder.edge(pair[0], pair[1]);
            }
        }
        SybilShape::StarOfChains => {
            if let Some(&hub) = bots.first() {
                builder.edge(hub, gatekeeper);
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
}

/// The thumbs a bot gives by rating the sign of its own feed under this model.
fn own_feed(snapshot: &Snapshot, bot: UserId, params: &Params) -> Vec<(Ratable, i8)> {
    let result = compute_user(snapshot, bot, params)
        .unwrap_or_else(|error| panic!("a bot's own feed: {error}"));
    result
        .scores
        .iter()
        .filter(|(ratable, score)| ratable.is_item() && score.score != 0.0)
        .map(|(&ratable, score)| (ratable, if score.score > 0.0 { 1 } else { -1 }))
        .collect()
}

/// One group of accounts behind one gatekeeper.
struct Group {
    gatekeeper: UserId,
    /// Accounts wired in behind the gatekeeper.
    bots: Vec<UserId>,
    /// Accounts with no connection at all, which still rate (`ManufactureContested`).
    edgeless: Vec<UserId>,
}

/// One group per gatekeeper, following the plan, each promoting the same new thing.
fn attacked(
    honest: &Snapshot,
    viewer: UserId,
    gatekeepers: &[UserId],
    count: usize,
    shape: SybilShape,
    plan: Plan,
    params: &Params,
) -> (Snapshot, Vec<Group>) {
    let strategy = match plan {
        Plan::PromoteOnly => Some(SybilStrategy::PromoteOnly),
        Plan::CopyConsensus => Some(SybilStrategy::CopyConsensus),
        Plan::ManufactureContested => Some(SybilStrategy::ManufactureContested),
        Plan::TagSpam => Some(SybilStrategy::TagSpam),
        Plan::CopyViewer
        | Plan::CopyViewerTagged
        | Plan::CopyWitnessFeed
        | Plan::SplitWitnessFeed => None,
    };
    let mut snapshot = honest.clone();
    let mut groups = Vec::new();
    for (index, &gatekeeper) in gatekeepers.iter().enumerate() {
        if let Some(strategy) = strategy {
            let (next, set) = add_sybils(
                &snapshot,
                &SybilConfig {
                    count,
                    gatekeepers: vec![gatekeeper],
                    promoted: vec![PROMOTED.to_string()],
                    strategy,
                    shape,
                    ..SybilConfig::default()
                },
            );
            snapshot = next;
            groups.push(Group {
                gatekeeper,
                bots: set.bots,
                edgeless: set.edgeless,
            });
            continue;
        }
        let mut builder = snapshot.edit();
        let accounts: Vec<UserId> = (0..count)
            .map(|position| builder.user(&format!("g{index}b{position}")))
            .collect();
        wire(&mut builder, &accounts, gatekeeper, shape);
        let copied: Vec<(Ratable, i8)> = match plan {
            Plan::CopyViewer | Plan::CopyViewerTagged => snapshot.ratings(viewer).to_vec(),
            _ => own_feed(&builder.clone().build(), accounts[0], params),
        };
        let promoted_item = builder.item(PROMOTED);
        let promoted = Ratable::Item(promoted_item);
        let mut tagged: BTreeMap<TagId, usize> = BTreeMap::new();
        for user in snapshot.users() {
            for &(ratable, _) in snapshot.ratings(user) {
                if let Ratable::Tag(item, tag) = ratable
                    && snapshot.rating(viewer, Ratable::Item(item)).is_some()
                {
                    *tagged.entry(tag).or_insert(0) += 1;
                }
            }
        }
        let kind = tagged
            .iter()
            .max_by_key(|&(&tag, &uses)| (uses, std::cmp::Reverse(tag)))
            .map(|(&tag, _)| tag);
        for (position, &bot) in accounts.iter().enumerate() {
            let invert = plan == Plan::SplitWitnessFeed && position >= count / 2;
            for (index, &(ratable, value)) in copied.iter().enumerate() {
                builder.rate_at(bot, ratable, if invert { -value } else { value }, BOT_STAMP);
                if let (Plan::CopyViewerTagged, Some(kind), Ratable::Item(item), 0) =
                    (plan, kind, ratable, index % 2)
                {
                    builder.rate_at(bot, Ratable::Tag(item, kind), 1, BOT_STAMP);
                }
            }
            builder.rate_at(bot, promoted, 1, BOT_STAMP);
            if let (Plan::CopyViewerTagged, Some(kind)) = (plan, kind) {
                builder.rate_at(bot, Ratable::Tag(promoted_item, kind), 1, BOT_STAMP);
            }
        }
        snapshot = builder.build();
        groups.push(Group {
            gatekeeper,
            bots: accounts,
            edgeless: Vec::new(),
        });
    }
    (snapshot, groups)
}

/// `Λ = 2 artanh(s)`: the log-odds a score stands for; zero for a thing with no score.
fn log_odds(detail: &UserDetail, ratable: Ratable, what: &str) -> f64 {
    detail.result.scores.get(&ratable).map_or(0.0, |score| {
        assert!(
            score.score.is_finite() && score.score.abs() < 1.0,
            "{what}: {ratable:?} scored {}",
            score.score
        );
        assert!(
            score.confidence.is_finite() && score.confidence >= 0.0,
            "{what}: {ratable:?} has certainty {}",
            score.confidence
        );
        2.0 * score.score.atanh()
    })
}

/// The honest snapshot with each gatekeeper given as many more connections as `attacked` gave
/// them, to accounts that rate nothing and know nobody else: the gatekeepers' exposure as the
/// attack leaves it, and nothing else the attack did.
fn with_inert_connections(
    honest: &Snapshot,
    attacked: &Snapshot,
    gatekeepers: &[UserId],
) -> Snapshot {
    let mut builder = honest.edit();
    for &gatekeeper in gatekeepers {
        let extra = attacked.friends(gatekeeper).len() - honest.friends(gatekeeper).len();
        for index in 0..extra {
            let inert = builder.user(&format!("inert{}x{index}", gatekeeper.0));
            builder.edge(gatekeeper, inert);
        }
    }
    builder.build()
}

/// Which of §1.4's claims a violation breaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Claim {
    /// Step 1: every bot is in the region of the head its path passes.
    Region,
    /// Step 2: no bot reads above its head, overall or on any attribute.
    Ceiling,
    /// Steps 2 and 7: every bot thumb comes after the viewer's, and later thumbs raise nobody past
    /// their own chain — overall or on any attribute — so copying the viewer earns nothing.
    Later,
    /// Steps 4–6: at most `2L + ln 2` of log-odds per accepted connection, on every thing.
    LogOdds,
    /// Step 3's caveat: a directly trusted gatekeeper moves only through their exposure — exactly
    /// as far as the same number of connections to accounts that rate nothing would move them.
    /// Nothing tighter holds: the posterior mean is not monotone in exposure once two or more
    /// thumbs are discounted, so it need not stay between its values with the later thumbs
    /// discounted as before and counted in full.
    Caveat,
    /// Steps 1 and 3 behind a gatekeeper two steps out: the chain to the gatekeeper, the region
    /// it is in, and that region's head do not move at all.
    Untouched,
}

/// Every broken claim of every attack, computed once for the whole binary.
struct Sweep {
    violations: Vec<(Claim, String)>,
    /// How many attacks were checked, so a sweep that silently checked nothing fails.
    attacks: usize,
}

impl Sweep {
    fn check(&mut self, claim: Claim, holds: bool, message: impl FnOnce() -> String) {
        if !holds {
            self.violations.push((claim, message()));
        }
    }

    fn report(&self, claim: Claim) {
        assert!(self.attacks > 0, "no attack was checked");
        let broken: Vec<&str> = self
            .violations
            .iter()
            .filter(|(which, _)| *which == claim)
            .map(|(_, message)| message.as_str())
            .collect();
        assert!(
            broken.is_empty(),
            "{claim:?}: {} broken checks over {} attacks; the first:\n{}",
            broken.len(),
            self.attacks,
            broken[..broken.len().min(12)].join("\n")
        );
    }
}

/// §1.4's claims about one attack, against the same viewer's honest result. `heads[i]` is the
/// region head in front of group `i`.
#[allow(clippy::too_many_arguments)]
fn check_bound(
    sweep: &mut Sweep,
    honest: &UserDetail,
    after: &UserDetail,
    groups: &[Group],
    heads: &[UserId],
    accepted: usize,
    params: &Params,
    what: &str,
) {
    sweep.attacks += 1;
    for (group, &head) in groups.iter().zip(heads) {
        let ceiling = after.reliability[head.index()].abs();
        let home = after.region[group.gatekeeper.index()];
        for &bot in &group.bots {
            let region = after.region[bot.index()];
            sweep.check(Claim::Region, region.is_none() || region == home, || {
                format!(
                    "{what}: bot {} is in {region:?}, not the gatekeeper's {home:?}",
                    bot.0
                )
            });
            let reliability = after.reliability[bot.index()];
            sweep.check(
                Claim::Ceiling,
                reliability.is_finite() && reliability.abs() <= ceiling + 1e-12,
                || {
                    format!(
                        "{what}: bot {} reads at {reliability}, past its head's {ceiling}",
                        bot.0
                    )
                },
            );
            let chain = after.chain[bot.index()];
            sweep.check(
                Claim::Ceiling,
                chain.is_finite() && chain.abs() <= ceiling + 1e-12,
                || {
                    format!(
                        "{what}: bot {} is chained at {chain}, past its head's {ceiling}",
                        bot.0
                    )
                },
            );
            sweep.check(
                Claim::Later,
                reliability.abs() <= chain.abs() + 1e-12,
                || {
                    format!(
                        "{what}: bot {} reads at {reliability} on later thumbs alone, past its \
                         chain {chain}",
                        bot.0
                    )
                },
            );
            for (tag, &value) in &after.attribute_reliability[bot.index()] {
                sweep.check(Claim::Later, value.abs() <= chain.abs() + 1e-12, || {
                    format!(
                        "{what}: bot {} reads at {value} on attribute {tag:?} on later thumbs \
                         alone, past its chain {chain}",
                        bot.0
                    )
                });
                sweep.check(
                    Claim::Ceiling,
                    value.is_finite() && value.abs() <= ceiling + 1e-12,
                    || {
                        format!(
                            "{what}: bot {} reads at {value} on attribute {tag:?}, past its \
                             head's {ceiling}",
                            bot.0
                        )
                    },
                );
            }
        }
        for &account in &group.edgeless {
            sweep.check(
                Claim::Region,
                after.region[account.index()].is_none()
                    && after.reliability[account.index()] == 0.0,
                || {
                    format!(
                        "{what}: account {}, connected to nobody, was reached",
                        account.0
                    )
                },
            );
        }
    }

    let bound = accepted as f64 * (2.0 * params.clip + std::f64::consts::LN_2);
    let ratables: BTreeSet<Ratable> = honest
        .result
        .scores
        .keys()
        .chain(after.result.scores.keys())
        .copied()
        .collect();
    for ratable in ratables {
        let moved = log_odds(after, ratable, what) - log_odds(honest, ratable, what);
        sweep.check(Claim::LogOdds, moved.abs() <= bound + 1e-9, || {
            format!(
                "{what}: {ratable:?} moved {moved:+} of log-odds, past {bound} for {accepted} \
                 accepted connections"
            )
        });
    }
}

/// Every plan, every shape, one to two hundred accounts, behind one to three of the viewer's own
/// connections; and behind one person two steps out.
fn sweep() -> &'static Sweep {
    static SWEEP: OnceLock<Sweep> = OnceLock::new();
    SWEEP.get_or_init(|| {
        let params = Params::default();
        let honest = world();
        let mut sweep = Sweep {
            violations: Vec::new(),
            attacks: 0,
        };
        for viewer in viewers(&honest) {
            let base = detail_of(&honest, viewer, &params, "honest");
            for accepted in 1..=3usize {
                let gatekeepers = &honest.friends(viewer)[..accepted];
                for plan in PLANS {
                    for shape in SHAPES {
                        for count in [1usize, 3, 20, 200] {
                            let what = format!(
                                "viewer {} × {plan:?} × {shape:?} × {count} × {accepted} accepted",
                                viewer.0
                            );
                            let (snapshot, groups) =
                                attacked(&honest, viewer, gatekeepers, count, shape, plan, &params);
                            let after = detail_of(&snapshot, viewer, &params, &what);
                            check_bound(
                                &mut sweep,
                                &base,
                                &after,
                                &groups,
                                gatekeepers,
                                accepted,
                                &params,
                                &what,
                            );
                            let exposed = detail_of(
                                &with_inert_connections(&honest, &snapshot, gatekeepers),
                                viewer,
                                &params,
                                "exposure only",
                            );
                            for &gatekeeper in gatekeepers {
                                let (expected, now) = (
                                    exposed.reliability[gatekeeper.index()],
                                    after.reliability[gatekeeper.index()],
                                );
                                sweep.check(Claim::Caveat, now == expected, || {
                                    format!(
                                        "{what}: gatekeeper {} moved to {now}, not the {expected} \
                                         its exposure alone gives",
                                        gatekeeper.0
                                    )
                                });
                            }
                        }
                    }
                }
            }

            let friends = honest.friends(viewer);
            let gatekeeper = friends
                .iter()
                .flat_map(|&friend| honest.friends(friend).iter().copied())
                .find(|&other| other != viewer && !friends.contains(&other))
                .expect("somebody two steps out");
            let head = base.region[gatekeeper.index()].expect("the gatekeeper is reached");
            for plan in PLANS {
                for shape in SHAPES {
                    for count in [1usize, 40, 200] {
                        let what = format!(
                            "viewer {} × {plan:?} × {shape:?} × {count} behind {} two steps out",
                            viewer.0, gatekeeper.0
                        );
                        let (snapshot, groups) =
                            attacked(&honest, viewer, &[gatekeeper], count, shape, plan, &params);
                        let after = detail_of(&snapshot, viewer, &params, &what);
                        let region = after.region[gatekeeper.index()];
                        sweep.check(Claim::Untouched, region == Some(head), || {
                            format!("{what}: the gatekeeper moved from {head:?}'s region to {region:?}'s")
                        });
                        let (was, now) =
                            (base.chain[gatekeeper.index()], after.chain[gatekeeper.index()]);
                        sweep.check(Claim::Untouched, (now - was).abs() <= 1e-12, || {
                            format!("{what}: the chain to the gatekeeper moved from {was} to {now}")
                        });
                        let (was, now) =
                            (base.reliability[head.index()], after.reliability[head.index()]);
                        sweep.check(Claim::Untouched, (now - was).abs() <= 1e-12, || {
                            format!("{what}: the head {} moved from {was} to {now}", head.0)
                        });
                        let heads: Vec<UserId> =
                            vec![region.unwrap_or(head); groups.len()];
                        check_bound(&mut sweep, &base, &after, &groups, &heads, 1, &params, &what);
                    }
                }
            }
        }
        sweep
    })
}

#[test]
fn every_bot_is_in_the_region_of_the_head_its_path_passes() {
    sweep().report(Claim::Region);
}

#[test]
fn no_bot_reads_above_its_head() {
    sweep().report(Claim::Ceiling);
}

#[test]
fn copying_the_viewer_raises_no_bot_past_its_own_chain() {
    sweep().report(Claim::Later);
}

#[test]
fn the_bots_move_any_thing_by_at_most_one_voice_per_accepted_connection() {
    sweep().report(Claim::LogOdds);
}

#[test]
fn a_gatekeeper_moves_only_through_their_later_thumbs() {
    sweep().report(Claim::Caveat);
}

#[test]
fn nothing_in_front_of_a_gatekeeper_two_steps_out_moves() {
    sweep().report(Claim::Untouched);
}
