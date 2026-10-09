import { BoxAnchor, GcodeOptions } from '../cam/gcode-options';
import { StockOptions } from '../cam/stock';
import { rotaryOf, sideUp } from '../cam/rotary';
import { arcOf, forEachSegment, polygonsBounds } from '../cam/arcs';
import { CamPath, CamPoint, CamPolygon, CamShape } from '../cam/types';

/** What goes on the setup sheet. */
export type SetupSheetData = {
  title: string;
  date: Date;
  stock: StockOptions;
  /** Where the G-code's X0 Y0 Z0 is, in design coordinates. */
  zero: { x: number; y: number; z: number };
  options: GcodeOptions;
  /** The operations that cut, in order. */
  operations: {
    id: string;
    name: string;
    /** "T2 Ø6 mm end mill". */
    tool: string | null;
    /**
     * Degrees the rotary axis turns the stock to for it, each time it's
     * cut (null: no axis).
     */
    angles?: number[] | null;
    /** Wrapped round the round stock, from each angle. */
    wrapped?: boolean;
    seconds: number;
  }[];
  total: number;
  shapes: CamShape[];
  paths: CamPath[];
  /** Things to look out for (warnings, clamps): one line each. */
  notes: string[];
};

const ANCHORS: Record<BoxAnchor, string> = {
  'xmin-ymin': 'bottom-left corner',
  'xcenter-ymin': 'bottom middle',
  'xmax-ymin': 'bottom-right corner',
  'xmin-ycenter': 'left middle',
  'xcenter-ycenter': 'middle',
  'xmax-ycenter': 'right middle',
  'xmin-ymax': 'top-left corner',
  'xcenter-ymax': 'top middle',
  'xmax-ymax': 'top-right corner',
};

/** Colours for the operations' toolpaths on the drawing. */
const COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

