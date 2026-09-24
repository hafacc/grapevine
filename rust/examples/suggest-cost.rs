//! What one viewer's deep taste search costs (DESIGN section 3.7).
//!
//! Running taste search on demand rests on this measurement and not on an estimate: the nodes a
//! deep search loads, the bytes `private.neighbourhood` returns for them, the edge pushes and the
//! wall time, against one Edge Function invocation's roughly two seconds of CPU and the free
//! tier's egress.
//!
//! Both budgets are reported because a search is two walks, not one. DESIGN section 5.1 ranks
//! candidates by `π̃·ℓ` from the deep walk and then drops anyone whose `π̃·ℓ` under the
//! **on-demand** budget is already high, because somebody the live feed carries is not a
//! suggestion. The deep neighbourhood is the one that is read: both walks run over it, so its
//! bytes are the egress and the on-demand row's bytes are here only to say how much wider the
//! deep read is than the feed's.
//!
//! The wall time is split into the read crossing into the core and the walks themselves, since
//! DESIGN section 3.4 records that the crossing is the larger of the two for the feed.
//!
//! `cargo run --release --features serde --example suggest-cost -- --seed 7`

use std::collections::{BTreeMap, BTreeSet};
use std::process::ExitCode;
use std::time::Instant;

use grapevine_core::{
    Params, Rng, Snapshot, SnapshotData, UserId, WorldConfig, compute_user_detail, simulate,
    suggest,
};
use serde::{Deserialize, Serialize};

/// The rows `private.neighbourhood(viewer, max_nodes, max_depth)` returns: one per node whose
/// friend list was read, and nothing at all for the people those nodes name beyond the cut.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NeighbourhoodRow {
    id: String,
    friend_ids: Vec<String>,
    ratings: BTreeMap<String, i8>,
}

/// The breadth-first cut of `0004_functions.sql`: a seen set grown one level at a time, stopped
/// by the node cap or the depth backstop, with the level that crosses the cap sliced.
fn neighbourhood_ids(
    snapshot: &Snapshot,
    viewer: UserId,
    max_nodes: usize,
    max_depth: u32,
) -> Vec<UserId> {
    let mut seen = vec![viewer];
    let mut known: BTreeSet<UserId> = BTreeSet::from([viewer]);
    let mut frontier = vec![viewer];
    for _ in 0..max_depth {
        if seen.len() >= max_nodes {
            break;
        }
        let mut next: BTreeSet<UserId> = BTreeSet::new();
        for &node in &frontier {
            for &friend in snapshot.friends(node) {
                if !known.contains(&friend) {
                    next.insert(friend);
                }
            }
        }
        if next.is_empty() {
            break;
        }
        for &node in &next {
            if seen.len() >= max_nodes {
                break;
            }
            seen.push(node);
            known.insert(node);
        }
        frontier = next.into_iter().collect();
    }
    seen
}

fn neighbourhood_rows(snapshot: &Snapshot, loaded: &[UserId]) -> Vec<NeighbourhoodRow> {
    loaded
        .iter()
        .map(|&user| NeighbourhoodRow {
            id: snapshot.user_name(user).to_string(),
            friend_ids: snapshot
                .friends(user)
                .iter()
                .map(|&friend| snapshot.user_name(friend).to_string())
                .collect(),
            ratings: snapshot
                .ratings(user)
                .iter()
                .map(|&(ratable, value)| (snapshot.ratable_name(ratable), value))
                .collect(),
        })
        .collect()
}

/// The rows as the boundary takes them. Everyone a loaded node names and nobody read is left out
/// of `loaded`, which is what makes them a boundary node rather than a friendless one.
fn rows_to_data(rows: &[NeighbourhoodRow]) -> SnapshotData {
    SnapshotData {
        users: rows.iter().map(|row| row.id.clone()).collect(),
        friend_ids: rows
            .iter()
            .map(|row| (row.id.clone(), row.friend_ids.clone()))
            .collect(),
        loaded: rows.iter().map(|row| row.id.clone()).collect(),
        edges: Vec::new(),
        ratings: rows
            .iter()
            .map(|row| {
                let thumbs = row
                    .ratings
                    .iter()
                    .map(|(ratable, &value)| (ratable.clone(), value.into()))
                    .collect();
                (row.id.clone(), thumbs)
            })
            .collect(),
    }
}

/// What one budget costs one viewer, before any of it is aggregated.
struct Sample {
    nodes: usize,
    bytes: usize,
    work: usize,
    walk_ms: f64,
    /// Parsing the rows and interning them: the crossing into the core, which for the feed is
    /// the larger of the two costs.
    load_ms: f64,
}

#[derive(Default)]
struct Column {
    values: Vec<f64>,
}

impl Column {
    fn push(&mut self, value: f64) {
        self.values.push(value);
    }

    fn sorted(&mut self) -> (f64, f64, f64) {
        self.values.sort_by(f64::total_cmp);
        let count = self.values.len();
        (
            self.values[count / 2],
            self.values[count * 9 / 10],
            self.values[count - 1],
        )
    }
}

