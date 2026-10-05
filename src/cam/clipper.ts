import type { MainModule, PathD, PathsD } from 'clipper2-wasm/dist/clipper2z';
import { CamPoint } from './types';
import { lazy } from '../util';
import { version as clipperVersion } from 'clipper2-wasm/package.json';

type ClipperJoinType = 'miter' | 'square' | 'round';
type ClipperEndType = 'polygon' | 'joined' | 'butt' | 'square' | 'round';
export type ClipperClipType = 'intersection' | 'union' | 'difference' | 'xor';
export type ClipperFillRule = 'even-odd' | 'non-zero' | 'positive' | 'negative';

export async function clipperBooleanOperation(
  a: PathsD,
  b: PathsD,
  clipType: ClipperClipType,
  fillRule: ClipperFillRule,
  /** Decimal places to work to. */
  decimals: number,
) {
  const { BooleanOpD, ClipType, PathsD, FillRule } = await ClipperModule.value;

  const result = BooleanOpD(
    getClipType(clipType, ClipType),
    getFillRule(fillRule, FillRule),
    a,
    b,
    decimals,
  );

  return result;
}

export async function clipperInflateRaw(
  paths: PathsD,
  offset: number,
  joinType: 'miter' | 'square' | 'round',
  endType: 'polygon' | 'joined' | 'butt' | 'square' | 'round',
  miterLimit: number,
  /** Decimal places to work to. */
  decimals: number,
  arcTolerance: number,
) {
  const module = await ClipperModule.value;
  const result = module.InflatePathsD(
    paths,
    offset,
    getJoinType(joinType, module.JoinType),
    getEndType(endType, module.EndType),
    miterLimit,
    decimals,
    arcTolerance,
  );
  return result;
}

export async function getAreaResolver() {
  const { AreaPathD } = await ClipperModule.value;
  return (path: PathD) => AreaPathD(path);
}

export async function pathsIntersect(a: PathD, b: PathD, decimals: number) {
  const { IntersectD, PathsD, FillRule } = await ClipperModule.value;

  const aa = new PathsD();
  aa.push_back(a);

  const bb = new PathsD();
  bb.push_back(b);

  const result = IntersectD(aa, bb, FillRule.NonZero, decimals);
  const intersect = result.size() > 0;

  aa.delete();
  bb.delete();
  result.delete();

  return intersect;
}

export async function pathIntersectsAnyFromGroup(
  path: PathD,
  group: PathsD,
  decimals: number,
) {
  const { IntersectD, PathsD, FillRule } = await ClipperModule.value;

  const aa = new PathsD();
  aa.push_back(path);

  const result = IntersectD(aa, group, FillRule.NonZero, decimals);
  const intersect = result.size() > 0;

  aa.delete();
  result.delete();

  return intersect;
}

/** Drop vertices that are less than `epsilon` (mm) off the outline. */
export async function simplifyPath(a: PathD, epsilon: number, closed = true) {
  const { SimplifyPathD } = await ClipperModule.value;

  const simplified = SimplifyPathD(a, epsilon, closed);

  return simplified;
}

function getFillRule(type: ClipperFillRule, FillRule: MainModule['FillRule']) {
  switch (type) {
    case 'even-odd':
      return FillRule.EvenOdd;
    case 'negative':
      return FillRule.Negative;
    case 'positive':
      return FillRule.Positive;
    case 'non-zero':
      return FillRule.NonZero;
  }
}

function getClipType(type: ClipperClipType, ClipType: MainModule['ClipType']) {
  switch (type) {
    case 'difference':
      return ClipType.Difference;
    case 'intersection':
      return ClipType.Intersection;
    case 'union':
      return ClipType.Union;
    case 'xor':
      return ClipType.Xor;
  }
}

function getJoinType(type: ClipperJoinType, JoinType: MainModule['JoinType']) {
  switch (type) {
    case 'miter':
      return JoinType.Miter;
    case 'square':
      return JoinType.Square;
    case 'round':
      return JoinType.Round;
  }
}

function getEndType(type: ClipperEndType, EndType: MainModule['EndType']) {
  switch (type) {
    case 'butt':
      return EndType.Butt;
    case 'joined':
      return EndType.Joined;
    case 'polygon':
      return EndType.Polygon;
    case 'round':
      return EndType.Round;
    case 'square':
      return EndType.Square;
  }
}

const ClipperModule = lazy(async () => {
  const { default: clipperFactory } = await import(
    /** @ts-ignore */
    'clipper2-wasm/dist/es/clipper2z.js'
  );
  const module = await clipperFactory({
    // The version in the URL keeps a cached clipper2z.wasm from another
    // version (the file name never changes) from being paired with this
    // code, which fails to start with it.
    locateFile: () => `clipper2z.wasm?v=${clipperVersion}`,
  });
  return module as MainModule;
});

export async function makePath(polyPoints: CamPoint[]) {
  const { MakePathD } = await ClipperModule.value;

  const points = polyPoints.flatMap((point) => [point.x, point.y]);
  const path = MakePathD(points);

  return path;
}

export async function makePaths(polys: CamPoint[][]) {
  const { PathsD } = await ClipperModule.value;
  let paths = new PathsD();
  for (const polyPoints of polys) {
    const path = await makePath(polyPoints);
    paths.push_back(path);
  }
  return paths;
}

export async function makePathsFromPath(...paths: PathD[]) {
  const { PathsD } = await ClipperModule.value;
  let result = new PathsD();
  for (const p of paths) {
    result.push_back(p);
  }
  return result;
}
