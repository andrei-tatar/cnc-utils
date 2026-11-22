import { CamPath, CamPoint3 } from './types';

/**
 * A program's G-code line by line, with where each line's move goes in the
 * preview (see `GCodeBuilder.toListing`): what links the text to the
 * toolpaths drawn.
 */
export type GcodeListing = {
  /** The G-code's lines, as `GCodeBuilder.build` writes them. */
  lines: string[];
  /**
   * The points the tool passes, x y z each, in the preview's coordinates
   * (the design's; in its frame for a run with the stock turned).
   */
  points: Float32Array;
  /**
   * Per line: the point (its index) its move starts from, -1 for a line
   * that moves nothing. The move goes through the points up to `ends`.
   */
  starts: Int32Array;
  /** Per line: the point the tool is at after it (-1 before any move). */
  ends: Int32Array;
  /** Per line: the operation it belongs to, an index into `operations`. */
  operationOf: Uint16Array;
  /** Operation ids ('' for lines belonging to none). */
  operations: string[];
  /** The points in runs sharing a frame, in order: each starts afresh. */
  runs: ListingRun[];
};

/** Points in one frame (as `CamPath`'s `rotation`, `wrapped`, `flip`). */
export type ListingRun = {
  /** Its first point's index. */
  start: number;
  rotation?: number;
  wrapped?: boolean;
  flip?: 'x' | 'y';
};

/** A stretch of a program belonging to one operation ('' for none). */
export type ListingSection = {
  operationId: string;
  /** Its first and last line (from 0). */
  first: number;
  last: number;
};

/** The run point `index` is in. */
export function runOf(listing: GcodeListing, index: number): ListingRun {
  const { runs } = listing;
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (runs[middle].start <= index) low = middle;
    else high = middle - 1;
  }
  return runs[low];
}

function pointAt(listing: GcodeListing, index: number): CamPoint3 {
  const { points } = listing;
  return {
    x: points[index * 3],
    y: points[index * 3 + 1],
    z: points[index * 3 + 2],
  };
}

function pathOf(listing: GcodeListing, from: number, to: number): CamPath {
  const run = runOf(listing, from);
  const points: CamPoint3[] = [];
  for (let k = from; k <= to; k++) points.push(pointAt(listing, k));
  const path: CamPath = { sourceShapeId: '', type: 'carve', points };
  if (run.rotation !== undefined) path.rotation = run.rotation;
  if (run.wrapped) path.wrapped = true;
  if (run.flip) path.flip = run.flip;
  return path;
}

/**
 * The moves lines `first` to `last` (from 0, both included) make, as paths
 * for the preview: lines whose moves follow one another join into one.
 */
export function listingPaths(
  listing: GcodeListing,
  first: number,
  last: number,
): CamPath[] {
  const paths: CamPath[] = [];
  let from = -1;
  let to = -1;
  const from0 = Math.max(0, first);
  const to0 = Math.min(listing.lines.length - 1, last);
  for (let line = from0; line <= to0; line++) {
    const start = listing.starts[line];
    if (start < 0) continue;
    if (start !== to) {
      if (from >= 0) paths.push(pathOf(listing, from, to));
      from = start;
    }
    to = listing.ends[line];
  }
  if (from >= 0) paths.push(pathOf(listing, from, to));
  return paths;
}

/**
 * Where the tool is once `line` has run, as a path of that one point (null
 * before the program's first move).
 */
export function listingTip(
  listing: GcodeListing,
  line: number,
): CamPath | null {
  const at =
    listing.ends[Math.max(0, Math.min(listing.lines.length - 1, line))];
  return at === undefined || at < 0 ? null : pathOf(listing, at, at);
}

/** Per point, the line whose move reaches it (-1: where a run starts). */
export function linesOfPoints(listing: GcodeListing): Int32Array {
  const lines = new Int32Array(listing.points.length / 3).fill(-1);
  for (let line = 0; line < listing.starts.length; line++) {
    const start = listing.starts[line];
    if (start < 0) continue;
    for (let k = start + 1; k <= listing.ends[line]; k++) lines[k] = line;
  }
  return lines;
}

/** The program's stretches by operation, in order. */
export function listingSections(listing: GcodeListing): ListingSection[] {
  const sections: ListingSection[] = [];
  const { operationOf, operations } = listing;
  for (let line = 0; line < operationOf.length; line++) {
    const operationId = operations[operationOf[line]];
    const current = sections[sections.length - 1];
    if (current && current.operationId === operationId) {
      current.last = line;
    } else {
      sections.push({ operationId, first: line, last: line });
    }
  }
  return sections;
}
