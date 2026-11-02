//! grapevine's core: DESIGN.md section 2 as pure functions over an in-memory snapshot.
//!
//! Nothing here does I/O, knows about a database, or depends on a runtime. One viewer's whole
//! result is a function of their own thumbs and the thumbs of the
//! accounts they follow:
//!
//! ```
//! use grapevine_core::{Ratable, Snapshot, compute_user_tensor};
//!
//! let mut builder = Snapshot::builder();
//! let viewer = builder.user("me");
//! let critic = builder.user("critic");
//! let item = Ratable::Item(builder.item("blue-bottle"));
//! builder.follow(viewer, critic).rate(critic, item, 1);
//! let snapshot = builder.build();
//!
//! let result = compute_user_tensor(&snapshot, viewer).expect("a finite result");
//! assert!(result.scores[&item].score > 0.0);
//! ```

pub mod data;
pub mod error;
pub mod ids;
pub mod layout;
pub mod rng;
pub mod score;
pub mod sim;
pub mod snapshot;
pub mod tensor;

#[cfg(feature = "wasm")]
mod wasm;

pub use data::{RatingValue, ResultData, ScoreData, SnapshotData, WorldData};
pub use error::CoreError;
pub use ids::{ID_MAX, ItemId, RATABLE_JOIN, Ratable, TagId, UserId, is_normalized_id};
pub use rng::Rng;
pub use score::{Score, UserResult};
pub use sim::{World, WorldConfig, simulate};
pub use snapshot::{Snapshot, SnapshotBuilder};
pub use tensor::compute_user_tensor;
