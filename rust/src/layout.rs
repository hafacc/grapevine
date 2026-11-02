//! Points in a few dimensions laid out in the plane, for the viewer's map.
//!
//! Points of one or two numbers are places already, and are only fitted to the square. Points
//! of more are placed by t-SNE (van der Maaten and Hinton, 2008), exactly: every pair of points
//! is visited each step, which a few hundred points can afford. Each point's neighbours in the plane are made
//! to be its neighbours in the space it came from, so points that sit together came from
//! together. Nothing else about the picture means anything: not how far apart two groups are,
//! and not which way anything lies. It is a look at the points, not a measurement of them.

use crate::rng::Rng;

/// How many neighbours a point is taken to have, where there are enough points for that.
const PERPLEXITY: f64 = 30.0;

/// Gradient steps. The first `EARLY` of them pull neighbours together harder than they are,
/// which is what lets groups form before they are spread out.
const STEPS: usize = 400;
const EARLY: usize = 100;
const EXAGGERATION: f64 = 12.0;

/// The smallest step size, and the momentum before and after the early steps. The step size
/// grows with the number of points, a quarter of it per unit of exaggeration, as the method's
/// common implementations set it: a fixed large one throws a few dozen points out of the plane
/// on the first steps.
const RATE: f64 = 50.0;
const MOMENTUM: [f64; 2] = [0.5, 0.8];

/// How far the plane's start is spread along the points' widest direction, as the method's
/// reference implementations set it: small, so that no pair starts out far apart.
const START: f64 = 1e-4;

/// The seed of the grain added to the start, which is what separates points that begin in one
/// place: the same points give the same picture.
const SEED: u64 = 0x6d61_705f_6f66_5f75;

/// The direction a set of points varies most along, with `without` taken out of them first:
/// the largest eigenvector of their covariance, by power iteration from a fixed start.
fn widest<const N: usize>(points: &[[f64; N]], without: Option<&[f64; N]>) -> [f64; N] {
    let along = |point: &[f64; N], direction: &[f64; N]| -> f64 {
        (0..N).map(|k| point[k] * direction[k]).sum()
    };
    let mut direction: [f64; N] = std::array::from_fn(|k| 1.0 / (1.0 + k as f64));
    for _ in 0..200 {
        let mut next = [0.0; N];
        for point in points {
            let mut rest = *point;
            if let Some(taken) = without {
                let part = along(point, taken);
                for k in 0..N {
                    rest[k] -= part * taken[k];
                }
            }
            let weight = along(&rest, &direction);
            for k in 0..N {
                next[k] += weight * rest[k];
            }
        }
        let size = next.iter().map(|value| value * value).sum::<f64>().sqrt();
        if size <= f64::MIN_POSITIVE {
            // No variation left to find a direction in: any will do.
            return direction;
        }
        direction = next.map(|value| value / size);
    }
    direction
}

/// The places fitted to the square from −1 to 1: centred, and scaled so that the furthest
/// touches its edge.
fn fitted(places: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let count = places.len().max(1) as f64;
    let mut centre = [0.0f64; 2];
    for place in places {
        centre[0] += place[0] / count;
        centre[1] += place[1] / count;
    }
    let reach = places
        .iter()
        .map(|place| {
            (place[0] - centre[0])
                .abs()
                .max((place[1] - centre[1]).abs())
        })
        .fold(f64::MIN_POSITIVE, f64::max);
    places
        .iter()
        .map(|place| {
            [
                (place[0] - centre[0]) / reach,
                (place[1] - centre[1]) / reach,
            ]
        })
        .collect()
}

/// The neighbour probabilities of point `from`, given every squared distance from it: a
/// Gaussian whose width is searched for until it has the entropy of `perplexity` neighbours.
fn neighbours(distances: &[f64], from: usize, perplexity: f64) -> Vec<f64> {
    let target = perplexity.ln();
    let (mut low, mut high) = (0.0f64, f64::INFINITY);
    let mut sharpness = 1.0f64;
    let mut out = vec![0.0; distances.len()];
    for _ in 0..64 {
        let mut total = 0.0;
        for (index, &distance) in distances.iter().enumerate() {
            out[index] = if index == from {
                0.0
            } else {
                (-sharpness * distance).exp()
            };
            total += out[index];
        }
        if total <= 0.0 {
            // Every other point is too far for this width to see: widen it.
            high = sharpness;
            sharpness = (low + high) / 2.0;
            continue;
        }
        let mut entropy = 0.0;
        for (value, &distance) in out.iter_mut().zip(distances) {
            *value /= total;
            entropy += sharpness * distance * *value;
        }
        entropy += total.ln();
        if (entropy - target).abs() < 1e-5 {
            break;
        }
        if entropy > target {
            low = sharpness;
            sharpness = if high.is_finite() {
                (low + high) / 2.0
            } else {
                sharpness * 2.0
            };
        } else {
            high = sharpness;
            sharpness = (low + high) / 2.0;
        }
    }
    out
}

