//! The parameter table of DESIGN §2.9.

use crate::error::CoreError;

/// Every constant the witness model has. `Default` is the table; `a₀` and `κ` are replaced field
/// by field by the population's estimate (`PriorEstimate::merge`).
///
/// The table is short on purpose: exposure, the chains, the regions, the base rates, `κ_a`, the
/// share of linked attribute pairs and the fact reliability are all learned or structural, and
/// carry no constant of their own. `N_max` is the loader's budget, not the core's: the core
/// computes over whatever snapshot it is handed.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct Params {
    /// `a₀`: the mean of the Beta prior on a trust connection's agreement rate `(1 + λ)/2`.
    pub prior_agreement: f64,
    /// `κ`: that prior's strength, in things.
    pub prior_strength: f64,
    /// `L`: the most one thumb can say, as log-odds.
    pub clip: f64,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            prior_agreement: 0.65,
            prior_strength: 8.0,
            clip: 2.0,
        }
    }
}

impl Params {
    /// `2a₀ − 1`: the reliability a trust connection with no shared history is read at.
    pub fn prior_reliability(&self) -> f64 {
        2.0 * self.prior_agreement - 1.0
    }

    /// Refuses a parameter table the model has no defined answer for.
    ///
    /// `a₀` at 0 or 1 is a Beta prior with no mass inside the grid, `κ = 0` is no prior at all
    /// (every posterior with no shared history is `0/0`), and a clip of zero makes every thumb
    /// say nothing. They are all reachable from a JSON object, so the boundary is where they are
    /// caught.
    pub fn validate(&self) -> Result<(), CoreError> {
        let out_of_range =
            |name: &'static str, value: f64| CoreError::InvalidParameter { name, value };
        if !(self.prior_agreement > 0.0 && self.prior_agreement < 1.0) {
            return Err(out_of_range("priorAgreement", self.prior_agreement));
        }
        for (name, value) in [("priorStrength", self.prior_strength), ("clip", self.clip)] {
            if !(value > 0.0 && value.is_finite()) {
                return Err(out_of_range(name, value));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_validates_and_the_degenerate_ones_do_not() {
        assert_eq!(Params::default().validate(), Ok(()));
        let refused = [
            (
                "priorAgreement",
                Params {
                    prior_agreement: 1.0,
                    ..Params::default()
                },
            ),
            (
                "priorAgreement",
                Params {
                    prior_agreement: f64::NAN,
                    ..Params::default()
                },
            ),
            (
                "priorStrength",
                Params {
                    prior_strength: 0.0,
                    ..Params::default()
                },
            ),
            (
                "priorStrength",
                Params {
                    prior_strength: f64::INFINITY,
                    ..Params::default()
                },
            ),
            (
                "clip",
                Params {
                    clip: -1.0,
                    ..Params::default()
                },
            ),
        ];
        for (name, params) in refused {
            match params.validate() {
                Err(CoreError::InvalidParameter { name: refused, .. }) => {
                    assert_eq!(refused, name)
                }
                other => panic!("{name} was accepted: {other:?}"),
            }
        }
    }

    #[test]
    fn a_connection_with_no_history_reads_at_the_prior() {
        assert!((Params::default().prior_reliability() - 0.3).abs() < 1e-12);
    }
}
