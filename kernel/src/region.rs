//! Boolean operations on regions bounded by line and arc loops.
//!
//! A region is a set of closed loops read with a fill rule. To combine two:
//! 1. every segment of every loop is split wherever it meets another;
//! 2. pieces that coincide are kept once;
//! 3. each piece is kept where the result is filled on one side of it and
//!    not the other (tested just off its middle, with exact winding numbers
//!    of the input loops), turned so the result lies on its left;
//! 4. the kept pieces are joined end to end into loops, taking the leftmost
//!    turn where several leave one point (loops that touch stay apart).
//! The result has its outlines counter-clockwise and holes clockwise, none
//! crossing another: what the non-zero (or even-odd) rule reads the same.

use crate::geom::{area, closed_from, cross, dot, segments, Pline, Seg, Vertex, EPS, V2};
use crate::winding::Winding;
use cavalier_contours::polyline::{
    pline_seg_intr, seg_split_at_point, PlineCreation, PlineSegIntr, PlineSource, PlineSourceMut,
};
use cavalier_contours::static_aabb2d_index::{StaticAABB2DIndex, StaticAABB2DIndexBuilder};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillRule {
    EvenOdd,
    NonZero,
    Positive,
    Negative,
}

impl FillRule {
    pub fn from_code(code: u32) -> FillRule {
        match code {
            0 => FillRule::EvenOdd,
            2 => FillRule::Positive,
            3 => FillRule::Negative,
            _ => FillRule::NonZero,
        }
    }

