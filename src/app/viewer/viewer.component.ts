import {
  Component,
  ElementRef,
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

import { GridHelper } from './helpers/grid-helper';
import { DirectionArrows } from './helpers/direction-arrows';
import { nestContours } from '../../cam/polygon-nesting';
import { CamPath, CamShape } from '../../cam/types';

@Component({
  selector: 'app-viewer',
  standalone: true,
  imports: [CubePreviewComponent],
  template: `
    <canvas #canvas></canvas>
    <app-cube-preview
      [camera]="camera"
      [controls]="controls"
    ></app-cube-preview>
  `,
  styles: `
    :host {
      position: relative;
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
  private highlightShapes$ = new ReplaySubject<string[]>(1);

  @ViewChild('canvas', { static: true })
  canvas!: ElementRef<HTMLCanvasElement>;

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
  set highlightShapes(value: string[]) {
    this.highlightShapes$.next(value);
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

    scene.add(new GridHelper(500));

    const origin = new Vector3(0, 0, 0);
    const length = 500;

    scene.add(new ArrowHelper(new Vector3(1, 0, 0), origin, length, 'red'));
    scene.add(new ArrowHelper(new Vector3(0, 1, 0), origin, length, 'green'));
    scene.add(
      new ArrowHelper(new Vector3(0, 0, 1), origin, length / 3, 'blue'),
    );

    // Direction arrows keep a constant on-screen size, so re-lay them out
    // whenever the scale (zoom or viewport height) changes.
    let laidOutAt = 0;
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

              const isHighlighted$ = this.highlightShapes$.pipe(
                map((h) => h.length === 0 || h.includes(shape.sourceShapeId)),
                distinctUntilChanged(),
              );

              return {
                shape,
                draw$: this.drawShape({
                  shape,
                  scene,
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

              const isHighlighted$ = this.highlightShapes$.pipe(
                map((h) => h.length === 0 || h.includes(path.sourceShapeId)),
                distinctUntilChanged(),
              );

              return {
                path,
                draw$: this.drawPath({
                  path,
                  scene,
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

  ngOnDestroy(): void {
    this.destroy$.next(1);
  }

  private drawPath(o: {
    path: CamPath;
    scene: Scene;
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
    scene: Scene;
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
