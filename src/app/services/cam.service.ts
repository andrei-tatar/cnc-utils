import { inject, Injectable } from '@angular/core';
import {
  combineLatest,
  concatMap,
  filter,
  firstValueFrom,
  map,
  Observable,
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

  private download$ = new Subject<'one' | 'per-tool'>();

  constructor() {
    this.download$
      .pipe(
        withLatestFrom(this.program$),
        // The project as it is now, not as it was when last routed.
        concatMap(async ([how, program]) => ({
          how,
          program,
          metadata: await getModelMetadata(this.store.value),
        })),
      )
      .subscribe(({ how, program, metadata }) => {
        // Named after the saved project the work belongs to, if any.
        const name = `${
          fileNameFrom(this.store.project?.name ?? '') || 'gcode'
        }-${new Date().getTime()}`;
        if (how === 'one') {
          downloadFile(buildProgram(program, metadata), `${name}.nc`);
          return;
        }
        const files = buildProgramPerTool(program, metadata);
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
    // Points as close as the geometry is kept (Clipper rounds it), the curve
    // between them as close as the polygons follow the original curves.
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
