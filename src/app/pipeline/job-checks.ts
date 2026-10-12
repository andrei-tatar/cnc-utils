import { hasArcs } from '../../cam/arcs';
import { CheckedOperation, checkJob, JobWarning } from '../../cam/job-checks';
import type { ClearanceReport, ClearanceTool } from '../../cam/clearance';
import { machineById } from '../../cam/feeds-speeds';
import { SimulatedStock } from '../../cam/simulate';
import { simulationInput } from './simulation';
import { resolveStock } from '../../cam/stock';
import { CamPath, CamShape } from '../../cam/types';
import { ModelType } from '../model-editor/model';
import {
  borrowedShapeId,
  describeOperation,
} from '../model-editor/operations/describe';
import { depthPerStep } from '../model-editor/operations/depth-steps';
import { shapeLabel } from '../model-editor/shapes/describe';
import { nestPolygons } from '../../cam/polygon-nesting';
import { rotaryOf } from '../../cam/rotary';
import {
  jobFlip,
  onBack,
  rotationMismatch,
} from '../model-editor/operations/rotation';
import { anglesLabel } from '../model-editor/operations/operation-rotary-repeat';
import {
  cutOperations,
  flatOperations,
} from '../model-editor/operations/flatten';

/** Round bits, which leave corners rounded. */
const ROUND = ['end-mill', 'ball-nose', 'bull-nose'];

/** The job's checks (see `checkJob`), from the resolved model. */
export function jobChecks(
  model: ModelType,
  paths: CamPath[],
  shapes: CamShape[],
): JobWarning[] {
  const shapesOf = (id: string | undefined) =>
    shapes.filter((s) => s.sourceShapeId === id);
  // Inside rotary repeats too; borrowing ones look among all of them.
  const listed = model.operations ?? [];
  const operations = flatOperations(listed);

  const checked = cutOperations(listed).flatMap((op): CheckedOperation[] => {
    const tool = model.tools.find((t) => t.id === op.toolId);
    if (op.disabled || !tool) return [];
    const shapeId = borrowedShapeId(op, operations);
    const source = model.shapes.find((s) => s.id === shapeId);
    const bitType = tool.bitType ?? 'end-mill';
    const round = ROUND.includes(bitType);
    const stepped =
      op.type === 'pocket' ||
      op.type === 'profile' ||
      op.type === 'flat' ||
      op.type === 'flat-plug';
    const engagement =
      op.type === 'pocket' ||
      op.type === 'rest' ||
      op.type === 'v-carve-clear' ||
      op.type === 'image-engrave-clear' ||
      op.type === 'relief-rough' ||
      op.type === 'relief' ||
      op.type === 'helix'
        ? (op.toolEngagement ?? null)
        : null;
    const outsideProfile =
      op.type === 'profile' && op.side === 'outside' && op.mode !== 'holes';
    return [
      {
        id: op.id,
        name:
          op.name ||
          describeOperation(op, model.shapes, model.tools, operations),
        type: op.type ?? '',
        bitType,
        toolDiameter: tool.diameter ?? 0,
        fluteLength: tool.fluteLength ?? 0,
        depthPerStep: stepped ? depthPerStep(op) : null,
        engagement,
        roundsCorners: !round
          ? null
          : op.type === 'pocket' ||
              (op.type === 'profile' && op.side === 'inside')
            ? 'convex'
            : outsideProfile
              ? 'concave'
              : null,
        shape: shapesOf(shapeId),
        cornersHandled: (source?.transforms ?? []).some(
          (t) => !t.disabled && (t.type === 'dogbone' || t.type === 'corners'),
        ),
        cutsOut: outsideProfile || op.type === 'flat-plug',
        onionSkin: op.type === 'profile' && (op.onionSkin ?? 0) > 0,
        intoSpoilboard: op.type === 'flip',
      },
    ];
  });

  // The parts cut out: their outer outlines (a corner on one of them, a
  // shape cut out of it, may matter; one in the waste doesn't).
  const parts = checked
    .filter((op) => op.cutsOut)
    .flatMap((op) =>
      nestPolygons(
        op.shape
          .flatMap((s) => s.polygons)
          .filter((p) => p.close && (p.vertices.length > 2 || hasArcs(p))),
      ).map(({ outer }) => outer),
    );

  // Clearings and rest machining cut where the operation they belong to
  // did: with the stock on a rotary axis, it must be turned the same.
  const stock = resolveStock(model.stock);
  const name = (op: any) =>
    op.name || describeOperation(op, model.shapes, model.tools, operations);
  // A board turned over: they must be cut on the same side.
  const flip = jobFlip(listed, stock);
  const side = (op: any) => (onBack(op, listed) ? 'back' : 'front');
  const turnedWrong: JobWarning[] =
    !rotaryOf(stock) && !flip
      ? []
      : cutOperations(listed).flatMap((op) => {
          const mismatch = rotationMismatch(op, listed);
          return mismatch
            ? [
                {
                  level: 'warning' as const,
                  text: flip
                    ? `${name(op)}: cut on the board’s ${side(op)}, but “${name(mismatch.other)}” on its ${side(mismatch.other)}: put it on the same side (between the same flip steps)`
                    : `${name(op)}: cut with the stock turned to ${anglesLabel(mismatch.angles) || 'no angle'}, but “${name(mismatch.other)}” at ${anglesLabel(mismatch.otherAngles) || 'no angle'}: put it where that one is (under the same rotate step, or in the same rotary repeat)`,
                  operationId: op.id,
                },
              ]
            : [];
        });

  return [
    ...turnedWrong,
    ...checkJob({
      stock,
      operations: checked,
      paths,
      parts,
      keepOuts: model.shapes
        .filter((s) => s.clamp)
        .map((s) => ({
          name: shapeLabel(s, model.shapes),
          polygons: shapesOf(s.id).flatMap((shape) => shape.polygons),
        })),
    }),
  ];
}

