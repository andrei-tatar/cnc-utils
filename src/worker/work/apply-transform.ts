import { Matrix3, Vector2 } from 'three';
import { CamShape } from '../../cam/types';
import { clipperInflate } from '../../cam/clipper';
import { TransformParameters } from '../../app/model-editor/model';

export async function applyTransform(
  input: CamShape[],
  transform: TransformParameters,
): Promise<CamShape[]> {
  try {
    switch (transform.type) {
      case 'translate':
        const translateMatrix = new Matrix3().translate(
          transform.translateX,
          transform.translateY,
        );
        return input.map((i) => applyMatrixTransform(i, translateMatrix));

      case 'rotate': {
        const box = getBoundingBox(input);

        const [ox, oy] = transform.around.split('-').map((v) => v.substring(1));
        const dx = getRotationOrigin(box.x, box.width, ox);
        const dy = getRotationOrigin(box.y, box.height, oy);

        const rotateMatrix = new Matrix3()
          .translate(-dx, -dy)
          .rotate((transform.rotateAngle * Math.PI) / 180)
          .translate(dx, dy);

        return input.map((i) => applyMatrixTransform(i, rotateMatrix));
      }

      case 'scale':
        const scaleMatrix = new Matrix3().scale(
          transform.scaleX,
          transform.scaleY,
        );
        return input.map((i) => applyMatrixTransform(i, scaleMatrix));

      case 'repeat':
        const output: CamShape[] = [];

        const deltaX =
          transform.repeatTypeX === 'each'
            ? transform.repeatSpaceX
            : transform.repeatSpaceX / (transform.repeatCountX - 1);

        const deltaY =
          transform.repeatTypeY === 'each'
            ? transform.repeatSpaceY
            : transform.repeatSpaceY / (transform.repeatCountY - 1);

        for (let y = 0; y < transform.repeatCountY; y++)
          for (let x = 0; x < transform.repeatCountX; x++) {
            const translate = new Matrix3().translate(deltaX * x, deltaY * y);
            output.push(
              ...input.map((i) => applyMatrixTransform(i, translate)),
            );
          }
        return output;

      case 'flip':
        const box = getBoundingBox(input);
        let matrix = new Matrix3();
        if (transform.flipHorizontal) {
          matrix = matrix
            .translate(-(box.x + box.width / 2), 0)
            .scale(-1, 1)
            .translate(box.x + box.width / 2, 0);
        }
        if (transform.flipVertical) {
          matrix = matrix
            .translate(0, -(box.y + box.height / 2))
            .scale(1, -1)
            .translate(0, box.y + box.height / 2);
        }
        return input.map((i) => applyMatrixTransform(i, matrix));

      case 'clipper-inflate':
        return await clipperInflate(input, transform);

      default:
        return input;
    }
  } catch (err) {
    console.error(err);
  }
  return input;
}

function getRotationOrigin(start: number, size: number, type: string) {
  switch (type) {
    case 'min':
      return start;
    case 'max':
      return start + size;
    case 'center':
    default:
      return start + size / 2;
  }
}

function getBoundingBox(input: CamShape[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  input.forEach((shape) => {
    shape.polygons.forEach((poly) => {
      poly.points.forEach((point) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      });
    });
  });

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function applyMatrixTransform(input: CamShape, matrix: Matrix3): CamShape {
  return {
    sourceShapeId: input.sourceShapeId,
    polygons: input.polygons.map((poly) => {
      return {
        close: poly.close,
        points: poly.points.map((p) => {
          const result = new Vector2(p.x, p.y).applyMatrix3(matrix);
          return {
            x: result.x,
            y: result.y,
          };
        }),
      };
    }),
  };
}
