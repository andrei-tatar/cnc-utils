// Regression harness: runs projects through the app's real pipelines (shapes
// → G-code → toolpaths → job checks → simulation) in Node, saves what comes
// out, and compares two runs geometrically. See README.md.
//
//   node run.mjs record <out dir> [filter]
//   node run.mjs compare <baseline dir> <current dir> <report dir> [filter]
// Partially compiled Angular libraries (ng-bootstrap, pulled in by the
// model's field configs) need the JIT compiler to load.
import '@angular/compiler';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { concat, NEVER, of, Subscription } from 'rxjs';
import { installImagePolyfill } from './image-polyfill';
import { running } from './fake-worker';
import fixtures from './projects/_all';
import { Fixture } from './projects/fixture';
import { generateShapesFromModel } from '../../src/app/pipeline/shapes';
import {
  buildProgram,
  generateGcodeFromOperations,
  Program,
  programPaths,
  programTime,
} from '../../src/app/pipeline/gcode';
import { jobChecks } from '../../src/app/pipeline/job-checks';
import { simulationInput } from '../../src/app/pipeline/simulation';
import { simulateStock } from '../../src/worker/work/simulate-stock';
import { resolveModel } from '../../src/app/model-editor/variables/resolve';
import { ModelFieldConfig, ModelType } from '../../src/app/model-editor/model';
import { loadModelFromGcode } from '../../src/app/store';
import { CamPath, CamShape } from '../../src/cam/types';
import { outlinePoints } from './outline';

installImagePolyfill();

// Bundled into .build/.
const ROOT = path.resolve(__dirname, '../../..');

/** How far apart (mm) two runs may be and still count as the same. */
const TOLERANCE = {
  /** Shape outlines (Hausdorff distance). */
  shape: 0.03,
  /** Cutting moves (Hausdorff distance, 3D). */
  path: 0.05,
  /** Material left after cutting, height (mm)… */
  height: 0.05,
  /** …allowing for an edge moved by up to this many cells. */
  heightCells: 1,
  /** Total cutting length (relative). */
  length: 0.02,
  /** Estimated job time (relative). */
  time: 0.05,
};

/** Give up on a project after this long (ms). */
const TIMEOUT = 180_000;

// ------------------------------------------------------------------ record

type Polyline = { close: boolean; points: number[][] };

type Output = {
  name: string;
  covers: string;
  error?: string;
  /** Outlines by shape id. */
  shapes: Record<string, Polyline[]>;
  /** Cutting moves by operation id (3D polylines; travel left out). */
  operations: Record<
    string,
    { type: string; carve: number[][][]; length: number }
  >;
  gcodeLines: number;
  gcodeArcs: number;
  time: number;
  warnings: string[];
  heightmap: {
    minX: number;
    minY: number;
    cell: number;
    nx: number;
    ny: number;
    top: number;
    bottom: number;
  } | null;
};

async function allFixtures(): Promise<Fixture[]> {
  const templates: Fixture[] = [];
  const dir = path.join(ROOT, 'templates');
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.nc'))
    .sort()) {
    const model = (await loadModelFromGcode(
      fs.readFileSync(path.join(dir, file), 'utf8'),
    )) as ModelType | null;
    if (model) {
      templates.push({
        name: `template-${file.replace(/\.nc$/, '')}`,
        covers: `template ${file}`,
        model,
      });
    }
  }
  return [...templates, ...fixtures];
}

