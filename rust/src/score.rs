//! What one viewer gets back.

use std::collections::BTreeMap;

use crate::ids::{Ratable, UserId};

/// What the decomposition says of one ratable for the viewer: a thing, or an attribute on a
/// thing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Score {
    /// Strictly inside `(−1, 1)`: what the accounts the viewer follows say, plus the viewer's own
    /// fitted departure from it. For a thing, how far the viewer would like it; for an attribute
    /// on a thing, how far the viewer would call it a good one.
    pub score: f64,
    /// How many followed accounts made the statement.
    pub confidence: f64,
    /// One for a thing itself; for an attribute on a thing, `score` on `(0, 1)`, so that one the
    /// accounts mostly thumbed down counts as not applying.
    pub applies: f64,
}

impl Default for Score {
    fn default() -> Self {
        Score {
            score: 0.0,
            confidence: 0.0,
            applies: 1.0,
        }
    }
}

/// One viewer's scores.
#[derive(Clone, Debug, PartialEq)]
pub struct UserResult {
    pub viewer: UserId,
    /// Every thing a followed account said anything about, and every attribute a followed
    /// account put on a thing, in ratable order. There is no floor: nothing is hidden for
    /// being uncertain.
    pub scores: BTreeMap<Ratable, Score>,
}
