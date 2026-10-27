import { DestroyRef, inject, Injectable, isDevMode } from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { firstValueFrom } from 'rxjs';
import { ModelFieldConfig, ModelType } from '../model-editor/model';
import { migrateModel, MODEL_VERSION } from '../model-editor/migrations';
import { describeShape, shapeLabel } from '../model-editor/shapes/describe';
import { describeOperation } from '../model-editor/operations/describe';
import { flatOperations } from '../model-editor/operations/flatten';
import { operationNeeds } from '../model-editor/operations';
import {
  freeToolIndex,
  numberedToolLabel,
  ToolType,
} from '../model-editor/tools';
import {
  libraryName,
  listLibrary,
  removeFromLibrary,
  saveToLibrary,
} from '../model-editor/tools/tool-library';
import { importParts } from '../model-editor/import-parts';
import { turnProject } from '../model-editor/stock/turn-project';
import { evaluateVariables } from '../model-editor/variables/evaluate';
import { evaluateExpression } from '../model-editor/variables/expression';
import { resolveModel } from '../model-editor/variables/resolve';
import { ModelStore } from '../services/model-store.service';
import { CamService } from '../services/cam.service';
import { ModelHistory } from '../services/model-history.service';
import { ProjectCommands } from '../projects/project-commands.service';
import { listProjects, loadProject, Project } from '../projects';
import { listTemplates } from '../templates';
import { shareLink, sharedProject, sharedProjectData } from '../share-link';
import { loadModelFromGcode } from '../store';
import { downloadFile, fileNameFrom } from '../project-file';
import { cutListCsv } from '../cut-list';
import { SIMULATION_CELLS, SimulationQuality } from '../pipeline/simulation';
import { polygonsBounds } from '../../cam/arcs';
import { resolveStock } from '../../cam/stock';
import { generateId, generateIdSync } from '../../util';
import { modelContext, ModelContextTool, registerTools } from './model-context';
import { describeList, findListField } from './form-schema';
import {
  FilePlaceholders,
  findItem,
  insertItems,
  moveItem,
  referencesTo,
  removeItems,
  updateItem,
  updateSection,
} from './model-edits';
import { ModelNormalizer } from './model-normalizer';

/** What the app does for the tools that only it can (the editor's view). */
export type WebMcpHost = {
  /** Opens a shape in the editor and brings it into view; null closes it. */
  selectShape(shapeId: string | null): void;
};

/** The lists items can be added to, at the top of the project. */
const LISTS = ['variables', 'shapes', 'tools', 'operations'] as const;
/** The lists inside an item: a shape's transforms, a repeat's operations. */
const ITEM_LISTS = ['transforms', 'operations'] as const;
/** Everything `describe_fields` can describe. */
const DESCRIBED = [...LISTS, 'transforms', 'stock', 'gcode'] as const;

/** How much G-code one call returns at most (characters). */
const GCODE_PAGE = 100_000;

const READ_ONLY = { readOnlyHint: true };

const ABOUT_VALUES =
  'Lengths are in mm, angles in degrees. Any number field also takes an expression (a string such as "width / 2 + 3", using the project’s variables, functions such as sqrt, sin, min, and units such as "1cm" or "1/4in").';

/**
 * Exposes the app to agents in the browser through WebMCP: reading the
 * project, editing it item by item, the job's G-code, checks and cut list,
 * saved projects, templates, the tool library, undo / redo. Each change
 * goes through the store like an edit in the editor (so undo takes it back)
 * and is first put through the editor's form (`ModelNormalizer`), so
 * defaults are filled in as the editor would.
 */
