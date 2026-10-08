import { map, Observable, of, race } from 'rxjs';
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
  RestSource,
  VCarveSource,
} from './vcarve-source';
import { pointLength } from '../model-editor/operations/operation-drill';
import { depthPerStep } from '../model-editor/operations/depth-steps';
import { operationLabel } from '../model-editor/operations';
import { recover } from './errors';

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
  clearings,
  geometry,
  optimizeTravel,
}: RoutingInputs): Observable<GCodeBuilder> | null {
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

    case 'rest':
      if (!rest || bitType === 'v-bit' || bitType === 'drill') {
        return null;
      }
      return worker.routeRest(shape, {
        geometry,
        optimizeTravel,
        toolSize: diameter,
        previousToolSize: rest.previousToolSize,
        toolEngagement: op.toolEngagement,
        leaveStock: rest.leaveStock,
        startDepth: rest.startDepth,
        depthPerStep: rest.depthPerStep,
        steps: rest.steps,
        rampAngle,
      });
  }

  return null;
}
