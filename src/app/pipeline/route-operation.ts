import {
  defaultIfEmpty,
  forkJoin,
  map,
  Observable,
  of,
  race,
  shareReplay,
  switchMap,
} from 'rxjs';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import worker from '../../worker';
import { OperationParameters, ToolParameters } from '../model-editor/model';
import {
  Clearing,
  FlatPlugSource,
  ImageEngraveSource,
  imageEngraveOptions,
  PlugSource,
  ReliefSource,
  reliefOptions,
  RestSource,
  VCarveSource,
} from './vcarve-source';
import { pointLength } from '../model-editor/operations/operation-drill';
import { depthPerStep } from '../model-editor/operations/depth-steps';
import { operationLabel } from '../model-editor/operations';
import { stepoverDiameter } from '../model-editor/tools';
import { recover } from './errors';
import { DowelHoles } from './flip';
import { Rotary } from '../../cam/rotary';
import type { ReliefOptions } from '../../worker/work/route-relief';
import { CutBefore, sameAngle, SideSurface } from '../../cam/rotary-remaining';

/** Everything that decides an operation's toolpath. */
export type RoutingInputs = {
  shape: CamShape[];
  op: OperationParameters;
  tool: ToolParameters | null;
  source: VCarveSource | null;
  plug: PlugSource | null;
  rest: RestSource | null;
  flatPlug: FlatPlugSource | null;
  imageEngrave: ImageEngraveSource | null;
  relief: ReliefSource | null;
  /**
   * For a relief whose model turns with the stock (and its roughing): the
   * rotary axis and the angle this is routed for.
   */
  turned: {
    rotary: Rotary;
    angle: number;
    before?: CutBefore[];
    /** Carved all round as the stock turns, unrolled from `angle`. */
    around?: boolean;
    /** For rounding the stock: its ends along the rotary axis. */
    ends?: { from: number; to: number };
    /** The angles the relief is finished at, each what faces it. */
    shared?: number[];
    /** The widest bit cutting the relief: its radius (mm). */
    reach?: number;
  } | null;
  /**
   * For a relief that carves a 3D model shape (and its roughing): the
   * shape's mesh, null while there's none. Left out for any other.
   */
  model?: {
    mesh: Float32Array | null;
    /** Carved within the model's own rectangle and this margin. */
    margin?: number;
  };
  /** For a flip step: the dowel holes it drills. */
  dowels: DowelHoles | null;
  /** End mills clearing for a v-carve (or inlay plug) before it. */
  clearings: Clearing[];
  geometry: GeometrySettings;
  /** Order each operation's cuts to keep the travel between them short. */
  optimizeTravel: boolean;
};

/**
 * Routes one operation in the worker. Emits an empty builder when there's
 * nothing to cut (no tool or shape yet, or the wrong kind of bit).
 */
export function routeOperation(
  operationId: string,
  inputs: RoutingInputs,
  working$: Observable<never>,
): Observable<GCodeBuilder> {
  const routed$ = route(inputs);
  if (!routed$) {
    return of(new GCodeBuilder());
  }
  const operationGcode = new GCodeBuilder().sourceOperationId(operationId);
  return race(
    routed$.pipe(
      map((r) => operationGcode.concat(GCodeBuilder.clone(r))),
      // Nothing cut, rather than no G-code at all.
      recover(`routing ${operationLabel(inputs.op.type)}`, () =>
        GCodeBuilder.clone(operationGcode),
      ),
    ),
    working$,
  );
}

/** A relief's options, carving a 3D model shape's mesh instead of a file. */
function carved(
  relief: ReliefSource['relief'],
  model: RoutingInputs['model'],
  turned: RoutingInputs['turned'],
): ReliefSource['relief'] {
  return model
    ? {
        ...relief,
        file: '',
        mesh: model.mesh,
        ...(model.margin === undefined ? {} : { margin: model.margin }),
        ...(turned
          ? {
              turned: {
                rotary: turned.rotary,
                angle: turned.angle,
                before: turned.before,
                shared: turned.shared,
                ...(turned.around ? { around: true } : {}),
              },
            }
          : {}),
      }
    : relief;
}

/** A relief's carving is shared out between at most this many workers. */
const MOST_SHARES = 8;
/** A share is at least this many of the carving's parts. */
const LEAST_SHARE = 4;

/**
 * Carves a relief with the work shared out between workers: one prepares
 * it (`prepareRelief`: its surface, what's left to carve), then each
 * carves a run of its raster lines (`routeReliefBand`) — exactly what one
 * worker carving it all would give for them — and their G-code is put end
 * to end.
 */