@Injectable({ providedIn: 'root' })
export class WebMcp {
  private readonly store = inject(ModelStore);
  private readonly cam = inject(CamService);
  private readonly history = inject(ModelHistory);
  private readonly commands = inject(ProjectCommands);
  private readonly normalizer = inject(ModelNormalizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly files = new FilePlaceholders();

  /** Registers the tools with the browser, when it supports WebMCP. */
  start(host: WebMcpHost) {
    const tools = this.tools(host);
    if (isDevMode()) {
      // To try them from the console without an agent:
      // `await webmcpTools.find(t => t.name === 'get_project').execute({})`.
      (window as { webmcpTools?: ModelContextTool[] }).webmcpTools = tools;
    }
    const context = modelContext();
    if (!context) {
      if (isDevMode()) {
        console.info(
          '[webmcp] This browser has no document.modelContext (turn on chrome://flags/#enable-webmcp-testing): the tools aren’t registered.',
        );
      }
      return;
    }
    const registration = new AbortController();
    this.destroyRef.onDestroy(() => registration.abort());
    registerTools(context, tools, registration.signal).then((count) => {
      if (isDevMode()) {
        console.info(`[webmcp] registered ${count} of ${tools.length} tools`);
      }
    });
  }

  /** Every tool (exposed for tests). */
  tools(host: WebMcpHost): ModelContextTool[] {
    return [
      ...this.readingTools(),
      ...this.editingTools(host),
      ...this.jobTools(),
      ...this.projectTools(),
      ...this.libraryTools(),
    ].map(reportingErrors);
  }

  private readingTools(): ModelContextTool[] {
    return [
      {
        name: 'get_project',
        title: 'Read the project',
        description:
          'The CNC project open in the app (CAM for a router: 2D shapes, cutting tools, operations that turn shapes into toolpaths, stock and G-code settings), with an outline of its items (ids, names, what each does). ' +
          'The model has: variables (named values for expressions), shapes (each with a type, its fields and a list of transforms), tools (bits, numbered T1, T2… by `index`), operations (in cutting order; each cuts a shape `shapeId` with a tool `toolId`), stock and gcode settings. ' +
          'Items are referred to by `id`. Long embedded files (SVG, pictures) are shown as placeholders: pass them back unchanged to keep them. ' +
          ABOUT_VALUES +
          ' Use describe_fields for the fields of each item type.',
        inputSchema: {
          type: 'object',
          properties: {
            outline_only: {
              type: 'boolean',
              description: 'Only the outline, not the whole model.',
            },
          },
        },
        annotations: READ_ONLY,
        execute: async ({ outline_only }: { outline_only?: boolean }) => {
          const model = this.store.value;
          const project = this.store.project;
          return {
            project: {
              name: project?.name ?? null,
              savedProjectId: project?.id ?? null,
              unsavedChanges: this.store.pending,
            },
            outline: outline(model),
            ...(outline_only
              ? {}
              : {
                  formatVersion: MODEL_VERSION,
                  model: this.files.abbreviate(model),
                }),
          };
        },
      },
      {
        name: 'describe_fields',
        title: 'Describe item fields',
        description:
          'The fields of the project’s items, as the editor has them: for a list (variables, shapes, transforms, tools, operations) or settings section (stock, gcode). Without `type`, a typed list gives its item types and the fields all items have; with `type`, that type’s fields too. ' +
          'Fields marked `conditional` only apply in some cases (another field’s value, the tool’s kind, the stock) and are dropped when they don’t. A field missing from an item takes its default. ' +
          ABOUT_VALUES,
        inputSchema: {
          type: 'object',
          properties: {
            list: { type: 'string', enum: [...DESCRIBED] },
            type: {
              type: 'string',
              description:
                'An item type of the list, e.g. "rectangle", "pocket", "translate".',
            },
          },
          required: ['list'],
        },
        annotations: READ_ONLY,
        execute: ({ list, type }: { list: string; type?: string }) => {
          const field = findListField(ModelFieldConfig, list);
          if (!field || !(DESCRIBED as readonly string[]).includes(list)) {
            throw new Error(`Unknown list “${list}”.`);
          }
          const schema = describeList(field, this.store.value, type);
          if (
            type !== undefined &&
            !schema.types.some((t) => t.type === type)
          ) {
            throw new Error(
              `“${list}” has no type “${type}”; it has ${schema.types.map((t) => t.type).join(', ')}.`,
            );
          }
          if (list === 'operations') {
            // Which bits each can cut with.
            schema.types = schema.types.map((t) => ({
              ...t,
              ...(operationNeeds(t.type)
                ? { tool: operationNeeds(t.type) }
                : {}),
            }));
          }
          return type === undefined
            ? { list, ...schema }
            : {
                list,
                ...schema.types.find((t) => t.type === type),
                fields: schema.fields,
              };
        },
      },
      {
        name: 'evaluate_expression',
        title: 'Work out an expression',
        description:
          'What an expression works out to with the project’s variables, e.g. "width / 2 - 3mm", or why it can’t be worked out. Also lists the variables’ values.',
        inputSchema: {
          type: 'object',
          properties: { expression: { type: 'string' } },
          required: ['expression'],
        },
        annotations: READ_ONLY,
        execute: ({ expression }: { expression: string }) => {
          const variables = evaluateVariables(this.store.value.variables);
          const scope = Object.fromEntries(variables.scope);
          try {
            return {
              value: evaluateExpression(String(expression), variables.scope),
              variables: scope,
            };
          } catch (error) {
            return { error: (error as Error).message, variables: scope };
          }
        },
      },
      {
        name: 'get_shape_geometry',
        title: 'Shape geometry',
        description:
          'A shape as made (after its transforms): its bounds in mm, how many outlines it has, and, unless `bounds_only`, the outlines as SVG (mm, Y up as in the design is flipped to SVG’s Y down). Single points (drill points) have no area.',
        inputSchema: {
          type: 'object',
          properties: {
            shape_id: { type: 'string' },
            bounds_only: { type: 'boolean' },
          },
          required: ['shape_id'],
        },
        annotations: READ_ONLY,
        execute: async ({
          shape_id,
          bounds_only,
        }: {
          shape_id: string;
          bounds_only?: boolean;
        }) => {
          const shape = this.store.value.shapes.find((s) => s.id === shape_id);
          if (!shape) throw new Error(`There’s no shape “${shape_id}”.`);
          const shapes = await this.cam.shapeResult(shape_id);
          const polygons = shapes.flatMap((s) => s.polygons);
          const bounds = polygons.length ? polygonsBounds(polygons) : null;
          const resolved = resolveModel(this.store.value, ModelFieldConfig);
          const name = shapeLabel(
            resolved.shapes.find((s) => s.id === shape_id),
            resolved.shapes,
          );
          return {
            name,
            outlines: polygons.filter((p) => p.close).length,
            openPaths: polygons.filter((p) => !p.close && p.vertices.length > 1)
              .length,
            points: polygons.filter((p) => p.vertices.length === 1).length,
            tabs: shapes.reduce((n, s) => n + (s.tabs?.length ?? 0), 0),
            bounds: bounds && {
              ...bounds,
              width: bounds.maxX - bounds.minX,
              height: bounds.maxY - bounds.minY,
            },
            ...(bounds_only
              ? {}
              : { svg: await this.cam.shapeSvg(shape_id, name) }),
          };
        },
      },
    ];
  }

  private editingTools(host: WebMcpHost): ModelContextTool[] {
    return [
      {
        name: 'add_items',
        title: 'Add items',
        description:
          'Adds items to a list of the project: variables ({name, value}), shapes, tools, operations — or, with `parent_id`, to an item’s own list: a shape’s `transforms`, a rotary repeat’s `operations`. ' +
          'Give each item its `type` (for typed lists) and the fields to set; the rest take their defaults (see describe_fields). An item may carry its own unique `id` so later items in the same call can refer to it (e.g. an operation’s shapeId); otherwise ids are made. Tools without an `index` get the lowest free one. ' +
          'Returns the new items’ ids. Undo takes it back.',
        inputSchema: {
          type: 'object',
          properties: {
            list: { type: 'string', enum: [...LISTS] },
            parent_id: {
              type: 'string',
              description:
                'The shape (for transforms) or rotary repeat (for operations) whose list to add to.',
            },
            index: {
              type: 'integer',
              description: 'Where in the list (from 0); the end without.',
            },
            items: { type: 'array', items: { type: 'object' } },
          },
          required: ['list', 'items'],
        },
        execute: async (input: {
          list: string;
          parent_id?: string;
          index?: number;
          items: Record<string, unknown>[];
        }) => {
          const nested = input.parent_id !== undefined;
          if (
            !(nested ? ITEM_LISTS : LISTS).includes(input.list as never) ||
            !Array.isArray(input.items)
          ) {
            throw new Error(
              nested
                ? 'With parent_id, list is "transforms" or "operations".'
                : `list is one of ${LISTS.join(', ')}.`,
            );
          }
          const model = this.store.value;
          const items = this.files
            .restore(input.items)
            .map((item): Record<string, unknown> & { id: string } => {
              if (typeof item !== 'object' || item === null) {
                throw new Error('Each item is an object.');
              }
              const id = typeof item['id'] === 'string' ? item['id'] : '';
              if (id && findItem(model, id)) {
                throw new Error(`The id “${id}” is taken.`);
              }
              return {
                ...item,
                id: id || generateIdSync(),
                // Variables are edited in place: they don't open.
                ...(input.list === 'variables' ? {} : { expanded: false }),
              };
            });
          if (input.list === 'variables') {
            for (const variable of items) {
              if (typeof variable['name'] !== 'string' || !variable['name']) {
                throw new Error('Each variable needs a name.');
              }
            }
          }
          if (input.list === 'tools' && !nested) {
            const tools: Partial<ToolType>[] = [...model.tools];
            for (const tool of items) {
              if (tool['index'] === undefined || tool['index'] === null) {
                tool['index'] = freeToolIndex(tools);
              }
              tools.push(tool as Partial<ToolType>);
            }
          }
          await this.edit((m) =>
            insertItems(
              m,
              {
                list: input.list,
                parentId: input.parent_id,
                index: input.index,
              },
              items as { id: string }[],
            ),
          );
          return {
            added: items.map((item) => {
              const found = findItem(this.store.value, item.id);
              return {
                id: item.id,
                label: found ? itemLabel(this.store.value, found.item) : null,
              };
            }),
          };
        },
      },
      {
        name: 'update_item',
        title: 'Change an item',
        description:
          'Changes fields of any item by its id (a variable, shape, transform, point, tool, operation…): each key in `changes` is set to its value; null resets it to its default. Lists (a shape’s transforms, a point list) are replaced whole. ' +
          ABOUT_VALUES +
          ' Returns the item as it is afterwards. Undo takes it back.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            changes: { type: 'object' },
          },
          required: ['id', 'changes'],
        },
        execute: async ({
          id,
          changes,
        }: {
          id: string;
          changes: Record<string, unknown>;
        }) => {
          if (typeof changes !== 'object' || changes === null) {
            throw new Error('changes is an object of fields.');
          }
          await this.edit((m) =>
            updateItem(m, id, withIds(this.files.restore(changes))),
          );
          const found = findItem(this.store.value, id);
          return { item: found && this.files.abbreviate(found.item) };
        },
      },
      {
        name: 'update_settings',
        title: 'Change stock or G-code settings',
        description:
          'Changes the stock settings (`stock`: size, material, where it’s held — on the table or a rotary axis —, where zero is) or the G-code settings (`gcode`: machine, safe height, arcs, comments…): each key set to its value, null resets it. See describe_fields for the fields. To turn the rotary axis to lie along the other direction, use turn_rotary_axis.',
        inputSchema: {
          type: 'object',
          properties: {
            section: { type: 'string', enum: ['stock', 'gcode'] },
            changes: { type: 'object' },
          },
          required: ['section', 'changes'],
        },
        execute: async ({
          section,
          changes,
        }: {
          section: 'stock' | 'gcode';
          changes: Record<string, unknown>;
        }) => {
          if (section !== 'stock' && section !== 'gcode') {
            throw new Error('section is "stock" or "gcode".');
          }
          await this.edit((m) => updateSection(m, section, changes ?? {}));
          return { [section]: this.store.value[section] };
        },
      },
      {
        name: 'remove_items',
        title: 'Remove items',
        description:
          'Removes items by id (with whatever they hold: a shape’s transforms…). When other items refer to them (an operation cutting a removed shape, a boolean using it), nothing is removed and those references are listed, unless `force`. Undo takes it back.',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' } },
            force: { type: 'boolean' },
          },
          required: ['ids'],
        },
        execute: async ({ ids, force }: { ids: string[]; force?: boolean }) => {
          const references = referencesTo(this.store.value, ids);
          if (references.length && !force) {
            return {
              removed: [],
              referencedBy: references,
              note: 'Nothing removed: other items refer to these. Change or remove those first, or pass force.',
            };
          }
          await this.edit((m) => removeItems(m, ids));
          return { removed: ids, leftDangling: references };
        },
      },
      {
        name: 'move_item',
        title: 'Reorder an item',
        description:
          'Moves an item within its list: to `index`, or just `before` / `after` another item of the same list. Operations are cut in list order; transforms apply in list order; variables can only use the ones above them.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            index: { type: 'integer' },
            before: { type: 'string' },
            after: { type: 'string' },
          },
          required: ['id'],
        },
        execute: async (input: {
          id: string;
          index?: number;
          before?: string;
          after?: string;
        }) => {
          await this.edit((m) => moveItem(m, input.id, input));
          const found = findItem(this.store.value, input.id);
          return { list: found?.path, index: found?.index };
        },
      },
      {
        name: 'replace_model',
        title: 'Replace the whole model',
        description:
          'Puts a whole model in place of the project’s (as get_project returns it, in format `formatVersion`; an older format is brought up to date when `version` is given). Stays the same project, and undo takes it back. Prefer the item tools for small changes.',
        inputSchema: {
          type: 'object',
          properties: {
            model: { type: 'object' },
            version: { type: 'integer' },
          },
          required: ['model'],
        },
        annotations: { consequentialHint: true },
        execute: async ({
          model,
          version,
        }: {
          model: object;
          version?: number;
        }) => {
          const migrated = migrateModel({
            ...this.files.restore(model),
            version: version ?? MODEL_VERSION,
          });
          await this.edit(() => withIds(migrated));
          return { outline: outline(this.store.value) };
        },
      },
      {
        name: 'undo',
        title: 'Undo',
        description: 'Undoes the last change to the project.',
        execute: () => {
          this.history.undo();
          return this.history.state$.value;
        },
      },
      {
        name: 'redo',
        title: 'Redo',
        description: 'Redoes the last change undone.',
        execute: () => {
          this.history.redo();
          return this.history.state$.value;
        },
      },
      {
        name: 'fit_stock',
        title: 'Fit the stock',
        description:
          'Turns on the stock size and sizes it round every operation’s cuts (each shape cut, grown by its tool’s diameter).',
        execute: async () => {
          const fit = await this.cam.stockToFit();
          if (!fit)
            throw new Error('There are no cuts to fit the stock round.');
          await this.edit((m) =>
            updateSection(m, 'stock', { enabled: true, ...fit }),
          );
          return { stock: this.store.value.stock };
        },
      },
      {
        name: 'turn_rotary_axis',
        title: 'Turn the rotary axis',
        description:
          'With the stock on a rotary axis: makes the axis lie along X or Y. With `turn_project` (the default), the shapes, the stock and every setting with a direction turn a quarter turn with it, so everything stays where it was on the blank.',
        inputSchema: {
          type: 'object',
          properties: {
            along: { type: 'string', enum: ['x', 'y'] },
            turn_project: { type: 'boolean' },
          },
          required: ['along'],
        },
        execute: async ({
          along,
          turn_project = true,
        }: {
          along: 'x' | 'y';
          turn_project?: boolean;
        }) => {
          const stock = resolveStock(this.store.value.stock);
          if (stock.mount !== 'rotary') {
            throw new Error('The stock isn’t on a rotary axis.');
          }
          const from = stock.rotaryAlong === 'y' ? 'y' : 'x';
          if (from === along) return { rotaryAlong: along };
          const turned = turn_project
            ? await turnProject(this.store.value, from, along, generateId)
            : updateSection(this.store.value, 'stock', { rotaryAlong: along });
          await this.edit(() => turned);
          return { rotaryAlong: along, turned: turn_project };
        },
      },
      {
        name: 'show_shape',
        title: 'Show a shape',
        description:
          'Opens a shape in the editor and highlights it in the preview, to show the user; its points can then be dragged there. Without shape_id, closes it.',
        inputSchema: {
          type: 'object',
          properties: { shape_id: { type: 'string' } },
        },
        execute: ({ shape_id }: { shape_id?: string }) => {
          if (
            shape_id &&
            !this.store.value.shapes.some((s) => s.id === shape_id)
          ) {
            throw new Error(`There’s no shape “${shape_id}”.`);
          }
          host.selectShape(shape_id ?? null);
          return { shown: shape_id ?? null };
        },
      },
      {
        name: 'set_simulation',
        title: 'Simulate the material',
        description:
          'Shows (or hides) in the preview the material left once every enabled operation is cut, and sets how finely it’s simulated.',
        inputSchema: {
          type: 'object',
          properties: {
            on: { type: 'boolean' },
            quality: { type: 'string', enum: Object.keys(SIMULATION_CELLS) },
          },
          required: ['on'],
        },
        execute: ({ on, quality }: { on: boolean; quality?: string }) => {
          if (quality !== undefined) {
            if (!(quality in SIMULATION_CELLS)) {
              throw new Error(`Unknown quality “${quality}”.`);
            }
            this.cam.setSimulationQuality(quality as SimulationQuality);
          }
          this.cam.simulate$.next(!!on);
          return {
            simulating: this.cam.simulate$.value,
            quality: this.cam.simulationQuality$.value,
          };
        },
      },
    ];
  }

  private jobTools(): ModelContextTool[] {
    return [
      {
        name: 'get_job_summary',
        title: 'Job summary',
        description:
          'The job as it stands once the toolpaths are made: the stock and where the G-code’s zero is, the tools in use, the operations with how long each takes, the total time, and the checks to look at before cutting (warnings: likely to spoil the job or the machine; notes: worth a look) — moves into uncut material, cuts deeper than the flutes or into the spoilboard, parts cut free without tabs, toolpaths near clamps…',
        annotations: READ_ONLY,
        execute: async () => {
          const warnings = await this.cam.jobWarnings();
          const [time, view] = await Promise.all([
            firstValueFrom(this.cam.time$),
            firstValueFrom(this.cam.stock$),
          ]);
          const model = resolveModel(this.store.value, ModelFieldConfig);
          const used = new Set(
            flatOperations(model.operations).map((o: any) => o.toolId),
          );
          return {
            stock: view.stock,
            gcodeZeroInDesignCoordinates: view.zero,
            tools: model.tools
              .filter((t) => used.has(t.id))
              .map((t) => ({ id: t.id, label: numberedToolLabel(t) })),
            totalSeconds: Math.round(time.total),
            operations: time.operations.map((o) => ({
              ...o,
              seconds: Math.round(o.seconds),
            })),
            checks: warnings,
          };
        },
      },
      {
        name: 'get_gcode',
        title: 'Read the G-code',
        description:
          'The job’s G-code once the toolpaths are made: one program, or with `per_tool` one file per tool run (for machines without a tool changer). Long output comes in pages: pass `offset` (characters) to read on. Without `include_project`, the embedded project line (to load the file back into the app) is left out.',
        inputSchema: {
          type: 'object',
          properties: {
            per_tool: { type: 'boolean' },
            include_project: { type: 'boolean' },
            offset: { type: 'integer' },
          },
        },
        annotations: READ_ONLY,
        execute: async ({
          per_tool,
          include_project,
          offset = 0,
        }: {
          per_tool?: boolean;
          include_project?: boolean;
          offset?: number;
        }) => {
          const files = await this.cam.gcode(
            per_tool ? 'per-tool' : 'one',
            !!include_project,
          );
          const text = files
            .map(
              (f) => (per_tool ? `;; ===== ${f.name} =====\n` : '') + f.gcode,
            )
            .join('\n');
          const start = Math.max(0, Math.floor(offset));
          const page = text.slice(start, start + GCODE_PAGE);
          const end = start + page.length;
          return {
            files: files.map((f) => ({
              name: f.name,
              characters: f.gcode.length,
            })),
            totalCharacters: text.length,
            offset: start,
            ...(end < text.length ? { nextOffset: end } : {}),
            gcode: page,
          };
        },
      },
      {
        name: 'get_cut_list',
        title: 'Cut list',
        description:
          'The parts with their sizes (mm): every nest’s parts with their sheet and place, or, without nests, the parts the outside profiles cut out. With `csv`, as CSV text.',
        inputSchema: {
          type: 'object',
          properties: { csv: { type: 'boolean' } },
        },
        annotations: READ_ONLY,
        execute: async ({ csv }: { csv?: boolean }) => {
          const rows = await this.cam.cutList();
          return csv ? { csv: cutListCsv(rows) } : { rows };
        },
      },
      {
        name: 'get_setup_sheet',
        title: 'Setup sheet',
        description:
          'The printable setup sheet: stock, zero, tools in order, operations with their times and the checks — as its text, or with `html` the whole page (large: it has a drawing from above).',
        inputSchema: {
          type: 'object',
          properties: { html: { type: 'boolean' } },
        },
        annotations: READ_ONLY,
        execute: async ({ html }: { html?: boolean }) => {
          const page = await this.cam.setupSheet();
          return html ? { html: page } : { text: pageText(page) };
        },
      },
      {
        name: 'download',
        title: 'Download a file',
        description:
          'Saves a file through the browser’s download, for the user: `gcode` (the program, with the project embedded so it can be loaded back), `gcode-per-tool` (a zip with one file per tool run), `cut-list` (CSV), or `shape-svg` (one shape as SVG in mm, with `shape_id`).',
        inputSchema: {
          type: 'object',
          properties: {
            what: {
              type: 'string',
              enum: ['gcode', 'gcode-per-tool', 'cut-list', 'shape-svg'],
            },
            shape_id: { type: 'string' },
          },
          required: ['what'],
        },
        execute: async ({
          what,
          shape_id,
        }: {
          what: string;
          shape_id?: string;
        }) => {
          switch (what) {
            case 'gcode':
              await this.cam.settled();
              this.cam.download();
              break;
            case 'gcode-per-tool':
              await this.cam.settled();
              this.cam.downloadPerTool();
              break;
            case 'cut-list':
              await this.cam.downloadCutList();
              break;
            case 'shape-svg': {
              const shape = this.store.value.shapes.find(
                (s) => s.id === shape_id,
              );
              if (!shape) throw new Error(`There’s no shape “${shape_id}”.`);
              const resolved = resolveModel(this.store.value, ModelFieldConfig);
              const name = shapeLabel(
                resolved.shapes.find((s) => s.id === shape.id),
                resolved.shapes,
              );
              downloadFile(
                await this.cam.shapeSvg(shape.id, name),
                `${fileNameFrom(name) || 'shape'}.svg`,
                'image/svg+xml',
              );
              break;
            }
            default:
              throw new Error(`Unknown download “${what}”.`);
          }
          return { downloaded: what };
        },
      },
      {
        name: 'get_share_link',
        title: 'Share link',
        description:
          'A link that opens a copy of the project in the app: the project is in the link itself (its fragment, never sent to a server). Links of projects with pictures or imported files get long.',
        annotations: READ_ONLY,
        execute: async () => {
          const link = await shareLink(
            this.store.value,
            location.href.split('#')[0],
          );
          return { link, characters: link.length };
        },
      },
    ];
  }

  private projectTools(): ModelContextTool[] {
    /** The user says whether unsaved work may be replaced (when there is any). */
    const mayReplace = (title: string) =>
      this.commands.confirmReplace(
        title,
        'An assistant asks to replace the current project.',
        'Replace project',
      );
    const declined = {
      done: false,
      note: 'The user kept the current project.',
    };
    return [
      {
        name: 'list_templates',
        title: 'List templates',
        description:
          'The example projects that come with the app, by group, with their descriptions (open one with open_template).',
        annotations: READ_ONLY,
        execute: async () => ({ templates: await listTemplates() }),
      },
      {
        name: 'open_template',
        title: 'Open a template',
        description:
          'Replaces the project with an example project (by its `file` from list_templates). When there are unsaved changes, the user is asked first.',
        inputSchema: {
          type: 'object',
          properties: { file: { type: 'string' } },
          required: ['file'],
        },
        annotations: { consequentialHint: true },
        execute: async ({ file }: { file: string }) => {
          const template = (await listTemplates()).find(
            (t) => t.file === file || t.name === file,
          );
          if (!template) throw new Error(`There’s no template “${file}”.`);
          if (!(await mayReplace(`Open “${template.name}”?`))) return declined;
          await this.store.openTemplate(template);
          return { done: true, outline: outline(this.store.value) };
        },
      },
      {
        name: 'new_project',
        title: 'New project',
        description:
          'Replaces the project with an empty one, keeping the current tools and G-code options unless `keep_tools` / `keep_gcode` is false. When there are unsaved changes, the user is asked first.',
        inputSchema: {
          type: 'object',
          properties: {
            keep_tools: { type: 'boolean', default: true },
            keep_gcode: { type: 'boolean', default: true },
          },
        },
        annotations: { consequentialHint: true },
        execute: async ({
          keep_tools = true,
          keep_gcode = true,
        }: { keep_tools?: boolean; keep_gcode?: boolean } = {}) => {
          if (!(await mayReplace('Start a new project?'))) return declined;
          this.store.clear({ tools: keep_tools, gcode: keep_gcode });
          return { done: true };
        },
      },
      {
        name: 'list_saved_projects',
        title: 'List saved projects',
        description:
          'The projects saved by name in this browser, most recent first, and which one is open.',
        annotations: READ_ONLY,
        execute: async () => {
          await this.store.refreshProjects();
          return {
            open: this.store.project?.id ?? null,
            unsavedChanges: this.store.pending,
            projects: this.store.projects$.value.map((p) => ({
              id: p.id,
              name: p.name,
              savedAt: new Date(p.savedAt).toISOString(),
            })),
          };
        },
      },
      {
        name: 'open_saved_project',
        title: 'Open a saved project',
        description:
          'Replaces the work with a project saved in this browser (by id or name). When there are unsaved changes, the user is asked first.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Id or name.' },
          },
          required: ['project'],
        },
        annotations: { consequentialHint: true },
        execute: async ({ project }: { project: string }) => {
          const found = await savedProject(project);
          if (!(await mayReplace(`Open “${found.name}”?`))) return declined;
          await this.store.openProject(found);
          return { done: true, outline: outline(this.store.value) };
        },
      },
      {
        name: 'save_project',
        title: 'Save the project',
        description:
          'Saves the work in this browser: over the project it belongs to, or with `name` as a project of that name. Saving under the name of another saved project replaces it only with `overwrite`.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            overwrite: { type: 'boolean' },
          },
        },
        execute: async ({
          name,
          overwrite,
        }: {
          name?: string;
          overwrite?: boolean;
        }) => {
          const trimmed = name?.trim();
          if (trimmed !== undefined) {
            if (!trimmed) throw new Error('The name is empty.');
            const other = (await listProjects()).find(
              (p) => p.name === trimmed && p.id !== this.store.project?.id,
            );
            if (other && !overwrite) {
              throw new Error(
                `There’s already a saved project “${trimmed}”: pass overwrite to replace it.`,
              );
            }
          }
          await this.store.saveProject(trimmed);
          return { saved: this.store.project };
        },
      },
      {
        name: 'delete_saved_project',
        title: 'Delete a saved project',
        description:
          'Deletes a project saved in this browser (by id or name), once the user confirms. When it’s the open one, the work stays open as unsaved work.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Id or name.' },
          },
          required: ['project'],
        },
        annotations: { consequentialHint: true },
        execute: async ({ project }: { project: string }) => {
          const found = await savedProject(project);
          const confirmed = await this.commands.confirm(
            `Delete “${found.name}”?`,
            'An assistant asks to remove this project from this browser.',
            'Delete project',
          );
          if (!confirmed) {
            return { done: false, note: 'The user kept it.' };
          }
          await this.store.deleteProject(found);
          return { done: true };
        },
      },
      {
        name: 'import_parts',
        title: 'Import parts',
        description:
          'Copies shapes from a project saved in this browser into this one, with the shapes they’re made from, and (with `with_operations`) the operations that cut them, their tools (an identical tool here is used instead) and the variables they use. Everything gets new ids and goes at the end of the lists. Read the saved project’s shapes with `list_only` first.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Id or name.' },
            shape_ids: { type: 'array', items: { type: 'string' } },
            with_operations: { type: 'boolean' },
            list_only: {
              type: 'boolean',
              description: 'Only list the saved project’s shapes.',
            },
          },
          required: ['project'],
        },
        execute: async (input: {
          project: string;
          shape_ids?: string[];
          with_operations?: boolean;
          list_only?: boolean;
        }) => {
          const found = await savedProject(input.project);
          const source = await loadProject(found.id);
          if (!source) throw new Error(`“${found.name}” is no longer saved.`);
          if (input.list_only || !input.shape_ids?.length) {
            return { shapes: outline(source).shapes };
          }
          let summary: unknown;
          await this.edit((m) => {
            const imported = importParts(
              m,
              source,
              input.shape_ids!,
              !!input.with_operations,
              generateIdSync,
            );
            summary = imported.summary;
            return imported.model;
          });
          return { summary, outline: outline(this.store.value) };
        },
      },
      {
        name: 'load_gcode_project',
        title: 'Load a project from G-code',
        description:
          'Replaces the work with the project embedded in a .nc file this app wrote (its "; model=" line). When there are unsaved changes, the user is asked first.',
        inputSchema: {
          type: 'object',
          properties: { gcode: { type: 'string' } },
          required: ['gcode'],
        },
        annotations: { consequentialHint: true, untrustedContentHint: true },
        execute: async ({ gcode }: { gcode: string }) => {
          const stored = await loadModelFromGcode(String(gcode));
          if (!stored) throw new Error('It has no project embedded.');
          const model = migrateModel(stored);
          if (!(await mayReplace('Load the project from the G-code?'))) {
            return declined;
          }
          this.store.openShared(model);
          return { done: true, outline: outline(this.store.value) };
        },
      },
      {
        name: 'open_share_link',
        title: 'Open a share link',
        description:
          'Replaces the work with the project in a share link of this app (…#project=…). When there are unsaved changes, the user is asked first.',
        inputSchema: {
          type: 'object',
          properties: { link: { type: 'string' } },
          required: ['link'],
        },
        annotations: { consequentialHint: true, untrustedContentHint: true },
        execute: async ({ link }: { link: string }) => {
          const hash = String(link).slice(String(link).indexOf('#'));
          const data = sharedProjectData(hash);
          if (!data) throw new Error('It isn’t a share link.');
          const model = await sharedProject(data);
          if (!(await mayReplace('Open the shared project?'))) return declined;
          this.store.openShared(model);
          return { done: true, outline: outline(this.store.value) };
        },
      },
    ];
  }

  private libraryTools(): ModelContextTool[] {
    return [
      {
        name: 'list_tool_library',
        title: 'List the tool library',
        description:
          'The tools kept in this browser’s library for every project (by `key`); add them to the project with add_library_tools.',
        annotations: READ_ONLY,
        execute: async () => ({
          tools: (await listLibrary()).map((entry) => ({
            key: entry.key,
            label: libraryName(entry.tool) || numberedToolLabel(entry.tool),
            tool: entry.tool,
          })),
        }),
      },
      {
        name: 'add_library_tools',
        title: 'Add tools from the library',
        description:
          'Adds library tools (by key) to the project. Each keeps its index (T number) unless a tool here has it; then it gets a free one.',
        inputSchema: {
          type: 'object',
          properties: { keys: { type: 'array', items: { type: 'string' } } },
          required: ['keys'],
        },
        execute: async ({ keys }: { keys: string[] }) => {
          const library = await listLibrary();
          const entries = keys.map((key) => {
            const entry = library.find((e) => e.key === key);
            if (!entry) throw new Error(`There’s no library tool “${key}”.`);
            return entry;
          });
          const tools: Partial<ToolType>[] = [...this.store.value.tools];
          const added = entries.map(({ tool }) => {
            const { index, ...settings } = structuredClone(tool);
            const free =
              typeof index === 'number' &&
              !tools.some((t) => t.index === index);
            const item = {
              ...settings,
              id: generateIdSync(),
              expanded: false,
              index: free ? index : freeToolIndex(tools),
            } as ToolType;
            tools.push(item);
            return item;
          });
          await this.edit((m) =>
            insertItems(m, { list: 'tools' }, added as { id: string }[]),
          );
          return {
            added: added.map((t) => ({
              id: t.id,
              label: numberedToolLabel(t),
            })),
          };
        },
      },
      {
        name: 'save_tool_to_library',
        title: 'Keep a tool in the library',
        description:
          'Keeps one of the project’s tools (by id) in this browser’s library, for every project. A library tool of the same name is replaced.',
        inputSchema: {
          type: 'object',
          properties: { tool_id: { type: 'string' } },
          required: ['tool_id'],
        },
        execute: async ({ tool_id }: { tool_id: string }) => {
          // Expressions worked out: the library has no variables.
          const model = resolveModel(this.store.value, ModelFieldConfig);
          const tool = model.tools.find((t) => t.id === tool_id);
          if (!tool) throw new Error(`There’s no tool “${tool_id}”.`);
          await saveToLibrary(tool);
          return { saved: numberedToolLabel(tool) };
        },
      },
      {
        name: 'remove_library_tool',
        title: 'Remove a library tool',
        description:
          'Removes a tool (by key) from this browser’s library. Projects using it keep their own copy.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' } },
          required: ['key'],
        },
        annotations: { consequentialHint: true },
        execute: async ({ key }: { key: string }) => {
          const library = await listLibrary();
          if (!library.some((e) => e.key === key)) {
            throw new Error(`There’s no library tool “${key}”.`);
          }
          await removeFromLibrary(key);
          return { removed: key };
        },
      },
    ];
  }

  /**
   * Makes a change to the project as an edit (undo takes it back): put
   * through the editor's form first, so it's what the editor would make,
   * then handed to the store.
   */
  private async edit(change: (model: ModelType) => ModelType) {
    const next = this.normalizer.normalize(withIds(change(this.store.value)));
    this.store.set(next);
    // The editor follows the store on its next round.
    await new Promise((resolve) => setTimeout(resolve));
  }
}