/** Runs one project through the pipelines until nothing is left to compute. */
async function runProject(
  fixture: Fixture,
): Promise<{ output: Output; heights: Float32Array | null }> {
  const model = resolveModel(fixture.model, ModelFieldConfig);
  const model$ = concat(of(model), NEVER);
  const shapes = generateShapesFromModel(model$, NEVER);
  const program$ = generateGcodeFromOperations(model$, shapes, NEVER);

  let latestShapes: CamShape[] | null = null;
  let latestProgram: Program | null = null;
  let error: unknown = null;
  const subscription = new Subscription();
  subscription.add(
    shapes.all$.subscribe({
      next: (s) => (latestShapes = s),
      error: (e) => (error = e),
    }),
  );
  subscription.add(
    program$.subscribe({
      next: (p) => (latestProgram = p),
      error: (e) => (error = e),
    }),
  );

  // Settled: no work running for a while, and a program out.
  const started = Date.now();
  let quiet = 0;
  while (quiet < 5) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    quiet =
      running.count === 0 && latestProgram && latestShapes ? quiet + 1 : 0;
    if (error) break;
    if (Date.now() - started > TIMEOUT) {
      error = new Error(`timed out with ${running.count} work calls running`);
      break;
    }
  }
  subscription.unsubscribe();

  const output: Output = {
    name: fixture.name,
    covers: fixture.covers,
    shapes: {},
    operations: {},
    gcodeLines: 0,
    gcodeArcs: 0,
    time: 0,
    warnings: [],
    heightmap: null,
  };
  if (error || !latestProgram || !latestShapes) {
    output.error = String(
      (error as Error)?.stack ?? error ?? 'nothing came out',
    );
    return { output, heights: null };
  }
  const program: Program = latestProgram;
  const camShapes: CamShape[] = latestShapes;

  for (const shape of camShapes) {
    const list = (output.shapes[shape.sourceShapeId] ??= []);
    for (const polygon of shape.polygons) {
      list.push({
        close: polygon.close,
        points: outlinePoints(polygon).map((p) => [round(p.x), round(p.y)]),
      });
    }
  }

  const paths: CamPath[] = programPaths(program);
  for (const p of paths) {
    if (p.type !== 'carve' || !p.sourceOperationId) continue;
    const op = (output.operations[p.sourceOperationId] ??= {
      type:
        model.operations.find((o) => o.id === p.sourceOperationId)?.type ?? '?',
      carve: [],
      length: 0,
    });
    op.carve.push(p.points.map((q) => [round(q.x), round(q.y), round(q.z)]));
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1],
        b = p.points[i];
      op.length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
  }

  const gcode = buildProgram(program);
  const lines = gcode.split('\n');
  output.gcodeLines = lines.length;
  output.gcodeArcs = lines.filter((l) => /^G0?[23]\b/.test(l)).length;
  output.time = programTime(program).total;
  output.warnings = jobChecks(model, paths, camShapes).map(
    (w) => `${w.level}: ${w.text}`,
  );

  let heights: Float32Array | null = null;
  const input = simulationInput(paths, model);
  if (input) {
    const map = await simulateStock(paths, input.tools, input.stock);
    const { heights: h, ...rest } = map;
    output.heightmap = rest;
    heights = h;
  }
  return { output, heights };
}

function round(v: number) {
  return Math.round(v * 1e5) / 1e5;
}

async function record(outDir: string, filter?: string) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const fixture of await allFixtures()) {
    if (filter && !fixture.name.includes(filter)) continue;
    const t = Date.now();
    let result;
    try {
      result = await runProject(fixture);
    } catch (e) {
      result = {
        output: {
          name: fixture.name,
          covers: fixture.covers,
          error: String((e as Error)?.stack ?? e),
        } as Output,
        heights: null,
      };
    }
    fs.writeFileSync(
      path.join(outDir, `${fixture.name}.json`),
      JSON.stringify(result.output),
    );
    if (result.heights) {
      fs.writeFileSync(
        path.join(outDir, `${fixture.name}.heights.bin`),
        Buffer.from(result.heights.buffer),
      );
    }
    const ops = Object.values(result.output.operations ?? {});
    console.log(
      `${result.output.error ? 'ERROR' : 'ok   '} ${fixture.name.padEnd(44)} ${String(Date.now() - t).padStart(6)} ms` +
        `  ${Object.keys(result.output.shapes ?? {}).length} shapes, ${ops.length} ops, ${ops.reduce((s, o) => s + o.carve.length, 0)} cuts` +
        (result.output.error
          ? `\n      ${result.output.error.split('\n')[0]}`
          : ''),
    );
  }
  // Rxjs timers or fetches may keep Node alive.
  process.exit(0);
}

// ------------------------------------------------------------------ compare

type Seg = [number[], number[]];