function sharedOut(
  shape: CamShape[],
  options: ReliefOptions,
): Observable<GCodeBuilder> {
  const { relief: _, ...carving } = options;
  const start = () => new GCodeBuilder().sourceShapeId(shape[0]?.sourceShapeId);
  return worker.prepareRelief(shape, options).pipe(
    defaultIfEmpty(null),
    switchMap((prepared) => {
      if (!prepared || !(prepared.units > 0)) {
        return of(start());
      }
      const workers = Math.max(
        1,
        Math.min(
          MOST_SHARES,
          (globalThis.navigator?.hardwareConcurrency || 4) - 1,
        ),
      );
      const shares = Math.max(
        1,
        Math.min(workers, Math.floor(prepared.units / LEAST_SHARE)),
      );
      const bands = Array.from({ length: shares }, (_, k) =>
        worker.routeReliefBand(
          prepared,
          carving,
          Math.floor((prepared.units * k) / shares),
          Math.floor((prepared.units * (k + 1)) / shares),
        ),
      );
      return forkJoin(bands).pipe(
        map((cut) =>
          start().concat(GCodeBuilder.concatAll(cut)).goToSafeHeight(),
        ),
      );
    }),
  );
}

/** Numbers standing for objects, to tell them apart in a key. */
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
function identity(value: object | null | undefined): number {
  if (!value) return 0;
  let id = identities.get(value);
  if (!id) identities.set(value, (id = nextIdentity++));
  return id;
}

/** The last side surfaces asked for, by what they're worked out from. */
const sideJobs = new Map<string, Observable<SideSurface | null>>();
const SIDE_JOBS_KEPT = 64;

/**
 * A relief whose model turns with the stock as the stock turned to `angle`
 * shows it (the worker's `reliefSide`). Every cut of the relief that needs
 * it — its roughing and finishing at the other angles — gets the same one.
 */
function sideSurfaceAt(
  shape: CamShape[],
  relief: ReliefSource['relief'],
  angle: number,
  reach: number,
  geometry: GeometrySettings,
): Observable<SideSurface | null> {
  const { mesh, turned, ...rest } = relief;
  const key = JSON.stringify([
    shape.map(identity),
    identity(mesh),
    rest,
    turned?.rotary,
    angle,
    reach,
    geometry,
  ]);
  let job$ = sideJobs.get(key);
  // Asked for again: the last to go.
  sideJobs.delete(key);
  if (!job$) {
    job$ = worker
      .reliefSide(
        shape,
        { ...rest, mesh, turned: { rotary: turned!.rotary, angle } },
        reach,
        geometry,
      )
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }
  sideJobs.set(key, job$);
  for (const old of sideJobs.keys()) {
    if (sideJobs.size <= SIDE_JOBS_KEPT) break;
    sideJobs.delete(old);
  }
  return job$;
}

/**
 * Routes a relief whose model turns with the stock (`route`, given the
 * relief to carve), with the relief as the other angles show it: those of
 * the cuts made before, and those its finishing is shared out between.
 */
function withSides(
  shape: CamShape[],
  relief: ReliefSource['relief'],
  turned: RoutingInputs['turned'],
  geometry: GeometrySettings,
  route: (relief: ReliefSource['relief']) => Observable<GCodeBuilder>,
): Observable<GCodeBuilder> {
  const own = relief.turned;
  if (!own || !turned || !relief.mesh?.length) {
    return route(relief);
  }
  const angles: number[] = [];
  for (const angle of [
    ...(own.before ?? []).map((cut) => cut.angle),
    ...(own.shared ?? []),
  ]) {
    if (!sameAngle(angle, own.angle) && !angles.includes(angle)) {
      angles.push(angle);
    }
  }
  if (!angles.length) {
    return route(relief);
  }
  return forkJoin(
    angles.map((angle) =>
      sideSurfaceAt(shape, relief, angle, turned.reach ?? 0, geometry).pipe(
        defaultIfEmpty(null),
      ),
    ),
  ).pipe(
    switchMap((sides) =>
      route({
        ...relief,
        turned: {
          ...own,
          sides: sides.filter((side): side is SideSurface => !!side),
        },
      }),
    ),
  );
}

