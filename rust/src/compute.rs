//! The per-viewer computation: the settling loop of DESIGN sections 2.2 and 3.4.

use std::collections::BTreeMap;

use crate::alignment::{Alignment, alignments};
use crate::error::CoreError;
use crate::graph::hop_distances;
use crate::ids::{Ratable, UserId};
use crate::informativeness::informativeness;
use crate::params::Params;
use crate::priors::{PairTallies, tally_pairs};
use crate::score::{Score, score_ratables};
use crate::snapshot::Snapshot;
use crate::walk::{Adjacency, BoundaryNode, Budget, Walk, push};

/// What one viewer gets back: everything worth showing, and the model behind it.
#[derive(Clone, Debug, PartialEq)]
pub struct UserResult {
    pub viewer: UserId,
    /// Every ratable with `W ≥ W_min`, in ratable order.
    pub scores: BTreeMap<Ratable, Score>,
    /// How many people the walk reached.
    pub reach: usize,
    /// `π̃_u(v)` for each of them, which is what the caller stores so a later recompute over an
    /// unchanged graph can rescore without walking again (DESIGN section 3.4).
    pub reach_masses: Vec<(UserId, f64)>,
    /// `Σ |r| · (1 − α) / α` at the end of the last pass the loop kept, over the loaded nodes
    /// only. In `π̃` friend-units.
    pub truncation: f64,
    /// The largest movement of any score in the last pass of the settling loop, already on the
    /// score's own `(−1, 1)` scale. Reported beside `truncation` rather than folded into it
    /// because the two are in different units until `UserResult::error` converts one of them,
    /// and which of the two is larger is a fact about the graph.
    pub settle_movement: f64,
    /// Passes the loop ran.
    pub passes: usize,
    /// Whether the loop stopped on the tolerance, rather than on the pass cap or the budget.
    /// Neither of those is an error; it is the caller's to weigh against `settle_movement`.
    pub settled: bool,
    /// What the nodes whose friend list was never read would have sent on, and where it sits.
    /// Reported and **not** counted against `ε_total`: the accuracy the result claims is
    /// relative to the loaded neighbourhood, and this is how much influence from past it the
    /// answer leaves out (DESIGN section 3.4). Zero for a snapshot with no boundary.
    pub boundary_residual: f64,
    pub boundary_nodes: Vec<BoundaryNode>,
    /// Edge pushes the whole computation spent, against `Budget::for_snapshot`.
    pub work: usize,
    /// This viewer's contribution to the population's `κ` and `a₀(d)` (DESIGN section 2.10):
    /// count, sum and sum of squares of the agreement rate over the pairs whose alignment this
    /// recompute already worked out, pooled by a scheduled statement in the database.
    pub pairs: PairTallies,
}

impl UserResult {
    /// The part of the result that bounds its error, which a rescore carries through unchanged.
    pub fn walk_report(&self) -> WalkReport {
        WalkReport {
            truncation: self.truncation,
            boundary_residual: self.boundary_residual,
            settle_movement: self.settle_movement,
            passes: self.passes,
            settled: self.settled,
        }
    }

    /// `max(truncation · L, settle_movement)`: the two errors in one unit, which is what the
    /// bar quantizes to (DESIGN section 1 "The bar"). A friend-unit of unresolved mass moves a
    /// score by at most `L`; the settling distance is already a distance between two scores.
    pub fn error(&self, params: &Params) -> f64 {
        (self.truncation * params.alignment_clamp).max(self.settle_movement)
    }
}

/// What the walk behind a set of masses reported about its own accuracy.
///
/// A rescore reuses the masses, so it reuses these too, unchanged: they bound the error in
/// exactly those masses, and a rescore that reported its own would be the cache claiming an
/// accuracy no walk paid for.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct WalkReport {
    pub truncation: f64,
    pub boundary_residual: f64,
    pub settle_movement: f64,
    pub passes: usize,
    pub settled: bool,
}

/// The same computation with every intermediate kept, for the simulator and the property tests.
#[derive(Clone, Debug)]
pub struct UserDetail {
    pub viewer: UserId,
    /// Edge pushes the whole computation spent.
    pub work: usize,
    pub distances: Vec<Option<u32>>,
    /// The graph-only pass: alignments at their priors, so the masses depend on the graph alone.
    pub first_pass: Walk,
    /// The last pass the loop kept. A pass the budget cut short is never kept.
    pub final_pass: Walk,
    pub first_visit_mass: Vec<f64>,
    pub visit_mass: Vec<f64>,
    pub informativeness: Vec<f64>,
    pub alignments: Vec<Option<Alignment>>,
    /// The largest score movement in each kept pass after the first, in order. The whole series
    /// is what a test reads to see that the map contracts.
    pub movements: Vec<f64>,
    /// The last entry of `movements`, or — when no second pass could be afforded — the distance
    /// of the first pass's scores from nothing at all, which is the only thing the loop measured.
    pub settle_movement: f64,
    pub settled: bool,
    pub pairs: PairTallies,
    /// Every ratable anyone in reach rated, including those below the display floor.
    pub scores: BTreeMap<Ratable, Score>,
}

