//! The graph interface the walk runs over.
//!
//! Adjacency may be *missing* for a node, which is different from a node with no friends: the
//! live loader of DESIGN section 3.4 pushes over what it has read so far, and the walk reports
//! the mass sitting on nodes it could not expand so the caller can decide whether to read more.

use crate::ids::UserId;

pub trait Graph {
    /// One past the largest user id the graph can be asked about.
    fn user_count(&self) -> usize;

    /// `None` when this node's friend list has not been loaded.
    fn neighbors(&self, user: UserId) -> Option<&[UserId]>;
}

/// Shortest-path hop distances from `viewer` over the loaded part of the graph.
///
/// Distances feed the alignment prior `a₀(d)` and nothing else; the walk decides on its own how
/// far to go.
///
/// Over a partial graph a distance can be an over-statement: the shortest path to someone may
/// run through a node whose friend list was never read, and then the only path this sees is a
/// longer one. The cost is one step of the prior — `a₀(2) = 0.55` read as `a₀(3) = 0.50` — on
/// someone the walk reached anyway, so it is a slightly colder prior for a boundary case and
/// never a wrong answer about reach. Loading the boundary (DESIGN section 3.4 step 4) is what
/// corrects it.
pub fn hop_distances<G: Graph>(graph: &G, viewer: UserId) -> Vec<Option<u32>> {
    let mut distances = vec![None; graph.user_count()];
    distances[viewer.index()] = Some(0);
    let mut frontier = vec![viewer];
    let mut depth = 0;
    while !frontier.is_empty() {
        depth += 1;
        let mut next = Vec::new();
        for node in frontier {
            let Some(neighbors) = graph.neighbors(node) else {
                continue;
            };
            for &neighbor in neighbors {
                if distances[neighbor.index()].is_none() {
                    distances[neighbor.index()] = Some(depth);
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
    }
    distances
}
