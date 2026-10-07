use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut, Polyline};
use cnc_kernel::offset::{inflate, offset_by_pieces, offset_region, End, Join};
use cnc_kernel::region::{normalize, FillRule};

fn pline(points: &[(f64, f64, f64)]) -> Polyline<f64> {
    let mut p = Polyline::with_capacity(points.len(), true);
    for &(x, y, b) in points {
        p.add(x, y, b);
    }
    p
}

#[test]
fn boolean_output_with_a_pinched_hole() {
    let t = 11.1803398875;
    let loops = vec![
        pline(&[
            (10.0, t, -0.0278),
            (t, 10.0, 0.0),
            (8.8196601125, 10.0, -0.0278),
        ]),
        pline(&[
            (15.0, 0.0, -0.2134),
            (10.0, -t, 0.382),
            (30.0, -t, -0.2134),
            (25.0, 0.0, 0.0),
            (35.0, 0.0, -0.2134),
            (30.0, -t, 0.6482),
            (55.0, 0.0, 0.0),
            (60.0, 0.0, 0.0),
            (60.0, 10.0, 0.0),
            (51.1803398875, 10.0, 0.4142),
            (30.0, t, -0.0278),
            (31.1803398875, 10.0, 0.0),
            (28.8196601125, 10.0, -0.0278),
            (30.0, t, 0.382),
            (10.0, t, 0.6482),
            (-15.0, 0.0, 0.6482),
            (10.0, -t, -0.2134),
            (5.0, 0.0, 0.0),
        ]),
    ];
    let region = normalize(&loops, FillRule::Positive);
    eprintln!(
        "region {:?}",
        region
            .iter()
            .map(|p| (p.vertex_count(), p.area()))
            .collect::<Vec<_>>()
    );
    let pieces = offset_by_pieces(&region, 3.0);
    eprintln!(
        "pieces {:?}",
        pieces
            .iter()
            .map(|p| (p.vertex_count(), p.area()))
            .collect::<Vec<_>>()
    );
    let cavc = offset_region(&region, 3.0);
    eprintln!(
        "offset_region {:?}",
        cavc.iter()
            .map(|p| (p.vertex_count(), p.area()))
            .collect::<Vec<_>>()
    );
    let inflated = inflate(&loops, 3.0, Join::Round, End::Polygon, 2.0, 0.0);
    eprintln!(
        "inflate {:?}",
        inflated
            .iter()
            .map(|p| (p.vertex_count(), p.area()))
            .collect::<Vec<_>>()
    );
    assert!(!inflated.is_empty());
}