/** Nearest-segment lookups on a grid. */
class SegmentIndex {
  private cells = new Map<string, Seg[]>();
  constructor(
    private segments: Seg[],
    private size: number,
  ) {
    for (const s of segments) {
      const [a, b] = s;
      const x0 = Math.floor(Math.min(a[0], b[0]) / size),
        x1 = Math.floor(Math.max(a[0], b[0]) / size);
      const y0 = Math.floor(Math.min(a[1], b[1]) / size),
        y1 = Math.floor(Math.max(a[1], b[1]) / size);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(s);
        }
    }
  }
  /** Distance to the nearest segment, searched up to `limit`. */
  distance(p: number[], limit: number): number {
    if (!this.segments.length) return Infinity;
    const cx = Math.floor(p[0] / this.size),
      cy = Math.floor(p[1] / this.size);
    const reach = Math.ceil(limit / this.size);
    let best = Infinity;
    for (let r = 0; r <= reach; r++) {
      for (let x = cx - r; x <= cx + r; x++)
        for (let y = cy - r; y <= cy + r; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          for (const s of this.cells.get(`${x},${y}`) ?? [])
            best = Math.min(best, segmentDistance(p, s[0], s[1]));
        }
      // Anything in a further ring is at least r cells away.
      if (best <= r * this.size) break;
    }
    return best;
  }
}

function segmentDistance(p: number[], a: number[], b: number[]) {
  const d = a.map((v, i) => b[i] - v);
  const l2 = d.reduce((s, v) => s + v * v, 0);
  const t = l2
    ? Math.max(
        0,
        Math.min(1, d.reduce((s, v, i) => s + v * (p[i] - a[i]), 0) / l2),
      )
    : 0;
  return Math.hypot(...a.map((v, i) => p[i] - (v + t * d[i])));
}

function segmentsOf(lines: { close?: boolean; points: number[][] }[]): Seg[] {
  const segments: Seg[] = [];
  for (const line of lines) {
    const pts = line.points;
    if (pts.length === 1) segments.push([pts[0], pts[0]]);
    for (let i = 1; i < pts.length; i++) segments.push([pts[i - 1], pts[i]]);
    if (line.close && pts.length > 2)
      segments.push([pts[pts.length - 1], pts[0]]);
  }
  return segments;
}

/** Points along the segments, every `step`. */
function samples(segments: Seg[], step: number): number[][] {
  const out: number[][] = [];
  for (const [a, b] of segments) {
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(...a.map((v, i) => b[i] - v)) / step),
    );
    for (let k = 0; k <= n; k++)
      out.push(a.map((v, i) => v + ((b[i] - v) * k) / n));
  }
  return out;
}

/** Worst distance from either set to the other, and where. */
function hausdorff(a: Seg[], b: Seg[], limit: number) {
  const ia = new SegmentIndex(a, 1),
    ib = new SegmentIndex(b, 1);
  let worst = 0;
  let at: number[] | null = null;
  for (const [from, to] of [
    [a, ib],
    [b, ia],
  ] as const) {
    for (const p of samples(from as Seg[], 0.05)) {
      const d = (to as SegmentIndex).distance(p, limit);
      if (d > worst) {
        worst = d;
        at = p;
      }
      if (worst === Infinity) break;
    }
  }
  return { worst, at };
}

type Check = { what: string; ok: boolean; detail: string };

