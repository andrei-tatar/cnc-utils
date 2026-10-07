import { hasArcs } from '../../cam/arcs';
import { CheckedOperation, checkJob, JobWarning } from '../../cam/job-checks';
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
  const operations = model.operations ?? [];

  const checked = operations.flatMap((op): CheckedOperation[] => {
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

  return checkJob({
    stock: resolveStock(model.stock),
    operations: checked,
    paths,
    parts,
    keepOuts: model.shapes
      .filter((s) => s.clamp)
      .map((s) => ({
        name: shapeLabel(s, model.shapes),
        polygons: shapesOf(s.id).flatMap((shape) => shape.polygons),
      })),
  });
}
