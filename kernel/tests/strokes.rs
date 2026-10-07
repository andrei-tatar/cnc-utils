use cavalier_contours::core::math::Vector2;
use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut, Polyline};
use cnc_kernel::offset::{round_strokes, stroke_by_pieces, End, Join};
use cnc_kernel::winding::Winding;

/// A small deterministic generator (xorshift), for repeatable cases.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next()
    }
}

/// Distance from `p` to the segment from `a` (with its bulge) to `b`: arcs
/// of any sweep.
fn segment_distance(a: (f64, f64, f64), b: (f64, f64), p: Vector2<f64>) -> f64 {
    let ends = (p.x - a.0)
        .hypot(p.y - a.1)
        .min((p.x - b.0).hypot(p.y - b.1));
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    if a.2 == 0.0 {
        let t = (((p.x - a.0) * dx + (p.y - a.1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
        return (p.x - a.0 - dx * t).hypot(p.y - a.1 - dy * t);
    }
    let sweep = 4.0 * a.2.atan();
    let chord = dx.hypot(dy);
    let r = chord / (2.0 * (sweep / 2.0).sin().abs());
    let h = chord / 2.0 / (sweep / 2.0).tan();
    let (cx, cy) = (
        (a.0 + b.0) / 2.0 - dy / chord * h,
        (a.1 + b.1) / 2.0 + dx / chord * h,
    );
    let from = (a.1 - cy).atan2(a.0 - cx);
    let at = (p.y - cy).atan2(p.x - cx);
    let along = ((at - from) * sweep.signum()).rem_euclid(2.0 * std::f64::consts::PI);
    if along <= sweep.abs() {
        ends.min(((p.x - cx).hypot(p.y - cy) - r).abs())
    } else {
        ends
    }
}

/// Round strokes — built from each path's outline, or by sweeping each
/// segment's band, joins and ends — cover exactly the points within `d` of
/// the paths: lines and arcs, arcs tighter than the stroke and
/// over half a turn, turns back on themselves, paths crossing — checked on a
/// grid against the distance to the paths (points a hair from the edge left
/// out).
#[test]
fn round_strokes_cover_what_is_within_reach() {
    let mut rng = Rng(0x9e3779b97f4a7c15);
    for case in 0..200 {
        let mut paths = Vec::new();
        for _ in 0..(1 + case % 3) {
            let n = 2 + (rng.next() * 6.0) as usize;
            let mut p = Polyline::with_capacity(n, false);
            for _ in 0..n {
                let bulge = if rng.next() < 0.5 {
                    0.0
                } else {
                    rng.range(-1.5, 1.5)
                };
                p.add(rng.range(0.0, 10.0), rng.range(0.0, 10.0), bulge);
            }
            paths.push(p);
        }
        let d = [0.3, 1.0, 3.0][case % 3];
        let stroke = Winding::new(&round_strokes(&paths, d));
        let pieces = Winding::new(&stroke_by_pieces(
            &paths,
            d,
            Join::Round,
            End::Round,
            2.0,
            0.0,
        ));
        let steps = 120;
        for i in 0..=steps {
            for j in 0..=steps {
                let p = Vector2::new(
                    -3.5 + 17.0 * i as f64 / steps as f64,
                    -3.5 + 17.0 * j as f64 / steps as f64,
                );
                let mut distance = f64::INFINITY;
                for path in &paths {
                    for k in 0..path.vertex_count() - 1 {
                        let (v, w) = (path.at(k), path.at(k + 1));
                        distance =
                            distance.min(segment_distance((v.x, v.y, v.bulge), (w.x, w.y), p));
                    }
                }
                if (distance - d).abs() < 1e-6 {
                    continue;
                }
                assert_eq!(
                    pieces.at(p) != 0,
                    distance < d,
                    "pieces: case {case} at {:?}: {distance} from the paths, stroke {d}",
                    (p.x, p.y)
                );
                assert_eq!(
                    stroke.at(p) != 0,
                    distance < d,
                    "case {case} at {:?}: {distance} from the paths, stroke {d}",
                    (p.x, p.y)
                );
            }
        }
    }
}

fn area(loops: &[Polyline<f64>]) -> f64 {
    loops.iter().map(|p| p.area()).sum()
}

/// A lone point strokes to a disk; a path doubling back on itself, to a
/// stadium either way.
#[test]
fn round_strokes_of_points_and_reversals() {
    let mut point = Polyline::with_capacity(1, false);
    point.add(1.0, 1.0, 0.0);
    let disk = round_strokes(&[point], 2.0);
    assert!((area(&disk) - 4.0 * std::f64::consts::PI).abs() < 1e-9);
    let mut back = Polyline::with_capacity(3, false);
    back.add(0.0, 0.0, 0.0);
    back.add(10.0, 0.0, 0.0);
    back.add(5.0, 0.0, 0.0);
    let stadium = round_strokes(&[back], 1.0);
    assert!((area(&stadium) - (20.0 + std::f64::consts::PI)).abs() < 1e-9);
}