    fn filled(self, winding: i32) -> bool {
        match self {
            FillRule::EvenOdd => winding % 2 != 0,
            FillRule::NonZero => winding != 0,
            FillRule::Positive => winding > 0,
            FillRule::Negative => winding < 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoolOp {
    Union,
    Intersection,
    Difference,
    Xor,
}

impl BoolOp {
    pub fn from_code(code: u32) -> BoolOp {
        match code {
            1 => BoolOp::Intersection,
            2 => BoolOp::Difference,
            3 => BoolOp::Xor,
            _ => BoolOp::Union,
        }
    }

    fn apply(self, a: bool, b: bool) -> bool {
        match self {
            BoolOp::Union => a || b,
            BoolOp::Intersection => a && b,
            BoolOp::Difference => a && !b,
            BoolOp::Xor => a != b,
        }
    }
}

/// `a` combined with `b` (closed loops only; open ones are left out).
pub fn boolean(
    a: &[Pline],
    fill_a: FillRule,
    b: &[Pline],
    fill_b: FillRule,
    op: BoolOp,
) -> Vec<Pline> {
    let closed = |loops: &[Pline]| -> Vec<Pline> {
        loops
            .iter()
            .filter(|p| p.is_closed() && p.vertex_count() > 1)
            .cloned()
            .collect()
    };
    let a = closed(a);
    let b = closed(b);
    let mut segs: Vec<Seg> = Vec::new();
    for pline in a.iter().chain(b.iter()) {
        segs.extend(segments(pline));
    }
    if segs.is_empty() {
        return Vec::new();
    }
    let wa = Winding::new(&a);
    let wb = Winding::new(&b);
    let filled = |p: V2| op.apply(fill_a.filled(wa.at(p)), fill_b.filled(wb.at(p)));

    let pieces = split_all(&segs);
    let graph = Graph::build(&pieces);
    let mut kept: Vec<Seg> = Vec::new();
    for edge in &graph.edges {
        let seg = graph.seg(edge);
        let m = seg.midpoint();
        let t = seg.tangent(m);
        let n = V2::new(-t.y, t.x);
        let d = (seg.length() * 0.25).min(10.0 * EPS);
        let left = filled(m + n.scale(d));
        let right = filled(m - n.scale(d));
        if left != right {
            kept.push(if left { seg } else { seg.reversed() });
        }
    }
    stitch(&kept)
}

/// A region's loops made into a clean region (outlines counter-clockwise,
/// holes clockwise, none crossing) under `fill`.
pub fn normalize(loops: &[Pline], fill: FillRule) -> Vec<Pline> {
    boolean(loops, fill, &[], FillRule::NonZero, BoolOp::Union)
}

/// Splits every segment where it meets another.
fn split_all(segs: &[Seg]) -> Vec<Seg> {
    let mut builder = StaticAABB2DIndexBuilder::new(segs.len());
    for s in segs {
        let (x0, y0, x1, y1) = s.bounds();
        builder.add(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS);
    }
    let index: StaticAABB2DIndex<f64> = builder.build().expect("segment index");
    let mut cuts: Vec<Vec<V2>> = vec![Vec::new(); segs.len()];
    for (i, s) in segs.iter().enumerate() {
        let (x0, y0, x1, y1) = s.bounds();
        for j in index.query(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS) {
            if j <= i {
                continue;
            }
            let t = &segs[j];
            let points: Vec<V2> = match pline_seg_intr(s.v1, s.v2, t.v1, t.v2, EPS) {
                PlineSegIntr::NoIntersect => continue,
                PlineSegIntr::TangentIntersect { point } | PlineSegIntr::OneIntersect { point } => {
                    vec![point]
                }
                PlineSegIntr::TwoIntersects { point1, point2 }
                | PlineSegIntr::OverlappingLines { point1, point2 }
                | PlineSegIntr::OverlappingArcs { point1, point2 } => vec![point1, point2],
            };
            for p in points {
                cuts[i].push(p);
                cuts[j].push(p);
            }
            // An overlap's ends may be the other segment's ends: cut there too.
            for (k, other) in [(i, t), (j, s)] {
                for end in [other.start(), other.end()] {
                    if on_segment(&segs[k], end) {
                        cuts[k].push(end);
                    }
                }
            }
        }
    }
    let mut out = Vec::with_capacity(segs.len());
    for (s, points) in segs.iter().zip(cuts.iter_mut()) {
        split_at(s, points, &mut out);
    }
    out
}

/// Whether `p` lies on the segment (within EPS), away from its ends.
fn on_segment(s: &Seg, p: V2) -> bool {
    if (p - s.start()).length() <= EPS || (p - s.end()).length() <= EPS {
        return false;
    }
    if !s.is_arc() {
        let d = s.end() - s.start();
        let l2 = dot(d, d);
        let t = dot(p - s.start(), d) / l2;
        return t > 0.0 && t < 1.0 && (cross(d, p - s.start()).abs() / l2.sqrt()) <= EPS;
    }
    let (r, c) = s.arc();
    if ((p - c).length() - r).abs() > EPS {
        return false;
    }
    let t = arc_param(s, p);
    t > 0.0 && t < 1.0
}

/// Where along an arc `p` is: 0 at its start, 1 at its end.
fn arc_param(s: &Seg, p: V2) -> f64 {
    let (_, c) = s.arc();
    let sweep = 4.0 * s.v1.bulge.atan();
    let a0 = (s.start().y - c.y).atan2(s.start().x - c.x);
    let a = (p.y - c.y).atan2(p.x - c.x);
    let mut d = a - a0;
    if sweep < 0.0 {
        d = -d;
    }
    d.rem_euclid(2.0 * std::f64::consts::PI) / sweep.abs()
}

fn param(s: &Seg, p: V2) -> f64 {
    if s.is_arc() {
        arc_param(s, p)
    } else {
        let d = s.end() - s.start();
        dot(p - s.start(), d) / dot(d, d)
    }
}

/// The segment cut at `points` (on it), in order, into `out`.
fn split_at(s: &Seg, points: &mut Vec<V2>, out: &mut Vec<Seg>) {
    let mut ordered: Vec<(f64, V2)> = points
        .iter()
        .filter(|p| (**p - s.start()).length() > EPS && (**p - s.end()).length() > EPS)
        .map(|p| (param(s, *p), *p))
        .filter(|(t, _)| *t > 0.0 && *t < 1.0)
        .collect();
    ordered.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let mut current = s.v1;
    let mut last = s.start();
    for (_, p) in ordered {
        if (p - last).length() <= EPS || (p - s.end()).length() <= EPS {
            continue;
        }
        let split = seg_split_at_point(current, s.v2, p, EPS);
        out.push(Seg::new(split.updated_start, p));
        current = split.split_vertex;
        last = p;
    }
    out.push(Seg {
        v1: current,
        v2: s.v2,
    });
}

/// Pieces joined at shared points, coinciding pieces kept once.
struct Graph {
    nodes: Vec<V2>,
    edges: Vec<(usize, usize, f64)>,
}

impl Graph {
    fn build(pieces: &[Seg]) -> Graph {
        let mut nodes: Vec<V2> = Vec::new();
        let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let cell = 4.0 * EPS;
        let mut node = |p: V2, nodes: &mut Vec<V2>| -> usize {
            let (gx, gy) = ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    if let Some(list) = grid.get(&(gx + dx, gy + dy)) {
                        for &n in list {
                            if (nodes[n] - p).length() <= EPS {
                                return n;
                            }
                        }
                    }
                }
            }
            nodes.push(p);
            grid.entry((gx, gy)).or_default().push(nodes.len() - 1);
            nodes.len() - 1
        };
        let mut edges: Vec<(usize, usize, f64)> = Vec::new();
        let mut between: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
        for s in pieces {
            let a = node(s.start(), &mut nodes);
            let b = node(s.end(), &mut nodes);
            if a == b {
                continue;
            }
            let seg = Seg::new(Vertex::new(nodes[a].x, nodes[a].y, s.v1.bulge), nodes[b]);
            let mid = seg.midpoint();
            let key = (a.min(b), a.max(b));
            let same = between.get(&key).is_some_and(|list| {
                list.iter().any(|&e| {
                    let (ea, eb, bulge) = edges[e];
                    let other = Seg::new(Vertex::new(nodes[ea].x, nodes[ea].y, bulge), nodes[eb]);
                    (other.midpoint() - mid).length() <= 10.0 * EPS
                })
            });
            if !same {
                between.entry(key).or_default().push(edges.len());
                edges.push((a, b, s.v1.bulge));
            }
        }
        Graph { nodes, edges }
    }

    fn seg(&self, &(a, b, bulge): &(usize, usize, f64)) -> Seg {
        Seg::new(
            Vertex::new(self.nodes[a].x, self.nodes[a].y, bulge),
            self.nodes[b],
        )
    }
}

/// How far apart (mm) the ends of pieces may be and still be joined, where
/// they don't meet exactly (see stitch).
const HEAL: f64 = 1e-2;

/// Joins directed pieces end to end into closed loops.
fn stitch(kept: &[Seg]) -> Vec<Pline> {
    // Ends meet exactly (they come from the graph's nodes), but match them
    // the same way regardless.
    let key = |p: V2| ((p.x / EPS).round() as i64, (p.y / EPS).round() as i64);
    let mut leaving: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, s) in kept.iter().enumerate() {
        leaving.entry(key(s.start())).or_default().push(i);
    }
    let mut used = vec![false; kept.len()];
    let mut loops = Vec::new();
    for first in 0..kept.len() {
        if used[first] {
            continue;
        }
        used[first] = true;
        let mut chain = vec![kept[first]];
        let start = key(kept[first].start());
        let mut closed = false;
        loop {
            let last = chain[chain.len() - 1];
            if key(last.end()) == start {
                closed = true;
                break;
            }
            let incoming = last.tangent(last.end());
            let next = leaving.get(&key(last.end())).and_then(|list| {
                list.iter().copied().filter(|&e| !used[e]).max_by(|&x, &y| {
                    let turn = |e: usize| {
                        let t = kept[e].tangent(kept[e].start());
                        cross(incoming, t).atan2(dot(incoming, t))
                    };
                    turn(x).partial_cmp(&turn(y)).unwrap()
                })
            });
            match next {
                Some(e) => {
                    used[e] = true;
                    chain.push(kept[e]);
                }
                None => {
                    // Pieces crossing at a glancing angle meet where their
                    // crossing was worked out, which can be off along them
                    // by more than EPS: carry on from the nearest end that
                    // close (or close the loop), rather than lose it.
                    let end = last.end();
                    if (end - kept[first].start()).length() <= HEAL {
                        closed = true;
                        break;
                    }
                    let nearest = (0..kept.len())
                        .filter(|&e| !used[e])
                        .map(|e| (e, (kept[e].start() - end).length()))
                        .filter(|&(_, d)| d <= HEAL)
                        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
                    match nearest {
                        Some((e, _)) => {
                            used[e] = true;
                            chain.push(kept[e]);
                        }
                        None => break,
                    }
                }
            }
        }
        if !closed {
            continue;
        }
        let pline = closed_from(&chain);
        let cleaned = pline.remove_redundant(EPS).unwrap_or(pline);
        loops.push(cleaned);
    }
    clean_loops(loops)
}