/** A page's text, a line per block, without its drawings and styles. */
function pageText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('svg, style, script').forEach((e) => e.remove());
  doc
    .querySelectorAll('p, div, li, tr, h1, h2, h3, h4, br, table, section')
    .forEach((e) => e.append('\n'));
  doc.querySelectorAll('td, th').forEach((e) => e.append('\t'));
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** The saved project with this id or name. */
async function savedProject(idOrName: string): Promise<Project> {
  const projects = await listProjects();
  const found =
    projects.find((p) => p.id === idOrName) ??
    projects.find((p) => p.name === idOrName);
  if (!found) throw new Error(`There’s no saved project “${idOrName}”.`);
  return found;
}

/**
 * `value` with an id for every item of the lists whose items have one in
 * the editor (an item added inside another: a shape's transforms, points),
 * found by the form's configs.
 */
function withIds<T>(value: T): T {
  fillIds(value, ModelFieldConfig);
  return value;
}

function fillIds(model: unknown, fields: readonly FormlyFieldConfig[]) {
  if (typeof model !== 'object' || model === null) return;
  for (const field of fields) {
    if (field.key === undefined || field.key === null) {
      fillIds(model, field.fieldGroup ?? []);
      continue;
    }
    const value = (model as Record<string, unknown>)[String(field.key)];
    const itemFields =
      field.fieldArray && typeof field.fieldArray === 'object'
        ? (field.fieldArray.fieldGroup ?? [])
        : null;
    if (itemFields && Array.isArray(value)) {
      const hasId = itemFields.some((f) => f.key === 'id');
      for (const item of value) {
        if (typeof item !== 'object' || item === null) continue;
        if (hasId && typeof item.id !== 'string') item.id = generateIdSync();
        fillIds(item, itemFields);
      }
    } else if (field.fieldGroup) {
      fillIds(value, field.fieldGroup);
    }
  }
}

