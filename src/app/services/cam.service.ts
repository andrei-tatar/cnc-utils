import { inject, Injectable } from '@angular/core';
import {
  combineLatest,
  concatMap,
  filter,
  firstValueFrom,
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  race,
  switchMap,
  ReplaySubject,
  share,
  shareReplay,
  Subject,
  withLatestFrom,
} from 'rxjs';
import { CamPath, CamShape, Highlight } from '../../cam/types';
import {
  buildProgram,
  buildProgramPerTool,
  generateGcodeFromOperations,
  operationDescriptions,
  Program,
  programPaths,
  programTime,
} from '../pipeline/gcode';
import { resolveStock, StockOptions, stockOffset } from '../../cam/stock';
import { resolveGcodeOptions } from '../../cam/gcode-options';
import { shapesToSvg } from '../../cam/svg-export';
import { distinctJson } from '../pipeline/operators';
import { describeOperation } from '../model-editor/operations/describe';
import {
  hiddenShapeIds,
  highlightFromModel,
  reuseUnchangedPaths,
} from '../pipeline/preview';
import { generateShapesFromModel } from '../pipeline/shapes';
import { downloadFile, fileNameFrom } from '../project-file';
import { createZip } from '../zip';
import { setupSheetHtml } from '../setup-sheet';
import { CutListRow, cutListCsv } from '../cut-list';
import { nestLayout } from '../pipeline/nest';
import { shapeLabel } from '../model-editor/shapes/describe';
import { borrowedShapeId } from '../model-editor/operations/describe';
import { nestPolygons } from '../../cam/polygon-nesting';
import { hasArcs, polygonsBounds } from '../../cam/arcs';
import { JobWarning } from '../../cam/job-checks';
import type { Heightmap } from '../../cam/simulate';
import {
  loadSimulationQuality,
  saveSimulationQuality,
  SIMULATION_CELLS,
  SimulationQuality,
  simulationInput,
} from '../pipeline/simulation';
import worker from '../../worker';
import { jobChecks } from '../pipeline/job-checks';
import { numberedToolLabel } from '../model-editor/tools';
import { getModelMetadata } from '../store';
import { ModelFieldConfig, ModelType } from '../model-editor/model';
import { resolveModel } from '../model-editor/variables/resolve';
import { ShapeExporter } from '../model-editor/shapes/shape-export';
import { ModelStore } from './model-store.service';
import { WorkTracker } from './work-tracker.service';

/**
 * Wires the reactive graph: model → shapes → G-code → toolpaths, plus what
 * the preview shows highlighted or hidden.
 */
@Injectable({ providedIn: 'root' })
export class CamService implements ShapeExporter {
  private store = inject(ModelStore);
  private workTracker = inject(WorkTracker);

