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
import { recover } from './errors';
import { GCodeBuilder, JobTime } from '../../cam/gcode-builder';
import { programOffset, resolveStock, stockOffset } from '../../cam/stock';
import { GcodeOptions, resolveGcodeOptions } from '../../cam/gcode-options';
import { GeometrySettings } from '../../cam/geometry';
import { CamPath, CamShape, CamTab } from '../../cam/types';
import { rotaryOf } from '../../cam/rotary';
import {
  flatOperations,
  NO_TOOL,
  ROTARY_REPEAT,
} from '../model-editor/operations/flatten';
import { repeatAngles } from '../model-editor/operations/operation-rotary-repeat';
import {
  operationFrame,
  operationRotation,
} from '../model-editor/operations/rotation';
import { tabsNear, tabsOf } from '../../cam/tabs';
import worker from '../../worker';
import { ModelType } from '../model-editor/model';
import { describeOperation } from '../model-editor/operations/describe';
import { geometrySettings } from './geometry-settings';
import { ShapeResults } from './shapes';
import { OperationInputs, operationInputs } from './operation-inputs';
import { distinctItems, distinctJson, shareLatest } from './operators';
import { routeOperation } from './route-operation';

/** What an operation's pipeline is fed on each model emission. */
type EntryInputs = OperationInputs & {
  /**
   * Which way up the stock is for its cuts (see `operationFrame`): it keeps
   * out of the tabs of shapes cut the same way up.
   */
  frame: string;
};

/** A long-lived pipeline for one operation, kept across model emissions. */
type OperationEntry = {
  id: string;
  inputs$: BehaviorSubject<EntryInputs>;
  /** The shape it cuts. */
  shape$: Observable<CamShape[]>;
  frame$: Observable<string>;
  /** Routed and tagged with its tool; turning the stock comes later. */
  result$: Observable<GCodeBuilder>;
};

/**
 * One cut of the program: an operation, with the stock turned to
 * `rotation` (null: not on a rotary axis). An operation inside a rotary
 * repeat is cut once per angle.
 */
export type ProgramStep = { id: string; rotation: number | null };

/**
 * What the program cuts, in order: each operation of the list, with the
 * angle the rotate steps above it turn the stock to; for a rotary repeat,
 * its operations at each of its angles (angle by angle, or operation by
 * operation). Without a rotary axis, a repeat's operations are cut once.
 */
