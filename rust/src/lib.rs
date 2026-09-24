//! grapevine's recommendation core: DESIGN.md section 2, as pure functions over an in-memory
//! snapshot.
//!
//! Nothing here does I/O, knows about a database, or depends on a runtime. One viewer's whole
//! result — scores and confidences — is a function of the friend graph and the ratings of the
//! people the walk reaches:
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
//! let result = compute_user(&snapshot, viewer, &Params::default()).expect("a finite walk");
//! assert!(result.scores[&item].score > 0.0);
//! ```

pub mod alignment;
pub mod attack;
pub mod compute;
pub mod data;
pub mod error;
pub mod graph;
pub mod ids;
pub mod informativeness;
pub mod params;
pub mod priors;
pub mod rng;
pub mod score;
pub mod sim;
pub mod snapshot;
pub mod suggest;
pub mod walk;

#[cfg(feature = "wasm")]
mod wasm;

pub use alignment::{Alignment, alignments, logit};
pub use attack::{SybilConfig, SybilSet, SybilShape, SybilStrategy, add_sybils};
pub use compute::{
    UserDetail, UserResult, WalkReport, affinity_of, compute_all, compute_user,
    compute_user_detail, rescore_user,
};
pub use data::{
    BoundaryNodeData, RatingValue, ResultData, ScoreData, SnapshotData, SuggestParamsData,
    SuggestionData, WorldData,
};
pub use error::CoreError;
pub use graph::{Graph, hop_distances};
pub use ids::{ID_MAX, ItemId, RATABLE_JOIN, Ratable, TagId, UserId, is_normalized_id};
pub use informativeness::informativeness;
pub use params::Params;
pub use priors::{
    DistancePriors, MIN_PAIR_OVERLAP, MIN_SAMPLE, PairMoments, PairTallies, PriorEstimate,
    PriorSample, PriorSamples, estimate_priors, estimate_priors_from_tallies, tally_pairs,
};
pub use rng::Rng;
pub use score::{Score, score_ratables};
pub use sim::{World, WorldConfig, simulate};
pub use snapshot::{Snapshot, SnapshotBuilder};
pub use suggest::{
    MAX_CURRENT_INFLUENCE, MAX_SUGGESTIONS, MIN_ALIGNMENT, MIN_OVERLAP, Suggestion, suggest,
};
pub use walk::{BoundaryNode, Budget, Walk, walk, walk_within};
