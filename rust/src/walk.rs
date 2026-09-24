//! The error-bounded local push of DESIGN section 2.4.
//!
//! The walk is a non-backtracking random walk from the viewer: it is absorbed at the viewer, it
//! never steps straight back the way it came, and it dies with probability `α` at every step.
//! Mass prefers neighbours the viewer is aligned with, so a chain of aligned people keeps most
//! of what enters it, and a wide unaligned neighbourhood divides its share away.
//!
//! Because the step rule depends on where the mass came from, the linear system lives on
//! *directed edges*: a residual on `(w → v)` is mass that has arrived at `v` from `w` and has not
//! yet been passed on. The push drains **every** residual waiting at a node in one step. Mass that
//! came from `w` may go anywhere but back to `w`, so what leaves along `(v → x)` is
//! `(1 − α)·aff(x)·Σ_{w ≠ x} r(w → v) / (S_v − aff(w))`, with `S_v` the affinity of all of `v`'s
//! neighbours but the viewer — one sum over the node's arrivals, less the one that came from `x`.
//! That makes a node's expansion cost its degree rather than its degree times its arrivals, and a
//! sweep of the neighbourhood cost `2|E|` edge pushes rather than `Σ_v deg(v)·(deg(v) − 1)`
//! (`docs/algorithm-notes.md` section 8). The equation, the stop rule and the truncation bound are
//! an edge-at-a-time push's; only the order of the arithmetic differs.
//!
//! Largest residual first, to within a factor of two (a bucket per binary exponent), and the stop
//! rule is what the mass still in flight could add, so the search goes as deep as it still
//! matters and no deeper.
//!
//! A walk can start from an earlier walk's answer rather than from nothing. The settling loop
//! does that on every pass after the first: the residual it starts from is `e + T·a₀ − a₀` under
//! the new split, which can be negative, and the truncation is `Σ|r|·(1 − α)/α` either way.
//!
//! Every mass here is in `π̃` units: one fresh friend's injection is exactly 1.

use std::collections::VecDeque;

use crate::error::CoreError;
use crate::graph::Graph;
use crate::ids::UserId;
use crate::params::Params;

/// How many edge pushes one viewer's computation may make, spent rather than re-read. An edge
/// push is one deposit along one directed edge, so expanding a node costs its degree.
///
/// One of these covers every pass of the settling loop. `Budget::for_snapshot` sizes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    limit: usize,
    spent: usize,
}

impl Budget {
    pub fn new(limit: usize) -> Self {
        Budget { limit, spent: 0 }
    }

    /// Edge pushes spent so far.
    pub fn spent(&self) -> usize {
        self.spent
    }

    pub fn remaining(&self) -> usize {
        self.limit.saturating_sub(self.spent)
    }

    pub fn is_exhausted(&self) -> bool {
        self.spent >= self.limit
    }

    pub(crate) fn spend(&mut self, pushes: usize) {
        self.spent = self.spent.saturating_add(pushes);
    }

    /// The smaller of what a whole settling loop over **this** neighbourhood can cost and
    /// `E_max`, which is a CPU ceiling and nothing else (DESIGN section 2.8).
    ///
    /// A cold walk that converges to `ε_total` shrinks its residual by `1 − α` a sweep, so it
    /// takes about `log_{1/(1−α)}(F·(1 − α)/(α·ε_total))` sweeps, `F` the friend count, and each
    /// sweep costs one push along every directed edge of the loaded nodes. A warm pass costs one
    /// more sweep to start from the previous answer, and the loop runs the graph-only pass and
    /// at most `SETTLE_MAX_PASSES` more. On any neighbourhood the query can return that is well
    /// under `E_max`, so the ceiling binds only on a graph nobody measured.
    pub fn for_snapshot<G: Graph>(graph: &G, viewer: UserId, params: &Params) -> Budget {
        Budget::new(reservation(graph, viewer, params).min(params.edge_budget))
    }
}

/// What a whole settling loop over this neighbourhood costs, uncapped.
fn reservation<G: Graph>(graph: &G, viewer: UserId, params: &Params) -> usize {
    let friends = graph
        .neighbors(viewer)
        .unwrap_or(&[])
        .iter()
        .filter(|&&friend| friend != viewer)
        .count()
        .max(1);
    let sweep: usize = (0..graph.user_count())
        .filter_map(|index| graph.neighbors(UserId(index as u32)))
        .map(<[UserId]>::len)
        .sum();
    let shrink = 1.0 / (1.0 - params.decay);
    let sweeps = ((friends as f64 * params.residual_reach() / params.error_budget).ln()
        / shrink.ln())
    .ceil()
    .max(1.0) as usize;
    // The graph-only pass, then at most `SETTLE_MAX_PASSES` more.
    (params.settle_max_passes.saturating_add(1))
        .saturating_mul(friends.saturating_add(sweeps.saturating_add(1).saturating_mul(sweep)))
}