/// Sub-loops narrower than this (area over length, mm) are slivers of no
/// width: a loop's way out and back along itself.
const NO_WIDTH: f64 = 1e-5;

/**
 * Loops split where they pass a point twice (a loop pinched into two, or
 * with a spike out and back along itself), the parts of no width dropped.
 * A pinch makes CavalierContours' offsets fall back to slower ones, and a
 * spike leaves pieces too thin to classify by a hair either side of them.
 */
pub fn clean_loops(loops: Vec<Pline>) -> Vec<Pline> {
    let mut out = Vec::with_capacity(loops.len());
    for pline in loops {
        if !pline.is_closed() || pline.vertex_count() < 2 {
            continue;
        }
        for part in split_pinches(&pline) {
            let a = area(&part).abs();
            let length = segments(&part).iter().map(|s| s.length()).sum::<f64>();
            if part.vertex_count() >= 2 && a > EPS * EPS && a > NO_WIDTH * length {
                out.push(part);
            }
        }
    }
    out
}

/// A closed loop cut into loops that each pass every point once.
fn split_pinches(pline: &Pline) -> Vec<Pline> {
    let vertices: Vec<Vertex> = pline.iter_vertexes().collect();
    let cell = 4.0 * EPS;
    let key = |p: V2| ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    let mut stack: Vec<Vertex> = Vec::with_capacity(vertices.len());
    let mut parts = Vec::new();
    let find = |grid: &HashMap<(i64, i64), Vec<usize>>, stack: &[Vertex], p: V2| {
        let (gx, gy) = key(p);
        let mut best: Option<usize> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for &i in grid.get(&(gx + dx, gy + dy)).into_iter().flatten() {
                    if i < stack.len() && (stack[i].pos() - p).length() <= EPS {
                        best = Some(best.map_or(i, |b: usize| b.min(i)));
                    }
                }
            }
        }
        best
    };
    // Each vertex in turn, and the first again to close the loop.
    for (k, v) in vertices.iter().chain(vertices.first()).enumerate() {
        let closing = k == vertices.len();
        match find(&grid, &stack, v.pos()) {
            Some(i) => {
                // Back at a point already passed: what lies between is a
                // loop of its own.
                let part: Vec<Vertex> = stack.drain(i..).collect();
                if part.len() >= 2 {
                    let mut p = Pline::with_capacity(part.len(), true);
                    for w in part {
                        p.add(w.x, w.y, w.bulge);
                    }
                    parts.push(p);
                }
                if !closing {
                    stack.push(*v);
                    let n = stack.len() - 1;
                    grid.entry(key(v.pos())).or_default().push(n);
                }
            }
            None if !closing => {
                stack.push(*v);
                let n = stack.len() - 1;
                grid.entry(key(v.pos())).or_default().push(n);
            }
            None => {}
        }
    }
    if stack.len() >= 2 {
        let mut p = Pline::with_capacity(stack.len(), true);
        for w in stack {
            p.add(w.x, w.y, w.bulge);
        }
        parts.push(p);
    }
    parts
}