/** A short account of the project's items, to find one's id. */
function outline(model: ModelType) {
  const resolved = resolveModel(model, ModelFieldConfig);
  const operations = flatOperations(resolved.operations);
  const variables = evaluateVariables(model.variables);
  return {
    variables: (model.variables ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      value: v.value,
      ...(() => {
        const result = variables.byId.get(v.id);
        return result && 'value' in result
          ? { worksOutTo: result.value }
          : { error: result?.error };
      })(),
    })),
    shapes: resolved.shapes.map((s) => ({
      id: s.id,
      type: s.type,
      label: shapeLabel(s, resolved.shapes),
      ...(s.name ? {} : { description: describeShape(s, resolved.shapes) }),
      transforms: (s.transforms ?? []).map((t) => ({
        id: t.id,
        type: t.type,
        ...(t.disabled ? { disabled: true } : {}),
      })),
      ...(s.hidden ? { hidden: true } : {}),
      ...(s.clamp ? { clamp: true } : {}),
    })),
    tools: resolved.tools.map((t) => ({
      id: t.id,
      label: numberedToolLabel(t),
    })),
    operations: (resolved.operations ?? []).map((o: any) => ({
      ...operationOutline(o, resolved, operations),
      ...(o.operations
        ? {
            operations: o.operations.map((inner: any) =>
              operationOutline(inner, resolved, operations),
            ),
          }
        : {}),
    })),
  };
}

