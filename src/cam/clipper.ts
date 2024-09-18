import type {
  Clipper2ZFactoryFunction,
  MainModule,
  PathsD,
} from 'clipper2-wasm/dist/clipper2z';
import { CamPolygon, CamShape } from './types';
import { lazy } from '../util';

type ClipperJoinType = 'miter' | 'square' | 'round';
type ClipperEndType = 'polygon' | 'joined' | 'butt' | 'square' | 'round';

export function clipperInflate(
  inputShapes: CamShape[],
  options: {
    offset: number;
    joinType: 'miter' | 'square' | 'round';
    endType: 'polygon' | 'joined' | 'butt' | 'square' | 'round';
    precision: number;
    miterLimit: number;
    arcTolerance: number;
  },
) {
  return clipperTransform(
    inputShapes,
    ({ InflatePathsD: inflatePaths, JoinType, EndType }, paths) => {
      const joinType = getJoinType(options.joinType, JoinType);
      const endType = getEndType(options.endType, EndType);
      return inflatePaths(
        paths,
        options.offset,
        joinType,
        endType,
        options.precision,
        options.miterLimit,
        options.arcTolerance,
      );
    },
    options.endType === 'polygon',
  );
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
    'clipper2-wasm/dist/es/clipper2z'
  );
  const factory: Clipper2ZFactoryFunction = clipperFactory;
  const module = await factory({
    locateFile: () => {
      return 'clipper2z.wasm';
    },
  });
  return module;
});

async function clipperTransform(
  inputShapes: CamShape[],
  transform: (module: MainModule, paths: PathsD) => PathsD,
  closePath: boolean,
) {
  const module = await ClipperModule.value;

  const { MakePathD: makePath, PathsD: Paths } = module;

  let paths = new Paths();
  for (const shape of inputShapes) {
    for (const poly of shape.polygons) {
      const points = poly.points.flatMap((point) => [point.x, point.y]);
      const path = makePath(points);

      paths.push_back(path);
    }
  }

  paths = transform(module, paths);

  return fromClipperPaths(paths, inputShapes[0]?.sourceShapeId, closePath);
}

function fromClipperPaths(
  paths: PathsD,
  sourceShapeId: string,
  closePath: boolean,
) {
  const resultShapes: CamShape[] = [];

  const pathsSize = paths.size();
  const result: CamShape = {
    polygons: [],
    sourceShapeId,
  };

  for (let i = 0; i < pathsSize; i++) {
    const path = paths.get(i);
    const poly: CamPolygon = { points: [], close: false };
    const pathSize = path.size();
    for (let j = 0; j < pathSize; j++) {
      const point = path.get(j);
      poly.points.push({ x: Number(point.x), y: Number(point.y) });
    }

    if (closePath && pathSize > 2) {
      poly.points.push({ x: Number(path.get(0).x), y: Number(path.get(0).y) });
    }

    result.polygons.push(poly);
  }

  resultShapes.push(result);

  return resultShapes;
}
