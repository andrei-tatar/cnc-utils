import { inject, Injectable } from '@angular/core';
import {
  combineLatest,
  concatMap,
  map,
  Observable,
  ReplaySubject,
  share,
  Subject,
  withLatestFrom,
} from 'rxjs';
import { CamPath, CamShape, Highlight } from '../../cam/types';
import {
  buildProgram,
  generateGcodeFromOperations,
  Program,
  programPaths,
  programTime,
} from '../pipeline/gcode';
import { resolveStock, StockOptions, stockOffset } from '../../cam/stock';
import { distinctJson } from '../pipeline/operators';
import { describeOperation } from '../model-editor/operations/describe';
import {
  hiddenShapeIds,
  highlightFromModel,
  reuseUnchangedPaths,
} from '../pipeline/preview';
import { generateShapesFromModel } from '../pipeline/shapes';
import { downloadFile } from '../project-file';
import { getModelMetadata } from '../store';
import { ModelStore } from './model-store.service';
import { WorkTracker } from './work-tracker.service';

/**
 * Wires the reactive graph: model → shapes → G-code → toolpaths, plus what
 * the preview shows highlighted or hidden.
 */
@Injectable({ providedIn: 'root' })
export class CamService {
  private store = inject(ModelStore);
  private workTracker = inject(WorkTracker);

  private readonly shapes = generateShapesFromModel(
    this.store.changes$,
    this.workTracker.working$,
  );

  readonly shapes$: Observable<CamShape[]> = this.shapes.all$;

  readonly program$: Observable<Program> = generateGcodeFromOperations(
    this.store.changes$,
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

  /** The stock, and where the G-code's zero is in design coordinates. */
  readonly stock$: Observable<StockView> = this.store.changes$.pipe(
    map((model) => {
      const stock = resolveStock(model.stock);
      const offset = stockOffset(stock);
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
    this.store.changes$,
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

  private download$ = new Subject<void>();

  constructor() {
    this.download$
      .pipe(
        withLatestFrom(this.program$),
        // The project as it is now, not as it was when last routed.
        concatMap(async ([, program]) =>
          buildProgram(program, await getModelMetadata(this.store.value)),
        ),
      )
      .subscribe((gcode) => {
        downloadFile(gcode, `gcode-${new Date().getTime()}.nc`);
      });
  }

  /** Downloads the latest G-code (with the project embedded). */
  download() {
    this.download$.next();
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
