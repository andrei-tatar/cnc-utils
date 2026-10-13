import { deflateSync } from 'node:zlib';
import { Fixture, project } from './fixture';
import { RING_PNG } from './shapes-imported';
import { circle, rect, relief, reliefRough, tool } from './operations-parts';

// 3D reliefs: from an image or an STL model, finished with a ball nose
// (a drop cutter over the relief), roughed out first with an end mill.

/** A square pyramid 20 × 20, 10 high (its sides), as a binary STL data URL. */
function pyramidStl(): string {
  const triangles = [
    [0, 0, 0, 20, 0, 0],
    [20, 0, 0, 20, 20, 0],
    [20, 20, 0, 0, 20, 0],
    [0, 20, 0, 0, 0, 0],
  ].flatMap((edge) => [...edge, 10, 10, 10]);
  const buffer = Buffer.alloc(84 + (triangles.length / 9) * 50);
  buffer.writeUInt32LE(triangles.length / 9, 80);
  triangles.forEach((value, k) =>
    buffer.writeFloatLE(value, 84 + Math.floor(k / 9) * 50 + 12 + (k % 9) * 4),
  );
  return `data:application/octet-stream;base64,${buffer.toString('base64')}`;
}

/**
 * A dome 64 × 64 pixels, white at its top, as a 16-bit grey PNG data URL:
 * a gentle slope that 8 bits would carve as steps.
 */
function domePng16(): string {
  const n = 64;
  const raw = Buffer.alloc(n * (1 + 2 * n));
  for (let y = 0; y < n; y++) {
    raw[y * (1 + 2 * n)] = 0;
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const v = Math.round(Math.sqrt(Math.max(0, 1 - d * d)) * 65535);
      raw.writeUInt16BE(v, y * (1 + 2 * n) + 1 + 2 * x);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(n, 0);
  header.writeUInt32BE(n, 4);
  header[8] = 16;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const ball3 = tool('t-ball', 1, 'ball-nose', 3);
const em6 = tool('t-em6', 2, 'end-mill', 6);

export default [
  {
    name: 'relief-image',
    covers:
      '3D relief from the ring PNG (light high) in a 30 mm disc: 2 deep, smoothed over 1 mm, the disc round it carved to the floor; Ø3 ball nose, stepover 0.1, lines along X back and forth',
    model: project({
      shapes: [circle('s-disc', 30)],
      tools: [ball3],
      operations: [
        relief('o-relief', 't-ball', 's-disc', RING_PNG, {
          reliefDepth: 2,
          smoothing: 1,
        }),
      ],
    }),
  },
  {
    name: 'relief-image-inverted-surface',
    covers:
      '3D relief from the ring PNG inverted (a mould), gamma 2, left uncut round it (contain in a 40 × 30 rectangle: the sides uncut), lines at 30° one way',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [ball3],
      operations: [
        relief('o-relief', 't-ball', 's-rect', RING_PNG, {
          invertRelief: true,
          gamma: 2,
          reliefAround: 'surface',
          rasterAngle: 30,
          allPassesInSameDirection: true,
        }),
      ],
    }),
  },
  {
    name: 'relief-stl-roughed',
    covers:
      '3D relief from an STL pyramid (binary), 6 deep in a 40 × 30 rectangle (contain), turned 90°: roughed out first with a Ø6 end mill (depthPerStep 1.5, leaveStock 0.3), then finished with a cross pass at 45°',
    model: project({
      shapes: [rect('s-rect', 40, 30)],
      tools: [ball3, em6],
      operations: [
        reliefRough('o-rough', 't-em6', 'o-relief', { depthPerStep: 1.5 }),
        relief('o-relief', 't-ball', 's-rect', pyramidStl(), {
          reliefDepth: 6,
          imageRotation: 90,
          rasterAngle: 45,
          crossPass: true,
        }),
      ],
    }),
  },
  {
    name: 'relief-png16',
    covers:
      '3D relief from a 16-bit grey PNG (a dome, read at full depth rather than the canvas’s 8 bits) in a 40 mm square, 4 deep, uncut round it; Ø3 ball nose, lines at 45°',
    model: project({
      shapes: [rect('s-rect', 40, 40)],
      tools: [ball3],
      operations: [
        relief('o-relief', 't-ball', 's-rect', domePng16(), {
          reliefDepth: 4,
          reliefAround: 'surface',
          rasterAngle: 45,
        }),
      ],
    }),
  },
] satisfies Fixture[];