function compareOutputs(
  base: Output,
  cur: Output,
  baseHeights: Float32Array | null,
  curHeights: Float32Array | null,
): Check[] {
  const checks: Check[] = [];
  if (base.error || cur.error) {
    checks.push({
      what: 'runs',
      ok: !!base.error === !!cur.error,
      detail: `baseline: ${base.error?.split('\n')[0] ?? 'ok'}; now: ${cur.error?.split('\n')[0] ?? 'ok'}`,
    });
    return checks;
  }
  const ids = new Set([
    ...Object.keys(base.shapes),
    ...Object.keys(cur.shapes),
  ]);
  for (const id of ids) {
    const a = base.shapes[id] ?? [],
      b = cur.shapes[id] ?? [];
    const h = hausdorff(segmentsOf(a), segmentsOf(b), 5);
    const ok = h.worst <= TOLERANCE.shape && a.length > 0 === b.length > 0;
    checks.push({
      what: `shape ${id}`,
      ok,
      detail: `${a.length}→${b.length} outlines, off by ${fmt(h.worst)} mm${h.at ? ` at ${h.at.map(fmt).join(',')}` : ''}`,
    });
  }
  const ops = new Set([
    ...Object.keys(base.operations),
    ...Object.keys(cur.operations),
  ]);
  for (const id of ops) {
    const a = base.operations[id],
      b = cur.operations[id];
    if (!a || !b) {
      checks.push({
        what: `operation ${id}`,
        ok: false,
        detail: `${a ? 'cuts' : 'no cuts'} → ${b ? 'cuts' : 'no cuts'}`,
      });
      continue;
    }
    const h = hausdorff(
      segmentsOf(a.carve.map((points) => ({ points }))),
      segmentsOf(b.carve.map((points) => ({ points }))),
      5,
    );
    const lengthChange =
      Math.abs(b.length - a.length) / Math.max(a.length, 1e-9);
    checks.push({
      what: `operation ${id} (${a.type})`,
      ok: h.worst <= TOLERANCE.path,
      detail: `paths off by ${fmt(h.worst)} mm${h.at ? ` at ${h.at.map(fmt).join(',')}` : ''}; ${a.carve.length}→${b.carve.length} cuts, length ${fmt(a.length)}→${fmt(b.length)} (${(lengthChange * 100).toFixed(1)}%)`,
    });
  }
  const timeChange = Math.abs(cur.time - base.time) / Math.max(base.time, 1e-9);
  checks.push({
    what: 'time',
    ok: timeChange <= TOLERANCE.time || Math.abs(cur.time - base.time) < 2,
    detail: `${fmt(base.time)}→${fmt(cur.time)} s`,
  });
  const removed = base.warnings.filter((w) => !cur.warnings.includes(w));
  const added = cur.warnings.filter((w) => !base.warnings.includes(w));
  checks.push({
    what: 'warnings',
    ok: !removed.length && !added.length,
    detail:
      removed.length || added.length
        ? `gone: ${JSON.stringify(removed)}; new: ${JSON.stringify(added)}`
        : `${base.warnings.length} same`,
  });
  checks.push({
    what: 'G-code',
    ok: true,
    detail: `${base.gcodeLines}→${cur.gcodeLines} lines, ${base.gcodeArcs}→${cur.gcodeArcs} arcs`,
  });

  if (base.heightmap && cur.heightmap && baseHeights && curHeights) {
    const h = compareHeights(
      base.heightmap,
      baseHeights,
      cur.heightmap,
      curHeights,
    );
    checks.push({
      what: 'material left',
      ok: h.bad === 0,
      detail: `${h.bad} of ${h.total} cells off by more than ${TOLERANCE.height} mm (worst ${fmt(h.worst)} mm${h.at ? ` at ${h.at.map(fmt).join(',')}` : ''})`,
    });
  } else if (!!base.heightmap !== !!cur.heightmap) {
    checks.push({
      what: 'material left',
      ok: false,
      detail: 'simulated in only one run',
    });
  }
  return checks;
}

/**
 * Cells where the material differs, allowing an edge to have moved by up to
 * `heightCells`: a cell matches if a cell that near in the other run has
 * (nearly) its height. Checked both ways.
 */
function compareHeights(
  a: Output['heightmap'] & {},
  ah: Float32Array,
  b: Output['heightmap'] & {},
  bh: Float32Array,
) {
  let bad = 0,
    total = 0,
    worst = 0;
  let at: number[] | null = null;
  const sample = (m: typeof a, h: Float32Array, x: number, y: number) => {
    const i = Math.floor((x - m.minX) / m.cell),
      j = Math.floor((y - m.minY) / m.cell);
    return i < 0 || j < 0 || i >= m.nx || j >= m.ny ? m.top : h[j * m.nx + i];
  };
  for (const [m, h, o, oh] of [
    [a, ah, b, bh],
    [b, bh, a, ah],
  ] as const) {
    for (let j = 0; j < m.ny; j++)
      for (let i = 0; i < m.nx; i++) {
        const x = m.minX + (i + 0.5) * m.cell,
          y = m.minY + (j + 0.5) * m.cell;
        const v = h[j * m.nx + i];
        let best = Infinity;
        const r = TOLERANCE.heightCells * Math.max(m.cell, o.cell);
        for (const dx of [-r, 0, r])
          for (const dy of [-r, 0, r])
            best = Math.min(best, Math.abs(sample(o, oh, x + dx, y + dy) - v));
        total++;
        if (best > TOLERANCE.height) {
          bad++;
          if (best > worst) {
            worst = best;
            at = [x, y];
          }
        }
      }
  }
  return { bad, total, worst, at };
}

function fmt(v: number) {
  return Number.isFinite(v)
    ? (Math.round(v * 1000) / 1000).toString()
    : String(v);
}

