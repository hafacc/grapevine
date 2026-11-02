//! One viewer's list as what the accounts they follow say, moved by a low-rank decomposition of
//! how each person departs from it.
//!
//! The statements are a tensor with a mode for who said it (the viewer and each account they
//! follow), a mode for the thing, and a mode for the attribute, where liking the thing is one
//! more attribute. A thumb up is `1` and a thumb down is `-1`.
//!
//! What the followed accounts say of a cell between them is `(ups − downs) / (n + 2)`: the
//! mean of their thumbs from a flat start. That is what the viewer is given of a thing before
//! anything of their own says otherwise. How far each statement departs from it, with `0` where
//! nothing was said, is then fitted by
//!
//! `d[who, thing, attribute] ≈ Σ_k P[who, k] · T[thing, k] · A[attribute, k]`
//!
//! at rank `K`, by alternating least squares over every cell, the zeros included. With
//! the zeros at full weight every row of a mode shares one `K × K` system, so a sweep
//! costs one pass over the statements. The result is the accounts' mean plus the viewer's row
//! of the fit.
//!
//! This is what the app computes its list with.

// The matrices here are `K` square and written as the sums they are.
#![allow(clippy::needless_range_loop)]

use std::collections::{BTreeMap, BTreeSet};

use crate::error::CoreError;
use crate::ids::{ItemId, Ratable, TagId, UserId};
use crate::rng::Rng;
use crate::score::{Score, UserResult};
use crate::snapshot::Snapshot;

/// Components in the decomposition where nothing asks for another number. One to six measured
/// alike on real ratings. The rank is a parameter of everything below, fixed where it is
/// compiled so that its loops unroll; `crate::wasm` compiles one to [`MOST`].
pub const RANK: usize = 3;

/// The highest rank built into the wasm module.
pub const MOST: usize = 6;

/// Added to the diagonal of every system so that it can be solved when a factor's columns line
/// up. The zeros are what hold the fit in; this is too small to.
const RIDGE: f64 = 1e-3;

/// A sweep that lowers the squared error by less than this share of the departures' own
/// squared size is the last. Measured against the departures and not against the error that
/// is left: with one or two accounts followed the fit is nearly exact, what is left keeps
/// shrinking by a steady share of itself, and a rule relative to it never fires. On real
/// ratings two fits from different starts then rank a viewer's things alike in a few dozen
/// sweeps; a rule a hundred times stricter measured no different.
const TOLERANCE: f64 = 1e-5;

/// Sweeps after which the fit is taken as it stands.
const SWEEPS: usize = 1_000;

/// The seed the factors start from: the same snapshot gives the same result.
const SEED: u64 = 0x6772_6170_6576_696e;

/// How close to an end a score may come, so that it stays strictly inside `(−1, 1)`.
const EDGE: f64 = 1e-9;

const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// The FNV-1a hash of a name: where its row of a factor starts from.
fn fnv(name: &str) -> u64 {
    name.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    })
}

type Row<const K: usize> = [f64; K];
type Square<const K: usize> = [[f64; K]; K];

/// One statement: who, which thing, which attribute, and how far the thumb is from what the
/// followed accounts say of that thing and attribute.
struct Cell {
    index: [usize; 3],
    value: f64,
}

/// `Σ rows rowᵀ·row`.
fn gram<const K: usize>(rows: &[Row<K>]) -> Square<K> {
    let mut out = [[0.0; K]; K];
    for row in rows {
        for first in 0..K {
            for second in 0..K {
                out[first][second] += row[first] * row[second];
            }
        }
    }
    out
}

/// The lower Cholesky factor of a symmetric positive-definite matrix, or the pivot that was
/// not positive.
fn cholesky<const K: usize>(matrix: &Square<K>) -> Result<Square<K>, f64> {
    let mut lower = [[0.0; K]; K];
    for row in 0..K {
        for column in 0..=row {
            let mut sum = matrix[row][column];
            for earlier in 0..column {
                sum -= lower[row][earlier] * lower[column][earlier];
            }
            if row == column {
                if sum <= 0.0 || sum.is_nan() {
                    return Err(sum);
                }
                lower[row][column] = sum.sqrt();
            } else {
                lower[row][column] = sum / lower[column][column];
            }
        }
    }
    Ok(lower)
}

