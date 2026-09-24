//! Reach-weighted consensus and informativeness, DESIGN section 2.2.

use crate::ids::{Ratable, UserId};
use crate::snapshot::Snapshot;

/// `ω_x` per item, indexed by item id: `ω = 4·n⁺·n⁻ / (n·(n + 1))`, and `0` where nobody in
/// reach has rated the item.
///
/// Votes are counted inside the viewer's own reach and weighted by `π̃`, so a region of the
/// graph can move the split only by the mass it is allowed to hold, and accounts the viewer
/// cannot reach at all move it by nothing. The viewer votes too, at `π̃_u(u) = 1`: their own
/// thumb is a real vote in their own reach, and leaving it out would make "everyone but me"
/// unanimous look uncontested.
///
/// `4·n⁺·n⁻/n²` is the even-split factor; the extra `n/(n + 1)` is the support the count itself
/// carries, so a lone pair of dissenters is worth half of what a crowd evenly split is, with no
/// threshold to choose. It reaches `n/(n + 1)` at an even split and is exactly `0` on a
/// unanimous item however many people rated it — which is what makes copying consensus
/// worthless rather than merely cheap.
pub fn informativeness(snapshot: &Snapshot, viewer: UserId, visit_mass: &[f64]) -> Vec<f64> {
    let mut up = vec![0.0; snapshot.item_count()];
    let mut down = vec![0.0; snapshot.item_count()];
    let mut count_vote = |ratings: &[(Ratable, i8)], mass: f64| {
        for &(ratable, value) in ratings {
            if let Ratable::Item(item) = ratable {
                if value > 0 {
                    up[item.index()] += mass;
                } else {
                    down[item.index()] += mass;
                }
            }
        }
    };
    count_vote(snapshot.ratings(viewer), 1.0);
    for rater in snapshot.users() {
        if rater == viewer {
            continue;
        }
        let mass = visit_mass[rater.index()];
        if mass <= 0.0 {
            continue;
        }
        count_vote(snapshot.ratings(rater), mass);
    }
    up.iter()
        .zip(&down)
        .map(|(&positive, &negative)| {
            let total = positive + negative;
            if total <= 0.0 {
                return 0.0;
            }
            4.0 * positive * negative / (total * (total + 1.0))
        })
        .collect()
}
