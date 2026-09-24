//! The WebAssembly boundary the Edge Functions call.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::compute::{WalkReport, compute_user, rescore_user};
use crate::data::{SnapshotData, SuggestParamsData};
use crate::error::CoreError;
use crate::ids::UserId;
use crate::params::Params;
use crate::priors::PriorEstimate;
use crate::snapshot::Snapshot;
use crate::suggest::suggest;

/// The parameter table a caller gave, or the shipped one.
fn table_of(params: JsValue) -> Result<Params, JsValue> {
    if params.is_null() || params.is_undefined() {
        Ok(Params::default())
    } else {
        serde_wasm_bindgen::from_value(params)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

/// `private.params` as the caller read it.
///
/// `null` — no estimate yet, or too few pairs to pool — is no estimate at all, and so is every
/// field the row is missing or got wrong (`PriorEstimate::merge`).
fn estimate_of(priors: JsValue) -> Result<PriorEstimate, JsValue> {
    if priors.is_null() || priors.is_undefined() {
        Ok(PriorEstimate::default())
    } else {
        serde_wasm_bindgen::from_value(priors)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

/// The table merged with the population's estimate, field by field, and validated.
///
/// Validation happens after the merge, so a crafted or half-written row cannot produce a
/// table the core has no answer for; it can only fail to move one.
fn with_priors(table: Params, priors: JsValue) -> Result<Params, JsValue> {
    let merged = estimate_of(priors)?.merge(&table);
    merged
        .validate()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(merged)
}

/// Computes one viewer's result from a snapshot.
///
/// `snapshot` is a `SnapshotData` object — `users`, `friendIds` (directed, one entry per node
/// whose list was read), `loaded`, `ratings` — `params` a partial parameter table (`null` for
/// the defaults). Returns a `ResultData` object, whose `boundaryResidual` and `boundaryNodes`
/// are what the loader reads for another round (DESIGN section 3.4). `truncation` is measured
/// over the loaded nodes only; `boundaryResidual` is reported beside it and not counted against
/// `ε_total`.
///
/// Throws only on something the caller can act on: a parameter out of range, an unknown viewer,
/// or a computation that did not resolve. Nothing a *rated* account can write reaches this —
/// values and keys are sanitized in `to_snapshot`, so one crafted ratings map cannot fail every
/// viewer within reach of it.
#[wasm_bindgen(js_name = computeUser)]
pub fn compute_user_js(
    snapshot: JsValue,
    viewer: &str,
    params: JsValue,
    priors: JsValue,
) -> Result<JsValue, JsValue> {
    let data: SnapshotData = serde_wasm_bindgen::from_value(snapshot)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let params = with_priors(table_of(params)?, priors)?;
    let snapshot = data.to_snapshot();
    let Some(viewer_id) = snapshot.user_id(viewer) else {
        return Err(JsValue::from_str(
            &CoreError::UnknownUser {
                name: viewer.to_string(),
            }
            .to_string(),
        ));
    };
    let result = compute_user(&snapshot, viewer_id, &params)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    // Only a non-finite result is refused. A large but finite truncation is a walk the budget
    // stopped early, which the caller can read off `truncation` and act on; refusing on its size
    // would also refuse DESIGN section 3.4's first call, whose frontier is exactly the thing the
    // loader asked for.
    if !result.truncation.is_finite()
        || !result.boundary_residual.is_finite()
        || !result.settle_movement.is_finite()
    {
        return Err(JsValue::from_str(
            &CoreError::Divergent {
                truncation: result.truncation,
            }
            .to_string(),
        ));
    }
    let result = snapshot.result_data(&result);
    // The JSON-compatible serializer writes maps as plain objects rather than `Map`s, which is
    // what the function and the tests expect to index into.
    result
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Rescores one viewer against masses a previous walk produced, skipping the walk.
///
/// `reach` is the `{ userId: mass }` map the caller stored, and `walk` the
/// `{ truncation, boundaryResidual, settleMovement, passes, settled }` the computation that
/// produced it reported — carried through, never recomputed, because they bound the error in
/// exactly these masses. The caller is the one that established the masses are still
/// good: it hashes the adjacency it just loaded against `user_model.reach_hash` (DESIGN section
/// 3.4). A name in the map that this snapshot does not hold is dropped, which is a person who
/// has left rather than a caller's mistake.
///
/// This saves the walk and nothing else, and the walk is the third largest of the three costs
/// in a recompute — the snapshot crossing this boundary and the neighbourhood read are both
/// larger. It is here because it is nearly free.
#[wasm_bindgen(js_name = rescoreUser)]
pub fn rescore_user_js(
    snapshot: JsValue,
    viewer: &str,
    reach: JsValue,
    walk: JsValue,
    params: JsValue,
    priors: JsValue,
) -> Result<JsValue, JsValue> {
    let data: SnapshotData = serde_wasm_bindgen::from_value(snapshot)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let masses: BTreeMap<String, f64> = serde_wasm_bindgen::from_value(reach)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let walk: WalkReport = serde_wasm_bindgen::from_value(walk)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let params = with_priors(table_of(params)?, priors)?;
    let snapshot = data.to_snapshot();
    let Some(viewer_id) = snapshot.user_id(viewer) else {
        return Err(unknown_user(viewer));
    };
    let mut visit_mass = vec![0.0; snapshot.user_count()];
    for (name, mass) in masses {
        if let Some(user) = snapshot.user_id(&name) {
            visit_mass[user.index()] = mass;
        }
    }
    let result = rescore_user(&snapshot, viewer_id, &visit_mass, walk, &params)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    snapshot
        .result_data(&result)
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// The ids a name list picks out, silently dropping the ones this snapshot does not hold.
///
/// Both lists taste search takes are read out of stored rows that can name somebody who has
/// since gone, so an unknown name is a stale reference rather than a caller's mistake.
fn known_ids(snapshot: &Snapshot, names: &[String]) -> BTreeSet<UserId> {
    names
        .iter()
        .filter_map(|name| snapshot.user_id(name))
        .collect()
}

fn unknown_user(name: &str) -> JsValue {
    JsValue::from_str(
        &CoreError::UnknownUser {
            name: name.to_string(),
        }
        .to_string(),
    )
}

/// `{ deep, live }` as the two validated tables, or `null` for the pairing DESIGN section 5.1
/// names: the deep walk at the deep budget, the "do they already reach you" test at the
/// on-demand one.
fn suggest_params(params: JsValue, priors: JsValue) -> Result<(Params, Params), JsValue> {
    let tables: SuggestParamsData = if params.is_null() || params.is_undefined() {
        SuggestParamsData::default()
    } else {
        serde_wasm_bindgen::from_value(params)
            .map_err(|error| JsValue::from_str(&error.to_string()))?
    };
    // One estimate over both tables: the deep walk and the "do they already reach you" test are
    // the same algorithm at two budgets, and a prior that differed between them would make the
    // second a question the first never asked.
    let estimate = estimate_of(priors)?;
    let deep = estimate.merge(&tables.deep_params());
    let live = estimate.merge(&tables.live_params());
    deep.validate()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    live.validate()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok((deep, live))
}

/// Taste search for one viewer (DESIGN section 5.1).
///
/// `snapshot` is the same `SnapshotData` `computeUser` takes: the caller's neighbourhood, read
/// once and walked twice. `discoverable` and `dismissed` are arrays of uids; `params` is
/// `{ deep, live }`, or `null` for the deep budget paired with the on-demand one.
///
/// Returns at most five `SuggestionData` objects, strongest first.
#[wasm_bindgen(js_name = suggestFor)]
pub fn suggest_for_js(
    snapshot: JsValue,
    viewer: &str,
    discoverable: JsValue,
    dismissed: JsValue,
    params: JsValue,
    priors: JsValue,
) -> Result<JsValue, JsValue> {
    let data: SnapshotData = serde_wasm_bindgen::from_value(snapshot)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let discoverable: Vec<String> = serde_wasm_bindgen::from_value(discoverable)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let dismissed: Vec<String> = serde_wasm_bindgen::from_value(dismissed)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let (deep, live) = suggest_params(params, priors)?;

    let snapshot = data.to_snapshot();
    let Some(viewer_id) = snapshot.user_id(viewer) else {
        return Err(unknown_user(viewer));
    };
    let suggestions = suggest(
        &snapshot,
        viewer_id,
        &known_ids(&snapshot, &discoverable),
        &known_ids(&snapshot, &dismissed),
        &deep,
        &live,
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    snapshot
        .suggestion_data(&suggestions)
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
