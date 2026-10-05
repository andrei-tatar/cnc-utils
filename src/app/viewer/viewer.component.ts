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
  Box3,
  Group,
  Object3D,
  Plane,
  Raycaster,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubePreviewComponent } from '../cube-preview/cube-preview.component';
import { pointsEqual, watchElementResize } from '../../util';
import {
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

      span:empty {
        display: none;
      }
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

  /** Shapes and toolpaths; its bounding box is what "fit to view" frames. */
  private content = new Group();
  /** Keep framing the content until the user moves the camera themselves. */
  private autoFit = true;

  camera!: OrthographicCamera;

  private arrows = new Set<DirectionArrows>();
  private arrowsDirty = false;
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

    // Direction arrows keep a constant on-screen size, so re-lay them out
    // whenever the scale (zoom or viewport height) changes.
    let laidOutAt = 0;
    let viewKey = '';
    let fittedBox = '';
    renderer.setAnimationLoop(() => {
      const pixelsPerUnit =
        (renderer.domElement.clientHeight * this.camera.zoom) / frustumSize;
      if (
        pixelsPerUnit > 0 &&
        (pixelsPerUnit !== laidOutAt || this.arrowsDirty)
      ) {
        this.arrows.forEach((arrows) => arrows.update(pixelsPerUnit));
        laidOutAt = pixelsPerUnit;
        this.arrowsDirty = false;
      }

      // Grid, labels and axis size only change when the view does.
      const { clientWidth: width, clientHeight: height } = renderer.domElement;
      const key = [
        ...this.camera.position.toArray(),
        ...this.controls.target.toArray(),
        this.camera.zoom,
        width,
        height,
      ].join();
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
      color: 'lightblue',
      opacity: 0,
    });
    const pathTravelMaterial = new LineBasicMaterial({
      transparent: true,
      color: 'salmon',
      opacity: 0,
    });
    const highlightPathCarveMaterial = new LineBasicMaterial({
      color: 'lightblue',
    });
    const highlightPathTravelMaterial = new LineBasicMaterial({
      color: 'salmon',
      transparent: true,
      opacity: 0.5,
    });
    const arrowCarveMaterial = new MeshBasicMaterial({ color: '#7cc4f0' });
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
