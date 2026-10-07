import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  race,
  scan,
  switchMap,
} from 'rxjs';
import { GCodeBuilder, JobTime } from '../../cam/gcode-builder';
import { programOffset, resolveStock, stockOffset } from '../../cam/stock';
import { GcodeOptions, resolveGcodeOptions } from '../../cam/gcode-options';
import { GeometrySettings } from '../../cam/geometry';
import { CamPath, CamShape, CamTab } from '../../cam/types';
import { tabsNear, tabsOf } from '../../cam/tabs';
import worker from '../../worker';
import { ModelType } from '../model-editor/model';
import { geometrySettings } from './geometry-settings';
import { ShapeResults } from './shapes';
import { OperationInputs, operationInputs } from './operation-inputs';
import { distinctItems, distinctJson, shareLatest } from './operators';
import { routeOperation } from './route-operation';

/** A long-lived pipeline for one operation, kept across model emissions. */
type OperationEntry = {
  id: string;
  inputs$: BehaviorSubject<OperationInputs>;
  /** The shape it cuts. */
  shape$: Observable<CamShape[]>;
  result$: Observable<GCodeBuilder>;
};

/** The routed operations, in order, and how to write them out. */
export type Program = {
  builders: GCodeBuilder[];
  options: GcodeOptions;
};

/**
 * Routes the model's operations, in order, into the program.
 *
 * Each operation keeps its pipeline across model emissions (its inputs are
 * pushed into it), so it is only re-routed when something it depends on
 * changes.
 */
export function generateGcodeFromOperations(
  model$: Observable<ModelType>,
  shapes: ShapeResults,
  working$: Observable<never>,
): Observable<Program> {
  const geometry$ = geometrySettings(model$);
  const optimizeTravel$ = model$.pipe(
    map(({ gcode }) => resolveGcodeOptions(gcode).optimizeTravel),
    distinctUntilChanged(),
    shareLatest(),
  );
  const entries$: Observable<OperationEntry[]> = model$.pipe(
    scan(
      (ctx, model) =>
        (model.operations ?? []).map((operation) => {
          const inputs = operationInputs(operation, model);
          const existing = ctx.find((e) => e.id === operation.id);
          if (existing) {
            existing.inputs$.next(inputs);
            return existing;
          }
          return createOperationEntry(
            operation.id,
            inputs,
            shapes,
            tabs$,
            geometry$,
            optimizeTravel$,
            working$,
          );
        }),
      [] as OperationEntry[],
    ),
    shareLatest(),
  );
  // The tabs on the shapes the operations cut: every operation keeps out
  // of all of them.
  const tabs$: Observable<CamTab[]> = entries$.pipe(
    switchMap((s) =>
      s.length ? combineLatest(s.map((i) => i.shape$)) : of([]),
    ),
    map((s) => tabsOf(s.flat())),
    distinctJson(),
    shareLatest(),
  );
  return entries$.pipe(
    // Incomplete operations (no tool, shape or type yet) emit an empty
    // builder rather than nothing, so they don't stall the whole G-code.
    switchMap((s) =>
      s.length ? combineLatest(s.map((i) => i.result$)) : of([]),
    ),
    distinctItems(),
    // G-code options only affect how the program is written out: rebuild
    // the text when they change, without re-running any routing.
    (builders$) =>
      combineLatest({
        builders: builders$,
        options: model$.pipe(
          map((model) => ({
            ...resolveGcodeOptions(model.gcode),
            // The G-code's zero, on the stock.
            offset: stockOffset(resolveStock(model.stock)),
          })),
          distinctJson(),
        ),
      }).pipe(
        map(({ builders, options }) => ({
          builders,
          options: {
            ...options,
            offset: programOffset(
              builders.map((b) => b.cutBounds()),
              options,
            ),
          },
        })),
      ),
  );
}

