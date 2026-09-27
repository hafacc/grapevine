//! What the core refuses to answer.
//!
//! Every failure here is a snapshot or a parameter table the algorithm has no defined answer
//! for. None of them is recoverable by retrying: a parameter outside its range or a non-finite
//! number is a bug or an attack. A non-finite score is a hard error, never a result: a `NaN` that
//! reaches a stored feed is a bar nobody can draw.

use std::fmt;

use crate::ids::UserId;

#[derive(Clone, Debug, PartialEq)]
pub enum CoreError {
    /// A score or a certainty that is not a finite number. Nothing a thumb can say produces one; a
    /// snapshot or a parameter table from outside the crate can.
    Divergent { viewer: UserId, value: f64 },
    /// A parameter outside the range DESIGN section 2.9 gives it.
    InvalidParameter { name: &'static str, value: f64 },
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
            CoreError::InvalidParameter { name, value } => {
                write!(formatter, "parameter {name} is out of range: {value}")
            }
            CoreError::UnknownUser { name } => write!(formatter, "unknown user {name}"),
        }
    }
}

impl std::error::Error for CoreError {}
