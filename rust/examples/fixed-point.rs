//! Does the alignment/flow loop settle, how fast, and where does it stop?
//!
//! DESIGN section 2.2 has a circular definition — flow decides who is in reach, reach decides
//! what is contested, contested decides alignment, alignment decides flow — and resolves it by
//! running the walk until the largest movement of any score falls under `SETTLE_TOLERANCE`.
//! This reads the movement series the core reports, so the numbers in `docs/algorithm-notes.md`
//! section 3 measure the loop that ships rather than a copy of it.
//!
//! The last block is the two-pass answer — the walk at the priors plus one application of the
//! map, the same core at `--passes 1` — because the notes quote how far it sits from the settled
//! one.
//!
//! `--sharpness` moves the clamp `L`, which is the only thing in the shipped algorithm that sets
//! how lopsided the split may get: the affinity range is `[1, e^L]`, so the best-to-worst
//! neighbour ratio the notes sweep is `e^L` and `--sharpness 1` is the shipped 7:1.
//!
//! `cargo run --release --example fixed-point -- [--seed 7] [--users 120] [--passes 12]`

use std::collections::BTreeMap;
use std::process::ExitCode;

use grapevine_core::{
    Params, Ratable, Rng, Score, SybilConfig, SybilShape, SybilStrategy, UserId, WorldConfig,
    add_sybils, compute_user_detail, simulate,
};

/// How far apart two passes' score maps are: the worst single ratable, and the total. A ratable
/// that appears or disappears counts its whole value, because a feed that changed shape has
/// moved even where the entries it kept did not.
fn distance(before: &BTreeMap<Ratable, Score>, after: &BTreeMap<Ratable, Score>) -> (f64, f64) {
    let mut worst = 0.0f64;
    let mut total = 0.0f64;
    for (ratable, scored) in after {
        let previous = before.get(ratable).map_or(0.0, |scored| scored.score);
        let moved = (scored.score - previous).abs();
        worst = worst.max(moved);
        total += moved;
    }
    for (ratable, scored) in before {
        if !after.contains_key(ratable) {
            worst = worst.max(scored.score.abs());
            total += scored.score.abs();
        }
    }
    (worst, total)
}

