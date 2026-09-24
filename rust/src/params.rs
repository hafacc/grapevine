//! The parameter table of DESIGN section 2.8.

use crate::error::CoreError;

/// Every tunable in the algorithm. `Default` is the shipped v1 table.
///
/// The table is deliberately short: the affinity range, the informativeness support factor and
/// the tag weight are not constants but quantities the model already carries — the alignment
/// log-odds, the vote count and the reach mass.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default, rename_all = "camelCase"))]
pub struct Params {
    /// `α`: the walk's killing rate. A half is what makes everything beyond a friend weigh at
    /// most as much as that friend.
    pub decay: f64,
    /// `ε_total`: the walk stops once the mass still in flight could add at most this much
    /// visit mass, in friend-units.
    pub error_budget: f64,
    /// `N_max`: the walk stops once this many nodes have received mass.
    pub node_budget: usize,
    /// `E_max`: a CPU ceiling on the edge pushes one viewer's whole computation may spend, and
    /// nothing else. `Budget::for_snapshot` reserves what a settling loop over the loaded
    /// neighbourhood can cost and takes the smaller of the two, so on the neighbourhoods
    /// measured this never binds; it is what stops a graph nobody measured from running an Edge
    /// Function past its CPU allowance. Sized as the pushes that fit in 0.3 s of WebAssembly
    /// (`docs/algorithm-notes.md` section 8), for both tables. No accuracy or security bound
    /// rests on it: a walk it stops says so in its truncation.
    pub edge_budget: usize,
    /// `κ`: alignment pseudo-count.
    pub alignment_pseudocount: f64,
    /// `a₀(1)`: alignment prior for a friend.
    pub prior_friend: f64,
    /// `a₀(2)`: alignment prior for a friend of a friend.
    pub prior_friend_of_friend: f64,
    /// `a₀(d ≥ 3)`: alignment prior for anyone further away.
    pub prior_distant: f64,
    /// `L`: clamp on the alignment log-odds. It also caps the affinity, at `e^L`.
    pub alignment_clamp: f64,
    /// `κ_s`: scoring shrinkage.
    pub score_shrinkage: f64,
    /// `W_min`: a ratable with less total weight than this is not shown at all.
    pub min_weight: f64,
    /// `SETTLE_TOLERANCE`: the settling loop stops once no score moved by more than this in a
    /// pass. Two orders below the 0.01 the bar's step can ever be, so a loop that stops here
    /// cannot have left a difference anybody could be shown.
    pub settle_tolerance: f64,
    /// `SETTLE_MAX_PASSES`: a hard cap on passes. Every measured viewer reached the tolerance in
    /// at most five passes on ordinary worlds and eight under a 200-bot mimic clique
    /// (`docs/algorithm-notes.md` section 3); twelve leaves room. **Reaching it is not an
    /// error**: the result reports the movement it stopped at and the caller decides.
    pub settle_max_passes: usize,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            decay: 0.5,
            error_budget: 0.02,
            node_budget: 2_000,
            edge_budget: 10_000_000,
            alignment_pseudocount: 8.0,
            prior_friend: 0.65,
            prior_friend_of_friend: 0.55,
            prior_distant: 0.50,
            alignment_clamp: 2.0,
            score_shrinkage: 1.0,
            min_weight: 0.5,
            settle_tolerance: 1e-4,
            settle_max_passes: 12,
        }
    }
}

impl Params {
    /// The deep budget of DESIGN section 2.8: the wider, tighter search taste search runs at.
    pub fn deep() -> Self {
        Params {
            error_budget: 0.001,
            node_budget: 50_000,
            ..Params::default()
        }
    }

    /// The alignment prior `a₀(d)` for someone at shortest-path distance `distance`.
    pub fn prior(&self, distance: u32) -> f64 {
        match distance {
            0 | 1 => self.prior_friend,
            2 => self.prior_friend_of_friend,
            _ => self.prior_distant,
        }
    }

    /// `(1 − α) / α`: how much visit mass a unit of residual can still produce if the walk
    /// were run to convergence.
    pub fn residual_reach(&self) -> f64 {
        (1.0 - self.decay) / self.decay
    }

    /// The largest affinity any neighbour can reach, `e^L`: the odds that someone whose
    /// alignment sits at the clamp shares the viewer's taste.
    pub fn affinity_cap(&self) -> f64 {
        self.alignment_clamp.exp()
    }

    /// Refuses a parameter table the algorithm has no defined answer for.
    ///
    /// Nothing inside the core checks these: `decay = 0` makes `residual_reach` infinite and the
    /// push run to `E_max`, `alignment_pseudocount = 0` with no shared ratings is `0/0` and
    /// turns every weight into `NaN`, a prior at `1` is `logit = inf`, and a non-positive
    /// settle tolerance is a loop that only ever stops at its cap. They are all reachable from
    /// a JSON object, so the boundary is where they are caught (DESIGN section 2.8's table is
    /// the range).
    pub fn validate(&self) -> Result<(), CoreError> {
        let out_of_range =
            |name: &'static str, value: f64| CoreError::InvalidParameter { name, value };
        let open_unit = |name: &'static str, value: f64| {
            if value > 0.0 && value < 1.0 {
                Ok(())
            } else {
                Err(out_of_range(name, value))
            }
        };
        let positive = |name: &'static str, value: f64| {
            if value > 0.0 && value.is_finite() {
                Ok(())
            } else {
                Err(out_of_range(name, value))
            }
        };
        open_unit("decay", self.decay)?;
        open_unit("priorFriend", self.prior_friend)?;
        open_unit("priorFriendOfFriend", self.prior_friend_of_friend)?;
        open_unit("priorDistant", self.prior_distant)?;
        positive("errorBudget", self.error_budget)?;
        positive("alignmentPseudocount", self.alignment_pseudocount)?;
        positive("alignmentClamp", self.alignment_clamp)?;
        positive("scoreShrinkage", self.score_shrinkage)?;
        positive("settleTolerance", self.settle_tolerance)?;
        if !(self.min_weight >= 0.0 && self.min_weight.is_finite()) {
            return Err(out_of_range("minWeight", self.min_weight));
        }
        if self.node_budget == 0 {
            return Err(out_of_range("nodeBudget", 0.0));
        }
        if self.edge_budget == 0 {
            return Err(out_of_range("edgeBudget", 0.0));
        }
        if self.settle_max_passes == 0 {
            return Err(out_of_range("settleMaxPasses", 0.0));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_table_validates_and_the_degenerate_ones_do_not() {
        assert_eq!(Params::default().validate(), Ok(()));
        assert_eq!(Params::deep().validate(), Ok(()));
        let refused = [
            (
                "decay",
                Params {
                    decay: 0.0,
                    ..Params::default()
                },
            ),
            (
                "decay",
                Params {
                    decay: 1.0,
                    ..Params::default()
                },
            ),
            (
                "alignmentPseudocount",
                Params {
                    alignment_pseudocount: 0.0,
                    ..Params::default()
                },
            ),
            (
                "priorFriend",
                Params {
                    prior_friend: 1.0,
                    ..Params::default()
                },
            ),
            (
                "priorDistant",
                Params {
                    prior_distant: 0.0,
                    ..Params::default()
                },
            ),
            (
                "nodeBudget",
                Params {
                    node_budget: 0,
                    ..Params::default()
                },
            ),
            (
                "edgeBudget",
                Params {
                    edge_budget: 0,
                    ..Params::default()
                },
            ),
            (
                "settleMaxPasses",
                Params {
                    settle_max_passes: 0,
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
}