function load(dir: string, name: string) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  const output = JSON.parse(fs.readFileSync(file, 'utf8')) as Output;
  const bin = path.join(dir, `${name}.heights.bin`);
  const heights = fs.existsSync(bin)
    ? new Float32Array(new Uint8Array(fs.readFileSync(bin)).buffer)
    : null;
  return { output, heights };
}

/** Top view of a failing check: baseline blue, now red. */
function overlay(base: Output, cur: Output, check: Check): string | null {
  const pick = (o: Output): { close?: boolean; points: number[][] }[] => {
    if (check.what.startsWith('shape '))
      return o.shapes[check.what.slice(6)] ?? [];
    const id = check.what.match(/^operation (\S+)/)?.[1];
    return id
      ? (o.operations[id]?.carve ?? []).map((points) => ({ points }))
      : [];
  };
  const a = pick(base),
    b = pick(cur);
  const all = [...a, ...b].flatMap((l) => l.points);
  if (!all.length) return null;
  const minX = Math.min(...all.map((p) => p[0])) - 1,
    maxX = Math.max(...all.map((p) => p[0])) + 1;
  const minY = Math.min(...all.map((p) => p[1])) - 1,
    maxY = Math.max(...all.map((p) => p[1])) + 1;
  const S = 1200 / Math.max(maxX - minX, maxY - minY);
  const line = (l: { close?: boolean; points: number[][] }, colour: string) =>
    `<${l.close ? 'polygon' : 'polyline'} points="${l.points.map((p) => `${((p[0] - minX) * S).toFixed(1)},${((maxY - p[1]) * S).toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="1" opacity="0.7"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${((maxX - minX) * S).toFixed(0)}" height="${((maxY - minY) * S).toFixed(0)}"><rect width="100%" height="100%" fill="white"/>${a.map((l) => line(l, '#1565c0')).join('')}${b.map((l) => line(l, '#d32f2f')).join('')}</svg>`;
}

async function compare(
  baseDir: string,
  curDir: string,
  reportDir: string,
  filter?: string,
) {
  fs.mkdirSync(reportDir, { recursive: true });
  const namesIn = (dir: string) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  const names = [...new Set([...namesIn(baseDir), ...namesIn(curDir)])]
    .filter((n) => !filter || n.includes(filter))
    .sort();
  let failed = 0;
  const report: string[] = [
    '# Regression comparison',
    '',
    `baseline: ${baseDir}`,
    `now: ${curDir}`,
    '',
  ];
  for (const name of names) {
    const base = load(baseDir, name);
    const cur = load(curDir, name);
    if (!base) {
      report.push(
        `## ✗ ${name}`,
        '',
        'no baseline: record it again (check.mjs --fresh)',
        '',
      );
      console.log(`FAIL ${name}: no baseline`);
      failed++;
      continue;
    }
    if (!cur) {
      report.push(`## ✗ ${name}`, '', 'no output in the current run', '');
      failed++;
      continue;
    }
    const checks = compareOutputs(
      base.output,
      cur.output,
      base.heights,
      cur.heights,
    );
    const ok = checks.every((c) => c.ok);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    report.push(
      `## ${ok ? '✓' : '✗'} ${name}`,
      '',
      `_${base.output.covers}_`,
      '',
    );
    for (const c of checks) {
      report.push(`- ${c.ok ? '✓' : '✗'} ${c.what}: ${c.detail}`);
      if (!c.ok) {
        console.log(`     ✗ ${c.what}: ${c.detail}`);
        const svg = overlay(base.output, cur.output, c);
        if (svg) {
          const file = `${name}--${c.what.replace(/[^a-zA-Z0-9-]+/g, '_')}.svg`;
          fs.writeFileSync(path.join(reportDir, file), svg);
          report.push(`  - overlay: ${file}`);
        }
      }
    }
    report.push('');
  }
  report.splice(
    4,
    0,
    `**${names.length - failed} of ${names.length} projects match.**`,
    '',
  );
  fs.writeFileSync(path.join(reportDir, 'report.md'), report.join('\n'));
  console.log(
    `\n${names.length - failed} of ${names.length} projects match; report in ${reportDir}/report.md`,
  );
  process.exit(failed ? 1 : 0);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'record') {
  record(args[0], args[1]);
} else if (command === 'compare') {
  compare(args[0], args[1], args[2], args[3]);
} else {
  console.log(
    'usage: record <out dir> [filter] | compare <baseline> <current> <report dir> [filter]',
  );
  process.exit(2);
}
