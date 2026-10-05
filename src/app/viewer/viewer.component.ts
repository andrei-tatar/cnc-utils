import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  ArrowHelper,
  BufferGeometry,
  Line,
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
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubePreviewComponent } from '../cube-preview/cube-preview.component';
import { pointsEqual, watchElementResize } from '../../util';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
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
import { DEPTH_GRADIENT_CSS, depthColor } from './helpers/depth-colors';
import {
  formatMm,
  GridLabels,
  visiblePlaneBounds,
} from './helpers/grid-labels';
import { DirectionArrows } from './helpers/direction-arrows';
import { nestContours } from '../../cam/polygon-nesting';
import { CamPath, CamShape, Highlight } from '../../cam/types';

@Component({
  selector: 'app-viewer',
  standalone: true,
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
    </div>
    <div class="hud">
      <span #cursorReadout class="hud_cursor"></span>
      <span #gridReadout class="hud_grid"></span>
      <span #depthLegend class="hud_depth" hidden>
        <span>depth 0</span>
        <span class="hud_depth_bar" [style.background]="DEPTH_GRADIENT"></span>
        <span #deepestReadout></span>
      </span>
    </div>
  `,
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

  camera!: OrthographicCamera;

  private arrows = new Set<DirectionArrows>();
  private arrowsDirty = false;
  /** Arrows shown by the last thinning pass, to keep them stable. */
  private shownArrows = new WeakMap<DirectionArrows, Set<number>>();
  controls!: OrbitControls;

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

    const grid = new AdaptiveGrid();
    scene.add(grid);
    scene.add(this.content);

    // Axis arrows of a constant on-screen size (scaled per frame below).
    const origin = new Vector3(0, 0, 0);
    const axes = [
      new ArrowHelper(new Vector3(1, 0, 0), origin, 1, 'red', 0.2, 0.08),
      new ArrowHelper(new Vector3(0, 1, 0), origin, 1, 'green', 0.2, 0.08),
      new ArrowHelper(new Vector3(0, 0, 1), origin, 0.6, 'blue', 0.2, 0.08),
    ];
    axes.forEach((axis) => scene.add(axis));

    const labels = new GridLabels(this.labelsLayer.nativeElement);
    this.trackCursor(renderer.domElement);

    let arrowsKey = '';
    let viewKey = '';
    let fittedBox = '';
    renderer.setAnimationLoop(() => {
      const pixelsPerUnit =
        (renderer.domElement.clientHeight * this.camera.zoom) / frustumSize;

      // Grid, labels, axes and arrows only change when the view does.
      const { clientWidth: width, clientHeight: height } = renderer.domElement;
      const key = [
        ...this.camera.position.toArray(),
        ...this.controls.target.toArray(),
        this.camera.zoom,
        width,
        height,
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
        labels.update(bounds, spacing, this.camera, width, height);
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
        const box = new Box3().setFromObject(this.content);
        const boxKey = box.isEmpty()
          ? ''
          : [...box.min.toArray(), ...box.max.toArray()]
              .map((v) => v.toFixed(2))
              .join();
        if (boxKey && boxKey !== fittedBox) {
          fittedBox = boxKey;
          this.fitToView(box);
        }
      }

      renderer.render(scene, this.camera);
    });

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
        switchMap((paths$) => paths$),
        scan(
          (ctx, shapes) =>
            shapes.map((shape) => {
              const existing = ctx.find((c) => c.shape === shape);
              if (existing) {
                return existing;
              }

              const isHighlighted$ = this.highlight$.pipe(
                map(
                  (h) =>
                    (!h.shapes.length && !h.operations.length) ||
                    h.shapes.includes(shape.sourceShapeId),
                ),
                distinctUntilChanged(),
              );

              return {
                shape,
                draw$: this.drawShape({
                  shape,
                  scene: this.content,
                  material,
                  materialHighlight,
                  nullMaterial,
                  highlight$: isHighlighted$,
                }).pipe(
                  share({
                    resetOnRefCountZero: () => timer(0),
                  }),
                ),
              };
            }),
          [] as Array<{
            shape: CamShape;
            draw$: Observable<never>;
          }>,
        ),
        switchMap((all) => merge(...all.map((a) => a.draw$))),
        takeUntil(this.destroy$),
      )
      .subscribe();

    this.paths$
      .pipe(
        switchMap((paths$) => paths$),
        tap((paths) => this.updateDeepest(paths)),
        scan(
          (ctx, paths) =>
            paths.map((path) => {
              const existing = ctx.find((c) => c.path === path);
              if (existing) {
                return existing;
              }

              const isHighlighted$ = this.highlight$.pipe(
                map((h) =>
                  h.operations.length
                    ? !!path.sourceOperationId &&
                      h.operations.includes(path.sourceOperationId)
                    : !h.shapes.length || h.shapes.includes(path.sourceShapeId),
                ),
                distinctUntilChanged(),
              );

              return {
                path,
                draw$: this.drawPath({
                  path,
                  scene: this.content,
                  material:
                    path.type === 'travel'
                      ? pathTravelMaterial
                      : pathCarveMaterial,
                  materialHighlight:
                    path.type === 'travel'
                      ? highlightPathTravelMaterial
                      : highlightPathCarveMaterial,
                  arrowMaterial:
                    path.type === 'travel'
                      ? arrowTravelMaterial
                      : arrowCarveMaterial,
                  colorByDepth: path.type === 'carve',
                  highlight$: isHighlighted$,
                }).pipe(
                  share({
                    resetOnRefCountZero: () => timer(0),
                  }),
                ),
              };
            }),
          [] as Array<{
            path: CamPath;
            draw$: Observable<never>;
          }>,
        ),
        switchMap((all) => merge(...all.map((a) => a.draw$))),
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
      if (!arrows.mesh.visible || !frustum.intersectsBox(arrows.bounds)) {
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

  /** Frame all shapes and toolpaths, keeping the current viewing angle. */
  fitToView(box = new Box3().setFromObject(this.content)) {
    if (box.isEmpty()) {
      return;
    }

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
    }
  }

  /** Show the cursor's position on the XY plane, in mm. */
  private trackCursor(canvas: HTMLCanvasElement) {
    const readout = this.cursorReadout.nativeElement;
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 0, 1), 0);
    const ndc = new Vector2();
    const hit = new Vector3();

    canvas.addEventListener('pointermove', (event) => {
      ndc.set(
        (event.offsetX / canvas.clientWidth) * 2 - 1,
        -(event.offsetY / canvas.clientHeight) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      readout.textContent = raycaster.ray.intersectPlane(plane, hit)
        ? `X ${hit.x.toFixed(2)}  Y ${hit.y.toFixed(2)} mm`
        : '';
    });
    canvas.addEventListener('pointerleave', () => (readout.textContent = ''));
  }

  ngOnDestroy(): void {
    this.destroy$.next(1);
  }

  private drawPath(o: {
    path: CamPath;
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

            const sceneItems: (Line | Mesh)[] = [];

            const points = o.path.points.map(
              ({ x, y, z }) => new Vector3(x, y, z),
            );
            const geometry = new BufferGeometry().setFromPoints(points);

            const line = new Line(geometry, o.material);
            sceneItems.push(line);
            o.scene.add(line);

            clean.add(() => o.scene.remove(line));

            const arrows = new DirectionArrows(points, o.arrowMaterial);
            o.scene.add(arrows.mesh);
            this.arrows.add(arrows);
            this.arrowsDirty = true;

            if (o.colorByDepth) {
              // Recolour whenever the job's deepest cut changes.
              const colors = new Float32Array(points.length * 3);
              geometry.setAttribute('color', new BufferAttribute(colors, 3));
              const color = new Color();
              clean.add(
                this.deepest$.subscribe((deepest) => {
                  points.forEach((p, i) =>
                    depthColor(p.z, deepest, color).toArray(colors, i * 3),
                  );
                  geometry.attributes['color'].needsUpdate = true;
                  arrows.colorBy((p) => depthColor(p.z, deepest, color));
                }),
              );
            }

            clean.add(() => {
              o.scene.remove(arrows.mesh);
              this.arrows.delete(arrows);
              arrows.dispose();
              geometry.dispose();
            });

            clean.add(
              o.highlight$.subscribe((highlight) => {
                sceneItems.forEach((item) => {
                  item.material = highlight ? o.materialHighlight : o.material;
                });
                // Unhighlighted paths are fully transparent; hide their arrows too.
                arrows.mesh.visible = highlight;
                this.arrowsDirty = true;
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
    highlight$: Observable<boolean>;
  }) {
    return timer(0).pipe(
      switchMap(
        () =>
          new Observable<never>((_) => {
            const clean = new Subscription();

            const sceneItems: (Line | Mesh)[] = [];

            // Fill each outline with its holes cut out, rather than filling
            // every closed polygon (which paints holes over as solid).
            const closed = o.shape.polygons
              .filter((poly) => poly.close && poly.points.length > 2)
              .map((poly) => poly.points);
            for (const { outer, holes } of nestContours(closed)) {
              const shape = new Shape(
                outer.map(({ x, y }) => new Vector2(x, y)),
              );
              shape.holes = holes.map(
                (hole) => new Path(hole.map(({ x, y }) => new Vector2(x, y))),
              );
              const geometry = new ShapeGeometry(shape);
              const mesh = new Mesh(geometry, o.material);
              sceneItems.push(mesh);
              o.scene.add(mesh);

              clean.add(() => {
                o.scene.remove(mesh);
                geometry.dispose();
              });
            }

            for (const poly of o.shape.polygons) {
              const srcPoints = [...poly.points];
              if (
                poly.close &&
                !pointsEqual(srcPoints[0], srcPoints[srcPoints.length - 1])
              ) {
                srcPoints.push(srcPoints[0]);
              }

              const points = srcPoints.map(({ x, y }) => new Vector2(x, y));

              const geometry = new BufferGeometry().setFromPoints(points);

              const line = new Line(geometry, o.material);
              sceneItems.push(line);
              o.scene.add(line);

              clean.add(() => o.scene.remove(line));
            }

            clean.add(
              o.highlight$.subscribe((highlight) => {
                sceneItems.forEach((item) => {
                  if (item instanceof Line) {
                    item.material = highlight
                      ? o.materialHighlight
                      : o.material;
                  }
                  if (item instanceof Mesh) {
                    item.material = highlight ? o.material : o.nullMaterial;
                  }
                });
              }),
            );

            return clean;
          }),
      ),
    );
  }
}