/** What `checkClearances` needs, or null when there's nothing it can check. */
export type ClearanceInput = {
  tools: Record<string, ClearanceTool>;
  stock: SimulatedStock;
  holderDiameter: number;
};

/**
 * What checking the moves against the material needs (see
 * `checkClearances`): each operation's bit with its flute length and how
 * far it sticks out, the block of material, and the machine's collet nut.
 * Null on a rotary axis or with the board turned over (cut from more than
 * one side), or with nothing to cut.
 */
export function clearanceInput(
  paths: CamPath[],
  model: ModelType,
): ClearanceInput | null {
  const input = simulationInput(paths, model);
  if (!input || input.rotary) {
    return null;
  }
  const tools: Record<string, ClearanceTool> = {};
  for (const op of cutOperations(model.operations)) {
    const bit = input.tools[op.id];
    const tool = model.tools.find((t) => t.id === op.toolId);
    if (!bit || !tool) continue;
    tools[op.id] = {
      ...bit,
      fluteLength: tool.fluteLength ?? null,
      stickout: tool.stickout ?? null,
    };
  }
  return {
    tools,
    stock: input.stock,
    holderDiameter: machineById(model.gcode?.machine).nutDiameter,
  };
}

/**
 * The job checks with what checking the moves against the material found
 * (`report`, null while it's not done): rapids into uncut material and the
 * collet nut on the material as warnings; a cut past the flutes kept as a
 * warning where uncut material rises above them, a note where earlier cuts
 * had cleared it.
 */
export function withClearances(
  warnings: JobWarning[],
  report: ClearanceReport | null,
  model: ModelType,
): JobWarning[] {
  if (!report) {
    return warnings;
  }
  const operations = flatOperations(model.operations);
  const name = (id: string) => {
    const op: any = operations.find((o: any) => o.id === id);
    return op
      ? op.name || describeOperation(op, model.shapes, model.tools, operations)
      : 'An operation';
  };
  const mm = (value: number) => `${Math.round(value * 10) / 10} mm`;
  const near = (p: { x: number; y: number }) =>
    `near X ${Math.round(p.x)} Y ${Math.round(p.y)}`;
  const shank = new Map(
    report.problems
      .filter((p) => p.kind === 'shank')
      .map((p) => [p.operationId, p]),
  );
  const checked = new Set(report.shankChecked);
  const refined = warnings.map((w) => {
    if (w.kind !== 'flutes' || !w.operationId || !checked.has(w.operationId)) {
      return w;
    }
    const problem = shank.get(w.operationId);
    return problem
      ? {
          ...w,
          text: `${w.text}: uncut material rises ${mm(problem.depth)} above them (${near(problem.at)})`,
        }
      : {
          ...w,
          level: 'note' as const,
          text: `${w.text}, only where earlier cuts cleared the way above them`,
        };
  });
  const found: JobWarning[] = report.problems.flatMap((p) => {
    const times = p.count > 1 ? ` (${p.count} times)` : '';
    switch (p.kind) {
      case 'rapid':
        return [
          {
            level: 'warning' as const,
            text: `${name(p.operationId)}: a rapid move goes ${mm(p.depth)} into material that isn’t cut yet${times}, ${near(p.at)}`,
            operationId: p.operationId,
          },
        ];
      case 'holder':
        return [
          {
            level: 'warning' as const,
            text: `${name(p.operationId)}: the collet nut comes ${mm(p.depth)} down onto the material${times}, ${near(p.at)}: let the bit stick out further`,
            operationId: p.operationId,
          },
        ];
      default:
        return [];
    }
  });
  // Warnings first.
  return [...found, ...refined].sort(
    (a, b) => (a.level === 'warning' ? 0 : 1) - (b.level === 'warning' ? 0 : 1),
  );
}
