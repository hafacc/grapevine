//! Prints one user's result from a world written by `dump-world`.
//!
//! `cargo run --features serde --example compute-user -- world.json u3`

use std::process::ExitCode;

use grapevine_core::{Params, WorldData, compute_user};

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [path, viewer_name] = arguments.as_slice() else {
        eprintln!("usage: compute-user <world.json> <user-id>");
        return ExitCode::FAILURE;
    };
    let document = match std::fs::read_to_string(path) {
        Ok(document) => document,
        Err(error) => {
            eprintln!("could not read {path}: {error}");
            return ExitCode::FAILURE;
        }
    };
    let world: WorldData = match serde_json::from_str(&document) {
        Ok(world) => world,
        Err(error) => {
            eprintln!("{path} is not a world: {error}");
            return ExitCode::FAILURE;
        }
    };
    let snapshot = world.snapshot.to_snapshot();
    let Some(viewer) = snapshot.user_id(viewer_name) else {
        eprintln!("no user {viewer_name} in {path}");
        return ExitCode::FAILURE;
    };
    let computed = match compute_user(&snapshot, viewer, &Params::default()) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("{viewer_name} has no result: {error}");
            return ExitCode::FAILURE;
        }
    };
    let result = snapshot.result_data(&computed);
    match serde_json::to_string_pretty(&result) {
        Ok(document) => {
            println!("{document}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("could not serialize the result: {error}");
            ExitCode::FAILURE
        }
    }
}
