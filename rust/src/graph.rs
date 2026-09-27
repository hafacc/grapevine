//! The graph interface distances are read over.
//!
//! Adjacency may be *missing* for a node, which is different from a node with no friends: the
//! loader of DESIGN section 3.4 hands over what it has read so far, and the core reports the
//! nodes it could not expand so the caller can decide whether to read more.

use crate::ids::UserId;

pub trait Graph {
    /// One past the largest user id the graph can be asked about.
    fn user_count(&self) -> usize;

    /// `None` when this node's friend list has not been loaded.
    fn neighbors(&self, user: UserId) -> Option<&[UserId]>;
}

/// Shortest-path hop distances from `viewer` over the loaded part of the graph.
///
/// Distances decide who is in the viewer's circle, which way a chain link's exposure counts, and
/// the tallies' distance classes; chains decide on their own how far to go.
///
/// Over a partial graph a distance can be an over-statement: the shortest path to someone may
/// run through a node whose friend list was never read, and then the only path this sees is a
/// longer one. Loading the boundary (DESIGN section 3.4) is what corrects it.
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