/// A node the push reached but could not expand, and the visit mass that is waiting on reading
/// its friend list (DESIGN section 3.4 step 4).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoundaryNode {
    pub user: UserId,
    /// `π̃ · (1 − α)/α` for the mass that stopped here: what it would have sent on.
    pub residual: f64,
}

/// What one push produced: the visit mass, and where it went.
#[derive(Clone, Debug)]
pub struct Walk {
    friends: Vec<UserId>,
    visit_mass: Vec<f64>,
    touched: Vec<UserId>,
    truncation: f64,
    boundary: Vec<BoundaryNode>,
    boundary_residual: f64,
    edge_pushes: usize,
    stopped_early: bool,
    /// `a + r` on every directed edge into a loaded node, in `Adjacency` slot order: what a later
    /// pass starts from.
    slot_mass: Vec<f64>,
    /// The same for what arrived with no edge to exclude — the injection at each friend.
    free_mass: Vec<f64>,
}

impl Walk {
    /// The viewer's friends, sorted; an index into this list is a branch index everywhere else.
    pub fn friends(&self) -> &[UserId] {
        &self.friends
    }

    /// Every node holding visit mass, sorted.
    pub fn touched(&self) -> &[UserId] {
        &self.touched
    }

    pub fn nodes_touched(&self) -> usize {
        self.touched.len()
    }

    /// `E_max`'s quantity: one per deposit along a directed edge, so expanding a node costs its
    /// degree. A warm start costs one sweep of the loaded nodes on top.
    pub fn edge_pushes(&self) -> usize {
        self.edge_pushes
    }

    /// `Σ |r| · (1 − α) / α` over the loaded nodes: the visit mass the walk could still move had
    /// it run on. Every `π̃` is within this of the walk run to convergence **over the loaded
    /// nodes**, and so every score within `L` times it. What waits on a node whose friend list
    /// was never read is `boundary_residual`, apart from this and not counted against
    /// `ε_total` (DESIGN section 3.4).
    pub fn truncation(&self) -> f64 {
        self.truncation
    }

    /// Whether the walk stopped on a budget with `truncation` still at or above `ε_total`.
    pub fn stopped_early(&self) -> bool {
        self.stopped_early
    }

    /// What the unread nodes would have sent on, in the same units as `truncation`: the influence
    /// of everyone past the loaded neighbourhood, which the answer leaves out.
    pub fn boundary_residual(&self) -> f64 {
        self.boundary_residual
    }

    /// The nodes that produced the boundary residual and how much each holds, in node order.
    pub fn boundary_nodes(&self) -> &[BoundaryNode] {
        &self.boundary
    }

    /// `π̃_u`, under the affinity the walk was run with.
    pub fn visit_mass(&self) -> &[f64] {
        &self.visit_mass
    }
}

/// Where a deposit along one directed edge lands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Landing {
    /// On the target's slot for this edge.
    Slot(u32),
    /// On the target's free slot: the target does not list the source, so there is no edge to
    /// exclude on the way on.
    Free,
    /// On a node whose friend list was never read, where it counts and goes no further.
    Unloaded,
    /// On the viewer, where it is absorbed.
    Viewer,
}

/// One viewer's neighbourhood as flat arrays, built once and walked once per pass.
///
/// A loaded node's slots are its neighbours, sorted and without repeats or itself; slot `s` holds
/// what arrived *from* `targets[s]`, and a push *to* `targets[s]` lands at `landings[s]`.
pub(crate) struct Adjacency {
    viewer: UserId,
    friends: Vec<UserId>,
    offsets: Vec<usize>,
    targets: Vec<u32>,
    landings: Vec<Landing>,
    loaded: Vec<bool>,
}

