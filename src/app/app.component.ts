import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ViewerComponent } from './viewer/viewer.component';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  race,
  ReplaySubject,
  scan,
  share,
  Subject,
  switchMap,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';
import { CamPath, CamShape, Highlight } from '../cam/types';
import { AsyncPipe } from '@angular/common';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import {
  migrateModel,
  ModelType,
  OperationParameters,
  ShapeParameters,
  ShapeType,
  ToolParameters,
  TransformParameters,
} from './model-editor/model';
import worker from '../worker';
import { GCodeBuilder } from '../cam/gcode-builder';
import { gcodeToPaths } from '../cam/gcode-viewer';
import { getModelMetadata, loadModelFromMetadata } from './store';
import { deepEqual, readFile } from '../util';

type VCarveSource = {
  shapeId: string;
  vToolSize: number;
  vAngle: number;
  tipDiameter: number;
  startDepth: number;
  maxDepth: number;
};

const EDITOR_WIDTH_STORAGE_KEY = 'ui.editorWidth';
const MIN_EDITOR_WIDTH = 280;
const MIN_VIEWER_WIDTH = 200;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ViewerComponent, AsyncPipe, ModelEditorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly DEFAULT_EDITOR_WIDTH = 420;
  readonly NO_HIGHLIGHT: Highlight = { shapes: [], operations: [] };
  editorWidth = signal(this.loadEditorWidth());
  resizing = false;
  private resizeOffset = 0;

  private destroy$ = new Subject<any>();
  private workLocks = new BehaviorSubject(0);

  private working$ = new Observable<never>(() => {
    this.workLocks.next(this.workLocks.value + 1);
    return () => this.workLocks.next(this.workLocks.value - 1);
  });

  isWorking$ = this.workLocks.pipe(
    map((locks) => locks > 0),
    distinctUntilChanged(),
    debounceTime(100),
  );

  model$ = new BehaviorSubject<ModelType>(this.loadModel());
  drawShapes$!: Observable<CamShape[]>;
  drawPaths$!: Observable<CamPath[]>;

  download$ = new Subject();
  upload$ = new Subject();

  /**
   * An expanded operation highlights its toolpaths and the shape it cuts;
   * otherwise an expanded shape highlights itself and its toolpaths.
   */
  highlight$: Observable<Highlight> = this.model$.pipe(
    map(({ shapes, tools, operations }) => {
      const expandedOperations = (operations ?? []).filter((o) => o.expanded);
      if (expandedOperations.length) {
        const shapeIds = expandedOperations.flatMap(
          ({ id, expanded, name, shapeId, toolId, ...parameters }) => {
            const source = AppComponent.vCarveSource(
              parameters,
              operations,
              tools,
            );
            const effective = source ? source.shapeId : shapeId;
            return effective ? [effective] : [];
          },
        );
        return {
          shapes: [...new Set(shapeIds)],
          operations: expandedOperations.map((o) => o.id),
        };
      }
      return {
        shapes: [...new Set(shapes.filter((s) => s.expanded).map((s) => s.id))],
        operations: [],
      };
    }),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  );

  ngOnInit(): void {
    const model$ = this.model$.pipe(
      distinctUntilChanged(),
      tap(this.saveModel.bind(this)),
    );

    const shapes$ = AppComponent.generateShapesFromModel(model$, this.working$);
    this.drawShapes$ = shapes$;

    const gcode$ = AppComponent.generateGcodeFromOperations(
      model$,
      shapes$,
      this.working$,
    ).pipe(share({ connector: () => new ReplaySubject(1) }));

    this.drawPaths$ = gcode$.pipe(map((gcode) => gcodeToPaths(gcode)));

    var downloadData = (function () {
      var a = document.createElement('a');
      a.setAttribute('style', 'display: none');
      document.body.appendChild(a);

      return (data: string, fileName: string) => {
        var blob = new Blob([data], { type: 'octet/stream' }),
          url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
      };
    })();

    this.download$.pipe(withLatestFrom(gcode$)).subscribe(([, gcode]) => {
      downloadData(gcode, `gcode-${new Date().getTime()}.nc`);
    });

    this.upload$
      .pipe(
        switchMap(() => readFile()),
        switchMap((file) => file.text()),
        switchMap((content) => {
          const modelPrefix = '; model=';
          const foundLine = content
            .split('\n')
            .find((l) => l.startsWith(modelPrefix));

          if (foundLine) {
            return loadModelFromMetadata(
              foundLine.substring(modelPrefix.length),
            ).then(migrateModel);
          }

          return EMPTY;
        }),
      )
      .subscribe((model) => {
        this.model$.next(model);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(1);
  }

  startResize(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    const divider = event.currentTarget as HTMLElement;
    divider.setPointerCapture(event.pointerId);
    this.resizing = true;
    // Keep the grab point under the cursor instead of snapping to it.
    this.resizeOffset = event.clientX - this.editorWidth();
    event.preventDefault();
  }

  resize(event: PointerEvent) {
    if (this.resizing) {
      this.setEditorWidth(event.clientX - this.resizeOffset, false);
    }
  }

  endResize(event: PointerEvent) {
    if (!this.resizing) {
      return;
    }
    this.resizing = false;
    this.setEditorWidth(this.editorWidth());

    const divider = event.currentTarget as HTMLElement;
    if (divider.hasPointerCapture(event.pointerId)) {
      divider.releasePointerCapture(event.pointerId);
    }
  }

  setEditorWidth(width: number, persist = true) {
    const max = Math.max(
      MIN_EDITOR_WIDTH,
      window.innerWidth - MIN_VIEWER_WIDTH,
    );
    const clamped = Math.round(
      Math.min(max, Math.max(MIN_EDITOR_WIDTH, width)),
    );
    this.editorWidth.set(clamped);
    if (persist) {
      try {
        localStorage.setItem(EDITOR_WIDTH_STORAGE_KEY, String(clamped));
      } catch {}
    }
  }

  private loadEditorWidth(): number {
    try {
      const stored = Number(localStorage.getItem(EDITOR_WIDTH_STORAGE_KEY));
      if (stored >= MIN_EDITOR_WIDTH) {
        return Math.min(
          stored,
          Math.max(MIN_EDITOR_WIDTH, window.innerWidth - MIN_VIEWER_WIDTH),
        );
      }
    } catch {}
    return this.DEFAULT_EDITOR_WIDTH;
  }

  private loadModel(): ModelType {
    const model = localStorage.getItem('model');
    return migrateModel(model ? JSON.parse(model) : {});
  }

  private saveModel(model: ModelType) {
    localStorage.setItem('model', JSON.stringify(model));
  }

  /**
   * For a v-carve clearing operation: the v-carve it clears for (shape,
   * V-bit and depths). Null for other operations, or while that v-carve or
   * its V-bit is missing.
   */
  private static vCarveSource(
    operation: OperationParameters,
    operations: ModelType['operations'],
    tools: ModelType['tools'],
  ): VCarveSource | null {
    if (operation.type !== 'v-carve-clear') {
      return null;
    }
    const vcarve = operations.find((o) => o.id === operation.vcarveOperationId);
    if (vcarve?.type !== 'v-carve') {
      return null;
    }
    const tool = tools.find((t) => t.id === vcarve.toolId);
    if (tool?.bitType !== 'v-bit') {
      return null;
    }
    return {
      shapeId: vcarve.shapeId,
      vToolSize: tool.diameter,
      vAngle: tool.vAngle,
      tipDiameter: tool.tipDiameter,
      startDepth: vcarve.startDepth,
      maxDepth: vcarve.maxDepth,
    };
  }

  private static generateGcodeFromOperations(
    model$: Observable<ModelType>,
    shapes$: Observable<CamShape[]>,
    working$: Observable<never>,
  ) {
    return model$.pipe(
      scan(
        (ctx, { tools, operations }) => {
          return (operations ?? []).map(
            ({
              id,
              expanded: _,
              name: __,
              shapeId,
              toolId,
              ...operationParameters
            }) => {
              const tool = tools.find((t) => t.id === toolId);
              const toolParameters: ToolParameters | null = tool
                ? (({ id: _, expanded: __, name: ___, ...parameters }) =>
                    parameters)(tool)
                : null;

              // V-carve clearing borrows its shape, bit and depths from the
              // v-carve it clears for, so it follows any change made there.
              const source = AppComponent.vCarveSource(
                operationParameters,
                operations,
                tools,
              );
              const effectiveShapeId = source ? source.shapeId : shapeId;

              const existing = ctx.find((e) => e.id === id);
              if (existing) {
                existing.operationParameters$.next(operationParameters);
                existing.shapeId$.next(effectiveShapeId);
                existing.toolParameters$.next(toolParameters);
                existing.source$.next(source);
                return existing;
              }

              const operationParameters$ = new BehaviorSubject(
                operationParameters,
              );
              const shapeId$ = new BehaviorSubject(effectiveShapeId);
              const toolParameters$ = new BehaviorSubject(toolParameters);
              const source$ = new BehaviorSubject(source);

              const shape$ = combineLatest([
                shapeId$.pipe(distinctUntilChanged()),
                shapes$.pipe(debounceTime(0)),
              ]).pipe(
                map(([shapeId, allShapes]) =>
                  allShapes.filter((shape) => shape.sourceShapeId === shapeId),
                ),
                distinctUntilChanged(
                  (a, b) =>
                    a.length === b.length &&
                    a.every((aa, index) => b[index] === aa),
                ),
              );

              const result$ = combineLatest([
                shape$,
                operationParameters$.pipe(
                  distinctUntilChanged(
                    (a, b) => a === b,
                    (s) => JSON.stringify(s),
                  ),
                ),
                toolParameters$.pipe(
                  distinctUntilChanged(
                    (a, b) => a === b,
                    (s) => JSON.stringify(s),
                  ),
                ),
                source$.pipe(
                  distinctUntilChanged(
                    (a, b) => a === b,
                    (s) => JSON.stringify(s),
                  ),
                ),
              ]).pipe(
                switchMap(([shape, op, tool, source]) => {
                  // No (or a deleted) tool selected yet: nothing to cut.
                  if (!tool) {
                    return of(new GCodeBuilder());
                  }
                  const {
                    bitType,
                    diameter,
                    vAngle,
                    tipDiameter,
                    feedRate,
                    plungeFeedRate,
                  } = tool;
                  const toolGcode = new GCodeBuilder()
                    .sourceOperationId(id)
                    .carveFeedrate(feedRate)
                    .plungeFeedRate(plungeFeedRate);
                  switch (op.type) {
                    case 'pocket':
                      return race(
                        worker
                          .routePocketHole(shape, {
                            toolSize: diameter,
                            toolEngagement: op.toolEngagement,
                            leaveStock: op.leaveStock,
                            depthPerStep: op.depth,
                            steps: op.steps,
                            startDepth: op.startDepth,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                    case 'flat':
                      return race(
                        worker
                          .flatOutline(shape, {
                            toolSize: diameter,
                            toolEngagement: op.toolEngagement,
                            depth: op.depthPerStep,
                            steps: op.steps,
                            interpolateStepSize: op.interpolateStepSize,
                            allPassesInSameDirection:
                              op.allPassesInSameDirection,
                            alongAxis: op.alongAxis,
                            growByToolsize: op.growByToolsize,
                            applyConvexHullOnShape: op.applyConvexHullOnShape,
                            pauseAfterEachStep: op.pauseAfterEachStep,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                    case 'profile':
                      return race(
                        worker
                          .routeProfile(shape, {
                            toolSize: diameter,
                            side: op.side,
                            direction: op.direction,
                            startDepth: op.startDepth,
                            depthPerStep: op.depth,
                            steps: op.steps,
                            tabsEnabled: op.tabsEnabled,
                            tabCount: op.tabCount,
                            tabWidth: op.tabWidth,
                            tabHeight: op.tabHeight,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                    case 'v-carve':
                      if (bitType !== 'v-bit') {
                        return of(new GCodeBuilder());
                      }
                      return race(
                        worker
                          .routeVCarve(shape, {
                            toolSize: diameter,
                            vAngle,
                            tipDiameter,
                            startDepth: op.startDepth,
                            maxDepth: op.maxDepth,
                            stepover: op.stepover,
                            clearFlatBottom: op.clearFlatBottom,
                            sharpCorners: op.sharpCorners ?? true,
                            sharpCornerAngle: op.sharpCornerAngle ?? 150,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                    case 'v-carve-clear':
                      if (!source || bitType === 'v-bit') {
                        return of(new GCodeBuilder());
                      }
                      return race(
                        worker
                          .routeVCarveClearing(shape, {
                            toolSize: diameter,
                            toolEngagement: op.toolEngagement,
                            depthPerStep: op.depthPerStep,
                            leaveStock: op.leaveStock,
                            vToolSize: source.vToolSize,
                            vAngle: source.vAngle,
                            tipDiameter: source.tipDiameter,
                            startDepth: source.startDepth,
                            maxDepth: source.maxDepth,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                  }

                  return of(new GCodeBuilder());
                }),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              return {
                id,
                operationParameters$,
                toolParameters$,
                result$,
                shapeId$,
                source$,
              };
            },
          );
        },
        [] as Array<{
          id: string;
          operationParameters$: BehaviorSubject<OperationParameters>;
          toolParameters$: BehaviorSubject<ToolParameters | null>;
          shapeId$: BehaviorSubject<string>;
          source$: BehaviorSubject<VCarveSource | null>;
          result$: Observable<GCodeBuilder>;
        }>,
      ),
      // Incomplete operations (no tool, shape or type yet) emit an empty
      // builder rather than nothing, so they don't stall the whole G-code.
      switchMap((s) =>
        s.length ? combineLatest(s.map((i) => i.result$)) : of([]),
      ),
      distinctUntilChanged((a, b) => {
        return a.length === b.length && a.every((aa, index) => b[index] === aa);
      }),
      withLatestFrom(model$),
      switchMap(async ([builders, model]) => {
        const compressed = await getModelMetadata(model);

        const meta = new GCodeBuilder().addModelMetadata(compressed);
        const result = [meta, ...builders].reduce((a, b) => a.concat(b));
        // The final retract belongs to no operation.
        const gcode = result
          .sourceOperationId('')
          .goToSafeHeight()
          .stopProgram()
          .build({
            safetyHeight: 10,
            carveFeedRate: 1200,
            plungeFeedRate: 300,
          });
        return gcode;
      }),
    );
  }

  private static generateShapesFromModel(
    model$: Observable<ModelType>,
    working$: Observable<never>,
  ) {
    const shapes$ = model$.pipe(
      scan(
        (ctx, { shapes }) => {
          return shapes.map(
            ({
              id: shapeId,
              transforms: shapeTransforms,
              expanded: _,
              name: __,
              ...shapeParameters
            }) => {
              const existing = ctx.find((e) => e.shapeId === shapeId);
              if (existing) {
                existing.shapeParameters$.next(shapeParameters);
                existing.shapeTransforms$.next(shapeTransforms);
                return existing;
              }

              const shapeParameters$ = new BehaviorSubject(shapeParameters);
              const shapeTransforms$ = new BehaviorSubject(shapeTransforms);

              const shape$ = shapeParameters$.pipe(
                distinctUntilChanged((a, b) => deepEqual(a, b)),
                map((t) => {
                  if (t.type === 'boolean') {
                    const shape1$ = shapes$.pipe(
                      switchMap(
                        (s) =>
                          s.find((v) => v.shapeId === t.shape1Id)?.result$ ??
                          // Deleted or unset shape: treat as empty instead of
                          // waiting forever (which stalls every shape).
                          of([] as CamShape[]),
                      ),
                      distinctUntilChanged(),
                    );
                    const shape2$ = shapes$.pipe(
                      switchMap(
                        (s) =>
                          s.find((v) => v.shapeId === t.shape2Id)?.result$ ??
                          // Deleted or unset shape: treat as empty instead of
                          // waiting forever (which stalls every shape).
                          of([] as CamShape[]),
                      ),
                      distinctUntilChanged(),
                    );
                    const result$: Observable<CamShape[]> = combineLatest([
                      shape1$,
                      shape2$,
                    ]).pipe(
                      debounceTime(0),
                      switchMap(([s1, s2]) => {
                        if (!t.operationType || !t.fillRule) {
                          return [];
                        }

                        return worker.applyBooleanOperation(
                          s1,
                          s2,
                          t.operationType,
                          t.fillRule,
                          shapeId,
                        );
                      }),
                    );
                    return result$;
                  }

                  if (t.type === 'text') {
                    return worker.importText(t, shapeId);
                  }

                  return worker.importSvg(this.createSvgFromShape(t), shapeId);
                }),
                switchMap((resolveShape) => race(resolveShape, working$)),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              const transforms$ = shapeTransforms$.pipe(
                scan(
                  (ctx, transforms) =>
                    transforms.map(
                      ({
                        id: transformId,
                        expanded: _,
                        ...transformParams
                      }) => {
                        const existing = ctx.find(
                          (t) => t.transformId === transformId,
                        );
                        if (existing) {
                          existing.transformParameters$.next(transformParams);
                          return existing;
                        }

                        const transformParameters$ = new BehaviorSubject(
                          transformParams,
                        );

                        const input = new Subject<CamShape[]>();

                        const output$ = transformParameters$.pipe(
                          distinctUntilChanged(
                            (a, b) => a === b,
                            (s) => JSON.stringify(s),
                          ),
                          switchMap((transform) => {
                            return input.pipe(
                              distinctUntilChanged(),
                              switchMap((shape) =>
                                race(
                                  worker.applyTransform(shape, transform),
                                  working$,
                                ),
                              ),
                            );
                          }),
                          share({
                            connector: () => new ReplaySubject(1),
                            resetOnRefCountZero: () => timer(0),
                          }),
                        );

                        return {
                          transformId,
                          transformParameters$,
                          input,
                          output$,
                        };
                      },
                    ),
                  [] as Array<{
                    transformId: string;
                    transformParameters$: BehaviorSubject<TransformParameters>;
                    input: Subject<CamShape[]>;
                    output$: Observable<CamShape[]>;
                  }>,
                ),
              );

              const result$ = transforms$.pipe(
                switchMap((all) => {
                  let input$ = shape$;

                  const watch: Observable<never>[] = [];
                  for (let i = 0; i < all.length; i++) {
                    watch.push(
                      input$.pipe(
                        tap((v) => all[i].input.next(v)),
                        ignoreElements(),
                      ),
                    );
                    input$ = all[i].output$;
                  }
                  return merge(input$, ...watch);
                }),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              return {
                shapeId: shapeId,
                result$,
                shapeParameters$,
                shapeTransforms$,
              };
            },
          );
        },
        [] as Array<{
          shapeId: string;
          shapeParameters$: BehaviorSubject<ShapeParameters>;
          shapeTransforms$: BehaviorSubject<ShapeType['transforms']>;
          result$: Observable<CamShape[]>;
        }>,
      ),
      share({
        connector: () => new ReplaySubject(1),
      }),
    );

    return shapes$.pipe(
      // With no shapes, emit an empty list rather than nothing.
      switchMap((s) =>
        s.length ? combineLatest(s.map((i) => i.result$)) : of([]),
      ),
      map((s) => s.flatMap((i) => i)),
      share({
        connector: () => new ReplaySubject(1),
      }),
    );
  }

  private static createSvgFromShape(
    t: Exclude<ShapeParameters, { type: 'boolean' | 'text' }>,
  ) {
    switch (t.type) {
      case 'circle':
        return `<svg><circle r="${t.diameter / 2}"/></svg>`;
      case 'rectangle':
        return `<svg><rect width="${t.width}" height="${t.height}" rx="${t.radius}"/></svg>`;
      case 'svg':
        return t.svg ?? `<svg></svg>`;
      case 'line':
        return `<svg><line x1="0" y1="0" x2="${t.width}" y2="0" /></svg>`;
      case 'path-data':
        return `<svg><path d="${t.data}" /></svg>`;
      default:
        return `<svg></svg>`;
    }
  }
}
