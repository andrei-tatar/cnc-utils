// @ts-nocheck

import { Matrix3, Vector2, Vector3 } from 'three';
import { SVGResultPaths } from 'three/examples/jsm/loaders/SVGLoader.js';

const tempTransform0 = new Matrix3();
const tempTransform1 = new Matrix3();
const tempTransform2 = new Matrix3();
const tempV2 = new Vector2();
const tempV3 = new Vector3();

export function transformPath(path: SVGResultPaths, m: Matrix3) {
  function transfVec2(v2) {
    tempV3.set(v2.x, v2.y, 1).applyMatrix3(m);

    v2.set(tempV3.x, tempV3.y);
  }

  function transfEllipseGeneric(curve) {
    // For math description see:
    // https://math.stackexchange.com/questions/4544164

    const a = curve.xRadius;
    const b = curve.yRadius;

    const cosTheta = Math.cos(curve.aRotation);
    const sinTheta = Math.sin(curve.aRotation);

    const v1 = new Vector3(a * cosTheta, a * sinTheta, 0);
    const v2 = new Vector3(-b * sinTheta, b * cosTheta, 0);

    const f1 = v1.applyMatrix3(m);
    const f2 = v2.applyMatrix3(m);

    const mF = tempTransform0.set(f1.x, f2.x, 0, f1.y, f2.y, 0, 0, 0, 1);

    const mFInv = tempTransform1.copy(mF).invert();
    const mFInvT = tempTransform2.copy(mFInv).transpose();
    const mQ = mFInvT.multiply(mFInv);
    const mQe = mQ.elements;

    const ed = eigenDecomposition(mQe[0], mQe[1], mQe[4]);
    const rt1sqrt = Math.sqrt(ed.rt1);
    const rt2sqrt = Math.sqrt(ed.rt2);

    curve.xRadius = 1 / rt1sqrt;
    curve.yRadius = 1 / rt2sqrt;
    curve.aRotation = Math.atan2(ed.sn, ed.cs);

    const isFullEllipse =
      (curve.aEndAngle - curve.aStartAngle) % (2 * Math.PI) < Number.EPSILON;

    // Do not touch angles of a full ellipse because after transformation they
    // would converge to a sinle value effectively removing the whole curve

    if (!isFullEllipse) {
      const mDsqrt = tempTransform1.set(rt1sqrt, 0, 0, 0, rt2sqrt, 0, 0, 0, 1);

      const mRT = tempTransform2.set(
        ed.cs,
        ed.sn,
        0,
        -ed.sn,
        ed.cs,
        0,
        0,
        0,
        1,
      );

      const mDRF = mDsqrt.multiply(mRT).multiply(mF);

      const transformAngle = (phi) => {
        const { x: cosR, y: sinR } = new Vector3(
          Math.cos(phi),
          Math.sin(phi),
          0,
        ).applyMatrix3(mDRF);

        return Math.atan2(sinR, cosR);
      };

      curve.aStartAngle = transformAngle(curve.aStartAngle);
      curve.aEndAngle = transformAngle(curve.aEndAngle);

      if (isTransformFlipped(m)) {
        curve.aClockwise = !curve.aClockwise;
      }
    }
  }

  function transfEllipseNoSkew(curve) {
    // Faster shortcut if no skew is applied
    // (e.g, a euclidean transform of a group containing the ellipse)

    const sx = getTransformScaleX(m);
    const sy = getTransformScaleY(m);

    curve.xRadius *= sx;
    curve.yRadius *= sy;

    // Extract rotation angle from the matrix of form:
    //
    //  | cosθ sx   -sinθ sy |
    //  | sinθ sx    cosθ sy |
    //
    // Remembering that tanθ = sinθ / cosθ; and that
    // `sx`, `sy`, or both might be zero.
    const theta =
      sx > Number.EPSILON
        ? Math.atan2(m.elements[1], m.elements[0])
        : Math.atan2(-m.elements[3], m.elements[4]);

    curve.aRotation += theta;

    if (isTransformFlipped(m)) {
      curve.aStartAngle *= -1;
      curve.aEndAngle *= -1;
      curve.aClockwise = !curve.aClockwise;
    }
  }

  const subPaths = path.subPaths;

  for (let i = 0, n = subPaths.length; i < n; i++) {
    const subPath = subPaths[i];
    const curves = subPath.curves;

    for (let j = 0; j < curves.length; j++) {
      const curve = curves[j];

      if (curve.isLineCurve) {
        transfVec2(curve.v1);
        transfVec2(curve.v2);
      } else if (curve.isCubicBezierCurve) {
        transfVec2(curve.v0);
        transfVec2(curve.v1);
        transfVec2(curve.v2);
        transfVec2(curve.v3);
      } else if (curve.isQuadraticBezierCurve) {
        transfVec2(curve.v0);
        transfVec2(curve.v1);
        transfVec2(curve.v2);
      } else if (curve.isEllipseCurve) {
        // Transform ellipse center point

        tempV2.set(curve.aX, curve.aY);
        transfVec2(tempV2);
        curve.aX = tempV2.x;
        curve.aY = tempV2.y;

        // Transform ellipse shape parameters

        if (isTransformSkewed(m)) {
          transfEllipseGeneric(curve);
        } else {
          transfEllipseNoSkew(curve);
        }
      }
    }
  }
}