function createOperationEntry(
  id: string,
  inputs: OperationInputs,
  shapes: ShapeResults,
  tabs$: Observable<CamTab[]>,
  geometry$: Observable<GeometrySettings>,
  optimizeTravel$: Observable<boolean>,
  working$: Observable<never>,
): OperationEntry {
  const inputs$ = new BehaviorSubject(inputs);
  const input = <K extends keyof OperationInputs>(key: K) =>
    inputs$.pipe(map((i) => i[key]));

  // Only this operation's shape: other shapes changing don't wake it.
  const shape$ = input('shapeId').pipe(
    distinctUntilChanged(),
    switchMap((shapeId) => shapes.byId(shapeId)),
    distinctItems(),
    shareLatest(),
  );

  const routed$ = combineLatest({
    shape: shape$,
    op: input('operationParameters').pipe(distinctJson()),
    tool: input('toolParameters').pipe(distinctJson()),
    source: input('source').pipe(distinctJson()),
    plug: input('plug').pipe(distinctJson()),
    rest: input('rest').pipe(distinctJson()),
    flatPlug: input('flatPlug').pipe(distinctJson()),
    beyondCone: input('beyondCone').pipe(distinctUntilChanged()),
    geometry: geometry$,
    optimizeTravel: optimizeTravel$,
  }).pipe(switchMap((routing) => routeOperation(id, routing, working$)));

  // Then over the tabs the tool would cut into: changing tabs doesn't
  // re-route.
  const radius$ = input('toolParameters').pipe(
    map((tool) => (tool?.diameter ?? 0) / 2),
    distinctUntilChanged(),
  );
  const kept$ = combineLatest([routed$, tabs$, radius$]).pipe(
    map(([builder, tabs, radius]) => ({
      builder,
      radius,
      tabs: tabsNear(tabs, builder.cutBounds(), radius),
    })),
    distinctUntilChanged(
      (a, b) =>
        a.builder === b.builder &&
        a.radius === b.radius &&
        JSON.stringify(a.tabs) === JSON.stringify(b.tabs),
    ),
    switchMap(({ builder, tabs, radius }) =>
      tabs.length
        ? race(worker.keepTabs(builder, tabs, radius), working$)
        : of(builder),
    ),
  );

  // Tag the routed G-code with its tool afterwards, so renumbering tools
  // (reordering the list) doesn't re-run the routing.
  const tagged$ = combineLatest([
    kept$,
    input('toolInfo').pipe(distinctJson()),
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
    shareLatest(),
  );

  // A disabled operation contributes nothing, and isn't routed at all while
  // it stays disabled.
  const result$ = input('enabled').pipe(
    distinctUntilChanged(),
    switchMap((enabled) => (enabled ? tagged$ : of(new GCodeBuilder()))),
    shareLatest(),
  );

  return { id, inputs$, shape$, result$ };
}

/**
 * The program's G-code: the embedded project (when given, as from
 * `getModelMetadata`), then each operation's G-code.
 */
export function buildProgram(program: Program, modelMetadata?: string): string {
  return wholeProgram(program, modelMetadata).build(program.options);
}

/**
 * The program's moves as paths for the preview, without writing G-code (in
 * design coordinates, like the shapes).
 */
export function programPaths(program: Program): CamPath[] {
  return wholeProgram(program).toPaths({
    ...program.options,
    offset: undefined,
  });
}

/** How long the program takes to run (see `GCodeBuilder.estimateTime`). */
export function programTime(program: Program): JobTime {
  return wholeProgram(program).estimateTime({
    ...program.options,
    offset: undefined,
  });
}

function wholeProgram(
  { builders }: Program,
  modelMetadata?: string,
): GCodeBuilder {
  const meta = new GCodeBuilder();
  if (modelMetadata !== undefined) {
    meta.addModelMetadata(modelMetadata);
  }
  // One copy of every instruction, rather than one per operation.
  const result = GCodeBuilder.concatAll([meta, ...builders]);
  // The final retract belongs to no operation.
  return result.sourceOperationId('').goToSafeHeight().stopProgram();
}
