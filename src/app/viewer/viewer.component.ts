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
  LineBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CubePreviewComponent } from '../cube-preview/cube-preview.component';
import { watchElementResize } from '../../util';
import {
  debounceTime,
  distinctUntilChanged,
  Observable,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';

import { GridHelper } from './helpers/grid-helper';
import { CamShape } from '../../cam/types';

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

  @ViewChild('canvas', { static: true })
  canvas!: ElementRef<HTMLCanvasElement>;

  camera!: OrthographicCamera;
  controls!: OrbitControls;

  @Input()
  set shapes(value: Observable<CamShape[]>) {
    this.shapes$.next(value);
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

    renderer.setAnimationLoop(() => {
      renderer.render(scene, this.camera);
    });

    this.shapes$
      .pipe(
        switchMap((paths$) => paths$),
        switchMap(
          (shapes) =>
            new Observable<never>((_) => {
              const material = new LineBasicMaterial({ color: 0xffffff });
              const clean = new Subscription();

              for (const shape of shapes) {
                for (const poly of shape.polygons) {
                  const points = poly.points.map(
                    ({ x, y }) => new Vector2(x, y),
                  );
                  const geometry = new BufferGeometry().setFromPoints(points);

                  const line = new Line(geometry, material);
                  scene.add(line);

                  clean.add(() => scene.remove(line));
                }
              }

              return clean;
            }),
        ),
        takeUntil(this.destroy$),
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next(1);
  }
}
