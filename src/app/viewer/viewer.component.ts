import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  OnDestroy,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  ArrowHelper,
  BufferGeometry,
  BoxGeometry,
  EdgesGeometry,
  PlaneGeometry,
  LineSegments,
  Shape,
  LineBasicMaterial,
  Material,
  OrthographicCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  ShapeGeometry,
  Mesh,
  MeshBasicMaterial,
  Path,
  BufferAttribute,
  Color,
  Box3,
  Frustum,
  Group,
  Matrix4,
  Object3D,
  Plane,
  Raycaster,
  AmbientLight,
  DirectionalLight,
  MeshLambertMaterial,
  DoubleSide,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubePreviewComponent } from '../cube-preview/cube-preview.component';
import { pointsEqual, watchElementResize } from '../../util';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  fromEvent,
  map,
  merge,
  Observable,
  ReplaySubject,
  scan,
  share,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';

import { AdaptiveGrid } from './helpers/adaptive-grid';
import { loadView, saveView } from './helpers/saved-view';
import { DEPTH_GRADIENT_CSS, depthColor } from './helpers/depth-colors';
import {
  formatMm,
  GridLabels,
  visiblePlaneBounds,
} from './helpers/grid-labels';
import { DirectionArrows } from './helpers/direction-arrows';
import { nestPolygons } from '../../cam/polygon-nesting';
import { hasArcs, polygonPoints } from '../../cam/arcs';
import {
  CamPath,
  CamPoint,
  CamPolygon,
  CamShape,
  CamTab,
  Highlight,
} from '../../cam/types';
import { StockView, TimeSummary } from '../services/cam.service';
import { JobWarning } from '../../cam/job-checks';
import type { Heightmap } from '../../cam/simulate';
import { stockSolid } from './helpers/stock-solid';

/** The measuring line, drawn over everything. */
const MEASURE_MATERIAL = new LineBasicMaterial({
  color: '#ffd54f',
  depthTest: false,
  transparent: true,
});

/** Half the size of the cross marking a single point, in mm. */
const POINT_MARK_SIZE = 1;
/** Outlines' arcs are drawn as lines straying no further than this (mm). */
const ARC_TOLERANCE = 0.01;

/**
 * How much fitting frames across X and Y (mm) when the content has next to
 * no extent there (under 1 mm: only a point, or the vertical move an empty
 * project's program makes), or there's none: ±200 mm.
 */
const EMPTY_VIEW_SIZE = 400;

