import { map, Observable, of, race } from 'rxjs';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { GeometrySettings } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import worker from '../../worker';
import { OperationParameters, ToolParameters } from '../model-editor/model';
import { VCarveSource } from './vcarve-source';

/** Everything that decides an operation's toolpath. */
export type RoutingInputs = {
  shape: CamShape[];
  op: OperationParameters;
  tool: ToolParameters | null;
  source: VCarveSource | null;
  beyondCone: boolean;
  geometry: GeometrySettings;
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
    routed$.pipe(map((r) => operationGcode.concat(GCodeBuilder.clone(r)))),
    working$,
  );
}

/** The worker call for the operation's type, or null for nothing to cut. */
function route({
  shape,
  op,
  tool,
  source,
  beyondCone,
  geometry,
}: RoutingInputs): Observable<GCodeBuilder> | null {
  // No (or a deleted) tool or shape: nothing to cut. Routing functions
  // expect at least one shape.
  if (!tool || !shape.length) {
    return null;
  }
  const { bitType, diameter, vAngle, tipDiameter } = tool;
  const rampAngle = tool.ramp ? tool.rampAngle : null;

  switch (op.type) {
    case 'pocket':
      return worker.routePocketHole(shape, {
        geometry,
        toolSize: diameter,
        toolEngagement: op.toolEngagement,
        leaveStock: op.leaveStock,
        depthPerStep: op.depth,
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
        depth: op.depthPerStep,
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
        toolSize: diameter,
        side: op.side,
        direction: op.direction,
        leaveStock: op.leaveStock ?? 0,
        startDepth: op.startDepth,
        depthPerStep: op.depth,
        steps: op.steps,
        tabsEnabled: op.tabsEnabled,
        tabCount: op.tabCount,
        tabWidth: op.tabWidth,
        tabHeight: op.tabHeight,
        tabOffset: op.tabOffset ?? 0,
        mode: op.mode ?? 'both',
        rampAngle,
      });

    case 'v-carve':
      if (bitType !== 'v-bit') {
        return null;
      }
      return worker.routeVCarve(shape, {
        geometry,
        toolSize: diameter,
        vAngle,
        tipDiameter,
        startDepth: op.startDepth,
        maxDepth: op.unlimitedDepth ? null : op.maxDepth,
        stepover: op.stepover && op.stepover > 0 ? op.stepover : null,
        // Without a max depth there's no flat bottom.
        clearFlatBottom: !op.unlimitedDepth && op.clearFlatBottom,
        sharpCorners: op.sharpCorners ?? true,
        sharpCornerAngle: op.sharpCornerAngle ?? 150,
        beyondCone,
        mode: op.mode ?? 'both',
        rampAngle,
      });

    case 'v-carve-clear':
      if (!source || bitType === 'v-bit') {
        return null;
      }
      return worker.routeVCarveClearing(shape, {
        geometry,
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
        rampAngle,
      });
  }

  return null;
}
