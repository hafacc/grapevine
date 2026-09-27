//! The WebAssembly boundary the Edge Function calls.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::data::SnapshotData;
use crate::error::CoreError;
use crate::params::Params;
use crate::priors::PriorEstimate;
use crate::witness::compute_user;

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
/// the defaults) and `priors` the `private.params` row (`null` for none). Returns
/// `{ viewer, reached, boundaryNodes: { id, strength }[], pairs, scores }`: `boundaryNodes` are
/// what the loader reads for another round, strongest first (DESIGN section 3.4).
///
/// Throws only on an invalid parameter, an unknown viewer or a non-finite result. Nothing a
/// *rated* account can write reaches this — values and keys are sanitized in `to_snapshot`, so
/// one crafted ratings map cannot fail every viewer within reach of it.
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
    // The JSON-compatible serializer writes maps as plain objects rather than `Map`s, which is
    // what the function and the tests expect to index into.
    snapshot
        .result_data(&result)
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
