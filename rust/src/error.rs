//! What the core refuses to answer.
//!
//! Every failure here is a snapshot or a parameter table the algorithm has no defined answer
//! for. None of them is recoverable by retrying: a divergent walk or a parameter outside its
//! range is a bug or an attack. A non-finite mass is a hard error, never a result: a `NaN` that
//! reads as convergence is how `inf` reaches a stored feed.

use std::fmt;

use crate::ids::UserId;

#[derive(Clone, Debug, PartialEq)]
pub enum CoreError {
    /// The push produced a mass that is not a finite number. Affinity reallocates what leaves a
    /// node and never scales it, so no alignment can cause this; a snapshot from outside the
    /// crate can.
    NonFiniteMass { viewer: UserId, mass: f64 },
    /// A result whose reported error is not a finite, non-negative number. A large truncation is
    /// a walk the budget stopped early and still says how far off it is; a non-finite one says
    /// nothing at all, and writing it would put a number nobody can interpret in front of a
    /// viewer.
    Divergent { truncation: f64 },
    /// A parameter outside the range DESIGN section 2.8 gives it.
    InvalidParameter { name: &'static str, value: f64 },
    /// A viewer the snapshot does not contain.
    UnknownUser { name: String },
    /// A mass vector handed to a rescore that is not one entry per person in the snapshot.
    MassLengthMismatch { expected: usize, got: usize },
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::NonFiniteMass { viewer, mass } => write!(
                formatter,
                "the walk for user {} produced a mass of {mass}: the snapshot diverges",
                viewer.0
            ),
            CoreError::Divergent { truncation } => write!(
                formatter,
                "the walk reported an error of {truncation}: the result is not a \
                 recommendation"
            ),
            CoreError::InvalidParameter { name, value } => {
                write!(formatter, "parameter {name} is out of range: {value}")
            }
            CoreError::UnknownUser { name } => write!(formatter, "unknown user {name}"),
            CoreError::MassLengthMismatch { expected, got } => write!(
                formatter,
                "{got} masses for a snapshot of {expected} people"
            ),
        }
    }
}

impl std::error::Error for CoreError {}
