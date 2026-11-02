//! What one viewer's list costs to compute, on a made-up viewer of a given size: wall time for
//! one call.
//!
//! `cargo run --release --example cost -- [--follows 40] [--items 30000] [--own 5000]`
//! `  [--each 5000] [--tags 40] [--runs 1]`

use std::process::ExitCode;
use std::time::Instant;

use grapevine_core::{Ratable, Rng, Snapshot, compute_user_tensor};

fn main() -> ExitCode {
    let (mut follows, mut items, mut own, mut each, mut tags) = (40usize, 30_000, 5_000, 5_000, 40);
    let mut runs = 1usize;
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < arguments.len() {
        let value = arguments.get(index + 1).and_then(|text| text.parse().ok());
        let slot = match arguments[index].as_str() {
            "--follows" => &mut follows,
            "--items" => &mut items,
            "--own" => &mut own,
            "--each" => &mut each,
            "--tags" => &mut tags,
            "--runs" => &mut runs,
            other => {
                eprintln!("unknown flag {other}");
                return ExitCode::FAILURE;
            }
        };
        let Some(value) = value else {
            eprintln!("{} needs a number", arguments[index]);
            return ExitCode::FAILURE;
        };
        *slot = value;
        index += 2;
    }

    let mut rng = Rng::new(7);
    let mut builder = Snapshot::builder();
    let viewer = builder.user("viewer");
    let catalog: Vec<_> = (0..items)
        .map(|index| builder.item(&format!("i{index}")))
        .collect();
    let vocabulary: Vec<_> = (0..tags.max(1))
        .map(|index| builder.tag(&format!("t{index}")))
        .collect();
    let mut thumbs = 0usize;
    for account in 0..=follows {
        let (user, count) = if account == 0 {
            (viewer, own)
        } else {
            let user = builder.user(&format!("a{account}"));
            builder.follow(viewer, user);
            (user, each)
        };
        let agreement = 0.5 + 0.4 * (account as f64).sin();
        for _ in 0..count {
            let position = rng.below(items);
            let liked = !position.is_multiple_of(3);
            let value = if rng.chance(agreement) == liked {
                1
            } else {
                -1
            };
            builder.rate(user, Ratable::Item(catalog[position]), value);
            // Two tags a thing, and most thumbs on a tag say it applies.
            for tag in [
                position % vocabulary.len(),
                (position * 7 + 3) % vocabulary.len(),
            ] {
                if rng.chance(0.3) {
                    let applies = if rng.chance(0.9) { 1 } else { -1 };
                    builder.rate(
                        user,
                        Ratable::Tag(catalog[position], vocabulary[tag]),
                        applies,
                    );
                    thumbs += 1;
                }
            }
            thumbs += 1;
        }
    }
    let snapshot = builder.build();
    // The fastest of `runs`: the others were sharing the machine.
    let mut fastest = f64::INFINITY;
    let mut scores = 0;
    for _ in 0..runs.max(1) {
        let started = Instant::now();
        match compute_user_tensor(&snapshot, viewer) {
            Ok(result) => scores = result.scores.len(),
            Err(error) => {
                eprintln!("{error}");
                return ExitCode::FAILURE;
            }
        }
        fastest = fastest.min(started.elapsed().as_secs_f64() * 1e3);
    }
    println!("{follows} followed, about {thumbs} thumbs, {scores} scores: {fastest:.0} ms");
    ExitCode::SUCCESS
}
