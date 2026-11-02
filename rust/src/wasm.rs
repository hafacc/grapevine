//! The WebAssembly boundary the browser calls.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use std::collections::BTreeMap;

use crate::data::{ResultData, SnapshotData};
use crate::error::CoreError;
use crate::ids::UserId;
use crate::layout::lay_out;
use crate::snapshot::Snapshot;
use crate::tensor::{MOST, Options, RANK, decompose};

fn refused(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// One viewer's result at rank `K`, in the boundary's form.
fn result<const K: usize>(snapshot: &Snapshot, viewer: UserId) -> Result<ResultData, CoreError> {
    decompose::<K>(snapshot, viewer, &Options::default()).map(|fit| snapshot.result_data(&fit))
}

/// Computes one viewer's result from a snapshot.
///
/// `snapshot` is a `SnapshotData` object — `users`, `follows`, `ratings`. Returns
/// `{ viewer, scores, plot }` (`ResultData`). `rank` is how many components the decomposition
/// has, from 1 to `tensor::MOST`, each compiled with its loops unrolled; left out, it is
/// `tensor::RANK`.
///
/// Throws only on an unknown viewer, a rank that was not compiled, or a non-finite result.
/// Nothing a *followed* account can write reaches this — values and keys are sanitized in
/// `to_snapshot`, so one crafted ratings map cannot fail the list of everyone who follows its
/// author.
#[wasm_bindgen(js_name = computeUserTensor)]
pub fn compute_user_tensor_js(
    snapshot: JsValue,
    viewer: &str,
    rank: Option<u32>,
) -> Result<JsValue, JsValue> {
    let data: SnapshotData = serde_wasm_bindgen::from_value(snapshot).map_err(refused)?;
    let snapshot = data.to_snapshot();
    let Some(viewer_id) = snapshot.user_id(viewer) else {
        return Err(refused(CoreError::UnknownUser {
            name: viewer.to_string(),
        }));
    };
    let found = match rank.map_or(RANK, |rank| rank as usize) {
        1 => result::<1>(&snapshot, viewer_id),
        2 => result::<2>(&snapshot, viewer_id),
        3 => result::<3>(&snapshot, viewer_id),
        4 => result::<4>(&snapshot, viewer_id),
        5 => result::<5>(&snapshot, viewer_id),
        6 => result::<6>(&snapshot, viewer_id),
        other => {
            return Err(refused(format!(
                "no decomposition of rank {other} is built: 1 to {MOST} are"
            )));
        }
    }
    .map_err(refused)?;
    // The JSON-compatible serializer writes maps as plain objects rather than `Map`s, which is
    // what the caller indexes into.
    found
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(refused)
}

/// The points as rows of `N` numbers each, if that is what every one of them is.
fn rows<const N: usize>(points: &BTreeMap<String, Vec<f64>>) -> Option<Vec<[f64; N]>> {
    points
        .values()
        .map(|point| <[f64; N]>::try_from(point.as_slice()).ok())
        .collect()
}

/// A place in the plane for each of a plot's points, by name (`crate::layout`).
///
/// `points` is `{ name: [numbers] }` as a plot holds its things: every point of the same
/// length, the rank the plot was computed at. Returns `{ name: [x, y] }`.
#[wasm_bindgen(js_name = layOut)]
pub fn lay_out_js(points: JsValue) -> Result<JsValue, JsValue> {
    let points: BTreeMap<String, Vec<f64>> =
        serde_wasm_bindgen::from_value(points).map_err(refused)?;
    if points.values().flatten().any(|value| !value.is_finite()) {
        return Err(refused("a point that is not a finite number"));
    }
    let places = None
        .or_else(|| rows::<1>(&points).map(|rows| lay_out(&rows)))
        .or_else(|| rows::<2>(&points).map(|rows| lay_out(&rows)))
        .or_else(|| rows::<3>(&points).map(|rows| lay_out(&rows)))
        .or_else(|| rows::<4>(&points).map(|rows| lay_out(&rows)))
        .or_else(|| rows::<5>(&points).map(|rows| lay_out(&rows)))
        .or_else(|| rows::<6>(&points).map(|rows| lay_out(&rows)))
        .ok_or_else(|| refused(format!("every point is one to {MOST} numbers, all alike")))?;
    let placed: BTreeMap<&String, [f64; 2]> = points.keys().zip(places).collect();
    placed
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(refused)
}