@Component({
  selector: 'app-viewer',
  imports: [CubePreviewComponent],
  template: `
    <canvas #canvas></canvas>
    <div class="labels" #labels aria-hidden="true"></div>
    <app-cube-preview
      [camera]="camera"
      [controls]="controls"
    ></app-cube-preview>
    <div class="tools">
      <button
        type="button"
        title="Fit everything in view (F)"
        aria-label="Fit to view"
        (click)="fitToView()"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M5.5 5.5h5v5h-5z" />
        </svg>
      </button>
      <button
        type="button"
        title="Top view (T)"
        aria-label="Top view"
        (click)="viewFromTop()"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 2.5h11v11h-11zM8 5v6M5 8h6" />
        </svg>
      </button>
      <button
        type="button"
        title="Measure: click two points (M; Esc to stop)"
        aria-label="Measure"
        [class.active]="measuring"
        [attr.aria-pressed]="measuring"
        (click)="toggleMeasure()"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.5 10.5 10.5 1.5l4 4-9 9zM4 8l1.5 1.5M6 6l2 2M8 4l1.5 1.5M10 2l2 2"
          />
        </svg>
      </button>
      <button
        type="button"
        title="Simulate: show the material left after cutting (S)"
        aria-label="Simulate"
        [class.active]="simulating"
        [attr.aria-pressed]="simulating"
        (click)="toggleSimulate()"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.5 6.5 8 3l6.5 3.5v4L8 14l-6.5-3.5zM1.5 6.5 8 10l6.5-3.5M8 10v4M5 8.2v-2M11 8.2v-2"
          />
        </svg>
      </button>
    </div>
    @if (warnings.length) {
      <div class="checks">
        @if (showWarnings) {
          <ul class="checks_list" aria-label="Checks before cutting">
            @for (w of warnings; track w.text) {
              <li [class.checks_warning]="w.level === 'warning'">
                {{ w.level === 'warning' ? '⚠ ' : '' }}{{ w.text }}
              </li>
            }
          </ul>
        }
        <button
          type="button"
          class="checks_toggle"
          [class.checks_toggle--notes]="!warningCount"
          [attr.aria-expanded]="showWarnings"
          (click)="showWarnings = !showWarnings"
        >
          {{
            warningCount
              ? '⚠ ' +
                warningCount +
                ' warning' +
                (warningCount === 1 ? '' : 's')
              : ''
          }}{{ warningCount && noteCount ? ' · ' : ''
          }}{{
            noteCount ? noteCount + ' note' + (noteCount === 1 ? '' : 's') : ''
          }}
        </button>
      </div>
    }
    <div class="hud">
      <span #cursorReadout class="hud_cursor"></span>
      <span #measureReadout class="hud_measure"></span>
      @if (timeText) {
        <span class="hud_time" [title]="timeDetails">≈ {{ timeText }}</span>
      }
      <span #gridReadout class="hud_grid"></span>
      <span #depthLegend class="hud_depth" hidden>
        <span>depth 0</span>
        <span class="hud_depth_bar" [style.background]="DEPTH_GRADIENT"></span>
        <span #deepestReadout></span>
      </span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      position: relative;
      overflow: hidden;
    }

    canvas {
      display: block;
    }

    .labels {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      font:
        10px/1 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      color: #8a8a8a;
    }

    .tools {
      position: absolute;
      left: 8px;
      top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;

      button {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 1px solid #3a3a3a;
        border-radius: 6px;
        background: rgba(30, 30, 30, 0.85);
        color: #bbb;
        cursor: pointer;

        &:hover {
          color: #fff;
          border-color: #666;
        }

        &.active {
          color: #ffd54f;
          border-color: #ffd54f;
        }
      }

      svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
    }

    .hud {
      position: absolute;
      left: 8px;
      bottom: 8px;
      display: flex;
      gap: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(20, 20, 20, 0.75);
      color: #bbb;
      font:
        11px/1.4 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      pointer-events: none;

      // Hide readouts with nothing to show (not the legend's bar).
      > span:empty {
        display: none;
      }
    }

    .checks {
      position: absolute;
      right: 8px;
      bottom: 8px;
      max-width: min(420px, calc(100% - 16px));
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
      font:
        12px/1.4 system-ui,
        sans-serif;
    }

    .checks_toggle {
      border: 1px solid #5a3b2e;
      border-radius: 6px;
      background: rgba(30, 20, 18, 0.9);
      color: #ffb4a2;
      padding: 3px 10px;
      cursor: pointer;

      &.checks_toggle--notes {
        border-color: #3a3a3a;
        background: rgba(30, 30, 30, 0.85);
        color: #ccc;
      }
    }

    .checks_list {
      margin: 0;
      padding: 6px 10px 6px 26px;
      max-height: 40vh;
      overflow-y: auto;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      background: rgba(20, 20, 20, 0.92);
      color: #ccc;

      li {
        margin: 3px 0;
      }

      .checks_warning {
        color: #ffb4a2;
      }
    }

    .hud_measure {
      color: #ffd54f;
    }

    .hud_depth {
      display: inline-flex;
      align-items: center;
      gap: 6px;

      &[hidden] {
        display: none;
      }
    }

    .hud_depth_bar {
      display: inline-block;
      width: 64px;
      height: 8px;
      border-radius: 4px;
    }

    app-cube-preview {
      width: min(10vh, 10vw);
      aspect-ratio: 1;
      position: absolute;
      right: 0;
      top: 0;
    }
  `,
})
export class ViewerComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<any>();
  private shapes$ = new ReplaySubject<Observable<CamShape[]>>(1);
  private paths$ = new ReplaySubject<Observable<CamPath[]>>(1);
  private highlight$ = new ReplaySubject<Highlight>(1);

  @ViewChild('canvas', { static: true })
  canvas!: ElementRef<HTMLCanvasElement>;

  @ViewChild('labels', { static: true })
  private labelsLayer!: ElementRef<HTMLElement>;

  @ViewChild('cursorReadout', { static: true })
  private cursorReadout!: ElementRef<HTMLElement>;

  @ViewChild('measureReadout', { static: true })
  private measureReadout!: ElementRef<HTMLElement>;

  /** Measuring: clicks on the preview pick the two ends of a measurement. */
  measuring = false;
  /** The measurement's ends, the second null while it's being picked. */
  private measureFrom: Vector3 | null = null;
  private measureTo: Vector3 | null = null;
  private measureGroup = new Group();
  /** Where shapes' vertices are, to snap measurements to. */
  private snapPoints: CamPoint[] = [];
  private pixelsPerUnit = 1;

  @ViewChild('gridReadout', { static: true })
  private gridReadout!: ElementRef<HTMLElement>;

  @ViewChild('depthLegend', { static: true })
  private depthLegend!: ElementRef<HTMLElement>;

  @ViewChild('deepestReadout', { static: true })
  private deepestReadout!: ElementRef<HTMLElement>;

  readonly DEPTH_GRADIENT = DEPTH_GRADIENT_CSS;
  /** Z of the deepest cut in the job (≤ 0); cut colours scale to it. */
  private deepest$ = new BehaviorSubject(0);

  /** Shapes and toolpaths; its bounding box is what "fit to view" frames. */
  private content = new Group();
  /** Keep framing the content until the user moves the camera themselves. */
  private autoFit = true;
  /** The content's box as last framed automatically ('' for none). */
  private fittedBox = '';

  camera!: OrthographicCamera;

  private arrows = new Set<DirectionArrows>();
  private arrowsDirty = false;
  private arrowsTimer: ReturnType<typeof setTimeout> | undefined;
  /** Arrows shown by the last thinning pass, to keep them stable. */
  private shownArrows = new WeakMap<DirectionArrows, Set<number>>();
  controls!: OrbitControls;
  /** Draw the next frame (the preview only draws when asked). */
  private requestRender = () => {};

  @Input()
  set shapes(value: Observable<CamShape[]>) {
    this.shapes$.next(value);
  }

  @Input()
  set paths(value: Observable<CamPath[]>) {
    this.paths$.next(value);
  }

  @Input()
  set highlight(value: Highlight) {
    this.highlight$.next(value);
  }

  /** The stock (drawn as a box) and the G-code's zero (the axes). */
  @Input()
  set stock(value: StockView | null) {
    this.stock$.next(value);
  }
  private stock$ = new BehaviorSubject<StockView | null>(null);

  /** How long the job takes, for the HUD. */
  @Input()
  set time(value: TimeSummary | null) {
    this.timeText = value && value.total > 0 ? formatDuration(value.total) : '';
    this.timeDetails = value
      ? [
          'Estimated machining time (no acceleration):',
          ...value.operations.map(
            (o) => `${formatDuration(o.seconds)}  ${o.name}`,
          ),
        ].join('\n')
      : '';
  }
  timeText = '';
  timeDetails = '';

  /** What to look at before cutting (see `checkJob`). */
  @Input()
  set checks(value: JobWarning[] | null) {
    this.warnings = value ?? [];
    this.warningCount = this.warnings.filter(
      (w) => w.level === 'warning',
    ).length;
    this.noteCount = this.warnings.length - this.warningCount;
  }
  warnings: JobWarning[] = [];
  warningCount = 0;
  noteCount = 0;
  showWarnings = false;

  /** What's left of the stock after cutting, while simulating. */
  @Input()
  set simulation(value: Heightmap | null) {
    this.simulation$.next(value);
  }
  private simulation$ = new BehaviorSubject<Heightmap | null>(null);
  /** Simulating: asks for the material left, and shows it. */
  simulating = false;
  @Output() simulateChange = new EventEmitter<boolean>();
  /**
   * The toolpaths, hidden while the simulated material is shown (so are the
   * shapes).
   */
  private pathsGroup = new Group();

  /** Shapes marked as clamps: drawn in red. */
  @Input()
  set clampShapes(value: string[] | null) {
    this.clampShapes$.next(value ?? []);
  }
  private clampShapes$ = new BehaviorSubject<string[]>([]);

  /** Shapes toggled off in the editor: not drawn (toolpaths unaffected). */
  @Input()
  set hiddenShapes(value: string[]) {
    this.hiddenShapes$.next(value);
  }
  private hiddenShapes$ = new BehaviorSubject<string[]>([]);

  constructor(private host: ElementRef) {}

  ngOnInit(): void {
    var scene = new Scene();

    const frustumSize = 1500;
    this.camera = new OrthographicCamera();
    this.camera.up.set(0, 0, 1);

    var renderer = new WebGLRenderer({
      antialias: true,
      canvas: this.canvas.nativeElement,
    });

    watchElementResize(this.host.nativeElement!)
      .pipe(
        distinctUntilChanged(
          (a, b) => a.width === b.width && a.height === b.height,
        ),
        debounceTime(100),
        tap(({ width, height }) => {
          const aspect = width / height;
          this.camera.left = (frustumSize * aspect) / -2;
          this.camera.right = (frustumSize * aspect) / 2;
          this.camera.top = frustumSize / 2;
          this.camera.bottom = frustumSize / -2;
          this.camera.near = 1;
          this.camera.far = 1e6;
          this.camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          this.requestRender();
        }),
        takeUntil(this.destroy$),
      )
      .subscribe();

    this.camera.position.set(175, -1225, 775);
    this.camera.lookAt(scene.position);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.zoomSpeed = 1.2;
    // Zoom towards what's under the cursor, not the middle of the screen.
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => (this.autoFit = false));

    // Restore the view from the last visit, and remember it as it changes
    // (orbiting, panning, zooming, fit, top view and the view cube all go
    // through the controls).
    const saved = loadView();
    if (saved) {
      this.camera.position.fromArray(saved.position);
      this.controls.target.fromArray(saved.target);
      this.camera.zoom = saved.zoom;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.autoFit = saved.autoFit;
    }
    const save = () =>
      saveView({
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
        zoom: this.camera.zoom,
        autoFit: this.autoFit,
      });
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    this.controls.addEventListener('change', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    });
    // Don't lose a change made just before leaving or reloading.
    fromEvent(window, 'pagehide')
      .pipe(takeUntil(this.destroy$))
      .subscribe(save);

    const grid = new AdaptiveGrid();
    scene.add(grid);
    scene.add(this.content);
    scene.add(this.measureGroup);
    this.content.add(this.pathsGroup);
    this.drawSimulation(scene, grid);

    // Axis arrows of a constant on-screen size (scaled per frame below).
    const origin = new Vector3(0, 0, 0);
    const axes = [
      new ArrowHelper(new Vector3(1, 0, 0), origin, 1, 'red', 0.2, 0.08),
      new ArrowHelper(new Vector3(0, 1, 0), origin, 1, 'green', 0.2, 0.08),
      new ArrowHelper(new Vector3(0, 0, 1), origin, 0.6, 'blue', 0.2, 0.08),
    ];
    axes.forEach((axis) => scene.add(axis));

    // The stock, as a box from its top (Z0 of the design) down, and the
    // G-code's zero, where the axes are drawn.
    const stockBox = new Group();
    this.content.add(stockBox);
    const stockEdges = new LineBasicMaterial({
      color: '#c9a227',
      transparent: true,
      opacity: 0.7,
    });
    const stockTop = new MeshBasicMaterial({
      color: '#c9a227',
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });
    this.stock$.pipe(takeUntil(this.destroy$)).subscribe((view) => {
      stockBox.children.forEach((child) => {
        (child as Mesh).geometry.dispose();
      });
      stockBox.clear();
      const zero = view?.zero ?? { x: 0, y: 0, z: 0 };
      axes.forEach((axis) => axis.position.set(zero.x, zero.y, zero.z));
      if (view?.stock.enabled) {
        const { width, height, thickness, x, y } = view.stock;
        const box = new BoxGeometry(width, height, thickness);
        box.translate(x + width / 2, y + height / 2, -thickness / 2);
        const edges = new LineSegments(new EdgesGeometry(box), stockEdges);
        box.dispose();
        const top = new PlaneGeometry(width, height);
        top.translate(x + width / 2, y + height / 2, 0);
        stockBox.add(edges, new Mesh(top, stockTop));
      }
      this.requestRender();
    });

    const labels = new GridLabels(this.labelsLayer.nativeElement);
    this.trackCursor(renderer.domElement);

    let arrowsKey = '';
    let viewKey = '';
    const frame = () => {
      const pixelsPerUnit =
        (renderer.domElement.clientHeight * this.camera.zoom) / frustumSize;
      this.pixelsPerUnit = pixelsPerUnit;

      // Grid, labels, axes and arrows only change when the view does.
      const { clientWidth: width, clientHeight: height } = renderer.domElement;
      const key = [
        ...this.camera.position.toArray(),
        ...this.controls.target.toArray(),
        this.camera.zoom,
        width,
        height,
        grid.position.z,
      ].join();

      // Arrows keep a constant on-screen size and are thinned out on screen,
      // so re-lay them out when the view, the paths or the highlight change.
      if (pixelsPerUnit > 0 && (key !== arrowsKey || this.arrowsDirty)) {
        arrowsKey = key;
        this.arrowsDirty = false;
        this.layoutArrows(pixelsPerUnit, width, height);
      }

      if (pixelsPerUnit > 0 && key !== viewKey) {
        viewKey = key;
        const bounds = visiblePlaneBounds(this.camera, this.controls.target);
        const spacing = grid.update(bounds, pixelsPerUnit);
        labels.update(
          bounds,
          spacing,
          this.camera,
          width,
          height,
          grid.position.z,
        );
        this.gridReadout.nativeElement.textContent = `grid ${formatMm(
          spacing.minor,
        )} mm`;
        const axisLength = 70 / pixelsPerUnit;
        axes.forEach((axis) => axis.scale.setScalar(axisLength));
      }

      // Until the user takes over, keep the whole project in view as shapes
      // and toolpaths arrive or change. Wait for the real viewport size
      // (before the first resize the camera has a ±1 frustum).
      if (this.autoFit && this.camera.right - this.camera.left > 2) {
        const box = this.viewBox();
        const boxKey = [...box.min.toArray(), ...box.max.toArray()]
          .map((v) => v.toFixed(2))
          .join();
        if (boxKey !== this.fittedBox) {
          this.fittedBox = boxKey;
          this.fitToView(box);
        }
      }

      renderer.render(scene, this.camera);
    };

    // Draw only when something changed, at most once per frame: an idle
    // preview costs nothing.
    let renderPending = false;
    this.requestRender = () => {
      if (renderPending) {
        return;
      }
      renderPending = true;
      requestAnimationFrame(() => {
        renderPending = false;
        frame();
      });
    };
    // The camera moved (orbit, pan, zoom, fit, top view, view cube).
    this.controls.addEventListener('change', this.requestRender);
    this.requestRender();

    const material = new LineBasicMaterial({
      transparent: true,
      color: 'orange',
      opacity: 0.2,
    });
    const materialHighlight = new LineBasicMaterial({
      color: 'orange',
    });
    const nullMaterial = new LineBasicMaterial({
      opacity: 0,
      transparent: true,
    });
    const clampEdges = new LineBasicMaterial({ color: '#ef4444' });
    const clampFaces = new MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    const tabEdges = new LineBasicMaterial({ color: '#4dd0e1' });
    const tabFaces = new MeshBasicMaterial({
      color: '#4dd0e1',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    const pathCarveMaterial = new LineBasicMaterial({
      transparent: true,
      vertexColors: true,
      opacity: 0,
    });
    const pathTravelMaterial = new LineBasicMaterial({
      transparent: true,
      color: 'salmon',
      opacity: 0,
    });
    const highlightPathCarveMaterial = new LineBasicMaterial({
      vertexColors: true,
    });
    const highlightPathTravelMaterial = new LineBasicMaterial({
      color: 'salmon',
      transparent: true,
      opacity: 0.5,
    });
    // White, tinted per arrow by depth (instance colours).
    const arrowCarveMaterial = new MeshBasicMaterial({ color: 'white' });
    const arrowTravelMaterial = new MeshBasicMaterial({
      color: 'salmon',
      transparent: true,
      opacity: 0.7,
    });

    this.shapes$
      .pipe(
        switchMap((shapes$) => shapes$),
        takeUntil(this.destroy$),
      )
      .subscribe((shapes) => {
        this.snapPoints = shapes.flatMap((shape) =>
          shape.polygons.flatMap((polygon) =>
            polygon.vertices.map(({ x, y }) => ({ x, y })),
          ),
        );
      });

    this.shapes$
      .pipe(
        switchMap((paths$) => paths$),
        scan(
          (ctx, shapes) =>
            new Map(
              shapes.map((shape) => {
                const existing = ctx.get(shape);
                if (existing) {
                  return [shape, existing] as const;
                }

                const isHighlighted$ = this.highlight$.pipe(
                  map(
                    (h) =>
                      (!h.shapes.length && !h.operations.length) ||
                      h.shapes.includes(shape.sourceShapeId),
                  ),
                  distinctUntilChanged(),
                );

                return [
                  shape,
                  this.drawShape({
                    shape,
                    scene: this.content,
                    material,
                    materialHighlight,
                    nullMaterial,
                    tabEdges,
                    tabFaces,
                    clampEdges,
                    clampFaces,
                    clamp$: this.clampShapes$.pipe(
                      map((ids) => ids.includes(shape.sourceShapeId)),
                      distinctUntilChanged(),
                    ),
                    highlight$: isHighlighted$,
                    // Toggled off, or the simulated material is shown.
                    hidden$: combineLatest([
                      this.hiddenShapes$,
                      this.simulation$,
                    ]).pipe(
                      map(
                        ([hidden, simulation]) =>
                          !!simulation || hidden.includes(shape.sourceShapeId),
                      ),
                      distinctUntilChanged(),
                    ),
                  }).pipe(
                    share({
                      resetOnRefCountZero: () => timer(0),
                    }),
                  ),
                ] as const;
              }),
            ),
          new Map<CamShape, Observable<never>>(),
        ),
        switchMap((all) => merge(...all.values())),
        takeUntil(this.destroy$),
      )
      .subscribe();

    // Paths of one operation, move type and shape are drawn together, as
    // one line object: a pocket alone can have thousands of paths, and each
    // object is a draw call. Unchanged paths keep their identity (see
    // `reuseUnchangedPaths`), so an unchanged group keeps its drawing.
    this.paths$
      .pipe(
        switchMap((paths$) => paths$),
        tap((paths) => this.updateDeepest(paths)),
        map(groupPaths),
        scan(
          (ctx, groups) =>
            new Map(
              [...groups].map(([key, paths]) => {
                const existing = ctx.get(key);
                if (existing && sameItems(existing.paths, paths)) {
                  return [key, existing] as const;
                }

                const [first] = paths;
                const isHighlighted$ = this.highlight$.pipe(
                  map((h) =>
                    h.operations.length
                      ? !!first.sourceOperationId &&
                        h.operations.includes(first.sourceOperationId)
                      : !h.shapes.length ||
                        h.shapes.includes(first.sourceShapeId),
                  ),
                  distinctUntilChanged(),
                );
                const travel = first.type === 'travel';

                return [
                  key,
                  {
                    paths,
                    draw$: this.drawPaths({
                      paths,
                      scene: this.pathsGroup,
                      material: travel ? pathTravelMaterial : pathCarveMaterial,
                      materialHighlight: travel
                        ? highlightPathTravelMaterial
                        : highlightPathCarveMaterial,
                      arrowMaterial: travel
                        ? arrowTravelMaterial
                        : arrowCarveMaterial,
                      colorByDepth: !travel,
                      highlight$: isHighlighted$,
                    }).pipe(
                      share({
                        resetOnRefCountZero: () => timer(0),
                      }),
                    ),
                  },
                ] as const;
              }),
            ),
          new Map<string, { paths: CamPath[]; draw$: Observable<never> }>(),
        ),
        switchMap((all) => merge(...[...all.values()].map((g) => g.draw$))),
        takeUntil(this.destroy$),
      )
      .subscribe();
  }

  /**
   * Lay out direction arrows for the current view, then thin them across all
   * visible paths so parallel passes (pockets, v-carves) don't bury the view:
   * a new arrow needs SPACING_PX of free screen around it. Every path's
   * midpoint gets a chance before any second arrow. Arrows already on screen
   * only give way once something is closer than KEEP_PX, so moving the view
   * doesn't make them flicker (distances don't change when panning or
   * rotating, unlike a fixed grid).
   *
   * Runs every frame while the view moves, so it only works on what's on
   * screen: paths outside the view are skipped entirely, and off-screen
   * arrows of partly visible paths take no part in the thinning.
   */
  private layoutArrows(pixelsPerUnit: number, width: number, height: number) {
    const SPACING_PX = 62;
    const KEEP_PX = 40;
    const MARGIN_PX = SPACING_PX;

    const camera = this.camera;
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection);
    const e = viewProjection.elements;

    const shownBefore = this.shownArrows;
    this.shownArrows = new WeakMap();

    // Screen-space candidates, in flat arrays to keep this allocation-light.
    const owners: DirectionArrows[] = [];
    const indices: number[] = [];
    const levels: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const kept: number[] = [];
    const fresh: number[] = [];

    this.arrows.forEach((arrows) => {
      if (!arrows.shown || !frustum.intersectsBox(arrows.bounds)) {
        arrows.clear();
        return;
      }
      arrows.update(pixelsPerUnit);
      const before = shownBefore.get(arrows);
      for (let index = 0; index < arrows.laidOut; index++) {
        // Project to screen (orthographic: w = 1).
        const p = arrows.positionOf(index);
        const x =
          ((e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12] + 1) / 2) * width;
        const y =
          ((1 - (e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13])) / 2) * height;
        if (
          x < -MARGIN_PX ||
          y < -MARGIN_PX ||
          x > width + MARGIN_PX ||
          y > height + MARGIN_PX
        ) {
          continue; // off-screen: drawn but invisible, no need to thin
        }
        const c = owners.length;
        owners.push(arrows);
        indices.push(index);
        levels.push(arrows.levelOf(index));
        xs.push(x);
        ys.push(y);
        (before?.has(index) ? kept : fresh).push(c);
      }
    });
    const byLevel = (a: number, b: number) => levels[a] - levels[b];
    kept.sort(byLevel);
    fresh.sort(byLevel);

    // Spatial hash of accepted arrows for quick "anything within r?" checks.
    const buckets = new Map<number, number[]>();
    const bucketKey = (bx: number, by: number) => bx * 100003 + by;
    const crowded = (c: number, radius: number) => {
      const bx = Math.floor(xs[c] / SPACING_PX);
      const by = Math.floor(ys[c] / SPACING_PX);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(bucketKey(bx + dx, by + dy));
          if (!bucket) continue;
          for (const o of bucket)
            if (Math.hypot(xs[o] - xs[c], ys[o] - ys[c]) < radius) return true;
        }
      return false;
    };
    const place = (c: number, radius: number) => {
      if (crowded(c, radius)) {
        owners[c].hideArrow(indices[c]);
        return;
      }
      const key = bucketKey(
        Math.floor(xs[c] / SPACING_PX),
        Math.floor(ys[c] / SPACING_PX),
      );
      const bucket = buckets.get(key);
      if (bucket) bucket.push(c);
      else buckets.set(key, [c]);
      let shown = this.shownArrows.get(owners[c]);
      if (!shown) {
        shown = new Set();
        this.shownArrows.set(owners[c], shown);
      }
      shown.add(indices[c]);
    };

    kept.forEach((c) => place(c, KEEP_PX));
    fresh.forEach((c) => place(c, SPACING_PX));
  }

  /**
   * Lay out arrows once paths stop arriving: thinning works across all
   * paths, so doing it for each of thousands of new paths would redo it
   * thousands of times.
   */
  private layoutArrowsSoon() {
    clearTimeout(this.arrowsTimer);
    this.arrowsTimer = setTimeout(() => {
      this.arrowsDirty = true;
      this.requestRender();
    }, 50);
  }

  /** Find the deepest cut and update the colour scale and legend. */
  private updateDeepest(paths: CamPath[]) {
    let deepest = 0;
    for (const path of paths) {
      if (path.type !== 'carve') continue;
      for (const point of path.points) {
        if (point.z < deepest) deepest = point.z;
      }
    }
    if (deepest !== this.deepest$.value) {
      this.deepest$.next(deepest);
    }
    this.depthLegend.nativeElement.hidden = deepest >= 0;
    this.deepestReadout.nativeElement.textContent = `${formatMm(deepest)} mm`;
  }

  /**
   * The box fitting frames: the shapes and toolpaths, or `EMPTY_VIEW_SIZE`
   * around them (around the origin when there are none) when they have no
   * extent across X and Y.
   */
  private viewBox(): Box3 {
    const box = new Box3().setFromObject(this.content);
    if (box.isEmpty()) {
      box.setFromCenterAndSize(new Vector3(), new Vector3());
    }
    const size = box.getSize(new Vector3());
    if (Math.max(size.x, size.y) < 1) {
      box.expandByVector(
        new Vector3(EMPTY_VIEW_SIZE / 2, EMPTY_VIEW_SIZE / 2, 0),
      );
    }
    return box;
  }

  /** Frame all shapes and toolpaths, keeping the current viewing angle. */
  fitToView(box = this.viewBox()) {
    const center = box.getCenter(new Vector3());
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.camera.updateMatrixWorld();

    // The box's extent as seen by the camera.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new Vector3(x, y, z).applyMatrix4(
            this.camera.matrixWorldInverse,
          );
          min.min(p);
          max.max(p);
        }
    const width = Math.max(max.x - min.x, 1e-3);
    const height = Math.max(max.y - min.y, 1e-3);

    this.camera.zoom = Math.min(
      1e4,
      0.85 *
        Math.min(
          (this.camera.right - this.camera.left) / width,
          (this.camera.top - this.camera.bottom) / height,
        ),
    );
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Look from the top and frame the content again, and keep framing it as
   * it arrives or changes until the user moves the camera (as on a first
   * visit): for a project that was just opened, whose shapes and toolpaths
   * are still coming.
   */
  refit() {
    this.viewFromTop();
    this.autoFit = true;
    this.fittedBox = '';
    this.requestRender();
  }

  /** Look straight down at the XY plane (X right, Y up). */
  viewFromTop() {
    const distance = this.camera.position.distanceTo(this.controls.target);
    // A hair off vertical: Z is "up", so straight down has no defined roll.
    this.camera.position
      .copy(this.controls.target)
      .add(new Vector3(0, -distance * 1e-4, distance));
    this.controls.update();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      target?.closest('input, textarea, select, [contenteditable], .modal')
    ) {
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      this.fitToView();
    } else if (event.key === 't' || event.key === 'T') {
      this.viewFromTop();
    } else if (event.key === 'm' || event.key === 'M') {
      this.toggleMeasure();
    } else if (event.key === 's' || event.key === 'S') {
      this.toggleSimulate();
    } else if (event.key === 'Escape' && this.measuring) {
      this.toggleMeasure();
    }
  }

  /** Shows or hides the material left after cutting. */
  toggleSimulate() {
    this.simulating = !this.simulating;
    this.simulateChange.emit(this.simulating);
  }

  /**
   * The simulated material as a lit, wood-coloured solid (darker where it's
   * cut deeper, with holes where it's cut through), in place of the
   * toolpaths while it's shown.
   */
  private drawSimulation(scene: Scene, grid: Object3D) {
    scene.add(new AmbientLight('#ffffff', 1.6));
    const sun = new DirectionalLight('#ffffff', 1.8);
    sun.position.set(-0.5, -0.8, 1.2);
    scene.add(sun);
    // Pulled towards the camera, so the grid (on the same Z0) stays behind
    // the uncut surface instead of flickering through it.
    const material = new MeshLambertMaterial({
      vertexColors: true,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const surface = new Group();
    this.content.add(surface);
    const colors = {
      top: new Color('#e2c08f'),
      floor: new Color('#7a4a22'),
      side: new Color('#c9a06a'),
    };

    this.simulation$.pipe(takeUntil(this.destroy$)).subscribe((map) => {
      surface.children.forEach((child) => (child as Mesh).geometry.dispose());
      surface.clear();
      this.pathsGroup.visible = !map;
      // The block stands on the grid, rather than the grid cutting through
      // it at Z0.
      grid.position.z = map ? map.bottom : 0;
      if (map) {
        const solid = stockSolid(map, colors);
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new BufferAttribute(solid.positions, 3),
        );
        geometry.setAttribute('color', new BufferAttribute(solid.colors, 3));
        geometry.setIndex(new BufferAttribute(solid.index, 1));
        geometry.computeVertexNormals();
        surface.add(new Mesh(geometry, material));
      }
      this.requestRender();
    });
  }

  /** Starts or stops measuring (stopping clears the measurement). */
  toggleMeasure() {
    this.measuring = !this.measuring;
    this.measureFrom = null;
    this.measureTo = null;
    this.drawMeasurement(null);
  }

  /**
   * The point on the XY plane under the pointer, snapped to the nearest
   * shape vertex within a few pixels.
   */
  private measurePoint(hit: Vector3): Vector3 {
    const reach = 8 / Math.max(this.pixelsPerUnit, 1e-9);
    let best: CamPoint | null = null;
    let bestDistance = reach;
    for (const p of this.snapPoints) {
      const d = Math.hypot(p.x - hit.x, p.y - hit.y);
      if (d < bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best ? new Vector3(best.x, best.y, 0) : hit.clone();
  }

  /** Draws the measurement from `measureFrom` to `to`, and its readout. */
  private drawMeasurement(to: Vector3 | null) {
    this.measureGroup.children.forEach((child) =>
      (child as LineSegments).geometry.dispose(),
    );
    this.measureGroup.clear();
    const from = this.measureFrom;
    const readout = this.measureReadout.nativeElement;
    if (!from) {
      readout.textContent = this.measuring
        ? 'measure: click the first point'
        : '';
      this.requestRender();
      return;
    }
    const end = to ?? from;
    const mark = 4 / Math.max(this.pixelsPerUnit, 1e-9);
    const positions = [
      from.x,
      from.y,
      0,
      end.x,
      end.y,
      0,
      ...[from, end].flatMap((p) => [
        p.x - mark,
        p.y - mark,
        0,
        p.x + mark,
        p.y + mark,
        0,
        p.x - mark,
        p.y + mark,
        0,
        p.x + mark,
        p.y - mark,
        0,
      ]),
    ];
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    const line = new LineSegments(geometry, MEASURE_MATERIAL);
    line.renderOrder = 10;
    this.measureGroup.add(line);
    const dx = end.x - from.x;
    const dy = end.y - from.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    readout.textContent = `${formatMm(Math.hypot(dx, dy))} mm  (ΔX ${formatMm(dx)}  ΔY ${formatMm(dy)}  ${angle.toFixed(1)}°)`;
    this.requestRender();
  }

  /** Show the cursor's position on the XY plane, in mm. */
  private trackCursor(canvas: HTMLCanvasElement) {
    const readout = this.cursorReadout.nativeElement;
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 0, 1), 0);
    const ndc = new Vector2();
    const hit = new Vector3();

    const pointAt = (event: MouseEvent) => {
      ndc.set(
        (event.offsetX / canvas.clientWidth) * 2 - 1,
        -(event.offsetY / canvas.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      return raycaster.ray.intersectPlane(plane, hit);
    };

    canvas.addEventListener('pointermove', (event) => {
      const at = pointAt(event);
      readout.textContent = at
        ? `X ${at.x.toFixed(2)}  Y ${at.y.toFixed(2)} mm`
        : '';
      // While picking the second end, follow the pointer.
      if (at && this.measuring && this.measureFrom && !this.measureTo) {
        this.drawMeasurement(this.measurePoint(at));
      }
    });
    canvas.addEventListener('pointerleave', () => (readout.textContent = ''));

    // A click (not the end of a drag to orbit or pan) picks a measurement's
    // ends: the first, the second, then a new first.
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('click', (event) => {
      const moved =
        !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4;
      if (!this.measuring || moved) return;
      const at = pointAt(event);
      if (!at) return;
      const point = this.measurePoint(at);
      if (!this.measureFrom || this.measureTo) {
        this.measureFrom = point;
        this.measureTo = null;
      } else {
        this.measureTo = point;
      }
      this.drawMeasurement(this.measureTo ?? point);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.arrowsTimer);
    this.destroy$.next(1);
  }

  private drawPaths(o: {
    paths: CamPath[];
    scene: Object3D;
    material: Material;
    materialHighlight: Material;
    arrowMaterial: Material;
    colorByDepth: boolean;
    highlight$: Observable<boolean>;
  }) {
    return timer(0).pipe(
      switchMap(
        () =>
          new Observable<never>((_) => {
            const clean = new Subscription();

            // Each path's segments as separate pairs of points, so one path
            // doesn't join up with the next.
            const segments = o.paths.reduce(
              (n, p) => n + Math.max(0, p.points.length - 1),
              0,
            );
            const positions = new Float32Array(segments * 6);
            let at = 0;
            for (const path of o.paths) {
              const points = path.points;
              for (let i = 1; i < points.length; i++) {
                const a = points[i - 1];
                const b = points[i];
                positions[at++] = a.x;
                positions[at++] = a.y;
                positions[at++] = a.z;
                positions[at++] = b.x;
                positions[at++] = b.y;
                positions[at++] = b.z;
              }
            }
            const geometry = new BufferGeometry();
            geometry.setAttribute(
              'position',
              new BufferAttribute(positions, 3),
            );

            const line = new LineSegments(geometry, o.material);
            o.scene.add(line);

            // Arrows stay per path: each path's midpoint gets one before any
            // path gets a second (see `layoutArrows`).
            const arrows = o.paths.map(
              (path) =>
                new DirectionArrows(
                  path.points.map(({ x, y, z }) => new Vector3(x, y, z)),
                  o.arrowMaterial,
                ),
            );
            for (const a of arrows) {
              o.scene.add(a.mesh);
              this.arrows.add(a);
            }
            this.layoutArrowsSoon();

            if (o.colorByDepth) {
              // Recolour whenever the job's deepest cut changes.
              const colors = new Float32Array(positions.length);
              geometry.setAttribute('color', new BufferAttribute(colors, 3));
              const color = new Color();
              clean.add(
                this.deepest$.subscribe((deepest) => {
                  for (let i = 0; i < positions.length; i += 3) {
                    depthColor(positions[i + 2], deepest, color).toArray(
                      colors,
                      i,
                    );
                  }
                  geometry.attributes['color'].needsUpdate = true;
                  for (const a of arrows) {
                    a.colorBy((p) => depthColor(p.z, deepest, color));
                  }
                  this.requestRender();
                }),
              );
            }

            clean.add(() => {
              o.scene.remove(line);
              geometry.dispose();
              for (const a of arrows) {
                o.scene.remove(a.mesh);
                this.arrows.delete(a);
                a.dispose();
              }
              this.requestRender();
            });

            let isNew = true;
            clean.add(
              o.highlight$.subscribe((highlight) => {
                line.material = highlight ? o.materialHighlight : o.material;
                // Unhighlighted paths are fully transparent; hide their
                // arrows too. New paths' arrows are laid out with the rest
                // that arrive.
                for (const a of arrows) {
                  if (a.shown !== highlight && !isNew) {
                    this.arrowsDirty = true;
                  }
                  a.shown = highlight;
                }
                isNew = false;
                this.requestRender();
              }),
            );

            return clean;
          }),
      ),
    );
  }

  private drawShape(o: {
    shape: CamShape;
    scene: Object3D;
    material: Material;
    materialHighlight: Material;
    nullMaterial: Material;
    tabEdges: Material;
    tabFaces: Material;
    clampEdges: Material;
    clampFaces: Material;
    clamp$: Observable<boolean>;
    highlight$: Observable<boolean>;
    hidden$: Observable<boolean>;
  }) {
    return timer(0).pipe(
      switchMap(
        () =>
          new Observable<never>((_) => {
            const clean = new Subscription();

            const sceneItems: (LineSegments | Mesh)[] = [];

            // Fill each outline with its holes cut out, rather than filling
            // every closed polygon (which paints holes over as solid).
            const closed = o.shape.polygons.filter(
              (poly) =>
                poly.close && (poly.vertices.length > 2 || hasArcs(poly)),
            );
            const vectors = (poly: CamPolygon) =>
              polygonPoints(poly, ARC_TOLERANCE).map(
                ({ x, y }) => new Vector2(x, y),
              );
            for (const { outer, holes } of nestPolygons(closed)) {
              const shape = new Shape(vectors(outer));
              shape.holes = holes.map((hole) => new Path(vectors(hole)));
              const geometry = new ShapeGeometry(shape);
              const mesh = new Mesh(geometry, o.material);
              sceneItems.push(mesh);
              o.scene.add(mesh);

              clean.add(() => {
                o.scene.remove(mesh);
                geometry.dispose();
              });
            }

            // Every outline of the shape as one line object; single points
            // (centre marks, drill points) as small crosses.
            const segments: number[] = [];
            for (const poly of o.shape.polygons) {
              const points = polygonPoints(poly, ARC_TOLERANCE);
              if (points.length === 1) {
                const { x, y } = points[0];
                const r = POINT_MARK_SIZE;
                segments.push(x - r, y - r, 0, x + r, y + r, 0);
                segments.push(x - r, y + r, 0, x + r, y - r, 0);
                continue;
              }
              for (let i = 1; i < points.length; i++) {
                const a = points[i - 1];
                const b = points[i];
                segments.push(a.x, a.y, 0, b.x, b.y, 0);
              }
              const first = points[0];
              const last = points[points.length - 1];
              if (
                poly.close &&
                points.length > 2 &&
                !pointsEqual(first, last)
              ) {
                segments.push(last.x, last.y, 0, first.x, first.y, 0);
              }
            }
            if (segments.length) {
              const geometry = new BufferGeometry();
              geometry.setAttribute(
                'position',
                new BufferAttribute(new Float32Array(segments), 3),
              );
              const outline = new LineSegments(geometry, o.material);
              sceneItems.push(outline);
              o.scene.add(outline);
              clean.add(() => {
                o.scene.remove(outline);
                geometry.dispose();
              });
            }
            this.requestRender();
            clean.add(() => this.requestRender());

            // The tabs, as blocks from their top down to the bottom of the
            // stock (or of the deepest cut, without stock).
            const tabs = new Group();
            if (o.shape.tabs?.length) {
              o.scene.add(tabs);
              clean.add(() => o.scene.remove(tabs));
              const bottom$ = combineLatest([this.stock$, this.deepest$]).pipe(
                map(([view, deepest]) =>
                  view?.stock.enabled ? -view.stock.thickness : deepest,
                ),
                distinctUntilChanged(),
              );
              const clear = () => {
                tabs.children.forEach((child) =>
                  (child as Mesh).geometry.dispose(),
                );
                tabs.clear();
              };
              clean.add(
                bottom$.subscribe((bottom) => {
                  clear();
                  for (const tab of o.shape.tabs!) {
                    tabs.add(...tabBlock(tab, bottom, o.tabEdges, o.tabFaces));
                  }
                  this.requestRender();
                }),
              );
              clean.add(clear);
            }

            clean.add(
              combineLatest([o.highlight$, o.clamp$]).subscribe(
                ([highlight, clamp]) => {
                  sceneItems.forEach((item) => {
                    if (item instanceof LineSegments) {
                      item.material = clamp
                        ? o.clampEdges
                        : highlight
                          ? o.materialHighlight
                          : o.material;
                    }
                    if (item instanceof Mesh) {
                      item.material = clamp
                        ? o.clampFaces
                        : highlight
                          ? o.material
                          : o.nullMaterial;
                    }
                  });
                  this.requestRender();
                },
              ),
            );

            clean.add(
              o.hidden$.subscribe((hidden) => {
                sceneItems.forEach((item) => (item.visible = !hidden));
                tabs.visible = !hidden;
                this.requestRender();
              }),
            );

            return clean;
          }),
      ),
    );
  }
}

/**
 * A tab drawn as a block: its footprint at its top, down to `bottom` (a
 * flat outline when that isn't below it).
 */
function tabBlock(
  tab: CamTab,
  bottom: number,
  edges: Material,
  faces: Material,
): (LineSegments | Mesh)[] {
  const { points, top } = tab;
  const low = Math.min(top, bottom);
  const segments: number[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    segments.push(a.x, a.y, top, b.x, b.y, top);
    if (low < top) {
      segments.push(a.x, a.y, low, b.x, b.y, low);
      segments.push(a.x, a.y, top, a.x, a.y, low);
    }
  });
  const lines = new BufferGeometry();
  lines.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(segments), 3),
  );
  const face = new ShapeGeometry(
    new Shape(points.map(({ x, y }) => new Vector2(x, y))),
  );
  face.translate(0, 0, top);
  return [new LineSegments(lines, edges), new Mesh(face, faces)];
}

/** Paths grouped by what's drawn together: operation, move type, shape. */
function groupPaths(paths: CamPath[]): Map<string, CamPath[]> {
  const groups = new Map<string, CamPath[]>();
  for (const path of paths) {
    const key = `${path.sourceOperationId ?? ''}|${path.type}|${path.sourceShapeId}`;
    const group = groups.get(key);
    if (group) group.push(path);
    else groups.set(key, [path]);
  }
  return groups;
}

function sameItems<T>(a: T[], b: T[]) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** Seconds as "45 s", "12 min" or "1 h 05 min". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}