impl Adjacency {
    pub(crate) fn new<G: Graph>(graph: &G, viewer: UserId) -> Adjacency {
        let user_count = graph.user_count();
        let mut loaded = vec![false; user_count];
        let mut offsets = Vec::with_capacity(user_count + 1);
        offsets.push(0);
        let mut targets: Vec<u32> = Vec::new();
        for (index, is_loaded) in loaded.iter_mut().enumerate() {
            if let Some(neighbors) = graph.neighbors(UserId(index as u32)) {
                *is_loaded = true;
                let start = targets.len();
                targets.extend(
                    neighbors
                        .iter()
                        .map(|user| user.0)
                        .filter(|&other| other as usize != index && (other as usize) < user_count),
                );
                targets[start..].sort_unstable();
                let mut kept = start;
                for position in start..targets.len() {
                    if kept == start || targets[kept - 1] != targets[position] {
                        targets[kept] = targets[position];
                        kept += 1;
                    }
                }
                targets.truncate(kept);
            }
            offsets.push(targets.len());
        }
        let mut landings = Vec::with_capacity(targets.len());
        for node in 0..user_count {
            for slot in offsets[node]..offsets[node + 1] {
                let target = targets[slot] as usize;
                landings.push(if target == viewer.index() {
                    Landing::Viewer
                } else if !loaded[target] {
                    Landing::Unloaded
                } else {
                    let theirs = &targets[offsets[target]..offsets[target + 1]];
                    match theirs.binary_search(&(node as u32)) {
                        Ok(position) => Landing::Slot((offsets[target] + position) as u32),
                        Err(_) => Landing::Free,
                    }
                });
            }
        }
        let friends = if loaded.get(viewer.index()).copied().unwrap_or(false) {
            targets[offsets[viewer.index()]..offsets[viewer.index() + 1]]
                .iter()
                .map(|&friend| UserId(friend))
                .collect()
        } else {
            Vec::new()
        };
        Adjacency {
            viewer,
            friends,
            offsets,
            targets,
            landings,
            loaded,
        }
    }

    fn user_count(&self) -> usize {
        self.loaded.len()
    }

    fn slot_count(&self) -> usize {
        self.targets.len()
    }
}

/// Runs the push of DESIGN section 2.4 on a budget of its own.
///
/// `affinity` is `aff_u(y) = exp(max(ℓ_{u,y}, 0))` per user (`1` for anyone the list does not
/// reach). It moves how each node's onward mass is split and never how much of it there is, and
/// it never touches the injection at a friend.
pub fn walk<G: Graph>(
    graph: &G,
    viewer: UserId,
    affinity: &[f64],
    params: &Params,
) -> Result<Walk, CoreError> {
    let mut budget = Budget::new(params.edge_budget);
    walk_within(graph, viewer, affinity, params, &mut budget)
}

/// The same push, spending a budget it shares with the rest of the viewer's computation.
pub fn walk_within<G: Graph>(
    graph: &G,
    viewer: UserId,
    affinity: &[f64],
    params: &Params,
    budget: &mut Budget,
) -> Result<Walk, CoreError> {
    push(
        &Adjacency::new(graph, viewer),
        affinity,
        params,
        budget,
        None,
    )
}

/// Buckets of nodes by the binary exponent of the residual they hold: the largest first to
/// within a factor of two, first come first served inside a bucket, and nothing to reorder when
/// a residual moves.
struct Queue {
    buckets: Vec<VecDeque<u32>>,
    /// The bucket each node is waiting in, or `IDLE`. An entry anywhere else is stale.
    waiting: Vec<u16>,
    top: usize,
}

const IDLE: u16 = u16::MAX;
const BUCKETS: usize = 2048;

impl Queue {
    fn new(user_count: usize) -> Queue {
        Queue {
            buckets: (0..BUCKETS).map(|_| VecDeque::new()).collect(),
            waiting: vec![IDLE; user_count],
            top: 0,
        }
    }

    fn place(&mut self, node: usize, held: f64) {
        if held <= 0.0 {
            self.waiting[node] = IDLE;
            return;
        }
        let bucket = ((held.to_bits() >> 52) & 0x7ff) as usize;
        if self.waiting[node] as usize != bucket {
            self.waiting[node] = bucket as u16;
            self.buckets[bucket].push_back(node as u32);
            self.top = self.top.max(bucket);
        }
    }

    fn pop(&mut self) -> Option<usize> {
        loop {
            if let Some(node) = self.buckets[self.top].pop_front() {
                if self.waiting[node as usize] as usize == self.top {
                    self.waiting[node as usize] = IDLE;
                    return Some(node as usize);
                }
            } else if self.top == 0 {
                return None;
            } else {
                self.top -= 1;
            }
        }
    }
}

/// The residual side of one push.
struct Residual<'a> {
    adjacency: &'a Adjacency,
    slot: Vec<f64>,
    free: Vec<f64>,
    /// `Σ |r|` per node, which is what the queue orders by.
    held: Vec<f64>,
    /// `Σ |r|` over everything, kept incrementally and re-summed before it is believed.
    total: f64,
    /// Visit mass that reached a node whose friend list was never read.
    unloaded: Vec<f64>,
    queue: Queue,
}

