//! The witness channel of DESIGN section 2.2 and everything read off it: the likelihood of one
//! shared thumb, the posterior of a reliability on a grid, one thumb's clipped log-likelihood
//! ratio, and the chance a thumb is the viewer's own answer rather than a guess.
//!
//! `P(v says +1 | t) = |λ|·[sign(λ)·t = +1] + (1 − |λ|)·b`: with probability `|λ|` the witness
//! knows the holder's answer (reversed when `λ < 0`), otherwise they draw from the base rate.

/// Grid points every reliability posterior is integrated over, the midpoints of `(−1, 1)` cut in
/// sixteen. Sixty-four measured no different and cost four times as much.
pub const GRID: usize = 16;

/// One shared thumb as evidence about how well a witness knows a holder's answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reading {
    /// Whether the witness's thumb matched the holder's.
    pub agreed: bool,
    /// The chance of matching with nothing shared: the base rate of the holder's thumb.
    pub chance: f64,
    /// The chance the witness saw the holder's thumb first and reacted to it; zero for a thumb
    /// given before the holder's.
    pub exposure: f64,
    /// How many readings this one counts as (attribute pairs average a region's co-tags).
    pub weight: f64,
}

/// `λ` at grid point `index`.
pub fn grid_point(index: usize) -> f64 {
    -1.0 + (index as f64 + 0.5) * 2.0 / GRID as f64
}

/// The chance a witness with reliability `lambda` matches a thumb whose base rate is `chance`.
pub fn agree_probability(lambda: f64, chance: f64) -> f64 {
    if lambda >= 0.0 {
        chance + lambda * (1.0 - chance)
    } else {
        chance * (1.0 + lambda)
    }
}

/// The log-likelihood of the readings at `lambda`. A reading that may be a reaction is, with
/// probability `exposure`, a coin whose direction says nothing (DESIGN section 2.3).
pub fn log_likelihood(readings: &[Reading], lambda: f64) -> f64 {
    readings
        .iter()
        .map(|reading| {
            let independent = agree_probability(lambda, reading.chance);
            let agree = reading.exposure * 0.5 + (1.0 - reading.exposure) * independent;
            let probability = if reading.agreed { agree } else { 1.0 - agree };
            reading.weight * probability.max(1e-300).ln()
        })
        .sum()
}

/// A reliability's posterior mean, and the marginal likelihood of the readings under the prior.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Posterior {
    pub mean: f64,
    pub log_marginal: f64,
}

/// The posterior of `λ` under a Beta prior on `(1 + λ)/2` with mean `prior_rate` and strength
/// `strength`, by the midpoint rule.
///
/// Over the whole of `(−1, 1)` the sixteen-point grid is what was measured, and is used whenever
/// the posterior can be anywhere. A sharp prior (the large `κ_a` of an attribute) confines it, and
/// sixteen points over the whole range would snap a prior of strength 1 024 by more than its own
/// width. Then the grid covers a window around the prior's centre at a quarter of the prior's
/// spread per point: `2n/(κ + n)` (how far `n` Bernoulli trials on `(1 + λ)/2` move a Beta mean)
/// plus eight spreads either side; and the window doubles until the posterior at both of its
/// inner edges is below `e⁻³⁰` of its peak, so the heuristic can cost points but never mass.
pub fn posterior(readings: &[Reading], prior_rate: f64, strength: f64) -> Posterior {
    let rate = prior_rate.clamp(1e-3, 1.0 - 1e-3);
    let alpha = strength * rate;
    let beta = strength * (1.0 - rate);
    let weight: f64 = readings.iter().map(|reading| reading.weight).sum();
    let mass = strength + weight + 1.0;
    let mut reach = 2.0 * weight / (strength + weight) + 8.0 / mass.sqrt();
    let centre = 2.0 * rate - 1.0;
    if centre - reach <= -1.0 && centre + reach >= 1.0 {
        let points: [f64; GRID] = std::array::from_fn(grid_point);
        return integrate(readings, &points, alpha, beta).0;
    }
    loop {
        let (low, high) = ((centre - reach).max(-1.0), (centre + reach).min(1.0));
        let count = (((high - low) * mass.sqrt() / 0.25).ceil() as usize).clamp(GRID, 4096);
        let step = (high - low) / count as f64;
        let points: Vec<f64> = (0..count)
            .map(|index| low + (index as f64 + 0.5) * step)
            .collect();
        let (found, [first, last]) = integrate(readings, &points, alpha, beta);
        let open_low = low > -1.0 && first > -30.0;
        let open_high = high < 1.0 && last > -30.0;
        if !open_low && !open_high {
            return found;
        }
        reach *= 2.0;
    }
}