fn report(label: &str, samples: &[Sample]) {
    let mut nodes = Column::default();
    let mut bytes = Column::default();
    let mut work = Column::default();
    let mut walk_ms = Column::default();
    let mut load_ms = Column::default();
    for sample in samples {
        nodes.push(sample.nodes as f64);
        bytes.push(sample.bytes as f64);
        work.push(sample.work as f64);
        walk_ms.push(sample.walk_ms);
        load_ms.push(sample.load_ms);
    }
    let (node_median, node_p90, node_max) = nodes.sorted();
    let (byte_median, byte_p90, byte_max) = bytes.sorted();
    let (work_median, work_p90, work_max) = work.sorted();
    let (walk_median, walk_p90, walk_max) = walk_ms.sorted();
    let (load_median, load_p90, load_max) = load_ms.sorted();
    println!("  {label}");
    println!(
        "    nodes loaded:        median {node_median:.0}  p90 {node_p90:.0}  max {node_max:.0}"
    );
    println!(
        "    neighbourhood bytes: median {byte_median:.0}  p90 {byte_p90:.0}  max {byte_max:.0}"
    );
    println!(
        "    edge pushes:         median {work_median:.0}  p90 {work_p90:.0}  max {work_max:.0}"
    );
    println!(
        "    ms, walk:            median {walk_median:.2}  p90 {walk_p90:.2}  max {walk_max:.2}"
    );
    println!(
        "    ms, rows into core:  median {load_median:.2}  p90 {load_p90:.2}  max {load_max:.2}"
    );
}

/// One viewer at one budget, from the breadth-first cut through the settled walk.
fn measure(
    world: &Snapshot,
    viewer: UserId,
    params: &Params,
    max_depth: u32,
) -> Option<(Sample, Snapshot, UserId)> {
    let loaded = neighbourhood_ids(world, viewer, params.node_budget, max_depth);
    let rows = neighbourhood_rows(world, &loaded);
    let payload = serde_json::to_string(&rows).ok()?;

    let started = Instant::now();
    let parsed: Vec<NeighbourhoodRow> = serde_json::from_str(&payload).ok()?;
    let snapshot = rows_to_data(&parsed).to_snapshot();
    let local = snapshot.user_id(world.user_name(viewer))?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;

    let started = Instant::now();
    let detail = compute_user_detail(&snapshot, local, params).ok()?;
    let walk_ms = started.elapsed().as_secs_f64() * 1000.0;

    Some((
        Sample {
            nodes: loaded.len(),
            bytes: payload.len(),
            work: detail.work,
            walk_ms,
            load_ms,
        },
        snapshot,
        local,
    ))
}

fn main() -> ExitCode {
    let mut seed = 7u64;
    let mut max_depth = 6u32;
    // The world the taste-search checks seed, which is what DESIGN section 3.7 names.
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
            "--max-depth" => max_depth = value.parse().unwrap_or(max_depth),
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
    let deep = Params::deep();
    let live = Params::default();

    let mut deep_samples: Vec<Sample> = Vec::new();
    let mut live_samples: Vec<Sample> = Vec::new();
    let mut search_ms = Column::default();
    let mut suggested = 0usize;
    let mut failures = 0usize;

    for viewer in snapshot.users() {
        let Some((deep_sample, deep_snapshot, local)) = measure(snapshot, viewer, &deep, max_depth)
        else {
            failures += 1;
            continue;
        };
        let Some((live_sample, _, _)) = measure(snapshot, viewer, &live, max_depth) else {
            failures += 1;
            continue;
        };

        // Everyone discoverable and nobody dismissed is the worst case for the candidate scan,
        // and it is also what the checks seed.
        let discoverable: BTreeSet<UserId> = deep_snapshot
            .users()
            .filter(|&user| user != local)
            .collect();
        let dismissed: BTreeSet<UserId> = BTreeSet::new();
        let started = Instant::now();
        let found = suggest(
            &deep_snapshot,
            local,
            &discoverable,
            &dismissed,
            &deep,
            &live,
        );
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        match found {
            Ok(list) => {
                if !list.is_empty() {
                    suggested += 1;
                }
                search_ms.push(elapsed);
            }
            Err(_) => failures += 1,
        }

        deep_samples.push(deep_sample);
        live_samples.push(live_sample);
    }

    if deep_samples.is_empty() || search_ms.values.is_empty() {
        eprintln!("every viewer failed");
        return ExitCode::FAILURE;
    }

    println!(
        "world: seed {seed}, {} users, {} items, rated {:.2}, p-same {:.3}, depth cap {max_depth}",
        config.users, config.items, config.rated_fraction, config.p_same_cluster
    );
    println!(
        "deep budget: N_max {}, error budget {}; on-demand: N_max {}, error budget {}",
        deep.node_budget, deep.error_budget, live.node_budget, live.error_budget
    );
    report("deep (the search's own walk)", &deep_samples);
    report("on-demand (the already-reaches-you test)", &live_samples);
    let (search_median, search_p90, search_max) = search_ms.sorted();
    println!("  whole search, both walks and the candidate scan");
    println!(
        "    ms:                  median {search_median:.2}  p90 {search_p90:.2}  max {search_max:.2}"
    );
    println!(
        "{suggested} of {} viewers had somebody to suggest",
        deep_samples.len()
    );
    if failures > 0 {
        println!("{failures} viewers had no result");
    }
    ExitCode::SUCCESS
}