impl UserDetail {
    /// `ℓ_{uv}`, or zero for someone the walk never reached.
    pub fn alignment_weight(&self, other: UserId) -> f64 {
        self.alignments[other.index()]
            .map(|alignment| alignment.weight)
            .unwrap_or(0.0)
    }

    /// `π̃_u(v)` at the settled answer.
    pub fn mass(&self, other: UserId) -> f64 {
        self.visit_mass[other.index()]
    }

    /// The displayable part of the result.
    pub fn result(&self, params: &Params) -> UserResult {
        self.clone().into_result(params)
    }

    /// The same, without copying the score map. `compute_user` — the wasm path, and the only one
    /// a viewer's recompute takes — has no use for the walks or the per-node intermediates, so
    /// it moves what it needs out and drops the rest here.
    pub fn into_result(self, params: &Params) -> UserResult {
        let mut scores = self.scores;
        scores.retain(|_, score| score.confidence >= params.min_weight);
        UserResult {
            viewer: self.viewer,
            scores,
            reach: self.final_pass.nodes_touched(),
            reach_masses: self
                .final_pass
                .touched()
                .iter()
                .map(|&user| (user, self.visit_mass[user.index()]))
                .collect(),
            truncation: self.final_pass.truncation(),
            settle_movement: self.settle_movement,
            passes: self.movements.len() + 1,
            settled: self.settled,
            boundary_residual: self.final_pass.boundary_residual(),
            boundary_nodes: self.final_pass.boundary_nodes().to_vec(),
            work: self.work,
            pairs: self.pairs,
        }
    }
}

/// Everything DESIGN section 2 says about one viewer.
///
/// The definition is circular — flow decides who is in reach, reach decides what is contested,
/// contested decides alignment, alignment decides flow — so it is iterated rather than unrolled
/// into a fixed number of stages. The first walk runs with every alignment at its prior, which
/// makes the transition row uniform and the masses a function of the graph alone; each pass
/// after it recomputes `ω` and the alignments from the masses it has and walks again, starting
/// from the previous pass's masses. The loop stops when the largest movement of any score falls
/// below `SETTLE_TOLERANCE`, at `SETTLE_MAX_PASSES`, or when the budget cannot pay for another
/// pass, and reports which.
///
/// A pass is started only when what is left of the budget covers what the last pass cost, and a
/// pass the budget cuts short anyway is thrown away: the answer is always the last *complete*
/// pass, never a walk that stopped half way and has less reach than the one before it.
pub fn compute_user_detail(
    snapshot: &Snapshot,
    viewer: UserId,
    params: &Params,
) -> Result<UserDetail, CoreError> {
    let user_count = snapshot.user_count();
    let distances = hop_distances(snapshot, viewer);
    let adjacency = Adjacency::new(snapshot, viewer);
    let uniform_affinity = vec![1.0; user_count];
    let mut budget = Budget::for_snapshot(snapshot, viewer, params);

    let first_pass = push(&adjacency, &uniform_affinity, params, &mut budget, None)?;
    let first_visit_mass = first_pass.visit_mass().to_vec();

    let mut visit_mass = first_visit_mass.clone();
    let mut final_pass = first_pass.clone();
    let mut omega = informativeness(snapshot, viewer, &visit_mass);
    let mut taste = alignments(snapshot, viewer, &omega, &distances, &visit_mass, params);
    let mut scores = score_ratables(snapshot, viewer, &visit_mass, &taste, params);
    let mut movements: Vec<f64> = Vec::new();
    let mut settled = false;

    for _ in 0..params.settle_max_passes {
        if budget.remaining() < final_pass.edge_pushes() {
            break;
        }
        let affinity: Vec<f64> = taste
            .iter()
            .map(|entry| entry.map_or(1.0, |alignment| affinity_of(alignment.weight)))
            .collect();
        let walked = push(
            &adjacency,
            &affinity,
            params,
            &mut budget,
            Some(&final_pass),
        )?;
        if walked.stopped_early() {
            break;
        }
        let next_mass = walked.visit_mass().to_vec();
        let next_omega = informativeness(snapshot, viewer, &next_mass);
        let next_taste = alignments(
            snapshot,
            viewer,
            &next_omega,
            &distances,
            &next_mass,
            params,
        );
        let next = score_ratables(snapshot, viewer, &next_mass, &next_taste, params);
        let moved = score_distance(&scores, &next);
        final_pass = walked;
        visit_mass = next_mass;
        omega = next_omega;
        taste = next_taste;
        scores = next;
        movements.push(moved);
        if moved < params.settle_tolerance {
            settled = true;
            break;
        }
    }
    let settle_movement = movements
        .last()
        .copied()
        .unwrap_or_else(|| score_distance(&BTreeMap::new(), &scores));

    let pairs = tally_pairs(&taste, &distances);

    Ok(UserDetail {
        viewer,
        work: budget.spent(),
        distances,
        first_pass,
        final_pass,
        first_visit_mass,
        visit_mass,
        informativeness: omega,
        alignments: taste,
        movements,
        settle_movement,
        settled,
        pairs,
        scores,
    })
}

