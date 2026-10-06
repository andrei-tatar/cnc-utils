import { CamPoint } from './types';

/**
 * Points typed as text: one per line, x and y separated by a comma, space,
 * semicolon or tab. Lines that don't hold two numbers are skipped (e.g. a
 * header pasted from a spreadsheet).
 */
export function parsePointList(text: string | null | undefined): CamPoint[] {
  const points: CamPoint[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const numbers = line
      .trim()
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);
    if (numbers.length >= 2 && numbers.every(Number.isFinite)) {
      points.push({ x: numbers[0], y: numbers[1] });
    }
  }
  return points;
}

/** `countX` × `countY` points, `spacingX` / `spacingY` apart, from (0, 0). */
export function gridPoints(
  countX: number,
  countY: number,
  spacingX: number,
  spacingY: number,
): CamPoint[] {
  const points: CamPoint[] = [];
  for (let j = 0; j < Math.max(0, Math.round(countY)); j++) {
    for (let i = 0; i < Math.max(0, Math.round(countX)); i++) {
      points.push({ x: i * spacingX, y: j * spacingY });
    }
  }
  return points;
}

/**
 * `count` points evenly round a circle of `diameter` centred on (0, 0), the
 * first at `startAngle` degrees (counter-clockwise from +X).
 */
export function circlePoints(
  count: number,
  diameter: number,
  startAngle: number,
): CamPoint[] {
  const n = Math.max(0, Math.round(count));
  const r = diameter / 2;
  return Array.from({ length: n }, (_, k) => {
    const a = ((startAngle + (360 * k) / n) * Math.PI) / 180;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

/** SVG path data through the points. */
export function pathData(points: CamPoint[], close: boolean): string {
  if (!points.length) return '';
  const [first, ...rest] = points;
  return (
    `M ${first.x},${first.y}` +
    rest.map((p) => ` L ${p.x},${p.y}`).join('') +
    (close ? ' Z' : '')
  );
}