export function programSteps(
  operations: ModelType['operations'],
  rotary: boolean,
): ProgramStep[] {
  return (operations ?? []).flatMap((op: any): ProgramStep[] => {
    if (op.disabled || op.type === 'rotate') {
      return [];
    }
    if (op.type === ROTARY_REPEAT) {
      const inner: any[] = op.operations ?? [];
      if (!rotary) {
        return inner.map((o) => ({ id: o.id, rotation: null }));
      }
      const angles = repeatAngles(op);
      return op.order === 'operation'
        ? inner.flatMap((o) =>
            angles.map((rotation) => ({ id: o.id, rotation })),
          )
        : angles.flatMap((rotation) =>
            inner.map((o) => ({ id: o.id, rotation })),
          );
    }
    return [
      {
        id: op.id,
        rotation: rotary ? operationRotation(op, operations) : null,
      },
    ];
  });
}

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
  // One pipeline per operation that cuts (those inside rotary repeats too),
  // however many times it's cut.
  const entries$: Observable<OperationEntry[]> = model$.pipe(
    scan((ctx, model) => {
      const all = flatOperations(model.operations);
      const onRotary = !!rotaryOf(resolveStock(model.stock));
      return all
        .filter((operation) => !NO_TOOL.has(operation.type!))
        .map((operation) => {
          const inputs: EntryInputs = {
            ...operationInputs(operation, { ...model, operations: all }),
            frame: onRotary ? operationFrame(operation, model.operations) : '',
          };
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
        });
    }, [] as OperationEntry[]),
    shareLatest(),
  );
  // The tabs on the shapes the operations cut, with which way up the stock
  // is for each: every operation keeps out of all of them cut the same way
  // up.
  const tabs$: Observable<FramedTabs[]> = entries$.pipe(
    switchMap((s) =>
      s.length
        ? combineLatest(
            s.map((i) => combineLatest({ shape: i.shape$, frame: i.frame$ })),
          )
        : of([]),
    ),
    map((cuts) =>
      cuts.map(({ shape, frame }) => ({ frame, tabs: tabsOf(shape) })),
    ),
    distinctJson(),
    shareLatest(),
  );
  const steps$ = model$.pipe(
    map((model) =>
      programSteps(model.operations, !!rotaryOf(resolveStock(model.stock))),
    ),
    distinctJson(),
  );
  return combineLatest([entries$, steps$]).pipe(
    // Each step's operation, turned for it. Incomplete operations (no tool,
    // shape or type yet) emit an empty builder rather than nothing, so they
    // don't stall the whole G-code.
    switchMap(([entries, steps]) => {
      const byId = new Map(entries.map((e) => [e.id, e]));
      const cuts = steps.flatMap(({ id, rotation }) => {
        const entry = byId.get(id);
        return entry
          ? [entry.result$.pipe(map((b) => turned(b, id, rotation)))]
          : [];
      });
      return cuts.length ? combineLatest(cuts) : of([]);
    }),
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
            rotary: rotaryOf(resolveStock(model.stock)),
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

/** The tabs on what an operation cuts, and which way up the stock is. */
type FramedTabs = { frame: string; tabs: CamTab[] };

/** Builders with the stock turned first, by builder and angle. */
const turnedBuilders = new WeakMap<GCodeBuilder, Map<number, GCodeBuilder>>();

/**
 * `builder` (operation `id`'s) with the stock turned to `rotation` first;
 * as it is without a rotary axis or anything cut. The same builder for the
 * same angle each time, so unchanged steps stay unchanged.
 */
function turned(
  builder: GCodeBuilder,
  id: string,
  rotation: number | null,
): GCodeBuilder {
  if (rotation === null || !builder.cutBounds()) {
    return builder;
  }
  let byAngle = turnedBuilders.get(builder);
  if (!byAngle) {
    turnedBuilders.set(builder, (byAngle = new Map()));
  }
  let result = byAngle.get(rotation);
  if (!result) {
    result = new GCodeBuilder()
      .sourceOperationId(id)
      .rotate(rotation)
      .concat(builder);
    byAngle.set(rotation, result);
  }
  return result;
}

function createOperationEntry(
  id: string,
  inputs: EntryInputs,
  shapes: ShapeResults,
  framedTabs$: Observable<FramedTabs[]>,
  geometry$: Observable<GeometrySettings>,
  optimizeTravel$: Observable<boolean>,
  working$: Observable<never>,
): OperationEntry {
  const inputs$ = new BehaviorSubject(inputs);
  const input = <K extends keyof EntryInputs>(key: K) =>
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
    imageEngrave: input('imageEngrave').pipe(distinctJson()),
    clearings: input('clearings').pipe(distinctJson()),
    geometry: geometry$,
    optimizeTravel: optimizeTravel$,
  }).pipe(switchMap((routing) => routeOperation(id, routing, working$)));

  const frame$ = input('frame').pipe(distinctUntilChanged());
  const tabs$ = combineLatest([framedTabs$, frame$]).pipe(
    map(([all, frame]) =>
      all.filter((t) => t.frame === frame).flatMap((t) => t.tabs),
    ),
    distinctJson(),
  );

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
        ? race(
            worker.keepTabs(builder, tabs, radius).pipe(
              // Cutting through the tabs beats not cutting at all; the
              // user is told.
              recover('keeping the cuts out of the tabs', () => builder),
            ),
            working$,
          )
        : of(builder),
    ),
  );

  // Tag the routed G-code with its tool afterwards, so renumbering tools
  // (reordering the list) doesn't re-run the routing (nor does turning the
  // stock: see `turned`).
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

  return { id, inputs$, shape$, frame$, result$ };
}

/**
 * What to say about each operation in the G-code (by operation id), with
 * the `operationComments` option.
 */
export type OperationDescriptions = Record<string, string>;