impl Residual<'_> {
    fn deposit(&mut self, target: usize, landing: Landing, amount: f64) {
        let place = match landing {
            Landing::Slot(slot) => &mut self.slot[slot as usize],
            Landing::Free => &mut self.free[target],
            Landing::Unloaded => {
                self.unloaded[target] += amount;
                return;
            }
            Landing::Viewer => return,
        };
        let before = *place;
        *place += amount;
        let change = place.abs() - before.abs();
        self.total += change;
        self.held[target] = (self.held[target] + change).max(0.0);
        self.queue.place(target, self.held[target]);
    }

    /// Every node's `Σ |r|` and the total summed afresh, and the queue told.
    fn recount(&mut self) {
        let adjacency = self.adjacency;
        for node in 0..self.held.len() {
            let range = adjacency.offsets[node]..adjacency.offsets[node + 1];
            self.held[node] = self.free[node].abs()
                + self.slot[range]
                    .iter()
                    .map(|value| value.abs())
                    .sum::<f64>();
            self.queue.place(node, self.held[node]);
        }
        self.total = self.exact_total();
    }

    fn exact_total(&self) -> f64 {
        self.slot.iter().map(|value| value.abs()).sum::<f64>()
            + self.free.iter().map(|value| value.abs()).sum::<f64>()
    }
}

/// Per pass: `aff(x)` per node, `1/S_v` per node and `1/(S_v − aff(w))` per slot, the
/// denominators of the batched split.
struct Split {
    affinity: Vec<f64>,
    free_share: Vec<f64>,
    slot_share: Vec<f64>,
}

impl Split {
    fn new(adjacency: &Adjacency, affinity: &[f64]) -> Result<Split, CoreError> {
        let viewer = adjacency.viewer.index();
        let mut weights = Vec::with_capacity(adjacency.user_count());
        for index in 0..adjacency.user_count() {
            let weight = affinity.get(index).copied().unwrap_or(1.0);
            // `exp(max(ℓ, 0)) ≥ 1`. Zero would make a split with nobody to take it, and a
            // non-finite weight a split into `NaN`.
            if !(weight > 0.0 && weight.is_finite()) {
                return Err(CoreError::InvalidParameter {
                    name: "affinity",
                    value: weight,
                });
            }
            weights.push(weight);
        }
        let mut free_share = vec![0.0; adjacency.user_count()];
        let mut slot_share = vec![0.0; adjacency.slot_count()];
        for (node, free) in free_share.iter_mut().enumerate() {
            let range = adjacency.offsets[node]..adjacency.offsets[node + 1];
            let onward: f64 = adjacency.targets[range.clone()]
                .iter()
                .filter(|&&other| other as usize != viewer)
                .map(|&other| weights[other as usize])
                .sum();
            *free = if onward > 0.0 { 1.0 / onward } else { 0.0 };
            for slot in range {
                let from = adjacency.targets[slot] as usize;
                let excluded = if from == viewer { 0.0 } else { weights[from] };
                let rest = onward - excluded;
                // `rest` is a sum less one of its own terms; anything under a rounding of the
                // whole is a node whose only onward neighbour is the one the mass came from.
                slot_share[slot] = if rest > onward * 1e-12 {
                    1.0 / rest
                } else {
                    0.0
                };
            }
        }
        Ok(Split {
            affinity: weights,
            free_share,
            slot_share,
        })
    }
}