/** The worker call for the operation's type, or null for nothing to cut. */
function route({
  shape,
  op,
  tool,
  source,
  plug,
  rest,
  flatPlug,
  imageEngrave,
  relief,
  turned,
  model,
  dowels,
  clearings,
  geometry,
  optimizeTravel,
}: RoutingInputs): Observable<GCodeBuilder> | null {
  // A flip step drills its dowel holes, if any: no shape of its own.
  if (op.type === 'flip') {
    if (!tool || !dowels || tool.bitType === 'v-bit') {
      return null;
    }
    return worker.routeDrill(
      [
        {
          sourceShapeId: '',
          polygons: dowels.points.map((p) => ({ vertices: [p], close: false })),
        },
      ],
      {
        geometry,
        optimizeTravel,
        drillAt: 'points',
        startDepth: 0,
        depth: dowels.depth,
        pointLength:
          tool.bitType === 'drill'
            ? pointLength(tool.diameter, tool.pointAngle)
            : 0,
        // Out every 3 mm to clear the chips, as deep holes want.
        peck: 3,
        chipBreak: false,
        dwell: 0,
        retractHeight: 2,
        cycles: false,
      },
    );
  }
  // Rounding the stock cuts the stock itself: no shape either.
  if (op.type === 'rotary-round') {
    if (
      !tool ||
      !turned?.ends ||
      tool.bitType === 'v-bit' ||
      tool.bitType === 'drill'
    ) {
      return null;
    }
    return worker.routeRotaryRound({
      geometry,
      rotary: turned.rotary,
      angle: turned.angle,
      from: op.roundFrom ?? turned.ends.from,
      to: op.roundTo ?? turned.ends.to,
      stockFrom: turned.ends.from,
      stockTo: turned.ends.to,
      diameter: op.roundDiameter,
      toolSize: tool.diameter,
      toolEngagement: op.toolEngagement,
      depthPerStep: op.depthPerStep,
      strategy: op.roundStrategy === 'around' ? 'around' : 'along',
      rampAngle: tool.ramp ? tool.rampAngle : null,
    });
  }
  // No (or a deleted) tool or shape: nothing to cut. Routing functions
  // expect at least one shape (a shape of only tabs has nothing to cut).
  if (!tool || !shape.some((s) => s.polygons.length)) {
    return null;
  }
  const { bitType, diameter, vAngle, tipDiameter } = tool;
  const rampAngle = tool.ramp ? tool.rampAngle : null;
  // Cleared first: a V-bit can go below its cone.
  const beyondCone = clearings.length > 0;

  switch (op.type) {
    case 'pocket':
      return worker.routePocketHole(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        toolEngagement: op.toolEngagement,
        leaveStock: op.leaveStock,
        depthPerStep: depthPerStep(op),
        steps: op.steps,
        startDepth: op.startDepth,
        strategy: op.strategy ?? 'offset',
        alongAxis: op.alongAxis ?? 'y',
        allPassesInSameDirection: !!op.allPassesInSameDirection,
        rampAngle,
      });

    case 'flat':
      return worker.flatOutline(shape, {
        geometry,
        toolSize: diameter,
        toolEngagement: op.toolEngagement,
        startDepth: op.startDepth ?? 0,
        depth: depthPerStep(op),
        steps: op.steps,
        interpolateStepSize: op.interpolateStepSize,
        allPassesInSameDirection: op.allPassesInSameDirection,
        alongAxis: op.alongAxis,
        growByToolsize: op.growByToolsize,
        applyConvexHullOnShape: op.applyConvexHullOnShape,
        pauseAfterEachStep: op.pauseAfterEachStep,
      });

    case 'profile':
      return worker.routeProfile(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        side: op.side,
        direction: op.direction,
        leaveStock: op.leaveStock ?? 0,
        finishPass: !!op.finishPass,
        onionSkin: op.onionSkin ?? 0,
        leadIn: op.leadIn ?? 0,
        startDepth: op.startDepth,
        depthPerStep: depthPerStep(op),
        steps: op.steps,
        mode: op.mode ?? 'both',
        rampAngle,
      });

    case 'v-carve':
      if (bitType !== 'v-bit') {
        return null;
      }
      return worker.routeVCarve(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        vAngle,
        tipDiameter,
        startDepth: op.startDepth,
        maxDepth: op.unlimitedDepth ? null : op.maxDepth,
        stepover: op.stepover && op.stepover > 0 ? op.stepover : null,
        // Without a max depth there's no flat bottom.
        clearFlatBottom: !op.unlimitedDepth && op.clearFlatBottom,
        clearedBy: clearings,
        centerLine: !!op.centerLine,
        sharpCorners: op.sharpCorners ?? true,
        sharpCornerAngle: op.sharpCornerAngle ?? 150,
        beyondCone,
        mode: op.mode ?? 'both',
        rampAngle,
      });

    case 'v-carve-clear':
      if (!source || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeVCarveClearing(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        toolEngagement: op.toolEngagement,
        depthPerStep: op.depthPerStep,
        leaveStock: op.leaveStock,
        vToolSize: source.vToolSize,
        vAngle: source.vAngle,
        tipDiameter: source.tipDiameter,
        startDepth: source.startDepth,
        maxDepth: source.maxDepth,
        beyondCone: source.beyondCone,
        mode: source.mode,
        plug: source.plug,
        rampAngle,
      });

    case 'inlay-plug':
      if (!plug || bitType !== 'v-bit') {
        return null;
      }
      return worker.routeVCarve(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        vAngle,
        tipDiameter,
        startDepth: 0,
        maxDepth: plug.maxDepth,
        stepover: plug.stepover,
        clearFlatBottom: true,
        clearedBy: clearings,
        centerLine: plug.centerLine,
        sharpCorners: plug.sharpCorners,
        sharpCornerAngle: plug.sharpCornerAngle,
        beyondCone,
        mode: 'both',
        plug: plug.plug,
        rampAngle,
      });

    case 'drill':
      return worker.routeDrill(shape, {
        geometry,
        optimizeTravel,
        drillAt: op.drillAt ?? 'centers',
        startDepth: op.startDepth,
        depth: op.depth,
        pointLength:
          op.fullDiameter && bitType === 'drill'
            ? pointLength(diameter, tool.pointAngle)
            : 0,
        peck: op.peck,
        chipBreak: !!op.chipBreak,
        dwell: op.dwell,
        retractHeight: op.retractHeight,
        cycles: op.output === 'cycles',
      });

    case 'helix':
      if (bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeHelix(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        startDepth: op.startDepth,
        depth: op.depth,
        pitch: op.pitch,
        direction: op.direction,
        leaveStock: op.leaveStock,
        clearMiddle: op.clearMiddle,
        toolEngagement: op.toolEngagement,
      });

    case 'flat-plug':
      if (!flatPlug || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeFlatPlug(shape, {
        geometry,
        optimizeTravel,
        pocketToolSize: flatPlug.pocketToolSize,
        gap: op.inlayGap ?? 0,
        mirror: !!op.plugMirror,
        toolSize: diameter,
        direction: op.direction ?? 'climb',
        startDepth: op.startDepth,
        depthPerStep: depthPerStep(op),
        steps: op.steps,
        rampAngle,
      });

    case 'keyhole':
      if (bitType !== 'keyhole') {
        return null;
      }
      return worker.routeKeyhole(shape, {
        geometry,
        optimizeTravel,
        keyholeAt: op.keyholeAt ?? 'centers',
        startDepth: op.startDepth,
        depth: op.depth,
        slotLength: op.slotLength,
        slotAngle: op.slotAngle,
      });

    case 'chamfer':
      if (bitType !== 'v-bit') {
        return null;
      }
      return worker.routeChamfer(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        vAngle,
        tipDiameter,
        width: op.chamferWidth,
        edges: op.chamferEdges,
        extraDepth: op.extraDepth,
        passes: op.passes,
        direction: op.direction,
        rampAngle,
      });

    case 'image-engrave':
      if (bitType !== 'v-bit') {
        return null;
      }
      return worker.routeImageEngrave(shape, {
        ...imageEngraveOptions(op, tool),
        geometry,
      });

    case 'image-engrave-clear':
      if (!imageEngrave || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeImageEngraveClearing(shape, {
        geometry,
        optimizeTravel,
        engrave: imageEngrave.engrave,
        toolSize: diameter,
        toolEngagement: op.toolEngagement,
        depthPerStep: op.depthPerStep,
        leaveStock: op.leaveStock ?? 0,
        rampAngle,
      });

    case 'relief':
      if (bitType === 'drill' || bitType === 'keyhole') {
        return null;
      }
      return withSides(
        shape,
        carved(reliefOptions(op), model, turned),
        turned,
        geometry,
        (carving) =>
          sharedOut(shape, {
            geometry,
            relief: carving,
            tool: {
              bitType: bitType ?? 'end-mill',
              diameter,
              vAngle,
              tipDiameter,
              cornerRadius: tool.cornerRadius,
              tipRadius: tool.tipRadius,
              taperAngle: tool.taperAngle,
            },
            spacing: op.toolEngagement * stepoverDiameter(tool),
            angle: op.rasterAngle ?? 0,
            oneWay: !!op.allPassesInSameDirection,
            crossPass: !!op.crossPass,
            spiral: op.aroundPattern === 'spiral',
          }),
      );

    case 'relief-rough':
      if (!relief || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return withSides(
        shape,
        carved(relief.relief, model, turned),
        turned,
        geometry,
        (carving) =>
          worker.routeReliefRough(shape, {
            geometry,
            optimizeTravel,
            relief: carving,
            toolSize: diameter,
            toolEngagement: op.toolEngagement,
            depthPerStep: op.depthPerStep,
            leaveStock: op.leaveStock ?? 0,
            rampAngle,
          }),
      );

    case 'rest':
      if (!rest || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeRest(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        previousToolSize: rest.previousToolSize,
        previousLeaveStock: rest.previousLeaveStock,
        toolEngagement: op.toolEngagement,
        leaveStock: op.leaveStock ?? 0,
        overlap: op.restOverlap ?? 0,
        startDepth: op.startDepth,
        depthPerStep: depthPerStep(op),
        steps: op.steps,
        rampAngle,
      });
  }

  return null;
}