/**
 * Each operation as the G-code describes it: its place in the list, its
 * name if it has one, what it cuts and with which tool, e.g. "Operation 2:
 * pocket 5 mm · circle Ø20 · T1 Ø6 mm end mill".
 */
export function operationDescriptions(model: ModelType): OperationDescriptions {
  const operations = flatOperations(model.operations);
  const describe = (op: any, number: string) => {
    const what = describeOperation(
      op,
      model.shapes ?? [],
      model.tools ?? [],
      operations,
    );
    return [
      op.id,
      `Operation ${number}: ${op.name ? `${op.name} (${what})` : what}`,
    ];
  };
  // Inside a rotary repeat: its number, then theirs (3.1, 3.2, …).
  return Object.fromEntries(
    (model.operations ?? []).flatMap((op: any, i) => [
      describe(op, `${i + 1}`),
      ...(op.type === ROTARY_REPEAT ? (op.operations ?? []) : []).map(
        (inner: any, j: number) => describe(inner, `${i + 1}.${j + 1}`),
      ),
    ]),
  );
}

/**
 * The program's G-code: the embedded project (when given, as from
 * `getModelMetadata`), then each operation's G-code, after a comment saying
 * what it is (when described and the option is on).
 */
export function buildProgram(
  program: Program,
  modelMetadata?: string,
  descriptions?: OperationDescriptions,
): string {
  return wholeProgram(program, modelMetadata, descriptions).build(
    program.options,
  );
}

/** One file of a program split by tool (see `buildProgramPerTool`). */
export type ToolFile = {
  /** The tool's number (T2), null for moves before any tool. */
  toolNumber: number | null;
  label: string;
  gcode: string;
};

/**
 * The program as one file per tool, for machines without a tool changer:
 * a new file wherever the tool changes (operations keep their order, so a
 * tool used again later gets another file). Every file starts and ends at
 * safe height, has the project embedded, and keeps the same X / Y zero; Z
 * is set again for each tool.
 */
export function buildProgramPerTool(
  program: Program,
  modelMetadata?: string,
  descriptions?: OperationDescriptions,
): ToolFile[] {
  type Run = {
    toolNumber: number | null;
    label: string;
    builders: GCodeBuilder[];
  };
  const runs: Run[] = [];
  for (const builder of program.builders) {
    if (!builder.cutBounds()) continue;
    const tool = builder.instructions.find((i) => i.type === 'tool');
    const toolNumber = tool?.type === 'tool' ? tool.toolNumber : null;
    const label = tool?.type === 'tool' ? tool.label : '';
    const last = runs[runs.length - 1];
    if (last && last.toolNumber === toolNumber) {
      last.builders.push(builder);
    } else {
      runs.push({ toolNumber, label, builders: [builder] });
    }
  }
  return runs.map((run, i) => {
    const name =
      run.toolNumber === null ? 'no tool' : `T${run.toolNumber} ${run.label}`;
    const note = new GCodeBuilder()
      .comment(`File ${i + 1} of ${runs.length}: ${name}`)
      .comment(
        'Fit this tool and set Z zero (probe) before running; keep X / Y zero as it was.',
      );
    return {
      toolNumber: run.toolNumber,
      label: run.label,
      gcode:
        wholeProgram(
          { ...program, builders: [note, ...run.builders] },
          modelMetadata,
          descriptions,
        ).build(program.options) + '\n',
    };
  });
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
  { builders, options }: Program,
  modelMetadata?: string,
  descriptions?: OperationDescriptions,
): GCodeBuilder {
  const meta = new GCodeBuilder();
  if (modelMetadata !== undefined) {
    meta.addModelMetadata(modelMetadata);
  }
  if (descriptions && options.operationComments) {
    builders = builders.flatMap((builder) => {
      const id = builder.instructions.find(
        (i) => i.type === 'source-operation',
      );
      const text = id?.type === 'source-operation' && descriptions[id.id];
      return text ? [new GCodeBuilder().comment(text), builder] : [builder];
    });
  }
  // One copy of every instruction, rather than one per operation.
  const result = GCodeBuilder.concatAll([meta, ...builders]);
  // The final retract belongs to no operation.
  return result.sourceOperationId('').goToSafeHeight().stopProgram();
}
