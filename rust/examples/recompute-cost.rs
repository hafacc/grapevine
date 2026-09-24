//! What one viewer's recompute costs, on a fixed world: wall time and edge pushes per viewer,
//! over every viewer of it (`docs/algorithm-notes.md` section 8). It reads no parameter but the
//! defaults, so the same flags and seed give numbers comparable across changes to the core.
//!
//! `cargo run --release --features serde --example recompute-cost -- --seed 7`

use std::process::ExitCode;
use std::time::Instant;

use grapevine_core::{Params, Rng, WorldConfig, compute_user, simulate};

fn main() -> ExitCode {
    let mut seed = 7u64;
    // The world the taste-search checks seed, so the numbers are comparable with the suggestion
    // measurements.
    let mut config = WorldConfig {
        users: 150,
        items: 500,
        rated_fraction: 0.45,
        p_same_cluster: 0.035,
        ..WorldConfig::default()
    };
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].as_str();
        let value = arguments.get(index + 1).cloned().unwrap_or_default();
        match flag {
            "--seed" => seed = value.parse().unwrap_or(seed),
            "--users" => config.users = value.parse().unwrap_or(config.users),
            "--items" => config.items = value.parse().unwrap_or(config.items),
            "--rated-fraction" => {
                config.rated_fraction = value.parse().unwrap_or(config.rated_fraction);
            }
            "--p-same-cluster" => {
                config.p_same_cluster = value.parse().unwrap_or(config.p_same_cluster);
            }
            other => {
                eprintln!("unknown flag {other}");
                return ExitCode::FAILURE;
            }
        }
        index += 2;
    }

    let world = simulate(&config, &mut Rng::new(seed));
    let snapshot = &world.snapshot;
    let params = Params::default();

    let payload = match serde_json::to_string(&snapshot.to_data()) {
        Ok(document) => document.len(),
        Err(error) => {
            eprintln!("could not serialize the snapshot: {error}");
            return ExitCode::FAILURE;
        }
    };

    let mut millis: Vec<f64> = Vec::new();
    let mut work: Vec<usize> = Vec::new();
    let mut failures = 0usize;
    for viewer in snapshot.users() {
        let started = Instant::now();
        match compute_user(snapshot, viewer, &params) {
            Ok(result) => {
                millis.push(started.elapsed().as_secs_f64() * 1000.0);
                work.push(result.work);
            }
            Err(_) => failures += 1,
        }
    }
    if millis.is_empty() {
        eprintln!("every viewer failed");
        return ExitCode::FAILURE;
    }
    millis.sort_by(f64::total_cmp);
    work.sort_unstable();

    println!(
        "world: seed {seed}, {} users, {} items, rated {:.2}, p-same {:.3}",
        config.users, config.items, config.rated_fraction, config.p_same_cluster
    );
    println!("whole-world snapshot as json: {payload} bytes");
    println!(
        "per viewer, ms: median {:.1}  p90 {:.1}  max {:.1}",
        millis[millis.len() / 2],
        millis[millis.len() * 9 / 10],
        millis[millis.len() - 1]
    );
    println!(
        "per viewer, edge pushes: median {}  p90 {}  max {}",
        work[work.len() / 2],
        work[work.len() * 9 / 10],
        work[work.len() - 1]
    );
    if failures > 0 {
        println!("{failures} viewers had no result");
    }
    ExitCode::SUCCESS
}
