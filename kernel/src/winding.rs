//! Exact winding numbers for sets of closed polylines with arcs.
//!
//! A horizontal ray from the point to +x counts the loops' crossings, each
//! segment taken as pieces monotone in y (arcs split at their top and
//! bottom), half-open in y so that a crossing at a shared vertex counts
//! once. No tolerance: a point a hair's breadth off an edge is classified
//! by which side it's on, which is what the boolean classification needs.

use crate::geom::{cross, segments, Pline, Seg, V2};
use cavalier_contours::polyline::PlineSource;
use std::f64::consts::PI;

/// A piece of a segment monotone in y, from `a` to `b`.
#[derive(Debug, Clone, Copy)]
struct Piece {
    a: V2,
    b: V2,
    /// For an arc piece: its circle, and which half (x ≥ cx or not).
    arc: Option<(V2, f64, bool)>,
}

impl Piece {
    fn min_y(&self) -> f64 {
        self.a.y.min(self.b.y)
    }
    fn max_y(&self) -> f64 {
        self.a.y.max(self.b.y)
    }

    /// +1 / -1 when the ray from `p` crosses it going up / down, else 0.
    fn crossing(&self, p: V2) -> i32 {
        let up = self.a.y <= p.y && p.y < self.b.y;
        let down = self.b.y <= p.y && p.y < self.a.y;
        if !up && !down {
            return 0;
        }
        let right_of_p = match self.arc {
            None => {
                // p is left of the upward edge, or right of the downward one.
                let side = cross(self.b - self.a, p - self.a);
                if up {
                    side > 0.0
                } else {
                    side < 0.0
                }
            }
            Some((c, r, right_half)) => {
                let dy = p.y - c.y;
                let dx = (r * r - dy * dy).max(0.0).sqrt();
                let x = if right_half { c.x + dx } else { c.x - dx };
                x > p.x
            }
        };
        if !right_of_p {
            0
        } else if up {
            1
        } else {
            -1
        }
    }
}

fn pieces_of(seg: &Seg, out: &mut Vec<Piece>) {
    if !seg.is_arc() {
        if seg.start().y != seg.end().y {
            out.push(Piece {
                a: seg.start(),
                b: seg.end(),
                arc: None,
            });
        }
        return;
    }
    let (r, c) = seg.arc();
    let sweep = 4.0 * seg.v1.bulge.atan();
    let start = (seg.start().y - c.y).atan2(seg.start().x - c.x);
    // Angles (along the sweep, from the start) where the arc turns in y.
    let mut cuts: Vec<f64> = Vec::new();
    for extreme in [PI / 2.0, -PI / 2.0] {
        let mut d = extreme - start;
        // Measured in the sweep's direction, in [0, 2π).
        if sweep < 0.0 {
            d = -d;
        }
        d = d.rem_euclid(2.0 * PI);
        if d > 1e-12 && d < sweep.abs() - 1e-12 {
            cuts.push(d);
        }
    }
    cuts.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let point_at = |d: f64| -> V2 {
        let angle = start + d * sweep.signum();
        V2::new(c.x + r * angle.cos(), c.y + r * angle.sin())
    };
    let mut from = 0.0;
    let mut a = seg.start();
    for i in 0..=cuts.len() {
        let to = if i < cuts.len() { cuts[i] } else { sweep.abs() };
        let b = if i < cuts.len() {
            point_at(to)
        } else {
            seg.end()
        };
        let mid = start + (from + to) / 2.0 * sweep.signum();
        if a.y != b.y {
            out.push(Piece {
                a,
                b,
                arc: Some((c, r, mid.cos() >= 0.0)),
            });
        }
        from = to;
        a = b;
    }
}

/// Winding numbers against a set of closed loops, indexed by y bands.
pub struct Winding {
    pieces: Vec<Piece>,
    bands: Vec<Vec<u32>>,
    min_y: f64,
    band_height: f64,
}

impl Winding {
    pub fn new(loops: &[Pline]) -> Winding {
        let mut pieces = Vec::new();
        for pline in loops.iter().filter(|p| p.is_closed()) {
            for seg in segments(pline) {
                pieces_of(&seg, &mut pieces);
            }
        }
        let min_y = pieces
            .iter()
            .map(|p| p.min_y())
            .fold(f64::INFINITY, f64::min);
        let max_y = pieces
            .iter()
            .map(|p| p.max_y())
            .fold(f64::NEG_INFINITY, f64::max);
        let count = ((pieces.len() as f64).sqrt().ceil() as usize).clamp(1, 4096);
        let band_height = if max_y > min_y {
            (max_y - min_y) / count as f64
        } else {
            1.0
        };
        let mut bands = vec![Vec::new(); count];
        for (i, piece) in pieces.iter().enumerate() {
            let lo = (((piece.min_y() - min_y) / band_height).floor() as isize)
                .clamp(0, count as isize - 1);
            let hi = (((piece.max_y() - min_y) / band_height).floor() as isize)
                .clamp(0, count as isize - 1);
            for band in lo..=hi {
                bands[band as usize].push(i as u32);
            }
        }
        Winding {
            pieces,
            bands,
            min_y,
            band_height,
        }
    }

