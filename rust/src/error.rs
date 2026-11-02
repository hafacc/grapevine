//! What the core refuses to answer.
//!
//! Every failure here is a snapshot the algorithm has no defined answer for. None of them is
//! recoverable by retrying. A non-finite score is a hard error, never a result: a `NaN` that
//! reaches a list is a bar nobody can draw.

use std::fmt;

use crate::ids::UserId;

#[derive(Clone, Debug, PartialEq)]
pub enum CoreError {
    /// A score, or the fit's error, that is not a finite number, or a system that could not be
    /// solved. Nothing a thumb can say produces one.
    Divergent { viewer: UserId, value: f64 },
    /// A viewer the snapshot does not contain.
    UnknownUser { name: String },
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::Divergent { viewer, value } => write!(
                formatter,
                "the computation for user {} produced {value}: the result is not a \
                 recommendation",
                viewer.0
            ),
            CoreError::UnknownUser { name } => write!(formatter, "unknown user {name}"),
        }
    }
}

impl std::error::Error for CoreError {}