/// The midpoint rule over equally spaced `points`, with the prior normalized over them; and the
/// log-posterior at the first and last point relative to its peak.
fn integrate(readings: &[Reading], points: &[f64], alpha: f64, beta: f64) -> (Posterior, [f64; 2]) {
    let log_prior: Vec<f64> = points
        .iter()
        .map(|&lambda| {
            let share = (1.0 + lambda) / 2.0;
            (alpha - 1.0) * share.ln() + (beta - 1.0) * (1.0 - share).ln()
        })
        .collect();
    let top_prior = log_prior.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let normalizer = log_prior
        .iter()
        .map(|value| (value - top_prior).exp())
        .sum::<f64>()
        .ln()
        + top_prior;
    let joint: Vec<f64> = points
        .iter()
        .zip(&log_prior)
        .map(|(&lambda, &prior)| prior - normalizer + log_likelihood(readings, lambda))
        .collect();
    let top = joint.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let mut total = 0.0;
    let mut weighted = 0.0;
    for (&lambda, &value) in points.iter().zip(&joint) {
        let weight = (value - top).exp();
        total += weight;
        weighted += weight * lambda;
    }
    let edges = [joint[0] - top, joint[joint.len() - 1] - top];
    (
        Posterior {
            mean: weighted / total,
            log_marginal: top + total.ln(),
        },
        edges,
    )
}

/// The chance a witness at `lambda` says up, given the viewer's answer `truth`, on a thing whose
/// base rate of an up is `up`.
fn says_up(lambda: f64, up: f64, truth: i8) -> f64 {
    let knows = lambda.abs();
    let copies = lambda.signum() * f64::from(truth) > 0.0;
    knows * f64::from(u8::from(copies)) + (1.0 - knows) * up
}

/// One thumb's log-likelihood ratio for "the viewer would say up", clipped at `±clip`.
pub fn thumb_evidence(lambda: f64, up: f64, value: i8, clip: f64) -> f64 {
    let if_up = says_up(lambda, up, 1);
    let if_down = says_up(lambda, up, -1);
    let ratio = if value > 0 {
        (if_up / if_down).ln()
    } else {
        ((1.0 - if_up) / (1.0 - if_down)).ln()
    };
    ratio.clamp(-clip, clip)
}