    pub fn at(&self, p: V2) -> i32 {
        if self.pieces.is_empty() || !p.y.is_finite() {
            return 0;
        }
        let band = ((p.y - self.min_y) / self.band_height).floor();
        if band < 0.0 || band >= self.bands.len() as f64 {
            return 0;
        }
        self.bands[band as usize]
            .iter()
            .map(|&i| self.pieces[i as usize].crossing(p))
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[allow(unused_imports)]
    use cavalier_contours::polyline::PlineSource as _;
    use cavalier_contours::polyline::{PlineCreation, PlineSourceMut};

    fn square(x: f64, y: f64, size: f64, ccw: bool) -> Pline {
        let mut p = Pline::with_capacity(4, true);
        let pts = [(x, y), (x + size, y), (x + size, y + size), (x, y + size)];
        if ccw {
            for (a, b) in pts {
                p.add(a, b, 0.0);
            }
        } else {
            for (a, b) in pts.iter().rev() {
                p.add(*a, *b, 0.0);
            }
        }
        p
    }

    fn circle(cx: f64, cy: f64, r: f64, ccw: bool) -> Pline {
        let b = if ccw { 1.0 } else { -1.0 };
        let mut p = Pline::with_capacity(2, true);
        p.add(cx - r, cy, b);
        p.add(cx + r, cy, b);
        p
    }

    #[test]
    fn square_inside_and_outside() {
        let w = Winding::new(&[square(0.0, 0.0, 10.0, true)]);
        assert_eq!(w.at(V2::new(5.0, 5.0)), 1);
        assert_eq!(w.at(V2::new(15.0, 5.0)), 0);
        assert_eq!(w.at(V2::new(-1.0, 5.0)), 0);
        assert_eq!(w.at(V2::new(5.0, 11.0)), 0);
        // Ray through a vertex's height counts once.
        assert_eq!(w.at(V2::new(5.0, 0.0 + 1e-12)), 1);
        let cw = Winding::new(&[square(0.0, 0.0, 10.0, false)]);
        assert_eq!(cw.at(V2::new(5.0, 5.0)), -1);
    }

    #[test]
    fn circle_with_arcs() {
        let w = Winding::new(&[circle(0.0, 0.0, 5.0, true)]);
        assert_eq!(w.at(V2::new(0.0, 0.0)), 1);
        assert_eq!(w.at(V2::new(4.99, 0.0)), 1);
        assert_eq!(w.at(V2::new(5.01, 0.0)), 0);
        assert_eq!(w.at(V2::new(3.0, 3.99)), 1);
        assert_eq!(w.at(V2::new(3.0, 4.01)), 0);
        // Exactly at the top and bottom heights.
        assert_eq!(w.at(V2::new(0.0, 4.999999)), 1);
        assert_eq!(w.at(V2::new(0.0, -4.999999)), 1);
        assert_eq!(w.at(V2::new(-3.0, -3.99)), 1);
        assert_eq!(w.at(V2::new(-3.0, -4.01)), 0);
        let cw = Winding::new(&[circle(0.0, 0.0, 5.0, false)]);
        assert_eq!(cw.at(V2::new(1.0, 1.0)), -1);
    }

    #[test]
    fn nested_loops_add_up() {
        let w = Winding::new(&[
            square(0.0, 0.0, 10.0, true),
            square(2.0, 2.0, 6.0, false),
            circle(5.0, 5.0, 1.0, true),
        ]);
        assert_eq!(w.at(V2::new(1.0, 1.0)), 1);
        assert_eq!(w.at(V2::new(3.0, 3.0)), 0);
        assert_eq!(w.at(V2::new(5.0, 5.0)), 1);
    }

    #[test]
    fn half_disk_arcs_both_ways() {
        // A half disk: line along the diameter, arc over the top.
        let mut p = Pline::with_capacity(2, true);
        p.add(-5.0, 0.0, 0.0);
        p.add(5.0, 0.0, 1.0); // arc counter-clockwise from (5,0) over the top to (-5,0)
        let w = Winding::new(&[p]);
        assert_eq!(w.at(V2::new(0.0, 2.0)), 1);
        assert_eq!(w.at(V2::new(0.0, -2.0)), 0);
        assert_eq!(w.at(V2::new(4.0, 2.0)), 1);
        assert_eq!(w.at(V2::new(4.9, 2.0)), 0);
    }
}
