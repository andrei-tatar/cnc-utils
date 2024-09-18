import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ViewerComponent } from './viewer/viewer.component';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  ignoreElements,
  map,
  merge,
  Observable,
  ReplaySubject,
  scan,
  share,
  Subject,
  switchMap,
  takeUntil,
  tap,
  timer,
} from 'rxjs';
import { CamShape, ShapeSource } from '../cam/types';
import { AsyncPipe } from '@angular/common';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import { ModelType } from './model-editor/model';
import { importSvg } from '../cam/svg-import';
import { Matrix3, Vector2 } from 'three';
import { clipperInflate } from '../cam/clipper';

type OmitUnion<T, K extends keyof T> = T extends any ? Omit<T, K> : never;
type ShapeType = ModelType['shapes'][number];
type ShapeParameters = OmitUnion<ShapeType, 'id' | 'transforms' | 'expanded'>;
type TransformType = ShapeType['transforms'][number];
type TransformParameters = OmitUnion<TransformType, 'id' | 'expanded'>;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ViewerComponent, AsyncPipe, ModelEditorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<any>();

  model$ = new BehaviorSubject<ModelType>(this.loadModel());

  shapeSources$ = new BehaviorSubject<ShapeSource[]>([]);

  drawShapes$ = this.shapeSources$.pipe(
    switchMap((sources) => {
      return combineLatest(sources.map((s) => s.shape$)).pipe(
        map((items) => items.flatMap((i) => i)),
      );
    }),
  );

  expandedShapes$ = this.model$.pipe(
    map((v) => [
      ...new Set(v.shapes.filter((v) => v.expanded).map((v) => v.id)),
    ]),
  );

  ngOnInit(): void {
    this.drawShapes$ = this.model$.pipe(
      distinctUntilChanged(),
      tap((v) => localStorage.setItem('model', JSON.stringify(v))),
      takeUntil(this.destroy$),
      scan(
        (ctx, { shapes }) => {
          return shapes.map(
            ({
              id: shapeId,
              transforms: shapeTransforms,
              expanded: _,
              ...shapeParameters
            }) => {
              const existing = ctx.find((e) => e.shapeId === shapeId);
              if (existing) {
                existing.shapeParameters$.next(shapeParameters);
                existing.shapeTransforms$.next(shapeTransforms);
                return existing;
              }

              const shapeParameters$ = new BehaviorSubject(shapeParameters);
              const shapeTransforms$ = new BehaviorSubject(shapeTransforms);

              const shape$ = shapeParameters$.pipe(
                map((t) => {
                  let svg: string;
                  switch (t.type) {
                    case 'circle':
                      svg = `<svg><circle r="${t.diameter / 2}"/></svg>`;
                      break;
                    case 'rectangle':
                      svg = `<svg><rect width="${t.width}" height="${t.height}" rx="${t.radius}"/></svg>`;
                      break;
                    case 'svg':
                      svg = t.svg;
                  }
                  return svg;
                }),
                distinctUntilChanged(),
                map((svg) => importSvg(svg, shapeId)),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              const transforms$ = shapeTransforms$.pipe(
                scan(
                  (ctx, transforms) =>
                    transforms.map(
                      ({
                        id: transformId,
                        expanded: _,
                        ...transformParams
                      }) => {
                        const existing = ctx.find(
                          (t) => t.transformId === transformId,
                        );
                        if (existing) {
                          existing.transformParameters$.next(transformParams);
                          return existing;
                        }

                        const transformParameters$ = new BehaviorSubject(
                          transformParams,
                        );

                        const input = new Subject<CamShape[]>();

                        const output$ = transformParameters$.pipe(
                          distinctUntilChanged(
                            (a, b) => a === b,
                            (s) => JSON.stringify(s),
                          ),
                          switchMap((transform) => {
                            return input.pipe(
                              distinctUntilChanged(),
                              switchMap(
                                async (shape) =>
                                  await this.applyTransform(shape, transform),
                              ),
                            );
                          }),
                          share({
                            connector: () => new ReplaySubject(1),
                            resetOnRefCountZero: () => timer(0),
                          }),
                        );

                        return {
                          transformId,
                          transformParameters$,
                          input,
                          output$,
                        };
                      },
                    ),
                  [] as Array<{
                    transformId: string;
                    transformParameters$: BehaviorSubject<TransformParameters>;
                    input: Subject<CamShape[]>;
                    output$: Observable<CamShape[]>;
                  }>,
                ),
              );

              const result$ = transforms$.pipe(
                switchMap((all) => {
                  let input$ = shape$;

                  const watch: Observable<any>[] = [];
                  for (let i = 0; i < all.length; i++) {
                    watch.push(
                      input$.pipe(
                        tap((v) => all[i].input.next(v)),
                        ignoreElements(),
                      ),
                    );
                    input$ = all[i].output$;
                  }
                  return merge(input$, ...watch);
                }),
                share({
                  connector: () => new ReplaySubject(1),
                  resetOnRefCountZero: () => timer(0),
                }),
              );

              return {
                shapeId: shapeId,
                result$,
                shapeParameters$,
                shapeTransforms$,
              };
            },
          );
        },
        [] as Array<{
          shapeId: string;
          shapeParameters$: BehaviorSubject<ShapeParameters>;
          shapeTransforms$: BehaviorSubject<ShapeType['transforms']>;
          result$: Observable<CamShape[]>;
        }>,
      ),
      switchMap((s) => combineLatest(s.map((i) => i.result$))),
      map((s) => s.flatMap((i) => i)),
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next(1);
  }

  private loadModel(): ModelType {
    const model = localStorage.getItem('model');
    if (!model) {
      return { shapes: [], tools: [] };
    }

    return JSON.parse(model);
  }

  private async applyTransform(
    input: CamShape[],
    transform: TransformParameters,
  ): Promise<CamShape[]> {
    try {
      switch (transform.type) {
        case 'translate':
          const translateMatrix = new Matrix3().translate(
            transform.translateX,
            transform.translateY,
          );
          return input.map((i) =>
            this.applyMatrixTransform(i, translateMatrix),
          );
        case 'rotate': {
          const box = this.getBoundingBox(input);

          const [ox, oy] = transform.around
            .split('-')
            .map((v) => v.substring(1));
          const dx = this.getRotationOrigin(box.x, box.width, ox);
          const dy = this.getRotationOrigin(box.y, box.height, oy);

          const rotateMatrix = new Matrix3()
            .translate(-dx, -dy)
            .rotate((transform.rotateAngle * Math.PI) / 180)
            .translate(dx, dy);

          return input.map((i) => this.applyMatrixTransform(i, rotateMatrix));
        }
        case 'scale':
          const scaleMatrix = new Matrix3().scale(
            transform.scaleX,
            transform.scaleY,
          );
          return input.map((i) => this.applyMatrixTransform(i, scaleMatrix));
        case 'repeat':
          const output: CamShape[] = [];
          for (let y = 0; y < transform.repeatCountY; y++)
            for (let x = 0; x < transform.repeatCountX; x++) {
              const translate = new Matrix3().translate(
                transform.repeatSpaceX * x,
                transform.repeatSpaceY * y,
              );
              output.push(
                ...input.map((i) => this.applyMatrixTransform(i, translate)),
              );
            }
          return output;
        case 'flip':
          const box = this.getBoundingBox(input);
          let matrix = new Matrix3();

          if (transform.flipHorizontal) {
            matrix = matrix
              .translate(-(box.x + box.width / 2), 0)
              .scale(-1, 1)
              .translate(box.x + box.width / 2, 0);
          }

          if (transform.flipVertical) {
            matrix = matrix
              .translate(0, -(box.y + box.height / 2))
              .scale(1, -1)
              .translate(0, box.y + box.height / 2);
          }

          return input.map((i) => this.applyMatrixTransform(i, matrix));

        case 'clipper-inflate':
          return await clipperInflate(input, transform);
      }

      return input;
    } catch (err) {
      console.error(err);
    }
    return input;
  }

  private getRotationOrigin(start: number, size: number, type: string) {
    switch (type) {
      case 'min':
        return start;
      case 'max':
        return start + size;
      case 'center':
      default:
        return start + size / 2;
    }
  }

  private getBoundingBox(input: CamShape[]) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    input.forEach((shape) => {
      shape.polygons.forEach((poly) => {
        poly.points.forEach((point) => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });
      });
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private applyMatrixTransform(input: CamShape, matrix: Matrix3): CamShape {
    return {
      sourceShapeId: input.sourceShapeId,
      polygons: input.polygons.map((poly) => {
        return {
          close: poly.close,
          points: poly.points.map((p) => {
            const result = new Vector2(p.x, p.y).applyMatrix3(matrix);
            return {
              x: result.x,
              y: result.y,
            };
          }),
        };
      }),
    };
  }
}
