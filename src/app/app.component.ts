import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
import { CamPath, CamShape } from '../cam/types';
import { AsyncPipe } from '@angular/common';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import {
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
import { readFile } from '../util';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ViewerComponent, AsyncPipe, ModelEditorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
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

  expandedShapes$ = this.model$.pipe(
    map((v) => [
      ...new Set(v.shapes.filter((v) => v.expanded).map((v) => v.id)),
    ]),
  );

  ngOnInit(): void {
    const model$ = this.model$.pipe(
      distinctUntilChanged(),
      tap(this.saveModel.bind(this)),
    );

    const shapes$ = AppComponent.generateShapesFromModel(
      model$,
      this.working$,
    ).pipe(
      share({
        connector: () => new ReplaySubject(1),
      }),
    );
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
            );
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

  private loadModel(): ModelType {
    const model = localStorage.getItem('model');
    if (!model) {
      return { shapes: [], tools: [] };
    }

    return JSON.parse(model);
  }

  private saveModel(model: ModelType) {
    localStorage.setItem('model', JSON.stringify(model));
  }

  private static generateGcodeFromOperations(
    model$: Observable<ModelType>,
    shapes$: Observable<CamShape[]>,
    working$: Observable<never>,
  ) {
    return model$.pipe(
      scan(
        (ctx, { tools }) => {
          return tools
            .flatMap((tool) =>
              tool.operations.map((operation) => ({ tool, operation })),
            )
            .map(
              ({
                tool: {
                  id: toolId,
                  expanded: ___,
                  name: _____,
                  operations: ____,
                  ...toolParameters
                },
                operation: {
                  id: operationId,
                  expanded: _,
                  name: __,
                  shapeId,
                  ...operationParameters
                },
              }) => {
                const id = `${toolId}-${operationId}`;
                const existing = ctx.find((e) => e.id === id);
                if (existing) {
                  existing.operationParameters$.next(operationParameters);
                  existing.shapeId$.next(shapeId);
                  existing.toolParameters$.next(toolParameters);
                  return existing;
                }

                const operationParameters$ = new BehaviorSubject(
                  operationParameters,
                );
                const shapeId$ = new BehaviorSubject(shapeId);
                const toolParameters$ = new BehaviorSubject(toolParameters);

                const shape$ = combineLatest([
                  shapeId$.pipe(distinctUntilChanged()),
                  shapes$.pipe(debounceTime(0)),
                ]).pipe(
                  map(([shapeId, allShapes]) =>
                    allShapes.filter(
                      (shape) => shape.sourceShapeId === shapeId,
                    ),
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
                ]).pipe(
                  switchMap(
                    ([
                      shape,
                      operationParameters,
                      { diameter, feedRate, plungeFeedRate },
                    ]) => {
                      const toolGcode = new GCodeBuilder()
                        .carveFeedrate(feedRate)
                        .plungeFeedRate(plungeFeedRate);
                      switch (operationParameters.type) {
                        case 'pocket':
                          return race(
                            worker
                              .routePocketHole(shape, {
                                toolSize: diameter,
                                toolEngagement:
                                  operationParameters.toolEngagement,
                                leaveStock: operationParameters.leaveStock,
                                depthPerStep: operationParameters.depth,
                                steps: operationParameters.steps,
                                startDepth: operationParameters.startDepth,
                              })
                              .pipe(
                                map((r) =>
                                  toolGcode.concat(GCodeBuilder.clone(r)),
                                ),
                              ),
                            working$,
                          );
                        case 'flat':
                          return race(
                            worker
                              .flatOutline(shape, {
                                toolSize: diameter,
                                toolEngagement:
                                  operationParameters.toolEngagement,
                                depth: operationParameters.depth,
                                interpolateStepSize:
                                  operationParameters.interpolateStepSize,
                                allPassesInSameDirection:
                                  operationParameters.allPassesInSameDirection,
                              })
                              .pipe(
                                map((r) =>
                                  toolGcode.concat(GCodeBuilder.clone(r)),
                                ),
                              ),
                            working$,
                          );
                      }

                      return EMPTY;
                    },
                  ),
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
                };
              },
            );
        },
        [] as Array<{
          id: string;
          operationParameters$: BehaviorSubject<OperationParameters>;
          toolParameters$: BehaviorSubject<ToolParameters>;
          shapeId$: BehaviorSubject<string>;
          result$: Observable<GCodeBuilder>;
        }>,
      ),
      switchMap((s) => combineLatest(s.map((i) => i.result$))),
      distinctUntilChanged((a, b) => {
        return a.length === b.length && a.every((aa, index) => b[index] === aa);
      }),
      withLatestFrom(model$),
      switchMap(async ([builders, model]) => {
        const compressed = await getModelMetadata(model);

        const meta = new GCodeBuilder().addModelMetadata(compressed);
        const result = [meta, ...builders].reduce((a, b) => a.concat(b));
        const gcode = result.goToSafeHeight().build({
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
    return model$.pipe(
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
                map((t) => {
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
                }),
                distinctUntilChanged(),
                switchMap((svg) =>
                  race(worker.importSvg(svg, shapeId), working$),
                ),
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
      switchMap((s) => combineLatest(s.map((i) => i.result$))),
      map((s) => s.flatMap((i) => i)),
    );
  }
}