/// The push itself. `warm` is an earlier walk over the same adjacency to start from.
pub(crate) fn push(
    adjacency: &Adjacency,
    affinity: &[f64],
    params: &Params,
    budget: &mut Budget,
    warm: Option<&Walk>,
) -> Result<Walk, CoreError> {
    let user_count = adjacency.user_count();
    let viewer = adjacency.viewer;
    let split = Split::new(adjacency, affinity)?;
    let onward = 1.0 - params.decay;
    let reach = params.residual_reach();
    let warm = warm.filter(|previous| {
        previous.slot_mass.len() == adjacency.slot_count() && previous.free_mass.len() == user_count
    });

    let mut residual = Residual {
        adjacency,
        slot: vec![0.0; adjacency.slot_count()],
        free: vec![0.0; user_count],
        held: vec![0.0; user_count],
        total: 0.0,
        unloaded: vec![0.0; user_count],
        queue: Queue::new(user_count),
    };
    // `a`: what has been passed on, per slot. Visit mass is `a + r`.
    let mut slot_flow = vec![0.0; adjacency.slot_count()];
    let mut free_flow = vec![0.0; user_count];
    let mut edge_pushes = 0usize;

    for &friend in &adjacency.friends {
        let landing = if adjacency.loaded[friend.index()] {
            Landing::Free
        } else {
            Landing::Unloaded
        };
        residual.deposit(friend.index(), landing, 1.0);
    }

    if let Some(previous) = warm {
        // `r = e + T·a₀ − a₀` under this pass's split, one sweep.
        slot_flow.copy_from_slice(&previous.slot_mass);
        free_flow.copy_from_slice(&previous.free_mass);
        for (slot, &mass) in previous.slot_mass.iter().enumerate() {
            residual.slot[slot] -= mass;
        }
        for (node, &mass) in previous.free_mass.iter().enumerate() {
            residual.free[node] -= mass;
        }
        for node in 0..user_count {
            if node == viewer.index() || !adjacency.loaded[node] {
                continue;
            }
            let range = adjacency.offsets[node]..adjacency.offsets[node + 1];
            edge_pushes += spread_arrivals(
                adjacency,
                &split,
                node,
                previous.free_mass[node],
                &previous.slot_mass[range],
                onward,
                false,
                &mut residual,
            );
        }
        residual.recount();
        budget.spend(edge_pushes);
    }

    let mut popped = vec![false; user_count];
    let mut expanded = 0usize;
    let mut arrived: Vec<f64> = Vec::new();
    let mut recounted = false;
    while expanded < params.node_budget && !budget.is_exhausted() {
        // A `NaN` total compares false against every bound, so leaving this to the comparison
        // below would read a diverged push as a converged one.
        if !residual.total.is_finite() {
            return Err(CoreError::NonFiniteMass {
                viewer,
                mass: residual.total,
            });
        }
        if residual.total * reach < params.error_budget {
            // The running total drifts by a rounding per deposit; the stop is decided on the sum.
            residual.total = residual.exact_total();
            if residual.total * reach < params.error_budget {
                break;
            }
        }
        let Some(node) = residual.queue.pop() else {
            // Only a rounding in the per-node sums can empty the queue with mass still above
            // the bound; counted afresh, what is left is queued again or is nothing.
            if recounted {
                break;
            }
            residual.recount();
            recounted = true;
            continue;
        };
        recounted = false;
        if !popped[node] {
            popped[node] = true;
            expanded += 1;
        }
        let range = adjacency.offsets[node]..adjacency.offsets[node + 1];
        let free = residual.free[node];
        arrived.clear();
        arrived.extend_from_slice(&residual.slot[range.clone()]);
        residual.total -= residual.held[node];
        residual.held[node] = 0.0;
        residual.free[node] = 0.0;
        free_flow[node] += free;
        for (offset, slot) in range.enumerate() {
            residual.slot[slot] = 0.0;
            slot_flow[slot] += arrived[offset];
        }
        let cost = spread_arrivals(
            adjacency,
            &split,
            node,
            free,
            &arrived,
            onward,
            warm.is_none(),
            &mut residual,
        );
        edge_pushes += cost;
        budget.spend(cost);
    }

    residual.total = residual.exact_total();
    if !residual.total.is_finite() {
        return Err(CoreError::NonFiniteMass {
            viewer,
            mass: residual.total,
        });
    }
    let truncation = residual.total * reach;

    let mut visit_mass = vec![0.0; user_count];
    let mut slot_mass = slot_flow;
    let mut free_mass = free_flow;
    for (slot, value) in slot_mass.iter_mut().enumerate() {
        *value += residual.slot[slot];
    }
    for (node, value) in free_mass.iter_mut().enumerate() {
        *value += residual.free[node];
    }
    let mut boundary: Vec<BoundaryNode> = Vec::new();
    let mut boundary_residual = 0.0;
    for (node, mass) in visit_mass.iter_mut().enumerate() {
        let total = if adjacency.loaded[node] {
            let range = adjacency.offsets[node]..adjacency.offsets[node + 1];
            free_mass[node] + slot_mass[range].iter().sum::<f64>()
        } else {
            residual.unloaded[node]
        };
        if !total.is_finite() {
            return Err(CoreError::NonFiniteMass {
                viewer,
                mass: total,
            });
        }
        // A warm start carries signed corrections, so a node the answer barely reaches can land
        // a rounding below zero. The true mass is not negative, so the floor only moves the
        // estimate toward it.
        *mass = total.max(0.0);
        if node != viewer.index() && !adjacency.loaded[node] && *mass > 0.0 {
            boundary.push(BoundaryNode {
                user: UserId(node as u32),
                residual: *mass * reach,
            });
            boundary_residual += *mass * reach;
        }
    }
    let touched: Vec<UserId> = (0..user_count)
        .filter(|&node| visit_mass[node] > 0.0)
        .map(|node| UserId(node as u32))
        .collect();

    Ok(Walk {
        friends: adjacency.friends.clone(),
        visit_mass,
        touched,
        truncation,
        boundary,
        boundary_residual,
        edge_pushes,
        stopped_early: truncation >= params.error_budget,
        slot_mass,
        free_mass,
    })
}