/// `ρ`: the posterior chance that a thumb is the viewer's own answer rather than a guess, given
/// the chance `up_probability` that the viewer would say up (DESIGN section 2.6).
pub fn answer_share(lambda: f64, up: f64, value: i8, up_probability: f64) -> f64 {
    let knows = lambda.abs();
    let direction = if lambda.signum() < 0.0 { -1 } else { 1 };
    let answer = |truth: i8| {
        let said = says_up(lambda, up, truth);
        let probability = if value > 0 { said } else { 1.0 - said };
        let copied = if value == truth * direction {
            knows
        } else {
            0.0
        };
        copied / probability.max(1e-12)
    };
    up_probability * answer(1) + (1.0 - up_probability) * answer(-1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64, what: &str) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "{what}: {actual} against {expected}"
        );
    }

    fn close_to(actual: f64, expected: f64, tolerance: f64, what: &str) {
        assert!(
            (actual - expected).abs() < tolerance,
            "{what}: {actual} against {expected}"
        );
    }

    #[test]
    fn the_grid_is_the_midpoints_of_minus_one_to_one() {
        close(grid_point(0), -1.0 + 1.0 / GRID as f64, "first");
        close(grid_point(GRID - 1), 1.0 - 1.0 / GRID as f64, "last");
        let sum: f64 = (0..GRID).map(grid_point).sum();
        close(sum, 0.0, "symmetric");
    }

    #[test]
    fn with_no_readings_the_posterior_is_the_prior() {
        // The prior's mean on the grid, which is the continuous mean to within the grid's error.
        let found = posterior(&[], 0.65, 8.0);
        assert!((found.mean - 0.3).abs() < 0.01, "{}", found.mean);
        close(found.log_marginal, 0.0, "no data has likelihood one");
    }

    #[test]
    fn agreeing_raises_and_disagreeing_lowers_and_surprise_counts_more() {
        let reading = |agreed: bool, chance: f64| Reading {
            agreed,
            chance,
            exposure: 0.0,
            weight: 1.0,
        };
        let prior = posterior(&[], 0.65, 8.0).mean;
        let agreed = posterior(&[reading(true, 0.5); 5], 0.65, 8.0).mean;
        let disagreed = posterior(&[reading(false, 0.5); 5], 0.65, 8.0).mean;
        assert!(agreed > prior && disagreed < prior);
        // Agreeing on what everybody likes teaches less than agreeing against the grain.
        let expected = posterior(&[reading(true, 0.95); 5], 0.65, 8.0).mean;
        let surprising = posterior(&[reading(true, 0.2); 5], 0.65, 8.0).mean;
        assert!(prior < expected && expected < surprising);
    }

    /// A sharp prior is integrated at its own scale: with no readings the posterior mean is the
    /// prior's, and with a few it moves by what a Beta-binomial update would move it.
    #[test]
    fn a_sharp_prior_is_not_snapped_to_the_grid() {
        for rate in [0.6146, 0.65, 0.93] {
            let found = posterior(&[], rate, 1024.0);
            close_to(found.mean, 2.0 * rate - 1.0, 1e-4, "no readings");
        }
        let agreed = Reading {
            agreed: true,
            chance: 0.5,
            exposure: 0.0,
            weight: 1.0,
        };
        // At an even chance a match has probability `(1 + λ)/2`, the share itself: the update is
        // Beta-binomial.
        let found = posterior(&[agreed; 14], 0.6146, 1024.0);
        let share = (1024.0 * 0.6146 + 14.0) / (1024.0 + 14.0);
        close_to(found.mean, 2.0 * share - 1.0, 1e-4, "fourteen matches");
    }

    #[test]
    fn a_certain_reaction_teaches_nothing() {
        let reaction = Reading {
            agreed: true,
            chance: 0.5,
            exposure: 1.0,
            weight: 1.0,
        };
        let prior = posterior(&[], 0.65, 8.0);
        let found = posterior(&[reaction; 20], 0.65, 8.0);
        close(found.mean, prior.mean, "the mean does not move");
    }

    #[test]
    fn a_reading_of_weight_zero_is_no_reading() {
        let ignored = Reading {
            agreed: false,
            chance: 0.3,
            exposure: 0.0,
            weight: 0.0,
        };
        close(
            posterior(&[ignored; 7], 0.6, 4.0).mean,
            posterior(&[], 0.6, 4.0).mean,
            "weight zero",
        );
    }

    #[test]
    fn evidence_follows_the_channel() {
        // At an even base rate the ratio is the Nitzan–Paroush weight (1 + λ)/(1 − λ).
        close(
            thumb_evidence(0.5, 0.5, 1, 10.0),
            (1.5f64 / 0.5).ln(),
            "even base rate",
        );
        // A reliable opposite is read reversed.
        close(
            thumb_evidence(-0.5, 0.5, 1, 10.0),
            -thumb_evidence(0.5, 0.5, 1, 10.0),
            "flipped",
        );
        // With the grain it is weak, against it strong, and the clip holds.
        assert!(thumb_evidence(0.5, 0.95, 1, 10.0) < thumb_evidence(0.5, 0.5, 1, 10.0));
        assert!(-thumb_evidence(0.5, 0.95, -1, 10.0) > thumb_evidence(0.5, 0.5, 1, 10.0));
        close(thumb_evidence(0.9, 0.99, -1, 2.0), -2.0, "clipped");
        close(
            thumb_evidence(0.0, 0.3, 1, 2.0),
            0.0,
            "no reliability, no evidence",
        );
    }

    #[test]
    fn the_answer_share_is_a_chance() {
        for lambda in [-0.9, -0.3, 0.1, 0.6, 0.95] {
            for up in [0.05, 0.5, 0.9] {
                for value in [-1, 1] {
                    for probability in [0.0, 0.3, 1.0] {
                        let share = answer_share(lambda, up, value, probability);
                        assert!(
                            (0.0..=1.0 + 1e-12).contains(&share),
                            "{lambda} {up} {value} {probability}: {share}"
                        );
                    }
                }
            }
        }
        // A witness who always knows is always the answer when the thumb says what they know.
        assert!(
            answer_share(0.999_999, 0.5, 1, 1.0) > 0.999_99,
            "a perfect witness"
        );
    }
}