/// The parts of open polylines inside (or outside) a region.
pub fn clip_open(paths: &[Pline], region: &[Pline], fill: FillRule, inside: bool) -> Vec<Pline> {
    let region: Vec<Pline> = region.iter().filter(|p| p.is_closed()).cloned().collect();
    let w = Winding::new(&region);
    let mut edges: Vec<Seg> = Vec::new();
    for p in &region {
        edges.extend(segments(p));
    }
    let index = if edges.is_empty() {
        None
    } else {
        let mut builder = StaticAABB2DIndexBuilder::new(edges.len());
        for s in &edges {
            let (x0, y0, x1, y1) = s.bounds();
            builder.add(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS);
        }
        builder.build().ok()
    };
    let mut out = Vec::new();
    for path in paths {
        let mut current: Vec<Seg> = Vec::new();
        let flush = |current: &mut Vec<Seg>, out: &mut Vec<Pline>| {
            if !current.is_empty() {
                let mut pline = Pline::with_capacity(current.len() + 1, false);
                for s in current.iter() {
                    pline.add(s.v1.x, s.v1.y, s.v1.bulge);
                }
                let last = current[current.len() - 1].end();
                pline.add(last.x, last.y, 0.0);
                out.push(pline);
                current.clear();
            }
        };
        for s in segments(path) {
            let mut cuts = Vec::new();
            if let Some(index) = &index {
                let (x0, y0, x1, y1) = s.bounds();
                for j in index.query(x0 - EPS, y0 - EPS, x1 + EPS, y1 + EPS) {
                    let t = &edges[j];
                    match pline_seg_intr(s.v1, s.v2, t.v1, t.v2, EPS) {
                        PlineSegIntr::NoIntersect => {}
                        PlineSegIntr::TangentIntersect { point }
                        | PlineSegIntr::OneIntersect { point } => cuts.push(point),
                        PlineSegIntr::TwoIntersects { point1, point2 }
                        | PlineSegIntr::OverlappingLines { point1, point2 }
                        | PlineSegIntr::OverlappingArcs { point1, point2 } => {
                            cuts.push(point1);
                            cuts.push(point2);
                        }
                    }
                }
            }
            let mut pieces = Vec::new();
            split_at(&s, &mut cuts, &mut pieces);
            for piece in pieces {
                let keep = fill.filled(w.at(piece.midpoint())) == inside;
                if keep {
                    current.push(piece);
                } else {
                    flush(&mut current, &mut out);
                }
            }
        }
        // A closed path whose cut pieces run across its start: join them.
        flush(&mut current, &mut out);
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Pline {
        let mut p = Pline::with_capacity(4, true);
        p.add(x0, y0, 0.0);
        p.add(x1, y0, 0.0);
        p.add(x1, y1, 0.0);
        p.add(x0, y1, 0.0);
        p
    }

    pub fn circle(cx: f64, cy: f64, r: f64) -> Pline {
        let mut p = Pline::with_capacity(2, true);
        p.add(cx - r, cy, 1.0);
        p.add(cx + r, cy, 1.0);
        p
    }

    fn pline(points: &[(f64, f64)]) -> Pline {
        let mut p = Pline::with_capacity(points.len(), true);
        for &(x, y) in points {
            p.add(x, y, 0.0);
        }
        p
    }

    #[test]
    fn spikes_of_no_width_go() {
        // A square with a spike out of its top edge and back.
        let spiked = pline(&[
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (5.0, 10.0),
            (5.0, 13.0),
            (5.0, 10.0 + 1e-7),
            (5.0, 10.0),
            (0.0, 10.0),
        ]);
        let clean = clean_loops(vec![spiked]);
        assert_eq!(clean.len(), 1);
        assert!((area(&clean[0]) - 100.0).abs() < 1e-9);
        assert!(clean[0].iter_vertexes().all(|v| v.y <= 10.0 + EPS));
    }

    #[test]
    fn pinched_loops_come_apart() {
        // Two squares meeting at a corner, as one loop through it twice.
        let eight = pline(&[
            (0.0, 0.0),
            (5.0, 0.0),
            (5.0, 5.0),
            (10.0, 5.0),
            (10.0, 10.0),
            (5.0, 10.0),
            (5.0, 5.0),
            (0.0, 5.0),
        ]);
        let parts = clean_loops(vec![eight]);
        assert_eq!(parts.len(), 2);
        for p in &parts {
            assert!((area(p) - 25.0).abs() < 1e-9);
        }
        // Booleans come out clean the same way.
        let touching = normalize(
            &[rect(0.0, 0.0, 5.0, 5.0), rect(5.0, 5.0, 10.0, 10.0)],
            FillRule::NonZero,
        );
        assert_eq!(touching.len(), 2);
    }

    pub fn total_area(loops: &[Pline]) -> f64 {
        loops.iter().map(area).sum()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn union_of_overlapping_squares() {
        let r = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(5.0, 5.0, 15.0, 15.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(r.len(), 1);
        assert!(close(total_area(&r), 175.0), "{}", total_area(&r));
        assert_eq!(r[0].vertex_count(), 8);
    }

    #[test]
    fn intersection_difference_xor() {
        let a = [rect(0.0, 0.0, 10.0, 10.0)];
        let b = [rect(5.0, 5.0, 15.0, 15.0)];
        let i = boolean(
            &a,
            FillRule::NonZero,
            &b,
            FillRule::NonZero,
            BoolOp::Intersection,
        );
        assert!(close(total_area(&i), 25.0));
        let d = boolean(
            &a,
            FillRule::NonZero,
            &b,
            FillRule::NonZero,
            BoolOp::Difference,
        );
        assert!(close(total_area(&d), 75.0));
        let x = boolean(&a, FillRule::NonZero, &b, FillRule::NonZero, BoolOp::Xor);
        assert!(close(total_area(&x), 150.0));
        assert_eq!(x.len(), 2);
    }

    #[test]
    fn hole_from_difference_is_clockwise() {
        let r = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(3.0, 3.0, 7.0, 7.0)],
            FillRule::NonZero,
            BoolOp::Difference,
        );
        assert_eq!(r.len(), 2);
        let mut areas: Vec<f64> = r.iter().map(area).collect();
        areas.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!(
            close(areas[0], -16.0) && close(areas[1], 100.0),
            "{areas:?}"
        );
    }

    #[test]
    fn circles_stay_arcs() {
        let r = boolean(
            &[circle(0.0, 0.0, 5.0)],
            FillRule::NonZero,
            &[circle(6.0, 0.0, 5.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(r.len(), 1);
        let expected = {
            // Two circles of radius 5, centres 6 apart: lens area subtracted.
            let (r, d) = (5.0f64, 6.0f64);
            let lens =
                2.0 * r * r * (d / (2.0 * r)).acos() - d / 2.0 * (4.0 * r * r - d * d).sqrt();
            2.0 * std::f64::consts::PI * r * r - lens
        };
        assert!(
            close(total_area(&r), expected),
            "{} vs {}",
            total_area(&r),
            expected
        );
        assert!(r[0].iter_vertexes().all(|v| v.bulge != 0.0), "all arcs");
        assert!(r[0].vertex_count() <= 4);
    }

    #[test]
    fn even_odd_self_overlap() {
        // Two overlapping squares as one input: even-odd leaves the overlap out.
        let loops = [rect(0.0, 0.0, 10.0, 10.0), rect(5.0, 5.0, 15.0, 15.0)];
        let eo = normalize(&loops, FillRule::EvenOdd);
        assert!(close(total_area(&eo), 150.0));
        let nz = normalize(&loops, FillRule::NonZero);
        assert!(close(total_area(&nz), 175.0));
    }

    #[test]
    fn self_intersecting_bowtie() {
        // A figure-eight loop: two triangles of opposite winding.
        let mut p = Pline::with_capacity(4, true);
        p.add(0.0, 0.0, 0.0);
        p.add(10.0, 10.0, 0.0);
        p.add(10.0, 0.0, 0.0);
        p.add(0.0, 10.0, 0.0);
        let nz = normalize(&[p.clone()], FillRule::NonZero);
        assert_eq!(nz.len(), 2);
        assert!(close(total_area(&nz), 50.0));
        let pos = normalize(&[p], FillRule::Positive);
        assert_eq!(pos.len(), 1);
        assert!(close(total_area(&pos), 25.0));
    }

    #[test]
    fn shared_edges_and_touching_corners() {
        // Side by side, sharing an edge: one rectangle.
        let r = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(10.0, 0.0, 20.0, 10.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(r.len(), 1);
        assert!(close(total_area(&r), 200.0));
        assert_eq!(r[0].vertex_count(), 4, "collinear points merged");
        // Corner to corner: two loops, not a figure eight.
        let t = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(10.0, 10.0, 20.0, 20.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(t.len(), 2);
        assert!(close(total_area(&t), 200.0));
        // Identical: union is the same square; difference empty.
        let s = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(s.len(), 1);
        assert!(close(total_area(&s), 100.0));
        let e = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            BoolOp::Difference,
        );
        assert!(e.is_empty());
    }

    #[test]
    fn t_junction_and_contained() {
        // B's corner touches A's edge from outside.
        let r = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(3.0, 10.0, 6.0, 13.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(r.len(), 1);
        assert!(close(total_area(&r), 109.0));
        // B inside A, no crossings.
        let c = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[circle(5.0, 5.0, 2.0)],
            FillRule::NonZero,
            BoolOp::Union,
        );
        assert_eq!(c.len(), 1);
        assert!(close(total_area(&c), 100.0));
    }

    #[test]
    fn many_overlapping_circles() {
        let circles: Vec<Pline> = (0..20)
            .map(|i| circle(i as f64 * 1.5, (i % 2) as f64, 1.0))
            .collect();
        let r = normalize(&circles, FillRule::NonZero);
        assert_eq!(
            r.len(),
            1,
            "{:?}",
            r.iter()
                .map(|p| (area(p), p.vertex_count(), p.at(0).pos()))
                .collect::<Vec<_>>()
        );
        assert!(total_area(&r) > 0.0);
        assert!(r.iter().all(|p| area(p) > 0.0));
    }

    #[test]
    fn clip_open_line_through_square_with_hole() {
        let region = boolean(
            &[rect(0.0, 0.0, 10.0, 10.0)],
            FillRule::NonZero,
            &[rect(4.0, 0.0 + 4.0, 6.0, 6.0)],
            FillRule::NonZero,
            BoolOp::Difference,
        );
        let mut line = Pline::with_capacity(2, false);
        line.add(-5.0, 5.0, 0.0);
        line.add(15.0, 5.0, 0.0);
        let inside = clip_open(&[line.clone()], &region, FillRule::NonZero, true);
        assert_eq!(inside.len(), 2);
        let lengths: f64 = inside.iter().map(|p| p.path_length()).sum();
        assert!(close(lengths, 8.0), "{lengths}");
        let outside = clip_open(&[line], &region, FillRule::NonZero, false);
        let lengths: f64 = outside.iter().map(|p| p.path_length()).sum();
        assert!(close(lengths, 12.0), "{lengths}");
    }
}