/** A printable page for whoever runs the job: stock, zero, tools, times. */
export function setupSheetHtml(data: SetupSheetData): string {
  const { stock, options } = data;
  const mm = (v: number) => `${round(v)} mm`;

  const xy =
    stock.enabled && stock.xyZero !== 'design'
      ? `the stock’s ${ANCHORS[stock.xyZero]}`
      : 'the design’s origin';
  const rotary = rotaryOf(stock);
  const z =
    !stock.enabled || stock.zZero === 'top'
      ? rotary
        ? 'the top of the stock, at 0°'
        : 'the top of the stock'
      : rotary
        ? 'the rotary axis'
        : 'the bottom of the stock (the spoilboard)';
  const turn = (angles: readonly number[]) =>
    angles
      .map((angle) => {
        const side = rotary && sideUp(rotary.along, angle);
        return `${round(angle)}°${side ? ` (${side})` : ''}`;
      })
      .join(', ');
  const toolChange =
    options.toolChange === 'm6'
      ? 'automatic (T<n> M6)'
      : options.toolChange === 'pause'
        ? 'by hand: the program pauses (M0) for each'
        : 'none in the program';

  // Each tool change in order, with the operations until the next one (a
  // tool used again later is fitted again).
  const tools: [string, string[]][] = [];
  for (const op of data.operations) {
    const key = op.tool ?? 'no tool';
    const last = tools[tools.length - 1];
    if (last?.[0] === key) {
      last[1].push(op.name);
    } else {
      tools.push([key, [op.name]]);
    }
  }

  const color = new Map(
    data.operations.map((op, i) => [op.id, COLORS[i % COLORS.length]]),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(data.title)} · setup sheet</title>
<style>
  :root { color-scheme: light; --line: #d4d4d8; --muted: #52525b; }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; background: #fff; margin: 0; padding: 24px; }
  main { max-width: 960px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid #18181b; padding-bottom: 8px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 22px 0 6px; }
  .meta { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0 32px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; }
  td.check { width: 28px; }
  .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #18181b; border-radius: 2px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }
  ul.notes { margin: 0; padding-left: 18px; }
  ul.notes li { margin: 2px 0; }
  figure { margin: 0; border: 1px solid var(--line); border-radius: 4px; padding: 8px; }
  figure svg { width: 100%; height: auto; max-height: 520px; display: block; }
  .print { position: fixed; right: 16px; top: 16px; font: inherit; padding: 6px 14px; border: 1px solid #18181b; background: #fff; border-radius: 4px; cursor: pointer; }
  @media print { .print { display: none; } body { padding: 0; } h2 { break-after: avoid; } figure, table { break-inside: avoid; } }
</style>
</head>
<body>
<button class="print" onclick="window.print()">Print</button>
<main>
<header>
  <h1>${esc(data.title)}</h1>
  <span class="meta">Setup sheet · ${esc(data.date.toLocaleString())} · about ${duration(data.total)}</span>
</header>

<div class="grid">
  <section>
    <h2>Stock</h2>
    <dl>
      ${
        stock.enabled
          ? `<dt>Size</dt><dd>${
              rotary?.round
                ? `Ø${round(stock.diameter)} × ${mm(rotary.along === 'x' ? stock.width : stock.height)}, round`
                : `${round(stock.width)} × ${round(stock.height)} × ${mm(stock.thickness)}`
            }</dd>
      <dt>Corner at</dt><dd>X${round(stock.x)} Y${round(stock.y)} (design)</dd>${
        rotary
          ? `
      <dt>Held</dt><dd>on the rotary axis (${esc(options.rotaryAxis)}), along ${rotary.along.toUpperCase()}, centred on it</dd>`
          : ''
      }`
          : `<dt>Size</dt><dd>not set in the project</dd>`
      }
    </dl>
  </section>
  <section>
    <h2>Zero</h2>
    <dl>
      <dt>X0 Y0</dt><dd>${esc(xy)}</dd>
      <dt>Z0</dt><dd>${esc(z)}</dd>
      <dt>Safe height</dt><dd>${
        rotary
          ? `${mm(options.safetyHeight)} above the stock’s corners as it turns`
          : `${mm(options.safetyHeight)} above Z0`
      }</dd>
      <dt>Tool changes</dt><dd>${esc(toolChange)}</dd>
    </dl>
  </section>
</div>

<h2>Tools, in the order they’re used</h2>
<table>
  <thead><tr><th class="check"></th><th>Tool</th><th>For</th></tr></thead>
  <tbody>
  ${tools
    .map(
      ([tool, ops]) =>
        `<tr><td class="check"><span class="box"></span></td><td>${esc(tool)}</td><td>${ops.map(esc).join('<br>')}</td></tr>`,
    )
    .join('\n  ')}
  </tbody>
</table>

<h2>Operations</h2>
<table>
  <thead><tr><th class="check"></th><th>#</th><th>Operation</th><th>Tool</th>${rotary ? '<th>Turned to</th>' : ''}<th class="num">Time</th></tr></thead>
  <tbody>
  ${data.operations
    .map(
      (op, i) =>
        `<tr><td class="check"><span class="box"></span></td><td>${i + 1}</td><td><span class="swatch" style="background:${color.get(op.id)}"></span>${esc(op.name)}</td><td>${esc(op.tool ?? '—')}</td>${rotary ? `<td>${esc(`${op.wrapped ? 'wrapped round from ' : ''}${turn(op.angles ?? [0])}`)}</td>` : ''}<td class="num">${duration(op.seconds)}</td></tr>`,
    )
    .join('\n  ')}
  <tr><td></td><td></td><td><strong>Total</strong></td><td></td>${rotary ? '<td></td>' : ''}<td class="num"><strong>${duration(data.total)}</strong></td></tr>
  </tbody>
</table>

${
  data.notes.length
    ? `<h2>Check before cutting</h2>
<ul class="notes">${data.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : ''
}

<h2>Top view${rotary ? ' (cuts with the stock turned aren’t drawn)' : ''}</h2>
<figure>${drawing(data, color)}</figure>
</main>
</body>
</html>`;
}

/** The job from above: stock, shape outlines, cuts and the zero. */
function drawing(data: SetupSheetData, color: Map<string, string>): string {
  const { stock, zero } = data;
  const points: CamPoint[] = [
    ...data.shapes.flatMap((s) =>
      s.polygons.flatMap((p) => {
        // Arcs included.
        const box = polygonsBounds([p]);
        return [
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.maxY },
        ];
      }),
    ),
    ...data.paths.filter((p) => p.type === 'carve').flatMap((p) => p.points),
    { x: zero.x, y: zero.y },
  ];
  if (stock.enabled) {
    points.push(
      { x: stock.x, y: stock.y },
      { x: stock.x + stock.width, y: stock.y + stock.height },
    );
  }
  const finite = points.filter((p) => Number.isFinite(p.x + p.y));
  if (finite.length < 2) {
    return '<p class="meta">Nothing to draw yet.</p>';
  }
  const minX = Math.min(...finite.map((p) => p.x));
  const maxX = Math.max(...finite.map((p) => p.x));
  const minY = Math.min(...finite.map((p) => p.y));
  const maxY = Math.max(...finite.map((p) => p.y));
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const pad = size * 0.06;
  const stroke = size / 500;
  // SVG's Y runs down: flip it, so the drawing looks like the preview.
  const pt = (p: CamPoint) => `${round(p.x)},${round(-p.y)}`;
  const line = (ps: CamPoint[], close: boolean) =>
    ps.length ? `M${ps.map(pt).join('L')}${close ? 'Z' : ''}` : '';
  // Lines and arcs; with Y flipped, a counter-clockwise arc turns the
  // negative way in SVG's terms (sweep flag 0).
  const outline = (polygon: CamPolygon) => {
    const { vertices, close } = polygon;
    let d = `M${pt(vertices[0])}`;
    forEachSegment(polygon, (a, b, bulge, i) => {
      if (bulge) {
        const r = round(arcOf(a, b, bulge).radius);
        d += `A${r},${r} 0 ${Math.abs(bulge) > 1 ? 1 : 0},${bulge > 0 ? 0 : 1} ${pt(b)}`;
      } else if (!close || i < vertices.length - 1) {
        // "Z" draws the closing line.
        d += `L${pt(b)}`;
      }
    });
    return close ? `${d}Z` : d;
  };

  const parts: string[] = [];
  if (stock.enabled) {
    parts.push(
      `<rect x="${round(stock.x)}" y="${round(-(stock.y + stock.height))}" width="${round(stock.width)}" height="${round(stock.height)}" fill="#fafaf9" stroke="#a8a29e" stroke-width="${stroke * 1.5}"/>`,
    );
  }
  const outlines = data.shapes
    .flatMap((s) => s.polygons)
    .filter((p) => p.vertices.length > 1)
    .map(outline)
    .join('');
  parts.push(
    `<path d="${outlines}" fill="none" stroke="#a1a1aa" stroke-width="${stroke}"/>`,
  );
  const tabs = data.shapes.flatMap((s) => s.tabs ?? []);
  if (tabs.length) {
    parts.push(
      `<path d="${tabs.map((t) => line(t.points, true)).join('')}" fill="#22d3ee" fill-opacity="0.6" stroke="#0891b2" stroke-width="${stroke}"/>`,
    );
  }
  const byOperation = new Map<string, string[]>();
  for (const path of data.paths) {
    if (path.type !== 'carve' || !path.sourceOperationId) continue;
    const d = line(path.points, false);
    byOperation.set(path.sourceOperationId, [
      ...(byOperation.get(path.sourceOperationId) ?? []),
      d,
    ]);
  }
  for (const [id, ds] of byOperation) {
    parts.push(
      `<path d="${ds.join('')}" fill="none" stroke="${color.get(id) ?? '#2563eb'}" stroke-width="${stroke * 1.4}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  // The zero: a cross with a label.
  const r = size / 40;
  parts.push(
    `<g stroke="#18181b" stroke-width="${stroke * 2}"><path d="M${round(zero.x - r)},${round(-zero.y)}h${round(2 * r)}M${round(zero.x)},${round(-zero.y - r)}v${round(2 * r)}"/></g>`,
    `<text x="${round(zero.x + r * 0.6)}" y="${round(-zero.y - r * 0.6)}" font-size="${round(size / 30)}" font-family="system-ui, sans-serif" fill="#18181b">X0 Y0</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX - pad)} ${round(-maxY - pad)} ${round(maxX - minX + 2 * pad)} ${round(maxY - minY + 2 * pad)}">${parts.join('')}</svg>`;
}

/** "1 h 05 min", "4 min 10 s", "35 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

function esc(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}
