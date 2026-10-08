use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut, Polyline};
use cnc_kernel::offset::offset_region;

fn pline(points: &[(f64, f64)]) -> Polyline<f64> {
    let mut p = Polyline::with_capacity(points.len(), true);
    for &(x, y) in points {
        p.add(x, y, 0.0);
    }
    p
}

/// What's left of a region that failed to shrink (where a 45° image
/// engraving left the surface deep enough to clear, outlined off a
/// heightmap) once everything that didn't matter to the failure was taken
/// away: two slivers touching at a point, and a small diamond. Shrinking it
/// sweeps the pieces, and stitching their remains made loops of no width —
/// one piece healed onto itself — which CavalierContours' remove_redundant
/// took down to nothing and then indexed past the end of (a panic, so a
/// trap in WebAssembly).
#[test]
fn shrinking_slivers_does_not_panic() {
    let region = vec![
        pline(&[
            (-15.849088371330229, 16.07888463947062),
            (-15.849088371330229, 16.035325902249514),
            (-15.94063093538722, 16.049702589470975),
        ]),
        pline(&[
            (-15.94063093538722, 16.049702589470975),
            (-15.941556596526768, 16.052820677213493),
            (-15.948329409075779, 16.05091162866977),
        ]),
        pline(&[
            (-5.978834055013873, -20.64908837133023),
            (-5.94908837133023, -20.667121766543158),
            (-5.920988628833555, -20.64908837133023),
            (-5.94908837133023, -20.599964561361965),
        ]),
    ];
    let shrunk = offset_region(&region, -0.0957);
    // Every loop given back encloses something.
    assert!(shrunk
        .iter()
        .all(|p| p.vertex_count() >= 2 && p.area().abs() > 1e-9));
}
