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
import {
  ModelType,
  ShapeParameters,
  ShapeType,
  TransformParameters,
} from './model-editor/model';
import worker from '../worker';

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
                  switch (t.type) {
                    case 'circle':
                      return `<svg><circle r="${t.diameter / 2}"/></svg>`;
                    case 'rectangle':
                      return `<svg><rect width="${t.width}" height="${t.height}" rx="${t.radius}"/></svg>`;
                    case 'svg':
                      return t.svg;
                    default:
                      return `<svg></svg>`;
                  }
                }),
                distinctUntilChanged(),
                switchMap((svg) => worker.importSvg(svg, shapeId)),
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
                              switchMap((shape) =>
                                worker.applyTransform(shape, transform),
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
}