  /**
   * The model with the variables worked out and put in place of the
   * expressions in number fields. Changing a variable re-emits it, and the
   * pipelines below then re-run whatever its new value changes.
   */
  private readonly model$: Observable<ModelType> = this.store.changes$.pipe(
    map((model) => resolveModel(model, ModelFieldConfig)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private readonly shapes = generateShapesFromModel(
    this.model$,
    this.workTracker.working$,
  );

  readonly shapes$: Observable<CamShape[]> = this.shapes.all$;

  readonly program$: Observable<Program> = generateGcodeFromOperations(
    this.model$,
    this.shapes,
    this.workTracker.working$,
  ).pipe(share({ connector: () => new ReplaySubject(1) }));

  /**
   * The toolpaths for the preview, straight from the program (no G-code is
   * written for it). Unchanged paths keep their identity across edits, so
   * the viewer only redraws what changed.
   */
  readonly paths$: Observable<CamPath[]> = this.program$.pipe(
    map((program) => programPaths(program)),
    reuseUnchangedPaths(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** What to look at before cutting (see `checkJob`), warnings first. */
  readonly warnings$: Observable<JobWarning[]> = combineLatest([
    this.model$,
    this.paths$,
    this.shapes$,
  ]).pipe(
    // Shapes and paths settle one after the other: check once they have.
    debounceTime(150),
    map(([model, paths, shapes]) => jobChecks(model, paths, shapes)),
    distinctJson(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** Whether to simulate the material left (see `simulation$`). */
  readonly simulate$ = new BehaviorSubject(false);

  /** How finely to simulate (see `SIMULATION_CELLS`), kept in this browser. */
  readonly simulationQuality$ = new BehaviorSubject<SimulationQuality>(
    loadSimulationQuality(),
  );

  setSimulationQuality(quality: SimulationQuality) {
    saveSimulationQuality(quality);
    this.simulationQuality$.next(quality);
  }

  /**
   * While simulating: what's left of the stock (or, without stock, of a
   * block round the cuts) once every toolpath is cut. Null otherwise.
   */
  readonly simulation$: Observable<Heightmap | null> = this.simulate$.pipe(
    distinctUntilChanged(),
    switchMap((on) =>
      !on
        ? of(null)
        : combineLatest([
            this.paths$,
            this.model$,
            this.simulationQuality$,
          ]).pipe(
            debounceTime(300),
            map(([paths, model, quality]) => ({
              paths,
              input: simulationInput(paths, model),
              cells: SIMULATION_CELLS[quality],
            })),
            // Edits that change neither the cuts, their bits nor the stock
            // (renames, feeds) don't simulate again.
            distinctUntilChanged(
              (a, b) =>
                a.paths === b.paths &&
                a.cells === b.cells &&
                JSON.stringify(a.input) === JSON.stringify(b.input),
            ),
            switchMap(({ paths, input, cells }) =>
              input
                ? race(
                    worker.simulateStock(
                      paths,
                      input.tools,
                      input.stock,
                      cells,
                    ),
                    this.workTracker.working$,
                  )
                : of(null),
            ),
          ),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** The shapes marked as clamps (keep-out zones), for the preview. */
  readonly clampShapes$: Observable<string[]> = this.model$.pipe(
    map((model) => model.shapes.filter((s) => s.clamp).map((s) => s.id)),
    distinctJson(),
  );

  readonly hiddenShapes$: Observable<string[]> = hiddenShapeIds(
    this.store.model$,
  );

  readonly highlight$: Observable<Highlight> = highlightFromModel(
    this.store.model$,
  );

  /**
   * The stock, and where the G-code's zero is in design coordinates (it can
   * depend on the toolpaths: see the reference point option).
   */
  readonly stock$: Observable<StockView> = combineLatest([
    this.model$,
    this.program$,
  ]).pipe(
    map(([model, program]) => {
      const stock = resolveStock(model.stock);
      const offset = program.options.offset ?? stockOffset(stock);
      return {
        stock,
        zero: { x: -offset.x, y: -offset.y, z: -offset.z },
      };
    }),
    distinctJson(),
  );

  /** Roughly how long the job takes, in all and per operation. */
  readonly time$: Observable<TimeSummary> = combineLatest([
    this.program$.pipe(map(programTime)),
    this.model$,
  ]).pipe(
    map(([time, model]) => ({
      total: time.total,
      operations: (model.operations ?? [])
        .filter((o) => (time.byOperation.get(o.id) ?? 0) > 0)
        .map((o) => ({
          name:
            o.name ||
            describeOperation(o, model.shapes, model.tools, model.operations),
          seconds: time.byOperation.get(o.id)!,
        })),
    })),
  );

  /** What to check before cutting, one line each (for the setup sheet). */
  readonly notes$: Observable<string[]> = this.warnings$.pipe(
    map((warnings) =>
      warnings.map((w) => (w.level === 'warning' ? `⚠ ${w.text}` : w.text)),
    ),
  );

  private download$ = new Subject<'one' | 'per-tool'>();

  constructor() {
    this.download$
      .pipe(
        withLatestFrom(this.program$, this.model$),
        // The project as it is now, not as it was when last routed.
        concatMap(async ([how, program, model]) => ({
          how,
          program,
          metadata: await getModelMetadata(this.store.value),
          descriptions: operationDescriptions(model),
        })),
      )
      .subscribe(({ how, program, metadata, descriptions }) => {
        // Named after the saved project the work belongs to, if any.
        const name = `${
          fileNameFrom(this.store.project?.name ?? '') || 'gcode'
        }-${new Date().getTime()}`;
        if (how === 'one') {
          downloadFile(
            buildProgram(program, metadata, descriptions),
            `${name}.nc`,
          );
          return;
        }
        const files = buildProgramPerTool(program, metadata, descriptions);
        const entries = files.map((file, i) => ({
          name: `${String(i + 1).padStart(2, '0')}-${
            fileNameFrom(
              file.toolNumber === null
                ? 'no-tool'
                : `T${file.toolNumber} ${file.label}`,
            ) || 'tool'
          }.nc`,
          data: file.gcode,
        }));
        downloadFile(createZip(entries), `${name}-by-tool.zip`);
      });
  }

  /** Downloads the latest G-code (with the project embedded). */
  download() {
    this.download$.next('one');
  }

  /**
   * Downloads the G-code as one file per tool, in a zip: for machines that
   * can't change tools in a program.
   */
  downloadPerTool() {
    this.download$.next('per-tool');
  }

  /**
   * Opens the setup sheet for the job in a new tab: stock, zero, tools in
   * order, operations with their times, a drawing from above. Opened at
   * once (browsers only allow it straight after a click), filled in when the
   * work in progress is done.
   */
  async openSetupSheet() {
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.document.write(
      '<p style="font: 14px system-ui">Preparing the setup sheet…</p>',
    );
    await firstValueFrom(this.workTracker.isWorking$.pipe(filter((w) => !w)));
    const [model, program, shapes, paths, view, notes] = await firstValueFrom(
      combineLatest([
        this.model$,
        this.program$,
        this.shapes$,
        this.paths$,
        this.stock$,
        this.notes$,
      ]),
    );
    const time = programTime(program);
    const operations = (model.operations ?? [])
      .filter((o) => !o.disabled && (time.byOperation.get(o.id) ?? 0) > 0)
      .map((o) => {
        const tool = model.tools.find((t) => t.id === o.toolId);
        return {
          id: o.id,
          name:
            o.name ||
            describeOperation(o, model.shapes, model.tools, model.operations),
          tool: tool ? numberedToolLabel(tool) : null,
          seconds: time.byOperation.get(o.id)!,
        };
      });
    const html = setupSheetHtml({
      title: this.store.project?.name || 'Untitled project',
      date: new Date(),
      stock: view.stock,
      zero: view.zero,
      options: program.options,
      operations,
      total: time.total,
      shapes: shapes.filter(
        (s) => !model.shapes.find((m) => m.id === s.sourceShapeId)?.hidden,
      ),
      paths,
      notes,
    });
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  }

  /**
   * Downloads the cut list as CSV: every nest's parts with where they go,
   * or, without nests, the parts the outside profiles cut out.
   */
  async downloadCutList() {
    await firstValueFrom(this.workTracker.isWorking$.pipe(filter((w) => !w)));
    const model = await firstValueFrom(this.model$);
    const stock = resolveStock(model.stock);
    const thickness = stock.enabled ? stock.thickness : null;
    const label = (id: string) =>
      shapeLabel(
        model.shapes.find((s) => s.id === id),
        model.shapes,
      );
    const resultOf = (id: string) => firstValueFrom(this.shapes.byId(id));
    const rows: CutListRow[] = [];

    for (const nest of model.shapes) {
      if (nest.type !== 'nest') continue;
      const items = nest.nestItems ?? [];
      const itemShapes = await Promise.all(
        items.map((item) => resultOf(item?.shapeId)),
      );
      const { result, boxes } = nestLayout(nest, itemShapes);
      const nestName = label(nest.id);
      const sorted = [...result.placements].sort(
        (a, b) => a.sheet - b.sheet || Number(a.key) - Number(b.key),
      );
      const size = (i: number) => {
        const box = boxes[i]!;
        const w = box.maxX - box.minX;
        const h = box.maxY - box.minY;
        return { length: Math.max(w, h), width: Math.min(w, h) };
      };
      for (const p of sorted) {
        const i = Number(p.key);
        rows.push({
          part: label(items[i].shapeId),
          copy: p.copy + 1,
          ...size(i),
          thickness,
          sheet: p.sheet + 1,
          x: p.x,
          y: p.y,
          turned: p.rotated,
          note: nestName,
        });
      }
      for (const u of result.unplaced) {
        const i = Number(u.key);
        rows.push({
          part: label(items[i].shapeId),
          copy: u.copy + 1,
          ...size(i),
          thickness,
          sheet: null,
          x: null,
          y: null,
          turned: null,
          note: `${nestName}: bigger than the sheet`,
        });
      }
    }

    if (!rows.length) {
      // No nests: what the outside profiles cut out, one row per outline.
      const operations = model.operations ?? [];
      const seen = new Set<string>();
      for (const op of operations) {
        if (op.disabled || op.type !== 'profile' || op.side !== 'outside') {
          continue;
        }
        const shapeId = borrowedShapeId(op, operations);
        if (!shapeId || seen.has(shapeId)) continue;
        seen.add(shapeId);
        const shapes = await resultOf(shapeId);
        const outlines = nestPolygons(
          shapes
            .flatMap((s) => s.polygons)
            .filter((p) => p.close && (p.vertices.length > 2 || hasArcs(p))),
        );
        outlines.forEach(({ outer }, k) => {
          // Arcs included.
          const box = polygonsBounds([outer]);
          const w = box.maxX - box.minX;
          const h = box.maxY - box.minY;
          rows.push({
            part: label(shapeId),
            copy: k + 1,
            length: Math.max(w, h),
            width: Math.min(w, h),
            thickness,
            sheet: null,
            x: null,
            y: null,
            turned: null,
            note: '',
          });
        });
      }
    }

    const name = fileNameFrom(this.store.project?.name ?? '');
    // With a byte order mark, so spreadsheets read it as UTF-8 (Ø, ×).
    downloadFile(
      '\ufeff' + cutListCsv(rows),
      `${name ? `${name}-` : ''}cut-list.csv`,
      'text/csv',
    );
  }

  /**
   * Downloads one shape (after its transforms) as an SVG in millimetres,
   * with arcs and Béziers in place of the polygons' short segments, e.g. to
   * cut it on a laser. Waits for any work in progress, so it's up to date.
   */
  async exportShapeSvg(shapeId: string, name: string) {
    await firstValueFrom(this.workTracker.isWorking$.pipe(filter((w) => !w)));
    const [shapes, model] = await firstValueFrom(
      combineLatest([this.shapes.byId(shapeId), this.model$]),
    );
    const options = resolveGcodeOptions(model.gcode);
    // Points as close as the geometry's precision, the curve between them as
    // close as the shapes follow the original curves.
    const points = Math.max(0.005, 10 ** -options.geometryDecimals);
    const svg = shapesToSvg(
      shapes,
      { points, chords: points + options.curveTolerance },
      name,
    );
    downloadFile(svg, `${fileNameFrom(name) || 'shape'}.svg`, 'image/svg+xml');
  }
}

/** The stock as the preview shows it. */
export type StockView = {
  stock: StockOptions;
  /** Where X0 Y0 Z0 of the G-code is, in design coordinates. */
  zero: { x: number; y: number; z: number };
};

export type TimeSummary = {
  total: number;
  operations: { name: string; seconds: number }[];
};
