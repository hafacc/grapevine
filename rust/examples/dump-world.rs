//! Writes a simulated world as JSON, for seeding the local stack and for `compute-user`.
//!
//! `cargo run --features serde --example dump-world -- --seed 7 [--users 60] [--items 120]`
//! `  [--rated-fraction 0.35] [--tag-rated-fraction 0] [--p-same-cluster 0.18]`
//! `  [--p-other-cluster 0.02] [--out world.json]`

use std::process::ExitCode;

use grapevine_core::{Rng, WorldConfig, simulate};

fn main() -> ExitCode {
    let mut seed = 1u64;
    let mut out: Option<String> = None;
    let mut config = WorldConfig::default();
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].as_str();
        let value = arguments.get(index + 1).cloned().unwrap_or_default();
        match flag {
            "--seed" => seed = value.parse().unwrap_or(1),
            "--out" => out = Some(value),
            "--users" => config.users = value.parse().unwrap_or(config.users),
            "--items" => config.items = value.parse().unwrap_or(config.items),
            "--rated-fraction" => {
                config.rated_fraction = value.parse().unwrap_or(config.rated_fraction);
            }
            "--tag-rated-fraction" => {
                config.tag_rated_fraction = value.parse().unwrap_or(config.tag_rated_fraction);
            }
            // The two edge probabilities, because how far apart people are is
            // the whole subject of a world seeded for taste search (DESIGN 5):
            // at the default density every pair is two hops apart and nobody is
            // far enough away to be a suggestion rather than a neighbour.
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

    let world = simulate(&config, &mut Rng::new(seed));
    let document = match serde_json::to_string_pretty(&world.to_data(seed)) {
        Ok(document) => document,
        Err(error) => {
            eprintln!("could not serialize the world: {error}");
            return ExitCode::FAILURE;
        }
    };
    match out {
        Some(path) => {
            if let Err(error) = std::fs::write(&path, document) {
                eprintln!("could not write {path}: {error}");
                return ExitCode::FAILURE;
            }
            eprintln!("wrote {path}");
        }
        None => println!("{document}"),
    }
    ExitCode::SUCCESS
}
