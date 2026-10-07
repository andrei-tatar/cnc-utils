//! The WebAssembly interface: plain C functions over linear memory.
//!
//! Polylines travel as `f64` arrays: the number of polylines, then for each
//! its vertex count, 1 if closed (else 0), and x, y, bulge per vertex. The
//! caller writes input into buffers from `kernel_alloc`, calls a function,
//! which returns the length of its result, and reads the result from
//! `kernel_result`. Results stay until the next call.

use crate::geom::Pline;
use crate::offset::{inflate, offset_region, End, Join};
use crate::region::{boolean, clip_open, normalize, BoolOp, FillRule};
use cavalier_contours::polyline::{PlineCreation, PlineSource, PlineSourceMut};
use std::cell::RefCell;

thread_local! {
    static RESULT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}

/// Room for `count` f64s, for the caller to fill.
#[no_mangle]
pub extern "C" fn kernel_alloc(count: usize) -> *mut f64 {
    let mut buffer = vec![0.0f64; count];
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Frees a buffer from `kernel_alloc`.
///
/// # Safety
/// `ptr` and `count` must be exactly what `kernel_alloc` gave and took.
#[no_mangle]
pub unsafe extern "C" fn kernel_free(ptr: *mut f64, count: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, count, count));
    }
}

/// Where the last result is.
#[no_mangle]
pub extern "C" fn kernel_result() -> *const f64 {
    RESULT.with(|r| r.borrow().as_ptr())
}

pub fn decode(data: &[f64]) -> Vec<Pline> {
    let mut out = Vec::new();
    if data.is_empty() {
        return out;
    }
    let count = data[0] as usize;
    let mut at = 1;
    for _ in 0..count {
        let n = data[at] as usize;
        let closed = data[at + 1] != 0.0;
        at += 2;
        let mut pline = Pline::with_capacity(n, closed);
        for _ in 0..n {
            pline.add(data[at], data[at + 1], data[at + 2]);
            at += 3;
        }
        out.push(pline);
    }
    out
}

pub fn encode(plines: &[Pline]) -> Vec<f64> {
    let mut out = vec![plines.len() as f64];
    for p in plines {
        out.push(p.vertex_count() as f64);
        out.push(if p.is_closed() { 1.0 } else { 0.0 });
        for v in p.iter_vertexes() {
            out.extend_from_slice(&[v.x, v.y, v.bulge]);
        }
    }
    out
}

/// # Safety
/// `ptr` must point at `len` f64s.
unsafe fn input(ptr: *const f64, len: usize) -> Vec<Pline> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    decode(std::slice::from_raw_parts(ptr, len))
}

fn answer(plines: Vec<Pline>) -> usize {
    let data = encode(&plines);
    let len = data.len();
    RESULT.with(|r| *r.borrow_mut() = data);
    len
}

/// `a` combined with `b`: op 0 union, 1 intersection, 2 difference, 3 xor;
/// fill rules 0 even-odd, 1 non-zero, 2 positive, 3 negative.
///
/// # Safety
/// The pointers must point at their lengths of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_boolean(
    a: *const f64,
    a_len: usize,
    fill_a: u32,
    b: *const f64,
    b_len: usize,
    fill_b: u32,
    op: u32,
) -> usize {
    answer(boolean(
        &input(a, a_len),
        FillRule::from_code(fill_a),
        &input(b, b_len),
        FillRule::from_code(fill_b),
        BoolOp::from_code(op),
    ))
}

/// The loops as a clean region under `fill`.
///
/// # Safety
/// The pointer must point at its length of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_normalize(a: *const f64, a_len: usize, fill: u32) -> usize {
    answer(normalize(&input(a, a_len), FillRule::from_code(fill)))
}

/// A clean region grown by `delta` (shrunk when negative), corners round.
///
/// # Safety
/// The pointer must point at its length of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_offset_region(a: *const f64, a_len: usize, delta: f64) -> usize {
    answer(offset_region(&input(a, a_len), delta))
}

/// Paths inflated: join 0 round, 1 miter, 2 square; end 0 polygon, 1
/// joined, 2 butt, 3 square, 4 round.
///
/// # Safety
/// The pointer must point at its length of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_inflate(
    a: *const f64,
    a_len: usize,
    delta: f64,
    join: u32,
    end: u32,
    miter_limit: f64,
    arc_tolerance: f64,
) -> usize {
    answer(inflate(
        &input(a, a_len),
        delta,
        Join::from_code(join),
        End::from_code(end),
        miter_limit,
        arc_tolerance,
    ))
}

/// The parts of open paths inside (`inside` 1) or outside a region.
///
/// # Safety
/// The pointers must point at their lengths of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_clip_open(
    paths: *const f64,
    paths_len: usize,
    region: *const f64,
    region_len: usize,
    fill: u32,
    inside: u32,
) -> usize {
    answer(clip_open(
        &input(paths, paths_len),
        &input(region, region_len),
        FillRule::from_code(fill),
        inside != 0,
    ))
}

/// One polyline offset to its left by `delta` (right when negative), open
/// or closed: CavalierContours' parallel offset.
///
/// # Safety
/// The pointer must point at its length of f64s.
#[no_mangle]
pub unsafe extern "C" fn kernel_pline_offset(a: *const f64, a_len: usize, delta: f64) -> usize {
    let plines = input(a, a_len);
    let mut out = Vec::new();
    for p in plines.iter().filter(|p| p.vertex_count() > 1) {
        out.extend(p.parallel_offset(delta));
    }
    answer(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::region::tests::{circle, rect};

    #[test]
    fn round_trip() {
        let plines = vec![rect(0.0, 0.0, 1.0, 2.0), circle(5.0, 5.0, 1.0)];
        let back = decode(&encode(&plines));
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].vertex_count(), 4);
        assert!(back[1].at(0).bulge == 1.0 && back[1].is_closed());
    }

    #[test]
    fn boolean_through_buffers() {
        let a = encode(&[rect(0.0, 0.0, 10.0, 10.0)]);
        let b = encode(&[rect(5.0, 5.0, 15.0, 15.0)]);
        let len = unsafe { kernel_boolean(a.as_ptr(), a.len(), 1, b.as_ptr(), b.len(), 1, 0) };
        let out = unsafe { std::slice::from_raw_parts(kernel_result(), len) }.to_vec();
        let r = decode(&out);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].vertex_count(), 8);
    }
}