/// Solves `L·Lᵀ·x = target`.
fn solve<const K: usize>(lower: &Square<K>, target: &Row<K>) -> Row<K> {
    let mut forward = [0.0; K];
    for row in 0..K {
        let mut sum = target[row];
        for earlier in 0..row {
            sum -= lower[row][earlier] * forward[earlier];
        }
        forward[row] = sum / lower[row][row];
    }
    let mut out = [0.0; K];
    for row in (0..K).rev() {
        let mut sum = forward[row];
        for later in (row + 1)..K {
            sum -= lower[later][row] * out[later];
        }
        out[row] = sum / lower[row][row];
    }
    out
}

/// The fitted value of one cell.
fn fitted<const K: usize>(factors: &[Vec<Row<K>>; 3], index: [usize; 3]) -> f64 {
    (0..K)
        .map(|k| factors[0][index[0]][k] * factors[1][index[1]][k] * factors[2][index[2]][k])
        .sum()
}

/// The squared error over every cell, zeros included, plus the ridge:
/// `‖x‖² − 2⟨x, fit⟩ + ‖fit‖²`, where the last is the sum of the three Gram matrices multiplied
/// entry by entry.
fn error<const K: usize>(cells: &[Cell], factors: &[Vec<Row<K>>; 3]) -> f64 {
    let grams = [gram(&factors[0]), gram(&factors[1]), gram(&factors[2])];
    let mut total = 0.0;
    for first in 0..K {
        for second in 0..K {
            total += grams[0][first][second] * grams[1][first][second] * grams[2][first][second];
        }
        total += RIDGE * (grams[0][first][first] + grams[1][first][first] + grams[2][first][first]);
    }
    for cell in cells {
        total += cell.value * cell.value - 2.0 * cell.value * fitted(factors, cell.index);
    }
    total
}

/// One least-squares update of every mode in turn.
fn sweep<const K: usize>(cells: &[Cell], factors: &mut [Vec<Row<K>>; 3]) -> Result<(), f64> {
    for mode in 0..3 {
        let (one, other) = match mode {
            0 => (1, 2),
            1 => (0, 2),
            _ => (0, 1),
        };
        let (first, second) = (gram(&factors[one]), gram(&factors[other]));
        let mut system = [[0.0; K]; K];
        for row in 0..K {
            for column in 0..K {
                system[row][column] = first[row][column] * second[row][column];
            }
            system[row][row] += RIDGE;
        }
        let lower = cholesky(&system)?;
        let mut targets = vec![[0.0; K]; factors[mode].len()];
        for cell in cells {
            let (left, right) = (
                &factors[one][cell.index[one]],
                &factors[other][cell.index[other]],
            );
            let target = &mut targets[cell.index[mode]];
            for k in 0..K {
                target[k] += cell.value * left[k] * right[k];
            }
        }
        for (row, target) in factors[mode].iter_mut().zip(&targets) {
            *row = solve(&lower, target);
        }
    }
    Ok(())
}

/// One viewer's result from the decomposition.
///
/// An entry for every thing a followed account said anything about, and for every attribute a
/// followed account put on a thing. `score` is what the followed accounts say of it plus the
/// viewer's own fitted departure, held strictly inside `(−1, 1)`: for a thing, how far the
/// viewer would like it; for an attribute on a thing, how far the viewer would call it a good
/// one, where a bad one sits below one nobody mentioned. `applies` is that same value on
/// `(0, 1)`, and `confidence` is how many followed accounts made the statement.
///
/// A viewer who has said nothing, or shares no thing with any followed account, departs from
/// nothing, and gets what the followed accounts say.
pub fn compute_user_tensor(snapshot: &Snapshot, viewer: UserId) -> Result<UserResult, CoreError> {
    decompose::<RANK>(snapshot, viewer, &Options::default()).map(|fit| fit.result)
}

/// What a measurement may vary. The defaults are what `compute_user_tensor` uses.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Options {
    /// Where the factors start.
    pub seed: u64,
    /// A sweep that lowers the squared error by less than this share of the departures'
    /// squared size is the last.
    pub tolerance: f64,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            seed: SEED,
            tolerance: TOLERANCE,
        }
    }
}

/// The viewer's own picture of how they depart from the accounts they follow: a point per thing
/// and a point per attribute, such that the fitted departure of the viewer's cell for a thing
/// and an attribute is the inner product of the two points. A thing lies the way an attribute
/// does as far as the viewer makes more of it, for that attribute, than the accounts do.
///
/// The viewer's own row of the fit is folded into the things, so the viewer is not a point
/// here: they are how far each axis is stretched. Each axis is turned so that liking has no
/// negative coordinate, and scaled so that the things and the attributes spread equally far
/// along it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Plot<const K: usize> {
    pub things: BTreeMap<ItemId, [f64; K]>,
    /// `None` is liking the thing itself.
    pub attributes: BTreeMap<Option<TagId>, [f64; K]>,
}