/// `T` applied to one node's arrivals, deposited on its neighbours: `free` is what arrived with
/// no edge to exclude, `arrived` what arrived along each slot. Returns the edge pushes spent.
#[allow(clippy::too_many_arguments)]
fn spread_arrivals(
    adjacency: &Adjacency,
    split: &Split,
    node: usize,
    free: f64,
    arrived: &[f64],
    onward: f64,
    cold: bool,
    residual: &mut Residual<'_>,
) -> usize {
    let start = adjacency.offsets[node];
    let mut pooled = free * split.free_share[node];
    for (offset, &value) in arrived.iter().enumerate() {
        pooled += value * split.slot_share[start + offset];
    }
    for (offset, &value) in arrived.iter().enumerate() {
        let slot = start + offset;
        let landing = adjacency.landings[slot];
        if landing == Landing::Viewer {
            continue;
        }
        let target = adjacency.targets[slot] as usize;
        let mut out = onward * split.affinity[target] * (pooled - value * split.slot_share[slot]);
        // Cold, every deposit is a sum of non-negative terms, and a negative one is the rounding
        // of `pooled` less its own term.
        if cold && out < 0.0 {
            out = 0.0;
        }
        if out != 0.0 {
            residual.deposit(target, landing, out);
        }
    }
    arrived.len().max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::Snapshot;

    fn pushed(snapshot: &Snapshot, viewer: UserId, params: &Params) -> Walk {
        let affinity = vec![1.0; snapshot.user_count()];
        match walk(snapshot, viewer, &affinity, params) {
            Ok(walked) => walked,
            Err(error) => unreachable!("{error}"),
        }
    }

    /// `u – f – g – h`, every node of degree two: the shape several of the bounds are quoted on.
    fn chain() -> (Snapshot, UserId, UserId, UserId, UserId) {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("u");
        let friend = builder.user("f");
        let beyond = builder.user("g");
        let further = builder.user("h");
        builder.edge(viewer, friend);
        builder.edge(friend, beyond);
        builder.edge(beyond, further);
        (builder.build(), viewer, friend, beyond, further)
    }

    #[test]
    fn friend_with_no_other_friends_keeps_exactly_one_unit() {
        let params = Params::default();
        let mut builder = Snapshot::builder();
        let viewer = builder.user("u");
        let friend = builder.user("f");
        builder.edge(viewer, friend);
        let snapshot = builder.build();
        let result = pushed(&snapshot, viewer, &params);
        let mass = result.visit_mass();
        assert!((mass[friend.index()] - 1.0).abs() < 1e-12);
        assert_eq!(result.truncation(), 0.0);
    }

    #[test]
    fn the_walk_does_not_step_back() {
        let params = Params::default();
        let (snapshot, viewer, friend, beyond, further) = chain();
        let result = pushed(&snapshot, viewer, &params);
        let mass = result.visit_mass();
        assert!((mass[friend.index()] - 1.0).abs() < 1e-12);
        assert!((mass[beyond.index()] - (1.0 - params.decay)).abs() < 1e-12);
        assert!((mass[further.index()] - (1.0 - params.decay).powi(2)).abs() < 1e-12);
    }

    #[test]
    fn no_affinity_can_make_a_friend_triangle_diverge() {
        // Three mutual friends are a triangle the non-backtracking walk circles forever. What
        // stops it is that affinity only ever *reallocates* what leaves a node: whatever the
        // shares are, `1 − α` of what arrives goes on and the rest dies, so the mass beyond one
        // friend is at most one friend-unit on every graph.
        let params = Params::default();
        let mut builder = Snapshot::builder();
        let viewer = builder.user("u");
        let ring: Vec<UserId> = (0..3)
            .map(|index| builder.user(&format!("f{index}")))
            .collect();
        for (index, &friend) in ring.iter().enumerate() {
            builder.edge(viewer, friend);
            builder.edge(friend, ring[(index + 1) % ring.len()]);
        }
        let snapshot = builder.build();
        let mut affinity = vec![1.0; snapshot.user_count()];
        for &friend in &ring {
            affinity[friend.index()] = params.affinity_cap();
        }
        let result = walk(&snapshot, viewer, &affinity, &params).expect("a finite walk");
        for &friend in &ring {
            let mass = result.visit_mass()[friend.index()];
            assert!(mass.is_finite() && mass <= 3.0, "π̃ = {mass} on the ring");
        }
        assert!(result.truncation() <= params.error_budget);
        let total: f64 = result.visit_mass().iter().sum();
        assert!(
            total <= ring.len() as f64 * 2.0 + 1e-9,
            "Σ π̃ = {total} is above |F_u|/α"
        );
    }

    #[test]
    fn an_affinity_the_split_cannot_use_is_refused() {
        let params = Params::default();
        let (snapshot, viewer, _, beyond, _) = chain();
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut affinity = vec![1.0; snapshot.user_count()];
            affinity[beyond.index()] = bad;
            assert!(
                matches!(
                    walk(&snapshot, viewer, &affinity, &params),
                    Err(CoreError::InvalidParameter {
                        name: "affinity",
                        ..
                    })
                ),
                "an affinity of {bad} was accepted"
            );
        }
    }

    #[test]
    fn a_dense_clique_stops_on_the_push_budget() {
        // 300 nodes all friends with each other: 89 700 directed edges, and a node's expansion
        // costs its whole degree.
        let params = Params {
            edge_budget: 10_000,
            ..Params::default()
        };
        let snapshot = clique_behind_a_friend(300);
        let viewer = snapshot.user_id("u").expect("the viewer");
        let result = pushed(&snapshot, viewer, &params);

        let max_degree = snapshot
            .users()
            .map(|user| snapshot.friends(user).len())
            .max()
            .unwrap_or(0);
        assert!(
            result.edge_pushes() >= params.edge_budget,
            "the push stopped at {} pushes, short of E_max = {}",
            result.edge_pushes(),
            params.edge_budget
        );
        assert!(result.stopped_early());
        assert!(
            result.truncation() > params.error_budget,
            "the walk converged instead of stopping early: truncation {}",
            result.truncation()
        );
        // The budget is checked once per expansion, and one expansion costs the degree of the
        // node it pops.
        assert!(
            result.edge_pushes() < params.edge_budget + max_degree,
            "{} pushes overshot E_max = {} by more than the largest degree {max_degree}",
            result.edge_pushes(),
            params.edge_budget
        );
        // Given the room, the same clique resolves in a handful of sweeps: every expansion of a
        // node drains everything that arrived at it, however many edges it arrived along.
        let roomy = Params {
            edge_budget: 100_000_000,
            ..params
        };
        let longer = pushed(&snapshot, viewer, &roomy);
        let sweep: usize = snapshot
            .users()
            .map(|user| snapshot.friends(user).len())
            .sum();
        assert!(!longer.stopped_early());
        assert!(
            longer.edge_pushes() <= 12 * sweep,
            "the clique took {} pushes, {} sweeps of {sweep}",
            longer.edge_pushes(),
            longer.edge_pushes() / sweep
        );
    }

    #[test]
    fn one_converged_walk_fits_in_a_pass_of_the_reservation() {
        let params = Params::default();
        for size in [5, 20, 80] {
            let snapshot = clique_behind_a_friend(size);
            let viewer = snapshot.user_id("u").expect("the viewer");
            let affinity = vec![1.0; snapshot.user_count()];
            let reserved = Budget::for_snapshot(&snapshot, viewer, &params).remaining();
            let mut budget = Budget::new(reserved);
            let walked = walk_within(&snapshot, viewer, &affinity, &params, &mut budget)
                .expect("a finite walk");
            assert!(
                walked.truncation() < params.error_budget,
                "the walk stopped short of ε_total at {}",
                walked.truncation()
            );
            assert!(
                budget.spent() * params.settle_max_passes <= reserved,
                "one converged pass spent {} of a reservation of {reserved}, so the loop cannot \
                 reach its {} passes",
                budget.spent(),
                params.settle_max_passes
            );
        }
    }

    fn clique_behind_a_friend(size: usize) -> Snapshot {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("u");
        let friend = builder.user("f");
        builder.edge(viewer, friend);
        let clique: Vec<_> = (0..size)
            .map(|index| builder.user(&format!("c{index}")))
            .collect();
        builder.edge(friend, clique[0]);
        for (index, &node) in clique.iter().enumerate() {
            for &other in &clique[index + 1..] {
                builder.edge(node, other);
            }
        }
        builder.build()
    }

    #[test]
    fn one_budget_is_shared_across_calls() {
        let params = Params {
            edge_budget: 4_000,
            ..Params::default()
        };
        let snapshot = clique_behind_a_friend(60);
        let viewer = snapshot.user_id("u").expect("the viewer");
        let affinity = vec![1.0; snapshot.user_count()];
        let mut budget = Budget::new(params.edge_budget);
        let first =
            walk_within(&snapshot, viewer, &affinity, &params, &mut budget).expect("a finite walk");
        let second =
            walk_within(&snapshot, viewer, &affinity, &params, &mut budget).expect("a finite walk");
        assert!(first.edge_pushes() >= params.edge_budget);
        // The injection is the one thing a walk always does; past it there is nothing left to
        // spend, so the second walk expands nothing and holds only what it injected.
        assert_eq!(
            second.edge_pushes(),
            0,
            "the second walk spent {} pushes of a budget the first had already used up",
            second.edge_pushes()
        );
        assert_eq!(second.nodes_touched(), 1);
        assert!(second.stopped_early());
        assert!(budget.is_exhausted());
    }

    #[test]
    fn a_warm_start_reaches_the_same_answer_for_less() {
        // The settling loop's case: the same graph under a different split, started from the
        // answer under the old one.
        let params = Params {
            error_budget: 1e-9,
            ..Params::default()
        };
        let snapshot = clique_behind_a_friend(40);
        let viewer = snapshot.user_id("u").expect("the viewer");
        let adjacency = Adjacency::new(&snapshot, viewer);
        let uniform = vec![1.0; snapshot.user_count()];
        let skewed: Vec<f64> = (0..snapshot.user_count())
            .map(|index| 1.0 + (index % 5) as f64)
            .collect();
        let mut budget = Budget::new(usize::MAX);
        let first = push(&adjacency, &uniform, &params, &mut budget, None).expect("finite");
        let cold = push(&adjacency, &skewed, &params, &mut budget, None).expect("finite");
        let warm = push(&adjacency, &skewed, &params, &mut budget, Some(&first)).expect("finite");
        assert!(warm.truncation() < params.error_budget);
        for user in snapshot.users() {
            let (hot, frozen) = (
                warm.visit_mass()[user.index()],
                cold.visit_mass()[user.index()],
            );
            assert!(
                (hot - frozen).abs() <= warm.truncation() + cold.truncation() + 1e-12,
                "user {}: warm {hot}, cold {frozen}",
                user.0
            );
        }
        assert!(
            warm.edge_pushes() < cold.edge_pushes(),
            "the warm start cost {} against {} cold",
            warm.edge_pushes(),
            cold.edge_pushes()
        );
        // Started from its own answer, a walk has nothing to do but the sweep that checks it.
        let again = push(&adjacency, &skewed, &params, &mut budget, Some(&cold)).expect("finite");
        let sweep: usize = snapshot
            .users()
            .map(|user| snapshot.friends(user).len())
            .sum();
        assert!(again.edge_pushes() <= sweep, "{}", again.edge_pushes());
    }

    #[test]
    fn the_pop_order_is_fixed_by_the_graph() {
        // Nothing in the queue depends on anything but the graph and the residuals — no hash
        // order, no allocation address — so two walks over the same snapshot, or over one built
        // again from the same edges, agree to the bit and spend the same pushes.
        let params = Params::default();
        let build = || {
            let mut builder = Snapshot::builder();
            let users: Vec<UserId> = (0..40)
                .map(|index| builder.user(&format!("p{index}")))
                .collect();
            for index in 0..users.len() {
                for step in [1, 3, 7] {
                    builder.edge(users[index], users[(index * 5 + step) % users.len()]);
                }
            }
            builder.build()
        };
        let snapshot = build();
        let viewer = UserId(0);
        let affinity: Vec<f64> = (0..snapshot.user_count())
            .map(|index| 1.0 + (index % 4) as f64)
            .collect();
        let first = walk(&snapshot, viewer, &affinity, &params).expect("finite");
        for other in [&snapshot, &build()] {
            let again = walk(other, viewer, &affinity, &params).expect("finite");
            assert_eq!(first.visit_mass(), again.visit_mass());
            assert_eq!(first.truncation(), again.truncation());
            assert_eq!(first.edge_pushes(), again.edge_pushes());
        }
    }

    #[test]
    fn an_unloaded_node_reports_its_residual_instead_of_swallowing_it() {
        let params = Params::default();
        let (mut builder, viewer, beyond) = {
            let mut builder = Snapshot::builder();
            let viewer = builder.user("u");
            let friend = builder.user("f");
            let beyond = builder.user("g");
            builder.edge(viewer, friend);
            builder.edge(friend, beyond);
            (builder, viewer, beyond)
        };
        builder.set_loaded(beyond, false);
        let snapshot = builder.build();
        let result = pushed(&snapshot, viewer, &params);
        assert_eq!(result.boundary_nodes().len(), 1);
        assert_eq!(result.boundary_nodes()[0].user, beyond);
        let expected = (1.0 - params.decay) * params.residual_reach();
        assert!((result.boundary_residual() - expected).abs() < 1e-12);
        assert!(
            result.truncation().abs() < 1e-12,
            "what waits on a boundary node is reported apart from the truncation, not inside \
             it: {}",
            result.truncation()
        );
    }

    #[test]
    fn viewer_with_no_friends_yields_nothing() {
        let params = Params::default();
        let mut builder = Snapshot::builder();
        let viewer = builder.user("u");
        let snapshot = builder.build();
        let result = pushed(&snapshot, viewer, &params);
        assert!(result.friends().is_empty());
        assert_eq!(result.nodes_touched(), 0);
        assert!(result.visit_mass().iter().all(|mass| *mass == 0.0));
    }
}
