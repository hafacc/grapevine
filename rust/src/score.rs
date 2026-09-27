//! One ratable's result.

/// What the viewer's network says about one ratable.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Score {
    /// `s_u(x) ∈ (−1, 1)`: `tanh(Λ/2)`, the posterior chance the viewer would say up, rescaled.
    pub score: f64,
    /// `W ≥ 0`: how many of the viewer's own thumbs the evidence amounts to (DESIGN §2.6). The
    /// client draws and ranks by `s·W/(1 + W)`, the score with the Jeffreys pseudo-thumb added.
    pub confidence: f64,
}
