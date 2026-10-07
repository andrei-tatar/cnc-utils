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
use crate::region::{boolean, normalize, BoolOp, FillRule};
use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut};
use cavalier_contours::shape_algorithms::{Shape, ShapeOffsetOptions};

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
    let shape = Shape::from_plines(region.iter().filter(|p| p.vertex_count() > 1).cloned());
    // CavalierContours offsets to the left of travel: into a
    // counter-clockwise outline. Growing is to the right.
    let result = shape.parallel_offset(-delta, ShapeOffsetOptions::default());
    result
        .ccw_plines
        .into_iter()
        .chain(result.cw_plines)
        .map(|p| p.polyline)
        .filter(|p| p.vertex_count() > 1 && area(p).abs() > EPS * EPS)
        .collect()
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
        let region = normalize(&closed, FillRule::EvenOdd);
        if delta == 0.0 {
            return region;
        }
        if join == Join::Round {
            return offset_region(&region, delta);
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
                Join::Round => out.push(disk(v, d)),
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
