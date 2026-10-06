import { inject, Injectable } from '@angular/core';
import {
  map,
  Observable,
  ReplaySubject,
  share,
  Subject,
  withLatestFrom,
} from 'rxjs';
import { gcodeToPaths } from '../../cam/gcode-viewer';
import { CamPath, CamShape, Highlight } from '../../cam/types';
import { generateGcodeFromOperations } from '../pipeline/gcode';
import { hiddenShapeIds, highlightFromModel } from '../pipeline/preview';
import { generateShapesFromModel } from '../pipeline/shapes';
import { downloadFile } from '../project-file';
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

  readonly shapes$: Observable<CamShape[]> = generateShapesFromModel(
    this.store.changes$,
    this.workTracker.working$,
  );

  readonly gcode$: Observable<string> = generateGcodeFromOperations(
    this.store.changes$,
    this.shapes$,
    this.workTracker.working$,
  ).pipe(share({ connector: () => new ReplaySubject(1) }));

  readonly paths$: Observable<CamPath[]> = this.gcode$.pipe(
    map((gcode) => gcodeToPaths(gcode)),
  );

  readonly hiddenShapes$: Observable<string[]> = hiddenShapeIds(
    this.store.model$,
  );

  readonly highlight$: Observable<Highlight> = highlightFromModel(
    this.store.model$,
  );

  private download$ = new Subject<void>();

  constructor() {
    this.download$.pipe(withLatestFrom(this.gcode$)).subscribe(([, gcode]) => {
      downloadFile(gcode, `gcode-${new Date().getTime()}.nc`);
    });
  }

  /** Downloads the latest G-code (with the project embedded). */
  download() {
    this.download$.next();
  }
}