fn main() -> ExitCode {
    let mut seed = 7u64;
    let mut passes = 12usize;
    let mut sybils = 0usize;
    let mut sharpness = 1.0f64;
    let mut config = WorldConfig {
        users: 120,
        items: 240,
        consensus_items: 20,
        ..WorldConfig::default()
    };
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].as_str();
        let value = arguments.get(index + 1).cloned().unwrap_or_default();
        match flag {
            "--seed" => seed = value.parse().unwrap_or(seed),
            "--passes" => passes = value.parse().unwrap_or(passes),
            "--users" => config.users = value.parse().unwrap_or(config.users),
            "--items" => config.items = value.parse().unwrap_or(config.items),
            "--rated-fraction" => {
                config.rated_fraction = value.parse().unwrap_or(config.rated_fraction);
            }
            "--p-same-cluster" => {
                config.p_same_cluster = value.parse().unwrap_or(config.p_same_cluster);
            }
            "--sybils" => sybils = value.parse().unwrap_or(sybils),
            "--sharpness" => sharpness = value.parse().unwrap_or(sharpness),
            other => {
                eprintln!("unknown flag {other}");
                return ExitCode::FAILURE;
            }
        }
        index += 2;
    }

    let mut rng = Rng::new(seed);
    let world = simulate(&config, &mut rng);
    let shipped = Params::default();
    let params = Params {
        settle_max_passes: passes.max(1),
        alignment_clamp: sharpness * shipped.alignment_clamp,
        ..shipped
    };
    // The same world through the same core with the cap at one: the graph-only walk plus a
    // single application of the map: the two-pass answer.
    let two_pass = Params {
        settle_max_passes: 1,
        ..params
    };

    // The mimic is the hardest case for a contraction: a bot whose ratings are a function of
    // its own feed makes alignment — the thing the loop feeds back — the quantity under attack.
    let mut attacked = None;
    let snapshot = if sybils > 0 {
        let target = UserId(0);
        let gatekeeper = *world
            .snapshot
            .friends(target)
            .first()
            .expect("user 0 has a friend to subvert");
        let (with_bots, set) = add_sybils(
            &world.snapshot,
            &SybilConfig {
                count: sybils,
                gatekeepers: vec![gatekeeper],
                promoted: vec!["promoted".to_string()],
                strategy: SybilStrategy::MimicFeed,
                shape: SybilShape::Clique,
                ..SybilConfig::default()
            },
            &params,
        );
        attacked = Some((target, gatekeeper, set));
        with_bots
    } else {
        world.snapshot.clone()
    };
    let snapshot = &snapshot;

    println!(
        "seed {seed}, {} users, {} items ({} unanimous), cap {passes} passes, L = {:.2} (best:worst {:.1}:1)",
        config.users,
        config.items,
        config.consensus_items,
        params.alignment_clamp,
        params.affinity_cap(),
    );
    println!();
    println!("        per-pass movement of the score vector, worst single ratable");
    println!("pass    viewers still running    mean max|ds|    ratio vs previous");

    let viewers: Vec<UserId> = snapshot.users().collect();
    let mut movement_per_pass = vec![0.0f64; passes + 1];
    let mut running_per_pass = vec![0usize; passes + 1];
    let mut settled_viewers = 0usize;
    let mut pass_counts: Vec<usize> = Vec::new();
    let mut worst_final_movement = 0.0f64;
    let mut two_pass_drift = 0.0f64;
    let mut worst_two_pass_gap = 0.0f64;
    let mut failures = 0usize;

    for &viewer in &viewers {
        let (Ok(detail), Ok(early)) = (
            compute_user_detail(snapshot, viewer, &params),
            compute_user_detail(snapshot, viewer, &two_pass),
        ) else {
            failures += 1;
            continue;
        };
        for (step, &moved) in detail.movements.iter().enumerate() {
            movement_per_pass[step + 1] += moved;
            running_per_pass[step + 1] += 1;
        }
        if detail.settled {
            settled_viewers += 1;
        }
        pass_counts.push(detail.movements.len());
        worst_final_movement =
            worst_final_movement.max(detail.movements.last().copied().unwrap_or(0.0));
        let (worst_gap, total_gap) = distance(&early.scores, &detail.scores);
        two_pass_drift += total_gap;
        worst_two_pass_gap = worst_two_pass_gap.max(worst_gap);
    }

    let mut previous = 0.0f64;
    for step in 1..=passes {
        let running = running_per_pass[step];
        if running == 0 {
            break;
        }
        let mean = movement_per_pass[step] / running as f64;
        let ratio = if previous > 0.0 {
            format!("{:.3}", mean / previous)
        } else {
            "-".to_string()
        };
        println!("{step:>4}    {running:>20}    {mean:>12.6}    {ratio:>16}");
        previous = mean;
    }

    let computed = pass_counts.len();
    if computed == 0 {
        eprintln!("every viewer failed");
        return ExitCode::FAILURE;
    }
    pass_counts.sort_unstable();
    println!();
    println!(
        "{settled_viewers} of {computed} viewers reached the tolerance {:.0e}; passes median {} max {}",
        params.settle_tolerance,
        pass_counts[computed / 2],
        pass_counts[computed - 1],
    );
    println!("worst movement any viewer stopped at: {worst_final_movement:.6}");
    println!(
        "two-pass answer against this one: mean total drift {:.4} per viewer, worst single ratable {:.4}",
        two_pass_drift / computed as f64,
        worst_two_pass_gap,
    );
    if failures > 0 {
        println!("{failures} viewers had no result");
    }

    // The sybil mass bound of DESIGN section 2.4, read at the settled answer rather than after
    // two passes: the bots' total mass against the mass their one gatekeeper holds.
    if let Some((target, gatekeeper, set)) = attacked {
        let Ok(detail) = compute_user_detail(snapshot, target, &params) else {
            eprintln!("the attacked viewer had no result");
            return ExitCode::FAILURE;
        };
        let bot_mass: f64 = set.bots.iter().map(|bot| detail.mass(*bot)).sum();
        println!();
        println!(
            "{} mimic bots behind one edge into a friend: bots hold {bot_mass:.4} friend-units, that friend holds {:.4}",
            set.bots.len(),
            detail.mass(gatekeeper),
        );
    }
    ExitCode::SUCCESS
}