/// A result with how the fit went.
#[derive(Clone, Debug, PartialEq)]
pub struct Fit<const K: usize> {
    pub result: UserResult,
    pub plot: Plot<K>,
    /// The squared error the fit ended at.
    pub error: f64,
    /// Sweeps taken.
    pub sweeps: usize,
}

/// `compute_user_tensor` under other options, for measurements.
pub fn decompose<const K: usize>(
    snapshot: &Snapshot,
    viewer: UserId,
    options: &Options,
) -> Result<Fit<K>, CoreError> {
    if viewer.index() >= snapshot.user_count() {
        return Err(CoreError::UnknownUser {
            name: format!("#{}", viewer.0),
        });
    }
    let mut who: Vec<UserId> = vec![viewer];
    who.extend(
        snapshot
            .follows(viewer)
            .iter()
            .filter(|&&user| user != viewer),
    );
    let mut things: BTreeSet<ItemId> = BTreeSet::new();
    let mut tags: BTreeSet<TagId> = BTreeSet::new();
    for &user in &who {
        for &(ratable, value) in snapshot.ratings(user) {
            if value == 0 {
                continue;
            }
            things.insert(ratable.item());
            if let Ratable::Tag(_, tag) = ratable {
                tags.insert(tag);
            }
        }
    }
    let thing_at: BTreeMap<ItemId, usize> = things.iter().copied().zip(0..).collect();
    // Attribute zero is liking the thing itself.
    let tag_at: BTreeMap<TagId, usize> = tags.iter().copied().zip(1..).collect();
    // Per ratable a followed account spoke of: how many did, and the sum of their thumbs. A
    // thing only its attributes were spoken of has an entry of nobody.
    let mut said: BTreeMap<Ratable, (f64, f64)> = BTreeMap::new();
    for &user in &who[1..] {
        for &(ratable, value) in snapshot.ratings(user) {
            if value == 0 {
                continue;
            }
            let entry = said.entry(ratable).or_insert((0.0, 0.0));
            entry.0 += 1.0;
            entry.1 += f64::from(value.signum());
            said.entry(Ratable::Item(ratable.item()))
                .or_insert((0.0, 0.0));
        }
    }
    let accounts_say = |ratable: Ratable| {
        said.get(&ratable)
            .map_or(0.0, |&(count, sum)| sum / (count + 2.0))
    };
    let attribute_of = |ratable: Ratable| match ratable {
        Ratable::Item(_) => 0,
        Ratable::Tag(_, tag) => tag_at[&tag],
    };
    let mut cells: Vec<Cell> = Vec::new();
    for (row, &user) in who.iter().enumerate() {
        for &(ratable, value) in snapshot.ratings(user) {
            if value == 0 {
                continue;
            }
            cells.push(Cell {
                index: [row, thing_at[&ratable.item()], attribute_of(ratable)],
                value: f64::from(value.signum()) - accounts_say(ratable),
            });
        }
    }
    let mut scores: BTreeMap<Ratable, Score> = BTreeMap::new();
    if said.is_empty() {
        return Ok(Fit {
            result: UserResult { viewer, scores },
            plot: Plot::default(),
            error: 0.0,
            sweeps: 0,
        });
    }

    // Each row starts from its own name, not from its place in the snapshot, so two snapshots
    // of the same statements start the same fit. Their sums still run in the order each came
    // to know its accounts, things and tags in, and can end a sweep's worth apart.
    let start = |mode: u64, name: &str| -> Row<K> {
        let mut rng = Rng::new(options.seed ^ mode.wrapping_mul(FNV_PRIME) ^ fnv(name));
        std::array::from_fn(|_| 0.3 * rng.normal())
    };
    let mut factors = [
        who.iter()
            .map(|&user| start(0, snapshot.user_name(user)))
            .collect::<Vec<Row<K>>>(),
        things
            .iter()
            .map(|&item| start(1, snapshot.item_name(item)))
            .collect(),
        std::iter::once(start(2, ""))
            .chain(tags.iter().map(|&tag| start(3, snapshot.tag_name(tag))))
            .collect(),
    ];
    let diverged = |value: f64| CoreError::Divergent { viewer, value };
    let mut before = f64::INFINITY;
    let mut sweeps = 0;
    let size: f64 = cells.iter().map(|cell| cell.value * cell.value).sum();
    for _ in 0..SWEEPS {
        sweeps += 1;
        sweep(&cells, &mut factors).map_err(diverged)?;
        let now = error(&cells, &factors);
        if !now.is_finite() {
            return Err(diverged(now));
        }
        let done = before.is_finite() && before - now <= options.tolerance * size;
        before = now;
        if done {
            break;
        }
    }

    for (&ratable, &(count, _)) in &said {
        let index = [0, thing_at[&ratable.item()], attribute_of(ratable)];
        let value = accounts_say(ratable) + fitted(&factors, index);
        if !value.is_finite() {
            return Err(diverged(value));
        }
        let score = value.clamp(-1.0 + EDGE, 1.0 - EDGE);
        scores.insert(
            ratable,
            Score {
                score,
                confidence: count,
                applies: if ratable.is_item() {
                    1.0
                } else {
                    (1.0 + score) / 2.0
                },
            },
        );
    }
    let own = factors[0][0];
    let mut folded: Vec<Row<K>> = factors[1]
        .iter()
        .map(|thing| std::array::from_fn(|k| own[k] * thing[k]))
        .collect();
    let mut attributes = factors[2].clone();
    let spread = |rows: &[Row<K>], k: usize| {
        (rows.iter().map(|row| row[k] * row[k]).sum::<f64>() / rows.len() as f64).sqrt()
    };
    for k in 0..K {
        let (things_spread, attributes_spread) = (spread(&folded, k), spread(&attributes, k));
        // An axis the viewer has no part of holds every thing at zero, and stays as it is.
        let balance = if things_spread > 0.0 && attributes_spread > 0.0 {
            (attributes_spread / things_spread).sqrt()
        } else {
            1.0
        };
        let turn = if attributes[0][k] < 0.0 { -1.0 } else { 1.0 };
        for row in &mut folded {
            row[k] *= turn * balance;
        }
        for row in &mut attributes {
            row[k] *= turn / balance;
        }
    }
    let plot = Plot {
        things: things.iter().copied().zip(folded).collect(),
        attributes: std::iter::once(None)
            .chain(tags.iter().copied().map(Some))
            .zip(attributes)
            .collect(),
    };
    Ok(Fit {
        result: UserResult { viewer, scores },
        plot,
        error: before,
        sweeps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A viewer following `accounts`, each of which rated what its list says.
    fn world(accounts: &[&[(&str, i8)]], own: &[(&str, i8)]) -> (Snapshot, UserId) {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        for &(name, value) in own {
            let ratable = builder.ratable(name);
            builder.rate(viewer, ratable, value);
        }
        for (index, ratings) in accounts.iter().enumerate() {
            let account = builder.user(&format!("account{index}"));
            builder.follow(viewer, account);
            for &(name, value) in ratings.iter() {
                let ratable = builder.ratable(name);
                builder.rate(account, ratable, value);
            }
        }
        (builder.build(), viewer)
    }

    fn score(snapshot: &Snapshot, viewer: UserId, name: &str) -> f64 {
        let result = compute_user_tensor(snapshot, viewer).expect("a finite result");
        result.scores[&snapshot.ratable_id(name).expect("a known ratable")].score
    }

    #[test]
    fn the_solver_solves() {
        let mut matrix: Square<RANK> = [[0.4; RANK]; RANK];
        for index in 0..RANK {
            matrix[index][index] = 3.0 + index as f64;
        }
        let target: Row<RANK> = std::array::from_fn(|index| 1.0 + index as f64);
        let lower = cholesky(&matrix).expect("positive definite");
        let found = solve(&lower, &target);
        for row in 0..RANK {
            let back: f64 = (0..RANK)
                .map(|column| matrix[row][column] * found[column])
                .sum();
            assert!((back - target[row]).abs() < 1e-12);
        }
        matrix[0][0] = -1.0;
        assert!(cholesky(&matrix).is_err());
    }

    #[test]
    fn the_same_snapshot_gives_the_same_result() {
        let (snapshot, viewer) = world(
            &[
                &[("a", 1), ("b", -1), ("c", 1)],
                &[("a", -1), ("c", 1), ("d", 1)],
            ],
            &[("a", 1), ("d", -1)],
        );
        let first = compute_user_tensor(&snapshot, viewer).expect("a finite result");
        let second = compute_user_tensor(&snapshot, viewer).expect("a finite result");
        assert_eq!(first, second);
    }

    #[test]
    fn an_account_the_viewer_does_not_follow_is_not_heard() {
        let (snapshot, viewer) = world(&[&[("a", 1)]], &[]);
        let before = compute_user_tensor(&snapshot, viewer).expect("a finite result");
        let mut builder = snapshot.edit();
        let stranger = builder.user("stranger");
        let ratable = builder.ratable("a");
        builder.rate(stranger, ratable, -1).follow(stranger, viewer);
        let after = compute_user_tensor(&builder.build(), viewer).expect("a finite result");
        assert_eq!(before.scores, after.scores);
    }

    /// The viewer agrees with one account and disagrees with another on everything the three
    /// share, and the two split on a thing the viewer has not rated. `others` more accounts
    /// with tastes of their own rate some of the same things.
    fn split(others: usize) -> f64 {
        split_from(others, SEED).0
    }

    /// Alternating least squares can stop in different places from different starts. Run until
    /// a sweep no longer lowers the error, it does not here.
    #[test]
    fn the_result_does_not_depend_on_where_the_fit_starts() {
        let (one, other) = (split_from(30, 1), split_from(30, 2));
        assert!((one.0 - other.0).abs() < 0.01, "{one:?} {other:?}");
    }

    fn split_from(others: usize, seed: u64) -> (f64, f64) {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let (like, unlike) = (builder.user("like"), builder.user("unlike"));
        builder.follow(viewer, like).follow(viewer, unlike);
        for index in 0..12 {
            let item = builder.ratable(&format!("s{index}"));
            let value = if index % 2 == 0 { 1 } else { -1 };
            builder
                .rate(viewer, item, value)
                .rate(like, item, value)
                .rate(unlike, item, -value);
        }
        for account in 0..others {
            let user = builder.user(&format!("other{account}"));
            builder.follow(viewer, user);
            for index in 0..40 {
                if (account * 7 + index * 13) % 3 == 0 {
                    let item = builder.ratable(&format!("s{index}"));
                    let value = if (account + index * index) % 2 == 0 {
                        1
                    } else {
                        -1
                    };
                    builder.rate(user, item, value);
                }
            }
        }
        let new = builder.ratable("new");
        builder.rate(like, new, 1).rate(unlike, new, -1);
        let snapshot = builder.build();
        let options = Options {
            seed,
            ..Options::default()
        };
        let fit = decompose::<RANK>(&snapshot, viewer, &options).expect("a finite result");
        (fit.result.scores[&new].score, fit.error)
    }

    #[test]
    fn the_account_that_agrees_with_the_viewer_counts_for_more() {
        let found = split(30);
        assert!(found > 0.01, "{found}");
    }

    /// With only the two accounts followed there is too little to tell them apart by, and the
    /// thing they split on sits near the middle.
    #[test]
    fn two_accounts_that_split_leave_a_thing_near_the_middle() {
        let found = split(0);
        assert!(found.abs() < 0.2, "{found}");
    }

    /// Twenty accounts each say the same of two thirds of thirty things, up on the even ones and
    /// down on the odd ones, and the viewer has said so of the first twelve: of the things
    /// themselves, or of each as an example of `cozy`.
    fn consensus(suffix: &str) -> (Snapshot, UserId) {
        let mut builder = Snapshot::builder();
        let viewer = builder.user("viewer");
        let value = |thing: usize| if thing.is_multiple_of(2) { 1 } else { -1 };
        for thing in 0..12 {
            let ratable = builder.ratable(&format!("t{thing}{suffix}"));
            builder.rate(viewer, ratable, value(thing));
        }
        for account in 0..20 {
            let user = builder.user(&format!("account{account}"));
            builder.follow(viewer, user);
            for thing in 0..30 {
                if (account * 7 + thing * 13) % 3 != 0 {
                    let ratable = builder.ratable(&format!("t{thing}{suffix}"));
                    builder.rate(user, ratable, value(thing));
                }
            }
        }
        (builder.build(), viewer)
    }

    #[test]
    fn thumbs_up_lean_up_and_thumbs_down_lean_down() {
        let (snapshot, viewer) = consensus("");
        for thing in 12..30 {
            let found = score(&snapshot, viewer, &format!("t{thing}"));
            assert_eq!(found > 0.0, thing % 2 == 0, "{thing}: {found}");
            assert!(found.abs() > 0.01, "{thing}: {found}");
        }
    }

    #[test]
    fn a_bad_example_of_an_attribute_sits_below_a_good_one() {
        let suffix = format!("{}cozy", crate::ids::RATABLE_JOIN);
        let (snapshot, viewer) = consensus(&suffix);
        let result = compute_user_tensor(&snapshot, viewer).expect("a finite result");
        for thing in 12..30 {
            let name = format!("t{thing}{suffix}");
            let found = result.scores[&snapshot.ratable_id(&name).expect("known")];
            assert!(found.confidence > 0.0);
            assert_eq!(found.applies, (1.0 + found.score) / 2.0);
            assert_eq!(found.score > 0.0, thing % 2 == 0, "{thing}: {found:?}");
            assert!(found.score.abs() > 0.01, "{thing}: {found:?}");
        }
    }

    /// The benefit of the doubt: a viewer who shares no thing with anybody, or has said nothing
    /// at all, is given what the accounts they follow say between them.
    #[test]
    fn a_viewer_who_shares_nothing_with_anybody_leans_the_way_the_accounts_do() {
        for own in [&[("c", 1)][..], &[]] {
            let (snapshot, viewer) = world(
                &[&[("a", 1), ("b", -1)], &[("a", 1), ("b", -1)], &[("a", 1)]],
                own,
            );
            assert!(score(&snapshot, viewer, "a") > 0.1);
            assert!(score(&snapshot, viewer, "b") < -0.1);
        }
    }

    /// What the picture is for: a score is what the accounts say plus the inner product of the
    /// thing's point and the attribute's, and liking sits on the positive side of every axis.
    #[test]
    fn the_plot_holds_the_viewers_departures() {
        let (snapshot, viewer) = consensus("");
        let fit =
            decompose::<RANK>(&snapshot, viewer, &Options::default()).expect("a finite result");
        let liking = fit.plot.attributes[&None];
        assert!(liking.iter().all(|&coordinate| coordinate >= 0.0));
        // Thing 29 is one the viewer has not rated; six of the accounts thumbed it down.
        let ratable = snapshot.ratable_id("t29").expect("known");
        let said: Vec<f64> = snapshot
            .follows(viewer)
            .iter()
            .filter_map(|&account| snapshot.rating(account, ratable))
            .map(f64::from)
            .collect();
        let mean = said.iter().sum::<f64>() / (said.len() as f64 + 2.0);
        let point = fit.plot.things[&ratable.item()];
        let departure: f64 = (0..RANK).map(|k| point[k] * liking[k]).sum();
        let score = fit.result.scores[&ratable].score;
        assert!(
            (mean + departure - score).abs() < 1e-9,
            "{mean} {departure} {score}"
        );
    }

    #[test]
    fn the_rank_is_a_parameter() {
        let (snapshot, viewer) = consensus("");
        let options = Options::default();
        let two = decompose::<2>(&snapshot, viewer, &options).expect("a finite result");
        let three = decompose::<3>(&snapshot, viewer, &options).expect("a finite result");
        assert_eq!(two.plot.attributes[&None].len(), 2);
        assert_eq!(three.plot.attributes[&None].len(), 3);
        for thing in 12..30 {
            let ratable = snapshot.ratable_id(&format!("t{thing}")).expect("known");
            for scores in [&two.result.scores, &three.result.scores] {
                assert_eq!(scores[&ratable].score > 0.0, thing % 2 == 0, "{thing}");
            }
        }
    }

    #[test]
    fn nobody_followed_is_an_empty_result_and_an_unknown_viewer_is_refused() {
        let (snapshot, viewer) = world(&[], &[("a", 1)]);
        let result = compute_user_tensor(&snapshot, viewer).expect("a finite result");
        assert!(result.scores.is_empty());
        assert!(compute_user_tensor(&snapshot, UserId(99)).is_err());
    }

    #[test]
    fn a_simulated_world_is_finite_and_inside_the_ends() {
        let world = crate::simulate(
            &crate::WorldConfig {
                tag_rated_fraction: 0.5,
                ..crate::WorldConfig::default()
            },
            &mut Rng::new(3),
        );
        for viewer in world.snapshot.users() {
            let result = compute_user_tensor(&world.snapshot, viewer).expect("a finite result");
            for found in result.scores.values() {
                assert!(found.score > -1.0 && found.score < 1.0);
            }
        }
    }
}
