//! A seeded xorshift64* generator. The simulator needs reproducible randomness and nothing
//! else, which is not worth a dependency.

/// Marsaglia's xorshift64, scrambled by a multiply. Same seed, same world, on every machine.
#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        // Any non-zero state works; the odd constant keeps a seed of 0 out of the fixed point.
        Rng {
            state: seed ^ 0x9E37_79B9_7F4A_7C15,
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut state = self.state;
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        self.state = state;
        state.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform on `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// Uniform on `[0, bound)`.
    pub fn below(&mut self, bound: usize) -> usize {
        if bound == 0 {
            0
        } else {
            (self.next_u64() % bound as u64) as usize
        }
    }

    pub fn chance(&mut self, probability: f64) -> bool {
        self.next_f64() < probability
    }

    /// Standard normal, by Box-Muller.
    pub fn normal(&mut self) -> f64 {
        let uniform = 1.0 - self.next_f64();
        let angle = std::f64::consts::TAU * self.next_f64();
        (-2.0 * uniform.ln()).sqrt() * angle.cos()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_stream() {
        let mut one = Rng::new(7);
        let mut other = Rng::new(7);
        for _ in 0..1000 {
            assert_eq!(one.next_u64(), other.next_u64());
        }
    }

    #[test]
    fn uniforms_stay_in_range_and_spread_out() {
        let mut rng = Rng::new(3);
        let mut buckets = [0usize; 10];
        for _ in 0..10_000 {
            let value = rng.next_f64();
            assert!((0.0..1.0).contains(&value));
            buckets[(value * 10.0) as usize] += 1;
        }
        for count in buckets {
            assert!(count > 700, "bucket {count} is far from the expected 1000");
        }
    }

    #[test]
    fn normals_have_the_right_moments() {
        let mut rng = Rng::new(11);
        let samples: Vec<f64> = (0..20_000).map(|_| rng.normal()).collect();
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        let variance = samples
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / samples.len() as f64;
        assert!(mean.abs() < 0.05, "mean {mean}");
        assert!((variance - 1.0).abs() < 0.1, "variance {variance}");
    }
}
