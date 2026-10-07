//! Offsets of regions and paths.
//!
//! `offset_region` grows or shrinks a clean region with round corners:
//! CavalierContours' shape offset, exact for lines and arcs.
//!
//! `inflate` covers the rest (as Clipper's `InflatePaths` did): miter and
//! square joins, open paths with butt / square / round ends, closed paths
//! stroked on both sides. It builds the area the offset sweeps out of
//! simple pieces — each segment's band, a join at each corner, a cap at each
//! end — and unions them (adding them to the region for a growing offset,
//! taking them from it for a shrinking one). Round pieces are exact; for
//! miter and square joins arcs are first approximated by lines, as those
//! joins only exist between straight segments.

use crate::geom::{area, cross, dot, segments, Pline, Seg, EPS, V2};
use crate::region::{boolean, clean_loops, normalize, BoolOp, FillRule};
use crate::winding::Winding;
use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut};
use cavalier_contours::shape_algorithms::{Shape, ShapeOffsetOptions};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Join {
    Round,
    Miter,
    Square,
}

impl Join {
    pub fn from_code(code: u32) -> Join {
        match code {
            1 => Join::Miter,
            2 => Join::Square,
            _ => Join::Round,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    /// Closed paths bound a region, grown or shrunk.
    Polygon,
    /// Closed paths stroked on both sides.
    Joined,
    Butt,
    Square,
    Round,
}

impl End {
    pub fn from_code(code: u32) -> End {
        match code {
            1 => End::Joined,
            2 => End::Butt,
            3 => End::Square,
            4 => End::Round,
            _ => End::Polygon,
        }
    }
}

/// A clean region (see `region::normalize`) grown by `delta` (shrunk when
/// negative), corners rounded.
pub fn offset_region(region: &[Pline], delta: f64) -> Vec<Pline> {
    if delta == 0.0 || region.is_empty() {
        return region.to_vec();
    }
    // Segments a fraction of a micron long (fonts have them) can make
    // CavalierContours lose a loop: merge their ends first. And loops
    // pinched or with spikes of no width are taken apart (see clean_loops).
    let region: Vec<Pline> = clean_loops(
        region
            .iter()
            .filter(|p| p.vertex_count() > 1)
            .map(|p| p.remove_repeat_pos(SHORT).unwrap_or_else(|| p.clone()))
            .collect(),
    );
    let region = &region[..];
    // CavalierContours' shape offset needs loops that don't touch; where
    // they do (a hole meeting its outline at a point, two parts corner to
    // corner — booleans make those), sweep the pieces instead.
    if touches(region) {
        return offset_by_pieces(region, delta);
    }
    let shape = Shape::from_plines(region.iter().cloned());
    // CavalierContours offsets to the left of travel: into a
    // counter-clockwise outline. Growing is to the right.
    let result = shape.parallel_offset(-delta, ShapeOffsetOptions::default());
    let result = clean_loops(
        result
            .ccw_plines
            .into_iter()
            .chain(result.cw_plines)
            .map(|p| p.polyline)
            .collect(),
    );
    if kept_its_side(region, &result, delta) {
        result
    } else {
        offset_by_pieces(region, delta)
    }
}

/// Segments shorter than this are merged before a shape offset (mm).
const SHORT: f64 = 1e-4;

/// Whether an offset region keeps to its side of the region it came from:
/// shrunk, it lies within it; grown, it covers it. Checked just beside the
/// middle of each segment, which catches a loop gone missing (a hole lost
/// when shrinking, an outline when growing).
fn kept_its_side(region: &[Pline], result: &[Pline], delta: f64) -> bool {
    let before = Winding::new(region);
    let after = Winding::new(result);
    let step = 0.5 * delta.abs().min(0.01);
    for pline in region {
        for seg in segments(pline) {
            let m = seg.midpoint();
            let t = seg.tangent(m);
            // The region lies to the left of its loops.
            let left = V2::new(-t.y, t.x);
            let side = if delta < 0.0 { -step } else { step };
            let p = V2::new(m.x + left.x * side, m.y + left.y * side);
            let inside = before.at(p) != 0;
            if delta < 0.0 && !inside && after.at(p) != 0 {
                return false;
            }
            if delta > 0.0 && inside && after.at(p) == 0 {
                return false;
            }
        }
    }
    true
}

/// Whether any two loops share a point, or a loop passes a point twice.
fn touches(region: &[Pline]) -> bool {
    let mut seen: HashMap<(i64, i64), usize> = HashMap::new();
    let key = |x: f64, y: f64| {
        (
            (x / (10.0 * EPS)).round() as i64,
            (y / (10.0 * EPS)).round() as i64,
        )
    };
    for p in region {
        for v in p.iter_vertexes() {
            let count = seen.entry(key(v.x, v.y)).or_insert(0);
            *count += 1;
            if *count > 1 {
                return true;
            }
        }
    }
    false
}

/// A clean region offset by sweeping its edges (exact, round corners):
/// grown, the band outside each edge and a disk at each corner added;
/// shrunk, those inside taken away. Slower than CavalierContours, but any
/// clean region will do.
pub fn offset_by_pieces(region: &[Pline], delta: f64) -> Vec<Pline> {
    let region = &clean_loops(region.to_vec())[..];
    let side = if delta > 0.0 { Side::Right } else { Side::Left };
    let mut pieces = Vec::new();
    for pline in region {
        // The region lies left of its loops: growing is to the right.
        band_pieces(
            pline,
            delta.abs(),
            Some(side),
            Join::Round,
            2.0,
            &mut pieces,
        );
    }
    let swept = normalize(&pieces, FillRule::NonZero);
    let op = if delta > 0.0 {
        BoolOp::Union
    } else {
        BoolOp::Difference
    };
    boolean(region, FillRule::NonZero, &swept, FillRule::NonZero, op)
}

/// Paths offset by `delta` (see the module's notes). `miter_limit`: how far
/// a miter may reach, in offsets, before it's squared off. `arc_tolerance`:
/// how far lines standing in for arcs may stray (miter and square joins).
pub fn inflate(
    paths: &[Pline],
    delta: f64,
    join: Join,
    end: End,
    miter_limit: f64,
    arc_tolerance: f64,
) -> Vec<Pline> {
    if end == End::Polygon {
        let closed: Vec<Pline> = paths.iter().map(closed_copy).collect();
        if delta != 0.0 && join == Join::Round {
            return clipper_offset(&closed, delta);
        }
        let region = polygon_region(&closed);
        if delta == 0.0 {
            return region;
        }
        let d = delta.abs();
        let lines = flatten(&region, arc_tolerance, d);
        let mut pieces = Vec::new();
        for pline in &lines {
            // The region lies left of its loops: growing is to the right.
            let side = if delta > 0.0 { Side::Right } else { Side::Left };
            band_pieces(pline, d, Some(side), join, miter_limit, &mut pieces);
        }
        let swept = normalize(&pieces, FillRule::NonZero);
        let op = if delta > 0.0 {
            BoolOp::Union
        } else {
            BoolOp::Difference
        };
        return boolean(&region, FillRule::NonZero, &swept, FillRule::NonZero, op);
    }
    let d = delta.abs();
    if d == 0.0 {
        return Vec::new();
    }
    if join == Join::Round && end == End::Round {
        return round_strokes(paths, d);
    }
    stroke_by_pieces(paths, d, join, end, miter_limit, arc_tolerance)
}

/**
 * Open paths stroked `d` either side, round joins and ends: each path's
 * outline (see stroke_outline), merged where they wind positively — as
 * Clipper strokes, but with arcs. Far fewer pieces to merge than sweeping
 * each segment's band.
 */
pub fn round_strokes(paths: &[Pline], d: f64) -> Vec<Pline> {
    let mut outlines = Vec::with_capacity(paths.len());
    for path in paths {
        let path = open_copy(path);
        let path = path.remove_repeat_pos(EPS).unwrap_or(path);
        if path.vertex_count() < 2 {
            if path.vertex_count() == 1 {
                outlines.push(disk(path.at(0).pos(), d));
            }
            continue;
        }
        outlines.push(stroke_outline(&path, d));
    }
    normalize(&outlines, FillRule::Positive)
}

/**
 * The outline round an open path `d` either side, counter-clockwise: along
 * its right side, round its end, back along its left side, round its start.
 * Each segment's side is the segment with its ends moved `d` along their
 * normals, keeping its bulge (an arc tighter than `d` comes out mirrored
 * through its centre, winding the same way). Consecutive sides that part
 * are joined by an arc round the vertex; ones that cross, through the vertex
 * itself, so what folds over winds back on itself.
 */
fn stroke_outline(path: &Pline, d: f64) -> Pline {
    let forward = segments(path);
    let backward: Vec<Seg> = forward.iter().rev().map(|s| s.reversed()).collect();
    let mut out = Pline::with_capacity(4 * forward.len() + 4, true);
    for segs in [&forward, &backward] {
        side(segs, d, &mut out);
        // Round the end: a half turn from its right to its left.
        let last = segs[segs.len() - 1];
        let n = right_normal(last.tangent(last.end()));
        let e = last.end() + n.scale(d);
        out.add(e.x, e.y, 1.0);
    }
    out.remove_repeat_pos(EPS).unwrap_or(out)
}

/// The right side of a chain of segments, `d` out, its last end left out.
fn side(segs: &[Seg], d: f64, out: &mut Pline) {
    for (i, seg) in segs.iter().enumerate() {
        let s = seg.start() + right_normal(seg.tangent(seg.start())).scale(d);
        out.add(s.x, s.y, seg.v1.bulge);
        let Some(next) = segs.get(i + 1) else {
            break;
        };
        let v = seg.end();
        let before = right_normal(seg.tangent(v));
        let after = right_normal(next.tangent(v));
        let e = v + before.scale(d);
        let (sin, cos) = (cross(before, after), dot(before, after));
        if cos > -0.999 && sin < 0.0 {
            // They cross: through the vertex.
            out.add(e.x, e.y, 0.0);
            out.add(v.x, v.y, 0.0);
        } else {
            // They part: round the vertex, the way the path turns (round
            // the outside of a turn back on itself).
            let mut turn = sin.atan2(cos);
            if turn < 0.0 {
                turn += 2.0 * std::f64::consts::PI;
            }
            out.add(e.x, e.y, (turn / 4.0).tan());
        }
    }
}

/// Paths stroked by sweeping each segment's band, joins and caps (any join
/// or end), the pieces merged.
pub fn stroke_by_pieces(
    paths: &[Pline],
    d: f64,
    join: Join,
    end: End,
    miter_limit: f64,
    arc_tolerance: f64,
) -> Vec<Pline> {
    let mut pieces = Vec::new();
    for path in paths {
        let path = if end == End::Joined {
            closed_copy(path)
        } else {
            open_copy(path)
        };
        let path = if join == Join::Round {
            path
        } else {
            flatten(&[path], arc_tolerance, d)
                .pop()
                .unwrap_or_else(|| Pline::new())
        };
        if path.vertex_count() < 2 {
            // A lone point: its cap.
            if path.vertex_count() == 1 && end != End::Butt {
                let p = path.at(0).pos();
                pieces.push(if end == End::Square {
                    square_around(p, d)
                } else {
                    disk(p, d)
                });
            }
            continue;
        }
        band_pieces(&path, d, None, join, miter_limit, &mut pieces);
        if !path.is_closed() {
            caps(&path, d, end, &mut pieces);
        }
    }
    normalize(&pieces, FillRule::NonZero)
}

/**
 * The region closed paths bound, read as Clipper's offset read them: the
 * path with the greatest y (then least x; "lowest" with y down, as Clipper
 * takes it) sets which way round outlines go, and areas wound that way are
 * filled. So overlapping outlines merge, and a hole must run the other way
 * round to be one.
 */
pub fn polygon_region(closed: &[Pline]) -> Vec<Pline> {
    match reference_orientation(closed) {
        None => Vec::new(),
        Some(sign) => normalize(closed, fill_for(sign)),
    }
}

fn fill_for(sign: f64) -> FillRule {
    if sign < 0.0 {
        FillRule::Negative
    } else {
        FillRule::Positive
    }
}

/**
 * Closed paths offset as Clipper's offset did: each path on its own, then
 * merged by winding (the way round outlines go, see polygon_region, counted
 * positive). So overlapping outlines grow or shrink each on their own before
 * merging, a hole (the other way round) shrinks as its outline grows, and a
 * line closed on itself (no area) still grows into a band.
 *
 * A path of lines is offset as Clipper did it (`raw_offset`): each segment
 * moved `delta` out, joined by exact arcs where they part and through the
 * corner where they cross, so what folds over cancels out. One with arcs
 * — Clipper only ever saw those as lines — has its parts wound each way
 * offset exactly instead (a raw offset of an arc tighter than the offset
 * would fold over).
 */
pub fn clipper_offset(closed: &[Pline], delta: f64) -> Vec<Pline> {
    let Some(sign) = reference_orientation(closed) else {
        return Vec::new();
    };
    let (outer, inner) = (fill_for(sign), fill_for(-sign));
    // Turned so outlines go the reference's way round.
    let along = |mut p: Pline| {
        if sign < 0.0 {
            p.invert_direction_mut();
        }
        p
    };
    let mut parts: Vec<Pline> = Vec::new();
    for p in closed.iter().filter(|p| p.vertex_count() > 1) {
        // (None: nothing repeated to remove.)
        let clean = p.remove_repeat_pos(EPS).unwrap_or_else(|| p.clone());
        if clean.vertex_count() < 2 {
            continue;
        }
        if clean.iter_vertexes().all(|v| v.bulge == 0.0) {
            // Outward from an outline is to the right of travel.
            let raw = raw_offset(&clean, delta * sign);
            if raw.vertex_count() > 1 {
                parts.push(raw);
            }
            continue;
        }
        let one = std::slice::from_ref(&clean);
        let filled = normalize(one, outer);
        let holes = normalize(one, inner);
        if filled.is_empty() && holes.is_empty() {
            // No area: growing makes a band round it, shrinking nothing.
            if delta > 0.0 {
                let band = inflate(one, delta, Join::Round, End::Joined, 2.0, 0.0);
                parts.extend(band.into_iter().map(along));
            }
            continue;
        }
        parts.extend(offset_region(&filled, delta).into_iter().map(along));
        for mut hole in offset_region(&orient(holes), -delta) {
            hole.invert_direction_mut();
            parts.push(along(hole));
        }
    }
    normalize(&parts, outer)
}

/**
 * A closed path of lines offset `d` to the right of travel, as Clipper's
 * offset builds it before merging: each segment moved out; where consecutive
 * ones part, an arc round their corner joins them, and where they cross,
 * they're joined through the corner itself — so a part that folds over (a
 * square shrunk past its middle) winds back on itself and cancels out when
 * merged by winding, rather than standing as a loop turned inside out.
 */
fn raw_offset(path: &Pline, d: f64) -> Pline {
    let points: Vec<V2> = path.iter_vertexes().map(|v| V2::new(v.x, v.y)).collect();
    let n = points.len();
    // The right-hand normal of the segment from each point to the next.
    let normals: Vec<V2> = (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let l = (dx * dx + dy * dy).sqrt();
            if l > 0.0 {
                V2::new(dy / l, -dx / l)
            } else {
                V2::new(0.0, 0.0)
            }
        })
        .collect();
    let mut out = Pline::with_capacity(3 * n, true);
    for j in 0..n {
        let (p, before, after) = (points[j], normals[(j + n - 1) % n], normals[j]);
        let from = V2::new(p.x + before.x * d, p.y + before.y * d);
        let to = V2::new(p.x + after.x * d, p.y + after.y * d);
        let (sin, cos) = (cross(before, after), dot(before, after));
        if cos > -0.999 && sin * d < 0.0 {
            // They cross: through the corner.
            out.add(from.x, from.y, 0.0);
            out.add(p.x, p.y, 0.0);
            out.add(to.x, to.y, 0.0);
        } else {
            // They part: an arc round the corner, turning the way the
            // offset goes (round the outside of a turn back on itself).
            let mut turn = sin.atan2(cos);
            if turn * d < 0.0 {
                turn += 2.0 * std::f64::consts::PI * d.signum();
            }
            out.add(from.x, from.y, (turn / 4.0).tan());
            out.add(to.x, to.y, 0.0);
        }
    }
    out.remove_repeat_pos(EPS).unwrap_or(out)
}

/// Loops of a clean region turned outlines counter-clockwise (a region
/// normalized under a negative fill comes out the other way round).
fn orient(region: Vec<Pline>) -> Vec<Pline> {
    let total: f64 = region.iter().map(area).sum();
    if total >= 0.0 {
        return region;
    }
    region
        .into_iter()
        .map(|mut p| {
            p.invert_direction_mut();
            p
        })
        .collect()
}

/**
 * +1 when outlines go counter-clockwise, -1 clockwise: by the path through
 * the topmost point (then leftmost; "lowest" with y down, as Clipper takes
 * it), the largest of them where several meet there. None without paths.
 */
fn reference_orientation(closed: &[Pline]) -> Option<f64> {
    // The topmost point (then leftmost) of all the paths.
    let mut top: Option<(f64, f64)> = None;
    for p in closed.iter().filter(|p| p.vertex_count() > 1) {
        for v in p.iter_vertexes() {
            if top.is_none_or(|(x, y)| v.y > y || (v.y == y && v.x < x)) {
                top = Some((v.x, v.y));
            }
        }
    }
    let (x, y) = top?;
    // Of the paths through it (a hole can touch its outline there), the
    // largest is the outline.
    let reference = closed
        .iter()
        .filter(|p| {
            p.vertex_count() > 1
                && p.iter_vertexes()
                    .any(|v| (v.x - x).abs() <= EPS && (v.y - y).abs() <= EPS)
        })
        .max_by(|a, b| area(a).abs().partial_cmp(&area(b).abs()).unwrap())?;
    Some(if area(reference) < 0.0 { -1.0 } else { 1.0 })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

fn closed_copy(p: &Pline) -> Pline {
    let mut c = p.clone();
    c.set_is_closed(true);
    c
}

/// An open path: a closed one returns to its start.
fn open_copy(p: &Pline) -> Pline {
    let mut c = p.clone();
    if p.is_closed() && p.vertex_count() > 1 {
        let first = p.at(0);
        c.add(first.x, first.y, 0.0);
        c.set_is_closed(false);
    }
    c
}

/// Arcs approximated by lines no further than `tolerance` off (default: a
/// small fraction of the offset).
fn flatten(plines: &[Pline], tolerance: f64, d: f64) -> Vec<Pline> {
    let tolerance = if tolerance > 0.0 {
        tolerance
    } else {
        (d * 0.002).max(1e-4)
    };
    plines
        .iter()
        .map(|p| {
            p.arcs_to_approx_lines(tolerance)
                .unwrap_or_else(|| p.clone())
        })
        .collect()
}

fn ccw(mut p: Pline) -> Pline {
    if area(&p) < 0.0 {
        p.invert_direction_mut();
    }
    p
}

fn polygon(points: &[V2]) -> Pline {
    let mut p = Pline::with_capacity(points.len(), true);
    for q in points {
        p.add(q.x, q.y, 0.0);
    }
    ccw(p)
}

fn disk(c: V2, r: f64) -> Pline {
    let mut p = Pline::with_capacity(2, true);
    p.add(c.x - r, c.y, 1.0);
    p.add(c.x + r, c.y, 1.0);
    p
}

/**
 * The round join at `v` between bands ending on the normals `n1` and `n2`:
 * the sector of radius `d` across the gap between them (the way of
 * `toward`). Its arc meets the bands' outer edges at their very ends — a
 * whole disk would touch them there tangentially, which is badly
 * conditioned to intersect.
 */
fn wedge(v: V2, n1: V2, n2: V2, toward: V2, d: f64) -> Pline {
    let mut sweep = cross(n1, n2).atan2(dot(n1, n2));
    let half = sweep / 2.0;
    let mid = V2::new(
        n1.x * half.cos() - n1.y * half.sin(),
        n1.x * half.sin() + n1.y * half.cos(),
    );
    if dot(mid, toward) < 0.0 {
        sweep -= 2.0 * std::f64::consts::PI * if sweep < 0.0 { -1.0 } else { 1.0 };
    }
    let (q1, q2) = (v + n1.scale(d), v + n2.scale(d));
    let mut p = Pline::with_capacity(3, true);
    p.add(v.x, v.y, 0.0);
    p.add(q1.x, q1.y, (sweep / 4.0).tan());
    p.add(q2.x, q2.y, 0.0);
    ccw(p)
}

fn square_around(c: V2, r: f64) -> Pline {
    polygon(&[
        V2::new(c.x - r, c.y - r),
        V2::new(c.x + r, c.y - r),
        V2::new(c.x + r, c.y + r),
        V2::new(c.x - r, c.y + r),
    ])
}

fn right_normal(u: V2) -> V2 {
    V2::new(u.y, -u.x)
}

/// The area between radii `inner` and `outer` (inner may be 0) over an
/// arc's angular span.
fn annular_sector(seg: &Seg, inner: f64, outer: f64) -> Pline {
    let (_, c) = seg.arc();
    let sweep = 4.0 * seg.v1.bulge.atan();
    let a0 = (seg.start().y - c.y).atan2(seg.start().x - c.x);
    let a1 = a0 + sweep;
    let at = |a: f64, r: f64| V2::new(c.x + r * a.cos(), c.y + r * a.sin());
    let b = (sweep / 4.0).tan();
    let mut p = Pline::with_capacity(4, true);
    let o0 = at(a0, outer);
    let o1 = at(a1, outer);
    p.add(o0.x, o0.y, b);
    p.add(o1.x, o1.y, 0.0);
    if inner > EPS {
        let i1 = at(a1, inner);
        let i0 = at(a0, inner);
        p.add(i1.x, i1.y, -b);
        p.add(i0.x, i0.y, 0.0);
    } else {
        p.add(c.x, c.y, 0.0);
    }
    ccw(p)
}

/// The band each segment sweeps (both sides, or one) and the joins at its
/// corners.
fn band_pieces(
    path: &Pline,
    d: f64,
    side: Option<Side>,
    join: Join,
    miter_limit: f64,
    out: &mut Vec<Pline>,
) {
    let segs = segments(path);
    if segs.is_empty() {
        return;
    }
    for seg in &segs {
        if seg.is_arc() {
            let (r, c) = seg.arc();
            let ccw_arc = seg.v1.bulge > 0.0;
            // A counter-clockwise arc has its centre on its left.
            let (inner, outer) = match side {
                None => (r - d, r + d),
                Some(Side::Left) if ccw_arc => (r - d, r),
                Some(Side::Left) => (r, r + d),
                Some(Side::Right) if ccw_arc => (r, r + d),
                Some(Side::Right) => (r - d, r),
            };
            out.push(annular_sector(seg, inner.max(0.0), outer));
            if inner < 0.0 {
                out.push(disk(c, -inner));
            }
        } else {
            let u = (seg.end() - seg.start()).normalize();
            let n = right_normal(u);
            let (a, b) = match side {
                None => (-d, d),
                Some(Side::Left) => (-d, 0.0),
                Some(Side::Right) => (0.0, d),
            };
            out.push(polygon(&[
                seg.start() + n.scale(a),
                seg.end() + n.scale(a),
                seg.end() + n.scale(b),
                seg.start() + n.scale(b),
            ]));
        }
    }
    // Joins between consecutive segments (and round the closing vertex).
    let count = if path.is_closed() {
        segs.len()
    } else {
        segs.len() - 1
    };
    for i in 0..count {
        let s1 = &segs[i];
        let s2 = &segs[(i + 1) % segs.len()];
        let v = s1.end();
        if (s2.start() - v).length() > EPS {
            continue;
        }
        let u1 = s1.tangent(v);
        let u2 = s2.tangent(v);
        let turn = cross(u1, u2);
        if turn.abs() < 1e-12 && dot(u1, u2) > 0.0 {
            continue;
        }
        // A left turn opens a gap on the right, and the other way round.
        let gap = if turn > 0.0 || (turn.abs() < 1e-12) {
            Side::Right
        } else {
            Side::Left
        };
        let sides: &[Side] = match side {
            None => &[Side::Left, Side::Right],
            Some(Side::Left) => &[Side::Left],
            Some(Side::Right) => &[Side::Right],
        };
        for &s in sides {
            if s != gap && !(turn.abs() < 1e-12) {
                continue;
            }
            let sign = if s == Side::Right { 1.0 } else { -1.0 };
            let n1 = right_normal(u1).scale(sign);
            let n2 = right_normal(u2).scale(sign);
            match join {
                Join::Round => out.push(wedge(v, n1, n2, u1 - u2, d)),
                Join::Miter | Join::Square => {
                    out.push(corner(v, u1, u2, n1, n2, d, join, miter_limit))
                }
            }
        }
    }
}

/// A miter (or, past the limit, square) join at `v`, on the side of the
/// normals `n1` / `n2`.
#[allow(clippy::too_many_arguments)]
fn corner(v: V2, u1: V2, u2: V2, n1: V2, n2: V2, d: f64, join: Join, miter_limit: f64) -> Pline {
    let q1 = v + n1.scale(d);
    let q2 = v + n2.scale(d);
    let cos = dot(n1, n2);
    if join == Join::Miter && cos > -1.0 + 1e-9 {
        let reach = (2.0 / (1.0 + cos)).sqrt();
        if reach <= miter_limit.max(1.0) {
            let m = v + (n1 + n2).scale(d / (1.0 + cos));
            return polygon(&[v, q1, m, q2]);
        }
    }
    // Squared off `d` from the vertex, across the bisector.
    let sum = n1 + n2;
    let b = if sum.length() > 1e-9 {
        sum.normalize()
    } else {
        u1
    };
    let t1 = (d - d * dot(n1, b)) / dot(u1, b).max(1e-9);
    let t2 = (d - d * dot(n2, b)) / dot(u2.scale(-1.0), b).max(1e-9);
    let p1 = q1 + u1.scale(t1);
    let p2 = q2 - u2.scale(t2);
    polygon(&[v, q1, p1, p2, q2])
}

/// End caps of an open path.
fn caps(path: &Pline, d: f64, end: End, out: &mut Vec<Pline>) {
    let segs = segments(path);
    let (Some(first), Some(last)) = (segs.first(), segs.last()) else {
        return;
    };
    for (p, u) in [
        (first.start(), first.tangent(first.start()).scale(-1.0)),
        (last.end(), last.tangent(last.end())),
    ] {
        match end {
            End::Round => out.push(disk(p, d)),
            End::Square => {
                let n = right_normal(u);
                out.push(polygon(&[
                    p - n.scale(d),
                    p - n.scale(d) + u.scale(d),
                    p + n.scale(d) + u.scale(d),
                    p + n.scale(d),
                ]));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::region::tests::{circle, rect, total_area};
    use std::f64::consts::PI;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    #[test]
    fn offset_region_grows_and_shrinks_with_round_corners() {
        let r = [rect(0.0, 0.0, 10.0, 10.0)];
        let grown = offset_region(&r, 1.0);
        assert_eq!(grown.len(), 1);
        assert!(
            close(total_area(&grown), 100.0 + 40.0 + PI, 1e-6),
            "{}",
            total_area(&grown)
        );
        let shrunk = offset_region(&r, -1.0);
        assert!(
            close(total_area(&shrunk), 64.0, 1e-6),
            "{}",
            total_area(&shrunk)
        );
        let gone = offset_region(&r, -6.0);
        assert!(gone.is_empty());
    }

    #[test]
    fn offset_region_with_hole_and_arcs() {
        let region = boolean(
            &[rect(0.0, 0.0, 20.0, 20.0)],
            FillRule::NonZero,
            &[circle(10.0, 10.0, 4.0)],
            FillRule::NonZero,
            BoolOp::Difference,
        );
        let shrunk = offset_region(&region, -1.0);
        // 18×18 square minus a circle of radius 5.
        assert!(
            close(total_area(&shrunk), 324.0 - PI * 25.0, 1e-6),
            "{}",
            total_area(&shrunk)
        );
        assert_eq!(shrunk.len(), 2);
    }

    #[test]
    fn round_inflate_matches_offset_region() {
        // The swept-pieces method and CavalierContours agree.
        let r = [rect(0.0, 0.0, 10.0, 10.0)];
        let shape = offset_region(&r, 2.0);
        let mut pieces = Vec::new();
        band_pieces(&r[0], 2.0, Some(Side::Right), Join::Round, 2.0, &mut pieces);
        let swept = boolean(
            &r,
            FillRule::NonZero,
            &normalize(&pieces, FillRule::NonZero),
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert!(close(total_area(&shape), total_area(&swept), 1e-6));
    }

    #[test]
    fn miter_and_square_joins() {
        let r = [rect(0.0, 0.0, 10.0, 10.0)];
        let miter = inflate(&r, 1.0, Join::Miter, End::Polygon, 2.0, 0.0);
        assert!(
            close(total_area(&miter), 144.0, 1e-6),
            "{}",
            total_area(&miter)
        );
        // A 90° miter reaches √2 offsets: past a limit of 1.2 it's squared.
        let squared = inflate(&r, 1.0, Join::Miter, End::Polygon, 1.2, 0.0);
        // Each corner loses a triangle (√2 − 1) high off its miter's tip.
        let expected = 144.0 - 4.0 * (2.0f64.sqrt() - 1.0).powi(2);
        assert!(
            close(total_area(&squared), expected, 1e-6),
            "{} vs {}",
            total_area(&squared),
            expected
        );
        let square = inflate(&r, 1.0, Join::Square, End::Polygon, 2.0, 0.0);
        assert!(close(total_area(&square), expected, 1e-6));
        let inset = inflate(&r, -1.0, Join::Miter, End::Polygon, 2.0, 0.0);
        assert!(close(total_area(&inset), 64.0, 1e-6));
    }

    #[test]
    fn open_path_ends() {
        let mut line = Pline::with_capacity(2, false);
        line.add(0.0, 0.0, 0.0);
        line.add(10.0, 0.0, 0.0);
        let butt = inflate(&[line.clone()], 1.0, Join::Round, End::Butt, 2.0, 0.0);
        assert!(close(total_area(&butt), 20.0, 1e-6));
        let square = inflate(&[line.clone()], 1.0, Join::Round, End::Square, 2.0, 0.0);
        assert!(close(total_area(&square), 24.0, 1e-6));
        let round = inflate(&[line.clone()], 1.0, Join::Round, End::Round, 2.0, 0.0);
        assert!(close(total_area(&round), 20.0 + PI, 1e-6));
        // An L: the round join fills the outside of the corner.
        let mut l = Pline::with_capacity(3, false);
        l.add(0.0, 0.0, 0.0);
        l.add(10.0, 0.0, 0.0);
        l.add(10.0, 10.0, 0.0);
        let stroke = inflate(&[l], 1.0, Join::Round, End::Butt, 2.0, 0.0);
        // Two 10×2 bands overlapping by 1×1, plus a quarter disk outside the corner.
        assert!(
            close(total_area(&stroke), 39.0 + PI / 4.0, 1e-6),
            "{}",
            total_area(&stroke)
        );
    }

    #[test]
    fn touching_loops_offset_by_pieces() {
        // A square with a square hole touching its outline at a corner of
        // the hole, and a separate part touching at a corner.
        let outer = rect(0.0, 0.0, 10.0, 10.0);
        let mut hole = Pline::with_capacity(3, true);
        hole.add(10.0, 5.0, 0.0);
        hole.add(6.0, 3.0, 0.0);
        hole.add(6.0, 7.0, 0.0);
        let region = boolean(
            &[outer],
            FillRule::NonZero,
            &[hole],
            FillRule::NonZero,
            BoolOp::Difference,
        );
        assert!(touches(&region));
        let grown = offset_region(&region, 1.0);
        assert!(!grown.is_empty());
        let shrunk = offset_region(&region, -0.5);
        assert!(!shrunk.is_empty());
        // The pieces agree with CavalierContours where both work.
        let plain = [rect(0.0, 0.0, 10.0, 10.0)];
        for d in [1.5, -2.0] {
            let a = total_area(&offset_region(&plain, d));
            let b = total_area(&offset_by_pieces(&plain, d));
            assert!(close(a, b, 1e-6), "{d}: {a} vs {b}");
        }
        let circle_region = [circle(0.0, 0.0, 5.0)];
        for d in [2.0, -3.0, -6.0] {
            let a = total_area(&offset_region(&circle_region, d));
            let b = total_area(&offset_by_pieces(&circle_region, d));
            assert!(close(a, b, 1e-6), "circle {d}: {a} vs {b}");
        }
    }

    #[test]
    fn offsets_like_clipper() {
        // A plain outline: the exact offset.
        let r = [rect(0.0, 0.0, 10.0, 10.0)];
        assert!(close(
            total_area(&clipper_offset(&r, 1.0)),
            100.0 + 40.0 + PI,
            1e-6
        ));
        assert!(close(total_area(&clipper_offset(&r, -1.0)), 64.0, 1e-6));
        // A circle, arcs kept.
        let c = [circle(0.0, 0.0, 5.0)];
        assert!(close(total_area(&clipper_offset(&c, -2.0)), 9.0 * PI, 1e-6));
        // A line closed on itself offsets to a stadium.
        let mut line = Pline::with_capacity(2, true);
        line.add(0.0, 0.0, 0.0);
        line.add(10.0, 0.0, 0.0);
        assert!(close(
            total_area(&clipper_offset(&[line], 2.0)),
            40.0 + 4.0 * PI,
            1e-6
        ));
        // Two overlapping squares shrunk each on its own, then merged: the
        // overlap's middle stays (shrinking their union would cut it).
        let both = [rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 0.0, 15.0, 10.0)];
        let shrunk = clipper_offset(&both, -1.0);
        assert_eq!(shrunk.len(), 1);
        assert!(close(total_area(&shrunk), 8.0 * 13.0, 1e-6));
        // A hole (the other way round) shrinks as the outline grows.
        let mut hole = rect(3.0, 3.0, 7.0, 7.0);
        hole.invert_direction_mut();
        let holed = [rect(0.0, 0.0, 10.0, 10.0), hole];
        let grown = clipper_offset(&holed, 1.0);
        assert!(close(total_area(&grown), 100.0 + 40.0 + PI - 4.0, 1e-6));
        // Grown past its middle, the hole is gone — not turned inside out
        // (a 4 mm square hole, grown 2.1 or 3).
        for d in [2.1, 3.0] {
            let grown = clipper_offset(&holed, d);
            assert_eq!(grown.len(), 1, "{d}");
            assert!(close(
                total_area(&grown),
                100.0 + 40.0 * d + PI * d * d,
                1e-6
            ));
        }
        // An outline shrunk past its middle is gone too.
        assert!(clipper_offset(&r, -5.5).is_empty());
        assert!(clipper_offset(&r, -8.0).is_empty());
    }

    #[test]
    fn polygons_read_as_clipper_reads_them() {
        // Overlapping copies, both counter-clockwise: one area.
        let both = [rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 0.0, 15.0, 10.0)];
        assert!(close(total_area(&polygon_region(&both)), 150.0, 1e-9));
        // A "hole" the same way round as its outline: filled.
        let same = [rect(0.0, 0.0, 10.0, 10.0), rect(2.0, 2.0, 8.0, 8.0)];
        assert!(close(total_area(&polygon_region(&same)), 100.0, 1e-9));
        // The other way round: a hole.
        let mut hole = rect(2.0, 2.0, 8.0, 8.0);
        hole.invert_direction_mut();
        let holed = [rect(0.0, 0.0, 10.0, 10.0), hole];
        assert!(close(total_area(&polygon_region(&holed)), 64.0, 1e-9));
        // All clockwise: the lowest sets the way round, the same result.
        let cw: Vec<Pline> = holed
            .iter()
            .map(|p| {
                let mut q = p.clone();
                q.invert_direction_mut();
                q
            })
            .collect();
        assert!(close(total_area(&polygon_region(&cw)).abs(), 64.0, 1e-9));
    }

    #[test]
    fn joined_closed_path_is_a_ring() {
        let ring = inflate(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            1.0,
            Join::Round,
            End::Joined,
            2.0,
            0.0,
        );
        assert_eq!(ring.len(), 2);
        assert!(
            close(total_area(&ring), (100.0 + 40.0 + PI) - 64.0, 1e-6),
            "{}",
            total_area(&ring)
        );
    }

    #[test]
    fn arc_band_through_its_centre() {
        // A half circle of radius 1 stroked 2 each side: the band covers the centre.
        let mut arc = Pline::with_capacity(2, false);
        arc.add(1.0, 0.0, 1.0);
        arc.add(-1.0, 0.0, 0.0);
        let r = inflate(&[arc], 2.0, Join::Round, End::Round, 2.0, 0.0);
        assert_eq!(r.len(), 1);
        // Inside it: the centre and points just past the arc.
        let w = crate::winding::Winding::new(&r);
        assert_eq!(w.at(V2::new(0.0, 0.0)), 1);
        assert_eq!(w.at(V2::new(0.0, 2.9)), 1);
        assert_eq!(w.at(V2::new(0.0, -0.9)), 1);
        assert_eq!(w.at(V2::new(0.0, 3.1)), 0);
    }
}
