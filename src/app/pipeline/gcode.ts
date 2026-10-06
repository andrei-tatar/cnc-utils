import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  scan,
  switchMap,
  withLatestFrom,
} from 'rxjs';
import { GCodeBuilder } from '../../cam/gcode-builder';
import { GcodeOptions, resolveGcodeOptions } from '../../cam/gcode-options';
import { GeometrySettings } from '../../cam/geometry';
import { CamShape } from '../../cam/types';
import { ModelType } from '../model-editor/model';
import { getModelMetadata } from '../store';
import { geometrySettings } from './geometry-settings';
import { OperationInputs, operationInputs } from './operation-inputs';
import { distinctItems, distinctJson, shareLatest } from './operators';
import { routeOperation } from './route-operation';

/** A long-lived pipeline for one operation, kept across model emissions. */
type OperationEntry = {
  id: string;
  inputs$: BehaviorSubject<OperationInputs>;
  result$: Observable<GCodeBuilder>;
};

/**
 * Routes the model's operations, in order, into the G-code program (with
 * the model embedded in it).
 *
 * Each operation keeps its pipeline across model emissions (its inputs are
 * pushed into it), so it is only re-routed when something it depends on
 * changes.
 */
export function generateGcodeFromOperations(
  model$: Observable<ModelType>,
  shapes$: Observable<CamShape[]>,
  working$: Observable<never>,
): Observable<string> {
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
            shapes$,
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
      combineLatest([
        builders$,
        model$.pipe(
          map((model) => resolveGcodeOptions(model.gcode)),
          distinctJson(),
        ),
      ]),
    withLatestFrom(model$),
    switchMap(([[builders, gcodeOptions], model]) =>
      buildProgram(builders, gcodeOptions, model),
    ),
  );
}

function createOperationEntry(
  id: string,
  inputs: OperationInputs,
  shapes$: Observable<CamShape[]>,
  geometry$: Observable<GeometrySettings>,
  working$: Observable<never>,
): OperationEntry {
  const inputs$ = new BehaviorSubject(inputs);
  const input = <K extends keyof OperationInputs>(key: K) =>
    inputs$.pipe(map((i) => i[key]));

  const shape$ = combineLatest([
    input('shapeId').pipe(distinctUntilChanged()),
    shapes$.pipe(debounceTime(0)),
  ]).pipe(
    map(([shapeId, allShapes]) =>
      allShapes.filter((shape) => shape.sourceShapeId === shapeId),
    ),
    distinctItems(),
  );

  const routed$ = combineLatest({
    shape: shape$,
    op: input('operationParameters').pipe(distinctJson()),
    tool: input('toolParameters').pipe(distinctJson()),
    source: input('source').pipe(distinctJson()),
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

/** The whole program: the model metadata, then each operation's G-code. */
async function buildProgram(
  builders: GCodeBuilder[],
  gcodeOptions: GcodeOptions,
  model: ModelType,
): Promise<string> {
  const compressed = await getModelMetadata(model);

  const meta = new GCodeBuilder().addModelMetadata(compressed);
  const result = [meta, ...builders].reduce((a, b) => a.concat(b));
  // The final retract belongs to no operation.
  return result
    .sourceOperationId('')
    .goToSafeHeight()
    .stopProgram()
    .build(gcodeOptions);
}
