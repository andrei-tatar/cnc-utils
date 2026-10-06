import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  scan,
  switchMap,
} from 'rxjs';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { GcodeOptions, resolveGcodeOptions } from '../../cam/gcode-options';
import { GeometrySettings } from '../../cam/geometry';
import { CamPath } from '../../cam/types';
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
  return model$.pipe(
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
            geometry$,
            working$,
          );
        }),
      [] as OperationEntry[],
    ),
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
          map((model) => resolveGcodeOptions(model.gcode)),
          distinctJson(),
        ),
      }),
  );
}

function createOperationEntry(
  id: string,
  inputs: OperationInputs,
  shapes: ShapeResults,
  geometry$: Observable<GeometrySettings>,
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
  );

  const routed$ = combineLatest({
    shape: shape$,
    op: input('operationParameters').pipe(distinctJson()),
    tool: input('toolParameters').pipe(distinctJson()),
    source: input('source').pipe(distinctJson()),
    plug: input('plug').pipe(distinctJson()),
    rest: input('rest').pipe(distinctJson()),
    beyondCone: input('beyondCone').pipe(distinctUntilChanged()),
    geometry: geometry$,
  }).pipe(switchMap((routing) => routeOperation(id, routing, working$)));

  // Tag the routed G-code with its tool afterwards, so renumbering tools
  // (reordering the list) doesn't re-run the routing.
  const tagged$ = combineLatest([
    routed$,
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

  return { id, inputs$, result$ };
}

/**
 * The program's G-code: the embedded project (when given, as from
 * `getModelMetadata`), then each operation's G-code.
 */
export function buildProgram(program: Program, modelMetadata?: string): string {
  return wholeProgram(program, modelMetadata).build(program.options);
}

/** The program's moves as paths for the preview, without writing G-code. */
export function programPaths(program: Program): CamPath[] {
  return wholeProgram(program).toPaths(program.options);
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