function operationOutline(o: any, model: ModelType, operations: any[]) {
  return {
    id: o.id,
    type: o.type,
    description: describeOperation(o, model.shapes, model.tools, operations),
    ...(o.name ? { name: o.name } : {}),
    ...(o.disabled ? { disabled: true } : {}),
  };
}

/** What the outline calls an item. */
function itemLabel(model: ModelType, item: any): string {
  const resolved = resolveModel(model, ModelFieldConfig);
  if (model.shapes.some((s) => s.id === item.id)) {
    return shapeLabel(
      resolved.shapes.find((s) => s.id === item.id),
      resolved.shapes,
    );
  }
  const tool = resolved.tools.find((t) => t.id === item.id);
  if (tool) return numberedToolLabel(tool);
  const operations = flatOperations(resolved.operations);
  const operation = operations.find((o: any) => o.id === item.id);
  if (operation) {
    return describeOperation(
      operation,
      resolved.shapes,
      resolved.tools,
      operations,
    );
  }
  return item.name ?? item.type ?? '';
}

/**
 * The tool with its failures logged, and given back as the error's
 * message alone (the agent gets that).
 */
function reportingErrors(tool: ModelContextTool): ModelContextTool {
  return {
    ...tool,
    execute: async (input, options) => {
      try {
        return await tool.execute(input ?? {}, options);
      } catch (error) {
        console.warn(`[webmcp] ${tool.name}`, error);
        throw new Error((error as Error)?.message ?? String(error));
      }
    },
  };
}
