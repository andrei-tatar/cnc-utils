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
import { toolLabel } from './model-editor/tools';
import { resolveGcodeOptions } from '../cam/gcode-options';
import { GeometrySettings } from '../cam/geometry';
import { deepEqual, readFile } from '../util';

/** How an operation's tool appears in the G-code. */
type ToolInfo = {
  /** Position in the tools list, from 1 (T1, T2, …). */
  number: number;
  label: string;
  spindleSpeed?: number;
  /** Empty means the G-code section's defaults. */
  feedRate?: number;
  plungeFeedRate?: number;
};

type VCarveSource = {
  shapeId: string;
  vToolSize: number;
  vAngle: number;
  tipDiameter: number;
  startDepth: number;
  maxDepth: number | null;
  beyondCone: boolean;
  mode: 'both' | 'holes' | 'contours';
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

  /** Shapes toggled off in the editor (hidden in the preview only). */
  hiddenShapes$ = this.model$.pipe(
    map(({ shapes }) => shapes.filter((s) => s.hidden).map((s) => s.id)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  );

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
      maxDepth: vcarve.unlimitedDepth ? null : vcarve.maxDepth,
      beyondCone: AppComponent.clearedFirst(vcarve.id, operations, tools),
      mode: vcarve.mode ?? 'both',
    };
  }

  /**
   * Whether v-carve `vcarveId` is preceded by a clearing for it that uses an
   * end mill. Then the groove's middle is gone before the V-bit arrives, so
   * it can carve below its cone without the shank meeting uncut material.
   */
  static clearedFirst(
    vcarveId: string,
    operations: ModelType['operations'],
    tools: ModelType['tools'],
  ): boolean {
    const vcarveIndex = operations.findIndex((o) => o.id === vcarveId);
    return operations.some(
      (o, index) =>
        index < vcarveIndex &&
        !o.disabled &&
        o.type === 'v-carve-clear' &&
        o.vcarveOperationId === vcarveId &&
        (tools.find((t) => t.id === o.toolId)?.bitType ?? 'end-mill') !==
          'v-bit',
    );
  }

  private static generateGcodeFromOperations(
    model$: Observable<ModelType>,
    shapes$: Observable<CamShape[]>,
    working$: Observable<never>,
  ) {
    const geometry$ = AppComponent.geometrySettings(model$);
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
              disabled,
              ...operationParameters
            }) => {
              const tool = tools.find((t) => t.id === toolId);
              // Spindle speed and feed rates only affect the G-code text,
              // not the routing.
              const toolParameters: ToolParameters | null = tool
                ? (({
                    id: _,
                    expanded: __,
                    name: ___,
                    spindleSpeed: ____,
                    feedRate: _____,
                    plungeFeedRate: ______,
                    ...parameters
                  }) => parameters)(tool)
                : null;

              // V-carve clearing borrows its shape, bit and depths from the
              // v-carve it clears for, so it follows any change made there.
              const source = AppComponent.vCarveSource(
                operationParameters,
                operations,
                tools,
              );
              const effectiveShapeId = source ? source.shapeId : shapeId;
              const beyondCone =
                operationParameters.type === 'v-carve' &&
                AppComponent.clearedFirst(id, operations, tools);

              // Tools are numbered by their position in the tools list.
              const toolInfo: ToolInfo | null = tool
                ? {
                    number: tools.indexOf(tool) + 1,
                    label: toolLabel(tool),
                    spindleSpeed: tool.spindleSpeed || undefined,
                    feedRate: tool.feedRate || undefined,
                    plungeFeedRate: tool.plungeFeedRate || undefined,
                  }
                : null;

              const existing = ctx.find((e) => e.id === id);
              if (existing) {
                existing.operationParameters$.next(operationParameters);
                existing.shapeId$.next(effectiveShapeId);
                existing.toolParameters$.next(toolParameters);
                existing.source$.next(source);
                existing.beyondCone$.next(beyondCone);
                existing.toolInfo$.next(toolInfo);
                existing.enabled$.next(!disabled);
                return existing;
              }

              const operationParameters$ = new BehaviorSubject(
                operationParameters,
              );
              const shapeId$ = new BehaviorSubject(effectiveShapeId);
              const toolParameters$ = new BehaviorSubject(toolParameters);
              const source$ = new BehaviorSubject(source);
              const beyondCone$ = new BehaviorSubject(beyondCone);
              const toolInfo$ = new BehaviorSubject(toolInfo);
              const enabled$ = new BehaviorSubject(!disabled);

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

              const routed$ = combineLatest([
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
                beyondCone$.pipe(distinctUntilChanged()),
                geometry$,
              ]).pipe(
                switchMap(([shape, op, tool, source, beyondCone, geometry]) => {
                  // No (or a deleted) tool or shape: nothing to cut. Routing
                  // functions expect at least one shape.
                  if (!tool || !shape.length) {
                    return of(new GCodeBuilder());
                  }
                  const { bitType, diameter, vAngle, tipDiameter } = tool;
                  const toolGcode = new GCodeBuilder().sourceOperationId(id);
                  switch (op.type) {
                    case 'pocket':
                      return race(
                        worker
                          .routePocketHole(shape, {
                            geometry,
                            toolSize: diameter,
                            toolEngagement: op.toolEngagement,
                            leaveStock: op.leaveStock,
                            depthPerStep: op.depth,
                            steps: op.steps,
                            startDepth: op.startDepth,
                            rampAngle: tool.ramp ? tool.rampAngle : null,
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
                            geometry,
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
                            geometry,
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
                            tabOffset: op.tabOffset ?? 0,
                            mode: op.mode ?? 'both',
                            rampAngle: tool.ramp ? tool.rampAngle : null,
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
                            geometry,
                            toolSize: diameter,
                            vAngle,
                            tipDiameter,
                            startDepth: op.startDepth,
                            maxDepth: op.unlimitedDepth ? null : op.maxDepth,
                            stepover:
                              op.stepover && op.stepover > 0
                                ? op.stepover
                                : null,
                            // Without a max depth there's no flat bottom.
                            clearFlatBottom:
                              !op.unlimitedDepth && op.clearFlatBottom,
                            sharpCorners: op.sharpCorners ?? true,
                            sharpCornerAngle: op.sharpCornerAngle ?? 150,
                            beyondCone,
                            mode: op.mode ?? 'both',
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
                            geometry,
                            toolSize: diameter,
                            toolEngagement: op.toolEngagement,
                            depthPerStep: op.depthPerStep,
                            leaveStock: op.leaveStock,
                            vToolSize: source.vToolSize,
                            vAngle: source.vAngle,
                            tipDiameter: source.tipDiameter,
                            startDepth: source.startDepth,
                            maxDepth: source.maxDepth,
                            beyondCone: source.beyondCone,
                            mode: source.mode,
                            rampAngle: tool.ramp ? tool.rampAngle : null,
                          })
                          .pipe(
                            map((r) => toolGcode.concat(GCodeBuilder.clone(r))),
                          ),
                        working$,
                      );
                  }

                  return of(new GCodeBuilder());
                }),
              );

              // Tag the routed G-code with its tool afterwards, so renumbering
              // tools (reordering the list) doesn't re-run the routing.
              const tagged$ = combineLatest([
                routed$,
                toolInfo$.pipe(
                  distinctUntilChanged(
                    (a, b) => a === b,
                    (s) => JSON.stringify(s),
                  ),
                ),
              ]).pipe(
                map(([builder, info]) =>
                  info
                    ? new GCodeBuilder()
                        .useTool(info.number, info.label, info.spindleSpeed)
                        .carveFeedrate(info.feedRate)
                        .plungeFeedRate(info.plungeFeedRate)
                        .concat(builder)
                    : builder,
                ),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              // A disabled operation contributes nothing, and isn't routed at
              // all while it stays disabled.
              const result$ = enabled$.pipe(
                distinctUntilChanged(),
                switchMap((enabled) =>
                  enabled ? tagged$ : of(new GCodeBuilder()),
                ),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              return {
                id,
                toolInfo$,
                enabled$,
                operationParameters$,
                toolParameters$,
                result$,
                shapeId$,
                source$,
                beyondCone$,
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
          beyondCone$: BehaviorSubject<boolean>;
          toolInfo$: BehaviorSubject<ToolInfo | null>;
          enabled$: BehaviorSubject<boolean>;
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
      // G-code options only affect how the program is written out: rebuild
      // the text when they change, without re-running any routing.
      (builders$) =>
        combineLatest([
          builders$,
          model$.pipe(
            map((model) => resolveGcodeOptions(model.gcode)),
            distinctUntilChanged(
              (a, b) => a === b,
              (o) => JSON.stringify(o),
            ),
          ),
        ]),
      withLatestFrom(model$),
      switchMap(async ([[builders, gcodeOptions], model]) => {
        const compressed = await getModelMetadata(model);

        const meta = new GCodeBuilder().addModelMetadata(compressed);
        const result = [meta, ...builders].reduce((a, b) => a.concat(b));
        // The final retract belongs to no operation.
        const gcode = result
          .sourceOperationId('')
          .goToSafeHeight()
          .stopProgram()
          .build(gcodeOptions);
        return gcode;
      }),
    );
  }

  /**
   * The geometry settings from the G-code section; shapes and toolpaths are
   * regenerated when they change.
   */
  private static geometrySettings(
    model$: Observable<ModelType>,
  ): Observable<GeometrySettings> {
    return model$.pipe(
      map(({ gcode }) => {
        const options = resolveGcodeOptions(gcode);
        return {
          curveTolerance: options.curveTolerance,
          decimals: options.geometryDecimals,
        };
      }),
      distinctUntilChanged((a, b) => deepEqual(a, b)),
      share({
        connector: () => new ReplaySubject(1),
        resetOnRefCountZero: () => timer(0),
      }),
    );
  }

  private static generateShapesFromModel(
    model$: Observable<ModelType>,
    working$: Observable<never>,
  ) {
    const geometry$ = AppComponent.geometrySettings(model$);
    const shapes$ = model$.pipe(
      scan(
        (ctx, { shapes }) => {
          return shapes.map(
            ({
              id: shapeId,
              transforms: shapeTransforms,
              expanded: _,
              name: __,
              hidden: ___,
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

              const shape$ = combineLatest([
                shapeParameters$.pipe(
                  distinctUntilChanged((a, b) => deepEqual(a, b)),
                ),
                geometry$,
              ]).pipe(
                map(([t, geometry]) => {
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
                          geometry,
                        );
                      }),
                    );
                    return result$;
                  }

                  if (t.type === 'copy') {
                    // Another shape's result, as this shape's (so the
                    // transforms below and operations work on it).
                    const copied$: Observable<CamShape[]> = shapes$.pipe(
                      switchMap(
                        (s) =>
                          s.find((v) => v.shapeId === t.copyOfId)?.result$ ??
                          // Deleted or unset shape: empty, not waiting.
                          of([] as CamShape[]),
                      ),
                      distinctUntilChanged(),
                      map((source) =>
                        source.map((s) => ({ ...s, sourceShapeId: shapeId })),
                      ),
                    );
                    return copied$;
                  }

                  if (t.type === 'text') {
                    return worker.importText(t, shapeId, geometry);
                  }

                  return worker.importSvg(
                    this.createSvgFromShape(t),
                    shapeId,
                    geometry,
                  );
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
    t: Exclude<ShapeParameters, { type: 'boolean' | 'text' | 'copy' }>,
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
