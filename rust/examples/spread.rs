//! How far does one paid recommendation travel, and what does it cost the attacker?
//!
//! The attack modelled here is the realistic one, not the one aimed at a single victim: a
//! business wants ONE item in front of as many people as possible. It runs a botnet, gets some
//! number of real people to accept friend requests, and each accepted request gets its own group
//! of bots that copy that person's taste before promoting the item.
//!
//! What this measures, over the honest population:
//!
//! - **swayed** — people who can see the item at all and are being told they will like it.
//! - **backfired** — people who can see it and are being told they will NOT like it, because the
//!   bots that pushed it are ones they reliably disagree with, so a thumbs-up from them is
//!   evidence against.
//! - **hidden** — people for whom it never clears the display floor.
//!
//! The three questions: does sway track accepted friend requests rather than bot count, and does
//! it collapse as the population's tastes get more varied?
//!
//! `cargo run --release --example spread -- [--seed 7] [--requests 3] [--bots 40] [--clusters 3]`

use std::process::ExitCode;

use grapevine_core::{
    Params, Ratable, Rng, Snapshot, SybilConfig, SybilShape, SybilStrategy, UserId, WorldConfig,
    add_sybils, compute_user, hop_distances, simulate,
};

const PROMOTED: &str = "the-business";

/// One bot group per accepted friend request, each copying its own gatekeeper's taste. Separate
/// groups rather than one clique wired to everybody: a single group friended to three people in
/// three different taste clusters has to average them, which is the attacker fighting themselves
/// for no reason. This is the stronger attack.
fn wire_attack(
    world: &Snapshot,
    gatekeepers: &[UserId],
    bots_each: usize,
    strategy: SybilStrategy,
    params: &Params,
) -> (Snapshot, Vec<UserId>) {
    let mut snapshot = world.clone();
    let mut all_bots = Vec::new();
    for &gatekeeper in gatekeepers {
        let (next, set) = add_sybils(
            &snapshot,
            &SybilConfig {
                count: bots_each,
                gatekeepers: vec![gatekeeper],
                promoted: vec![PROMOTED.to_string()],
                strategy,
                shape: SybilShape::Clique,
                ..SybilConfig::default()
            },
            params,
        );
        snapshot = next;
        all_bots.extend(set.bots);
    }
    (snapshot, all_bots)
}

fn main() -> ExitCode {
    let mut seed = 7u64;
    let mut requests = 3usize;
    let mut bots_each = 40usize;
    let mut config = WorldConfig {
        users: 120,
        items: 240,
        consensus_items: 20,
        ..WorldConfig::default()
    };
    let mut clusters = 3usize;
    // Off, the bots only push the item and never copy anybody, which is the baseline the
    // copying has to beat before it is worth calling an attack.
    let mut cloning = true;

    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].as_str();
        let value = arguments.get(index + 1).cloned().unwrap_or_default();
        match flag {
            "--seed" => seed = value.parse().unwrap_or(seed),
            "--requests" => requests = value.parse().unwrap_or(requests),
            "--bots" => bots_each = value.parse().unwrap_or(bots_each),
            "--clusters" => clusters = value.parse().unwrap_or(clusters),
            "--clone" => cloning = value != "no",
            "--users" => config.users = value.parse().unwrap_or(config.users),
            "--spread" => config.cluster_spread = value.parse().unwrap_or(config.cluster_spread),
            "--p-same-cluster" => {
                config.p_same_cluster = value.parse().unwrap_or(config.p_same_cluster);
            }
            "--p-other-cluster" => {
                config.p_other_cluster = value.parse().unwrap_or(config.p_other_cluster);
            }
            other => {
                eprintln!("unknown flag {other}");
                return ExitCode::FAILURE;
            }
        }
        index += 2;
    }
    config.cluster_proportions = vec![1.0 / clusters as f64; clusters];

    let mut rng = Rng::new(seed);
    let world = simulate(&config, &mut rng);
    let params = Params::default();
    let honest: Vec<UserId> = world.snapshot.users().collect();

    // Spread the accepted requests across the population rather than inside one friend group, so
    // the attacker is not paying twice to reach people who share a feed anyway.
    let step = honest.len() / requests.max(1);
    let gatekeepers: Vec<UserId> = (0..requests).map(|slot| honest[slot * step]).collect();

    let strategy = if cloning {
        SybilStrategy::MimicFeed
    } else {
        SybilStrategy::PromoteOnly
    };
    let (attacked, _bots) =
        wire_attack(&world.snapshot, &gatekeepers, bots_each, strategy, &params);
    let promoted = Ratable::Item(
        attacked
            .item_id(PROMOTED)
            .expect("the promoted item exists after wiring"),
    );

    // How far each person is from the nearest person who accepted a request, in the honest
    // graph. 0 is that person; 1 is their friends, who the botnet never friended and whose taste
    // it did not copy.
    let mut steps_away = vec![usize::MAX; world.snapshot.user_count()];
    for &gatekeeper in &gatekeepers {
        for (index, hops) in hop_distances(&world.snapshot, gatekeeper)
            .iter()
            .enumerate()
        {
            if let Some(hops) = hops {
                steps_away[index] = steps_away[index].min(*hops as usize);
            }
        }
    }

    const RINGS: usize = 4;
    let mut population = [0usize; RINGS];
    let mut sees = [0usize; RINGS];
    let mut strength = [0.0f64; RINGS];
    for &viewer in &honest {
        let ring = steps_away[viewer.index()].min(RINGS - 1);
        population[ring] += 1;
        if let Ok(result) = compute_user(&attacked, viewer, &params)
            && let Some(score) = result.scores.get(&promoted)
        {
            sees[ring] += 1;
            strength[ring] += score.score;
        }
    }

    println!(
        "seed {seed}  {} people  {clusters} taste groups  {:.1} friends each  copying {}",
        honest.len(),
        honest
            .iter()
            .map(|&person| world.snapshot.friends(person).len() as f64)
            .sum::<f64>()
            / honest.len() as f64,
        if cloning { "on" } else { "off" }
    );
    println!("{requests} accepted the request, {bots_each} bots behind each");
    println!("  steps from whoever accepted   people   sees it   average strength");
    for ring in 0..RINGS {
        if population[ring] == 0 {
            continue;
        }
        let label = if ring == RINGS - 1 {
            format!("{}+", RINGS - 1)
        } else {
            ring.to_string()
        };
        let average = if sees[ring] > 0 {
            strength[ring] / sees[ring] as f64
        } else {
            0.0
        };
        println!(
            "  {label:>27}   {:>6}   {:>7}   {:>+15.3}",
            population[ring], sees[ring], average
        );
    }
    ExitCode::SUCCESS
}
