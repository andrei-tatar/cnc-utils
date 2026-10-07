//! Shared vocabulary: polylines of lines and arcs (CavalierContours'
//! `Polyline<f64>`, each vertex's bulge describing the segment to the next:
//! `bulge = tan(sweep / 4)`, positive counter-clockwise), and small helpers.

pub use cavalier_contours::core::math::Vector2;
use cavalier_contours::polyline::{
    seg_arc_radius_and_center, seg_bounding_box, seg_length, seg_midpoint, seg_tangent_vector,
    PlineCreation, PlineSource, PlineSourceMut, PlineVertex, Polyline,
};

pub type V2 = Vector2<f64>;
pub type Pline = Polyline<f64>;
pub type Vertex = PlineVertex<f64>;

/// Positions closer than this (mm) are the same point.
pub const EPS: f64 = 1e-6;

/// One segment of a polyline: from `v1` (whose bulge shapes it) to `v2`.
#[derive(Debug, Clone, Copy)]
pub struct Seg {
    pub v1: Vertex,
    pub v2: Vertex,
}

impl Seg {
    pub fn new(v1: Vertex, end: V2) -> Seg {
        Seg {
            v1,
            v2: Vertex::new(end.x, end.y, 0.0),
        }
    }

    pub fn start(&self) -> V2 {
        self.v1.pos()
    }

    pub fn end(&self) -> V2 {
        self.v2.pos()
    }

    pub fn is_arc(&self) -> bool {
        self.v1.bulge != 0.0
    }

    pub fn length(&self) -> f64 {
        seg_length(self.v1, self.v2)
    }

    pub fn midpoint(&self) -> V2 {
        seg_midpoint(self.v1, self.v2)
    }

    pub fn bounds(&self) -> (f64, f64, f64, f64) {
        let b = seg_bounding_box(self.v1, self.v2);
        (b.min_x, b.min_y, b.max_x, b.max_y)
    }

    /// Unit direction of travel at `point` (on the segment).
    pub fn tangent(&self, point: V2) -> V2 {
        let t = seg_tangent_vector(self.v1, self.v2, point);
        let l = t.length();
        if l > 0.0 {
            t.scale(1.0 / l)
        } else {
            t
        }
    }

    /// (radius, center) of an arc segment.
    pub fn arc(&self) -> (f64, V2) {
        seg_arc_radius_and_center(self.v1, self.v2)
    }

    /// The same segment travelled the other way.
    pub fn reversed(&self) -> Seg {
        Seg {
            v1: Vertex::new(self.v2.x, self.v2.y, -self.v1.bulge),
            v2: Vertex::new(self.v1.x, self.v1.y, 0.0),
        }
    }
}

/// The segments of a polyline (closing segment included when closed),
/// skipping ones that have no length. Arcs of more than half a turn come
/// as two halves: CavalierContours' segment functions (intersections,
/// closest points) can get those wrong.
pub fn segments(pline: &Pline) -> Vec<Seg> {
    let n = pline.vertex_count();
    let count = if pline.is_closed() {
        n
    } else {
        n.saturating_sub(1)
    };
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let v1 = pline.at(i);
        let v2 = pline.at((i + 1) % n);
        if (v2.pos() - v1.pos()).length() > EPS {
            if v1.bulge.abs() > 1.0 {
                // Half the sweep each: tan(sweep / 8).
                let half = (v1.bulge.atan() / 2.0).tan();
                // The arc's middle: the sagitta (bulge × half the chord) off
                // the chord's middle, to its right (worked out here, as
                // seg_midpoint is one of those functions).
                let chord = v2.pos() - v1.pos();
                let right = V2::new(chord.y, -chord.x);
                let mid = (v1.pos() + v2.pos()).scale(0.5) + right.scale(v1.bulge / 2.0);
                out.push(Seg::new(Vertex::new(v1.x, v1.y, half), mid));
                out.push(Seg::new(Vertex::new(mid.x, mid.y, half), v2.pos()));
            } else {
                out.push(Seg { v1, v2 });
            }
        }
    }
    out
}

/// A closed polyline from segments that follow each other.
pub fn closed_from(segs: &[Seg]) -> Pline {
    let mut pline = Pline::with_capacity(segs.len(), true);
    for s in segs {
        pline.add(s.v1.x, s.v1.y, s.v1.bulge);
    }
    pline
}

pub fn cross(a: V2, b: V2) -> f64 {
    a.x * b.y - a.y * b.x
}

pub fn dot(a: V2, b: V2) -> f64 {
    a.x * b.x + a.y * b.y
}

/// Signed area (positive counter-clockwise), arcs included.
pub fn area(pline: &Pline) -> f64 {
    if !pline.is_closed() || pline.vertex_count() < 2 {
        return 0.0;
    }
    pline.area()
}
