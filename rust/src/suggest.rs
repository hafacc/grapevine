//! Taste search: DESIGN section 5.
//!
//! The same walk as everywhere else, run at the deep budget so that it is followed far past
//! where it still moves a score, and turned into friend suggestions. Nothing here is a
//! trust channel: a suggestion changes no score until the viewer accepts one, at which point it
//! is an ordinary edge.
//!
//! Three things make it a search rather than a directory. Mass decides who is reachable at all,
//! so a region of accounts behind one edge shares that branch's bounded mass however it is
//! wired (section 2.4). Alignment decides who is worth naming, and it is the viewer's own
//! reach-weighted one, so an account nobody's walk reaches contributes to no `ω` and can
//! neither manufacture contestedness nor blind anyone. And the people who *already* reach the
//! viewer are cut: a suggestion is for someone whose taste the viewer cannot currently hear.

use std::collections::BTreeSet;

use crate::alignment::Alignment;
use crate::compute::{UserDetail, compute_user_detail};
use crate::error::CoreError;
use crate::ids::UserId;
use crate::params::Params;
use crate::snapshot::Snapshot;

/// `A_{uv} + D_{uv} ≥ 20`: twenty units of informative overlap, which is twenty contested items
/// agreed or disagreed on at full weight and more of them at the weight they actually carry.
///
/// This is the leak budget as much as the evidence bar (DESIGN section 5.2): a list that only
/// moves once twenty items' worth of `ω` has changed hands is a list nobody learns a single
/// rating from by toggling one of their own and watching it.
pub const MIN_OVERLAP: f64 = 20.0;

/// `ℓ_{uv} ≥ 1`: the shrunk odds of agreement are at least `e` to one.
pub const MIN_ALIGNMENT: f64 = 1.0;

/// `π̃_u(v)·ℓ_{uv} < 0.1` under the **on-demand** budget — the one a viewer's live feed is
/// computed at. Someone above this is already carrying evidence into what the viewer sees, so
/// suggesting them would be offering a connection to somebody they can hear perfectly well.
pub const MAX_CURRENT_INFLUENCE: f64 = 0.1;

/// How many suggestions a viewer is given.
pub const MAX_SUGGESTIONS: usize = 5;

/// One person taste search would put in front of the viewer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Suggestion {
    pub user: UserId,
    /// `π̃_u(v)·ℓ_{uv}` from the deep walk: the ranking, and never shown to anyone.
    pub strength: f64,
    /// `ℓ_{uv}` from the deep walk: the shrunk odds that this person agrees with the viewer,
    /// and never shown to anyone either — what a suggestion says out loud is the attributes the
    /// two of them agree on against the grain, which the caller asks for separately.
    pub alignment: f64,
    /// `A_{uv} + D_{uv}`: how much informative overlap the alignment rests on.
    pub overlap: f64,
}

struct Candidate {
    user: UserId,
    strength: f64,
    alignment: f64,
    overlap: f64,
}

/// DESIGN section 5.1 for one viewer.
///
/// `discoverable` is everyone who has left `user_prefs.discoverable_by_taste` on; anyone else
/// still carries mass through the walk exactly as before and is simply never named.
/// `dismissed` is who this viewer has waved away. `deep` is the deep table the search runs
/// at; `live` is the on-demand one, and is used for nothing but deciding who already reaches
/// the viewer — measured at the budget their feed is actually computed at, since that is what
/// "already influential" means to the person reading the screen.
///
/// The live walk is run only when there is a candidate to test against it, so a viewer with
/// nobody far away who matches them costs one walk and not two.
pub fn suggest(
    snapshot: &Snapshot,
    viewer: UserId,
    discoverable: &BTreeSet<UserId>,
    dismissed: &BTreeSet<UserId>,
    deep: &Params,
    live: &Params,
) -> Result<Vec<Suggestion>, CoreError> {
    let deep_detail = compute_user_detail(snapshot, viewer, deep)?;
    let friends: BTreeSet<UserId> = snapshot.friends(viewer).iter().copied().collect();
    let mut candidates: Vec<Candidate> = Vec::new();
    for user in snapshot.users() {
        if user == viewer
            || friends.contains(&user)
            || !discoverable.contains(&user)
            || dismissed.contains(&user)
        {
            continue;
        }
        let mass = deep_detail.mass(user);
        let Some(alignment) = deep_detail.alignments[user.index()] else {
            continue;
        };
        if mass <= 0.0 || !qualifies(&alignment) {
            continue;
        }
        candidates.push(Candidate {
            user,
            strength: mass * alignment.weight,
            alignment: alignment.weight,
            overlap: alignment.agreements + alignment.disagreements,
        });
    }
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let live_detail = compute_user_detail(snapshot, viewer, live)?;
    candidates.retain(|candidate| !already_influential(&live_detail, candidate.user));
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    // Strongest first; the tie is broken by id so that the answer is a function of the snapshot
    // and nothing else.
    candidates.sort_by(|left, right| {
        right
            .strength
            .total_cmp(&left.strength)
            .then_with(|| left.user.cmp(&right.user))
    });
    Ok(candidates
        .into_iter()
        .take(MAX_SUGGESTIONS)
        .map(|candidate| Suggestion {
            user: candidate.user,
            strength: candidate.strength,
            alignment: candidate.alignment,
            overlap: candidate.overlap,
        })
        .collect())
}

/// Enough shared contested taste to be worth naming at all.
fn qualifies(alignment: &Alignment) -> bool {
    alignment.weight >= MIN_ALIGNMENT
        && alignment.agreements + alignment.disagreements >= MIN_OVERLAP
}

/// Does this person already carry evidence into the viewer's feed?
///
/// Mass and alignment both come from the live result rather than the deep one: the question is
/// what the viewer currently hears, and the feed they are reading was computed with these
/// numbers.
fn already_influential(live: &UserDetail, user: UserId) -> bool {
    live.mass(user) * live.alignment_weight(user) >= MAX_CURRENT_INFLUENCE
}
