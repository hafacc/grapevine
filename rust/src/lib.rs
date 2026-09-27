//! grapevine's recommendation core: DESIGN.md section 2, the witness model, as pure functions
//! over an in-memory snapshot.
//!
//! Nothing here does I/O, knows about a database, or depends on a runtime. One viewer's whole
//! result — scores and certainties — is a function of the friend graph and the ratings of the
//! people loaded around them:
//!
//! ```
//! use grapevine_core::{Params, Ratable, Snapshot, compute_user};
//!
//! let mut builder = Snapshot::builder();
//! let viewer = builder.user("me");
//! let friend = builder.user("friend");
//! let item = Ratable::Item(builder.item("blue-bottle"));
//! builder.edge(viewer, friend).rate(friend, item, 1);
//! let snapshot = builder.build();
//!
//! let result = compute_user(&snapshot, viewer, &Params::default()).expect("a finite result");
//! assert!(result.scores[&item].score > 0.0);
//! ```

pub mod attack;
pub mod data;
pub mod error;
pub mod graph;
pub mod ids;
pub mod params;
pub mod priors;
pub mod rng;
pub mod score;
pub mod sim;
pub mod snapshot;
pub mod witness;

#[cfg(feature = "wasm")]
mod wasm;

pub use attack::{SybilConfig, SybilSet, SybilShape, SybilStrategy, add_sybils};
pub use data::{BoundaryNodeData, RatingValue, ResultData, ScoreData, SnapshotData, WorldData};
pub use error::CoreError;
pub use graph::{Graph, hop_distances};
pub use ids::{ID_MAX, ItemId, RATABLE_JOIN, Ratable, TagId, UserId, is_normalized_id};
pub use params::Params;
pub use priors::{
    DistancePriors, MIN_PAIR_OVERLAP, MIN_SAMPLE, PairCounts, PairMoments, PairTallies,
    PriorEstimate, PriorSample, PriorSamples, estimate_priors, estimate_priors_from_tallies,
    shared_item_chances, shared_item_counts, tally_pairs,
};
pub use rng::Rng;
pub use score::Score;
pub use sim::{World, WorldConfig, simulate};
pub use snapshot::{Snapshot, SnapshotBuilder};
pub use witness::{
    BoundaryNode, PairLink, UserDetail, UserResult, compute_all, compute_user, compute_user_detail,
};