/// A place in the plane for each point, inside the square from −1 to 1 each way.
///
/// The same points in the same order give the same places. Points of one or two numbers are
/// their own places, the second of a one-number point being nothing. Fewer than three points
/// are put on a line through the middle: there is nothing to lay out.
pub fn lay_out<const N: usize>(points: &[[f64; N]]) -> Vec<[f64; 2]> {
    let count = points.len();
    if N <= 2 {
        let own: Vec<[f64; 2]> = points
            .iter()
            .map(|point| [point[0], if N == 2 { point[1] } else { 0.0 }])
            .collect();
        return fitted(&own);
    }
    if count < 3 {
        return fitted(
            &(0..count)
                .map(|index| [index as f64, 0.0])
                .collect::<Vec<_>>(),
        );
    }
    // Scaled to a unit spread, so that what counts as near does not depend on the units.
    let spread = (points
        .iter()
        .map(|point| point.iter().map(|value| value * value).sum::<f64>())
        .sum::<f64>()
        / count as f64)
        .sqrt()
        .max(f64::MIN_POSITIVE);
    let squared = |one: usize, other: usize| -> f64 {
        (0..N)
            .map(|k| ((points[one][k] - points[other][k]) / spread).powi(2))
            .sum()
    };
    let perplexity = PERPLEXITY.min((count as f64 - 1.0) / 3.0);
    let mut joint = vec![0.0; count * count];
    for from in 0..count {
        let distances: Vec<f64> = (0..count).map(|to| squared(from, to)).collect();
        for (to, value) in neighbours(&distances, from, perplexity)
            .into_iter()
            .enumerate()
        {
            joint[from * count + to] += value;
            joint[to * count + from] += value;
        }
    }
    for value in &mut joint {
        *value = (*value / (2.0 * count as f64)).max(1e-12);
    }

    // Started along the two directions the points vary most in, which keeps the picture's
    // broad arrangement the points' own and the same from one fit to the next.
    let mean: [f64; N] =
        std::array::from_fn(|k| points.iter().map(|point| point[k]).sum::<f64>() / count as f64);
    let centred: Vec<[f64; N]> = points
        .iter()
        .map(|point| std::array::from_fn(|k| (point[k] - mean[k]) / spread))
        .collect();
    let first = widest(&centred, None);
    let second = widest(&centred, Some(&first));
    let along = |point: &[f64; N], direction: &[f64; N]| -> f64 {
        (0..N).map(|k| point[k] * direction[k]).sum()
    };
    let widest_spread = (centred
        .iter()
        .map(|point| along(point, &first).powi(2))
        .sum::<f64>()
        / count as f64)
        .sqrt()
        .max(f64::MIN_POSITIVE);
    let mut rng = Rng::new(SEED);
    let mut places: Vec<[f64; 2]> = centred
        .iter()
        .map(|point| {
            [
                START * along(point, &first) / widest_spread + 1e-6 * rng.normal(),
                START * along(point, &second) / widest_spread + 1e-6 * rng.normal(),
            ]
        })
        .collect();
    let rate = RATE.max(count as f64 / EXAGGERATION / 4.0);
    let mut moves = vec![[0.0f64; 2]; count];
    let mut gains = vec![[1.0f64; 2]; count];
    let mut weights = vec![0.0; count * count];
    for step in 0..STEPS {
        let mut total = 0.0;
        for one in 0..count {
            for other in (one + 1)..count {
                let (dx, dy) = (
                    places[one][0] - places[other][0],
                    places[one][1] - places[other][1],
                );
                let weight = 1.0 / (1.0 + dx * dx + dy * dy);
                weights[one * count + other] = weight;
                weights[other * count + one] = weight;
                total += 2.0 * weight;
            }
        }
        let pull = if step < EARLY { EXAGGERATION } else { 1.0 };
        let momentum = MOMENTUM[usize::from(step >= EARLY)];
        for one in 0..count {
            let mut gradient = [0.0f64; 2];
            for other in 0..count {
                if other == one {
                    continue;
                }
                let weight = weights[one * count + other];
                let force = (pull * joint[one * count + other] - weight / total) * weight;
                gradient[0] += 4.0 * force * (places[one][0] - places[other][0]);
                gradient[1] += 4.0 * force * (places[one][1] - places[other][1]);
            }
            for axis in 0..2 {
                // A step that keeps going the same way is lengthened; one that turned is cut.
                let same = (gradient[axis] > 0.0) == (moves[one][axis] > 0.0);
                gains[one][axis] = if same {
                    (gains[one][axis] * 0.8).max(0.01)
                } else {
                    gains[one][axis] + 0.2
                };
                moves[one][axis] =
                    momentum * moves[one][axis] - rate * gains[one][axis] * gradient[axis];
            }
        }
        for (place, moved) in places.iter_mut().zip(&moves) {
            place[0] += moved[0];
            place[1] += moved[1];
        }
    }

    fitted(&places)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two groups of points far apart in three dimensions.
    fn groups() -> Vec<[f64; 3]> {
        let mut rng = Rng::new(11);
        (0..60)
            .map(|index| {
                let centre = if index < 30 { 0.0 } else { 6.0 };
                [
                    centre + 0.3 * rng.normal(),
                    0.3 * rng.normal(),
                    centre + 0.3 * rng.normal(),
                ]
            })
            .collect()
    }

    fn gap(one: [f64; 2], other: [f64; 2]) -> f64 {
        (one[0] - other[0]).hypot(one[1] - other[1])
    }

    /// What the method keeps is who is near whom: every point's nearest neighbour in the plane
    /// is one of its own group, and the groups' middles are further apart than either is wide.
    #[test]
    fn points_that_came_from_together_sit_together() {
        let places = lay_out(&groups());
        for one in 0..60 {
            let nearest = (0..60)
                .filter(|&other| other != one)
                .min_by(|&first, &second| {
                    gap(places[one], places[first]).total_cmp(&gap(places[one], places[second]))
                })
                .expect("another point");
            assert_eq!(one < 30, nearest < 30, "{one} sits nearest {nearest}");
        }
        let middle = |group: std::ops::Range<usize>| -> [f64; 2] {
            let size = group.len() as f64;
            group.fold([0.0, 0.0], |sum, index| {
                [
                    sum[0] + places[index][0] / size,
                    sum[1] + places[index][1] / size,
                ]
            })
        };
        let (first, second) = (middle(0..30), middle(30..60));
        let width = |group: std::ops::Range<usize>, centre: [f64; 2]| -> f64 {
            let size = group.len() as f64;
            group.map(|index| gap(places[index], centre)).sum::<f64>() / size
        };
        let apart = gap(first, second);
        assert!(
            apart > width(0..30, first) + width(30..60, second),
            "{apart}"
        );
    }

    #[test]
    fn the_same_points_give_the_same_picture_inside_the_square() {
        let points = groups();
        let places = lay_out(&points);
        assert_eq!(places, lay_out(&points));
        for place in &places {
            assert!(
                place
                    .iter()
                    .all(|value| value.is_finite() && value.abs() <= 1.0)
            );
        }
    }

    #[test]
    fn too_few_points_or_points_all_in_one_place_are_still_placed() {
        assert!(lay_out::<3>(&[]).is_empty());
        assert_eq!(lay_out(&[[1.0, 2.0, 3.0]]), vec![[0.0, 0.0]]);
        // One number or two are a place already, fitted to the square.
        assert_eq!(
            lay_out(&[[1.0], [3.0], [2.0]]),
            vec![[-1.0, 0.0], [1.0, 0.0], [0.0, 0.0]]
        );
        assert_eq!(
            lay_out(&[[0.0, 0.0], [2.0, 4.0]]),
            vec![[-0.5, -1.0], [0.5, 1.0]]
        );
        assert_eq!(lay_out(&[[0.0; 3], [1.0; 3]]).len(), 2);
        for place in lay_out(&[[1.0, 1.0, 1.0]; 12]) {
            assert!(place.iter().all(|value| value.is_finite()));
        }
    }
}
