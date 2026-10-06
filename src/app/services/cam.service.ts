import { inject, Injectable } from '@angular/core';
import {
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
} from '../pipeline/gcode';
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