function isTransformFlipped(m) {
  const te = m.elements;
  return te[0] * te[4] - te[1] * te[3] < 0;
}

function isTransformSkewed(m) {
  const te = m.elements;
  const basisDot = te[0] * te[3] + te[1] * te[4];

  // Shortcut for trivial rotations and transformations
  if (basisDot === 0) return false;

  const sx = getTransformScaleX(m);
  const sy = getTransformScaleY(m);

  return Math.abs(basisDot / (sx * sy)) > Number.EPSILON;
}

function getTransformScaleX(m) {
  const te = m.elements;
  return Math.sqrt(te[0] * te[0] + te[1] * te[1]);
}

function getTransformScaleY(m) {
  const te = m.elements;
  return Math.sqrt(te[3] * te[3] + te[4] * te[4]);
}

// Calculates the eigensystem of a real symmetric 2x2 matrix
//    [ A  B ]
//    [ B  C ]
// in the form
//    [ A  B ]  =  [ cs  -sn ] [ rt1   0  ] [  cs  sn ]
//    [ B  C ]     [ sn   cs ] [  0   rt2 ] [ -sn  cs ]
// where rt1 >= rt2.
//
// Adapted from: https://www.mpi-hd.mpg.de/personalhomes/globes/3x3/index.html
// -> Algorithms for real symmetric matrices -> Analytical (2x2 symmetric)
function eigenDecomposition(A, B, C) {
  let rt1, rt2, cs, sn, t;
  const sm = A + C;
  const df = A - C;
  const rt = Math.sqrt(df * df + 4 * B * B);

  if (sm > 0) {
    rt1 = 0.5 * (sm + rt);
    t = 1 / rt1;
    rt2 = A * t * C - B * t * B;
  } else if (sm < 0) {
    rt2 = 0.5 * (sm - rt);
  } else {
    // This case needs to be treated separately to avoid div by 0

    rt1 = 0.5 * rt;
    rt2 = -0.5 * rt;
  }

  // Calculate eigenvectors

  if (df > 0) {
    cs = df + rt;
  } else {
    cs = df - rt;
  }

  if (Math.abs(cs) > 2 * Math.abs(B)) {
    t = (-2 * B) / cs;
    sn = 1 / Math.sqrt(1 + t * t);
    cs = t * sn;
  } else if (Math.abs(B) === 0) {
    cs = 1;
    sn = 0;
  } else {
    t = (-0.5 * cs) / B;
    cs = 1 / Math.sqrt(1 + t * t);
    sn = t * cs;
  }

  if (df > 0) {
    t = cs;
    cs = -sn;
    sn = t;
  }

  return { rt1, rt2, cs, sn };
}