/// One viewer's scores from masses a previous walk produced, with no walk at all.
///
/// The masses are a function of the friend graph and the alignments, which move slowly; the
/// scores are a function of the masses and the *ratings*, which do not. So when the caller has
/// established that the graph the last walk ran on has not moved (DESIGN section 3.4 hashes the
/// adjacency it just loaded against the one the cached masses came from), this re-reads the
/// thumbs against the same masses and skips the walk.
///
/// `walk` is what the computation that produced these masses reported, and it is **carried
/// through unchanged rather than recomputed**: it bounds the error in the masses, the masses are
/// the ones being reused, and inventing a smaller number here would be the cache quietly
/// claiming an accuracy no walk paid for.
///
/// What this saves is small. The walks of a whole loop over 2 000 people are a few milliseconds;
/// crossing the snapshot into wasm costs tens, and reading the neighbourhood costs more again.
/// This is the third largest of the three costs, and it is worth doing because it is nearly
/// free.
pub fn rescore_user(
    snapshot: &Snapshot,
    viewer: UserId,
    visit_mass: &[f64],
    walk: WalkReport,
    params: &Params,
) -> Result<UserResult, CoreError> {
    if visit_mass.len() != snapshot.user_count() {
        return Err(CoreError::MassLengthMismatch {
            expected: snapshot.user_count(),
            got: visit_mass.len(),
        });
    }
    for error in [
        walk.truncation,
        walk.boundary_residual,
        walk.settle_movement,
    ] {
        if !(error.is_finite() && error >= 0.0) {
            return Err(CoreError::Divergent { truncation: error });
        }
    }
    for &mass in visit_mass {
        if !mass.is_finite() {
            return Err(CoreError::NonFiniteMass { viewer, mass });
        }
    }
    let distances = hop_distances(snapshot, viewer);
    let omega = informativeness(snapshot, viewer, visit_mass);
    let taste = alignments(snapshot, viewer, &omega, &distances, visit_mass, params);
    let mut scores = score_ratables(snapshot, viewer, visit_mass, &taste, params);
    scores.retain(|_, score| score.confidence >= params.min_weight);
    Ok(UserResult {
        viewer,
        scores,
        reach: visit_mass.iter().filter(|&&mass| mass > 0.0).count(),
        reach_masses: visit_mass
            .iter()
            .enumerate()
            .filter(|&(_, &mass)| mass > 0.0)
            .map(|(index, &mass)| (UserId(index as u32), mass))
            .collect(),
        truncation: walk.truncation,
        settle_movement: walk.settle_movement,
        passes: walk.passes,
        settled: walk.settled,
        boundary_residual: walk.boundary_residual,
        boundary_nodes: Vec::new(),
        work: 0,
        pairs: tally_pairs(&taste, &distances),
    })
}

/// The largest movement of any score between two passes. A ratable that appears or disappears
/// counts its whole value: a score that arrived at `0.4` moved from nothing by `0.4`, and
/// treating a missing entry as agreement would let the loop stop while the feed was still
/// changing shape.
fn score_distance(before: &BTreeMap<Ratable, Score>, after: &BTreeMap<Ratable, Score>) -> f64 {
    let mut worst = 0.0f64;
    for (ratable, score) in after {
        let previous = before.get(ratable).map_or(0.0, |score| score.score);
        worst = worst.max((score.score - previous).abs());
    }
    for (ratable, score) in before {
        if !after.contains_key(ratable) {
            worst = worst.max(score.score.abs());
        }
    }
    worst
}

/// `aff_u(y) = exp(max(ℓ_{u,y}, 0))`: the odds that `y` shares the viewer's taste, which is what
/// the walk steers by. Someone the viewer is anti-aligned with is not steered *away* from — the
/// evidence they carry is real, only its sign is flipped — so the exponent is floored at zero
/// and the range is `[1, e^L]`.
pub fn affinity_of(alignment_weight: f64) -> f64 {
    alignment_weight.max(0.0).exp()
}

pub fn compute_user(
    snapshot: &Snapshot,
    viewer: UserId,
    params: &Params,
) -> Result<UserResult, CoreError> {
    compute_user_detail(snapshot, viewer, params).map(|detail| detail.into_result(params))
}

/// Every viewer in the snapshot, for tests and the simulator.
pub fn compute_all(snapshot: &Snapshot, params: &Params) -> Result<Vec<UserResult>, CoreError> {
    snapshot
        .users()
        .map(|viewer| compute_user(snapshot, viewer, params))
        .collect()
}
