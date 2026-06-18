# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based CAM tool (Angular 18, standalone components, zoneless change detection). The user defines 2D **shapes** and cutting **tools/operations** in a form-driven editor; the app converts shapes into polygons, routes toolpaths, and emits G-code, while previewing both shapes and toolpaths in a Three.js viewport. There is no backend — everything runs client-side and deploys to Firebase Hosting.

## Commands

- `npm start` / `ng serve` — dev server at http://localhost:4200 (development config, no optimization).
- `npm run build` / `ng build` — production build to `dist/`.
- `npm test` / `ng test` — Karma + Jasmine unit tests in headless/Chrome. Run a single spec by temporarily narrowing with `fdescribe`/`fit`, or `ng test --include='**/some.spec.ts'` (note: there are currently no `.spec.ts` files in `src/`).
- Formatting via Prettier (`.prettierrc`); HTML uses the `angular` parser.

Deployment is automated by GitHub Actions (`.github/workflows/firebase-hosting-*.yml`): PRs get preview channels, merges to the default branch deploy live.

## Architecture

The whole app is a set of RxJS observable pipelines wired together in `src/app/app.component.ts`. There is no NgRx/state-management library — the reactive graph *is* the state.

### The data flow

```
model$ (ModelType)  ──►  shapes$ (CamShape[])  ──►  gcode$ (string)  ──►  drawPaths$
   ▲                          │                          │
 form edits                drawShapes$              download / model metadata
```

1. **`model$`** is the single source of truth: a `BehaviorSubject<ModelType>` persisted to `localStorage` under key `model`. `ModelType = { shapes, tools }`.
2. **`generateShapesFromModel`** turns each shape into a `CamShape[]` observable. Each shape is rasterized to an SVG string (`createSvgFromShape`) and sent to the worker's `importSvg`, *except* `boolean` shapes which combine two other shapes' outputs. Transforms are then chained: each transform's output feeds the next transform's input.
3. **`generateGcodeFromOperations`** pairs every tool×operation, resolves the referenced shape by `shapeId`, runs the operation (`routePocketHole` / `flatOutline`) in the worker, and concatenates `GCodeBuilder` results into the final G-code. The full model is gzip+base64 encoded (`src/app/store.ts`) and embedded in the G-code as a `; model=` comment so a `.nc` file can be re-loaded to restore the project.

A key pattern in both `generate*` functions: a `scan` operator keeps a per-id list of long-lived inner pipelines. On each model emission, existing entries are **mutated in place** (push new params into their `BehaviorSubject`s) rather than rebuilt, so heavy worker computations only re-run when their specific inputs actually change. New ids create new pipelines; this is intentional incremental memoization — preserve it when editing.

`working$` is a zero-emission observable that increments/decrements a work-lock counter on subscribe/unsubscribe; it's `race`d against worker calls to drive the `isWorking$` spinner. Cancelling (unsubscribing) a worker observable terminates the underlying Worker.

### Web worker layer (`src/worker/`)

CPU-heavy geometry runs off the main thread. The boundary is **type-safe via a Proxy contract**:

- `src/worker/work/` exports plain functions (e.g. `importSvg`, `applyTransform`, `routePocketHole`, `flatOutline`, `applyBooleanOperation`), each returning an `Observable`. Add a new work function by exporting it and re-exporting from `src/worker/work/index.ts` — nothing else needs registration.
- `src/worker/index.ts` exposes `worker` as a `Proxy` typed as `Contract` (derived from the work functions). Calling `worker.someWork(args)` on the main thread posts a message; the result comes back as an RxJS `materialize`d notification stream, so observables, errors, and completion all cross the worker boundary intact. Up to `MAX_WORKERS` (6) workers run in parallel; idle workers are pooled for 5 minutes then terminated.
- `src/worker/main.worker.ts` is the worker entry: it looks up the function by name in `work` and runs it. Worker code is compiled with `tsconfig.worker.json`.
- Geometry uses **clipper2-wasm** (`src/cam/clipper.ts`) for boolean ops and path offsetting/inflation. The `.wasm` asset is wired into the build in `angular.json`.

### Model editor (form-driven, `src/app/model-editor/`)

The editor UI is **entirely generated from ngx-formly field configs** — there are no hand-written shape/tool forms. The model type and the form schema are co-defined:

- `shapes/`, `transforms/`, `operations/`, `tools/` each have an `index.ts` that aggregates its members into both a discriminated-union `ModelType` and a Formly `field` config.
- Each individual shape/transform/operation file (e.g. `shape-circle.ts`, `transform-rotate.ts`, `operation-flat.ts`) exports a `ModelType` interface (with a `type` discriminator) and a `Definition` (`{ type, label, fieldGroup }`). The field group uses `expressions.hide` keyed on `model.type` so only the selected variant's fields show.
- **To add a new shape/transform/operation:** create the file with its `ModelType` + `Definition`, then register it in the relevant `index.ts` (add to the union and the `[...]` array). For shapes, also add a case to `createSvgFromShape` in `app.component.ts` (unless it's handled like `boolean`); for operations, add a case to the `switch (op.type)` in `generateGcodeFromOperations`.
- Custom Formly types (`repeat`, `file`, `hidden`) live in `model-editor/components/` and are registered in `src/app/app.config.ts`.

`src/app/model-editor/model.ts` derives the parameter types (`ShapeParameters`, `OperationParameters`, etc.) by `Omit`ing the bookkeeping fields (`id`, `expanded`, `name`, `transforms`, …) via the `OmitUnion` helper in `src/util.ts`.

### CAM / G-code (`src/cam/`)

- `types.ts` — the shared geometry vocabulary: `CamPoint`, `CamPolygon`, `CamShape` (polygons + `sourceShapeId`), `CamPath`.
- `gcode-builder.ts` — fluent `GCodeBuilder` that records abstract instructions (travel/carve/plunge/feedrate/…) and renders them to G-code text with `.build()`. Builders are immutably `clone`d and `concat`ed. `addModelMetadata` embeds the project; `goToSafeHeight().stopProgram()` finalizes.
- `gcode-viewer.ts` — `gcodeToPaths` parses built G-code back into `CamPath[]` for the toolpath preview.
- `clipper.ts` — thin async wrappers over clipper2-wasm, lazily initialized via `lazy()`.

### Viewer (`src/app/viewer/viewer.component.ts`)

Three.js renderer that draws `CamShape[]` (shape outlines) and `CamPath[]` (toolpaths, travel vs. carve colored differently), with a grid helper. Pure presentation — it consumes the observables from `AppComponent`.

## Conventions & gotchas

- **Zoneless change detection** is enabled (`provideExperimentalZonelessChangeDetection`). Don't rely on Zone.js auto-detection; UI updates flow through the `async` pipe on observables.
- IDs are generated with `generateId()` (random base64url) in `src/util.ts`; equality of params is checked with `deepEqual` / `JSON.stringify` in `distinctUntilChanged` to avoid redundant worker work.
- When touching the reactive graph in `app.component.ts`, respect the `scan`-based memoization (mutate existing entries, create only for new ids) or you'll cause every operation to recompute on every keystroke.
- The worker contract is structural: a function exported from `src/worker/work/` is automatically callable as `worker.<name>()` with full types. Keep signatures serializable (structured-clone-able).
