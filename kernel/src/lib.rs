//! Geometry for cnc-utils, over polylines of lines and arcs: region
//! booleans (`region`), offsets (`offset`), winding numbers (`winding`),
//! exported to WebAssembly (`ffi`).

pub mod ffi;
pub mod geom;
pub mod offset;
pub mod region;
pub mod winding;
