import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ViewerComponent } from './viewer/viewer.component';
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  map,
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
import { ModelType } from './model-editor/shapes';
import { importSvg } from '../cam/svg-import';
import { Matrix3 } from 'three';

type ShapeType = ModelType['shapes'][number];

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

  ngOnInit(): void {
    this.drawShapes$ = this.model$.pipe(
      distinctUntilChanged(),
      tap((v) => localStorage.setItem('model', JSON.stringify(v))),
      takeUntil(this.destroy$),
      scan(
        (ctx, { shapes }) => {
          return shapes.map((shape) => {
            const existing = ctx.find((e) => e.shapeId === shape.id);
            if (existing) {
              existing.shapeParameters$.next(shape);
              return existing;
            }

            const shapeParameters$ = new BehaviorSubject(shape);

            const result$ = shapeParameters$.pipe(
              map((t) => {
                let stack: Matrix3[] = [new Matrix3()];
                for (const transform of t.transforms) {
                  switch (transform.type) {
                    case 'repeat':
                      const newStack: Matrix3[] = [];
                      for (let y = 0; y < transform.repeatCountY; y++)
                        for (let x = 0; x < transform.repeatCountX; x++) {
                          for (let i = 0; i < stack.length; i++) {
                            newStack.push(
                              stack[i]
                                .clone()
                                .translate(
                                  transform.repeatSpaceX * x,
                                  transform.repeatSpaceY * y,
                                ),
                            );
                          }
                        }
                      stack = newStack;
                      break;
                    case 'scale':
                      for (let i = 0; i < stack.length; i++)
                        stack[i] = stack[i].scale(
                          transform.scaleX,
                          transform.scaleY,
                        );
                      break;
                    case 'rotate':
                      for (let i = 0; i < stack.length; i++)
                        stack[i] = stack[i].rotate(
                          (transform.rotateAngle * Math.PI) / 180,
                        );
                      break;
                    case 'translate':
                      for (let i = 0; i < stack.length; i++)
                        stack[i] = stack[i].translate(
                          transform.translateX,
                          transform.translateY,
                        );
                      break;
                  }
                }

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

                return { svg, stack };
              }),
              distinctUntilChanged(
                (a, b) =>
                  a.svg === b.svg &&
                  a.stack.length === b.stack.length &&
                  a.stack.every((aa, index) => b.stack[index].equals(aa)),
              ),
              map(({ svg, stack }) => {
                const result: Array<CamShape[]> = [];
                for (const tm of stack) result.push(importSvg(svg, tm));
                return result.flatMap((i) => i);
              }),
              catchError((_) => EMPTY),
              share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: () => timer(1000),
              }),
            );

            return {
              shapeId: shape.id,
              result$,
              shapeParameters$,
            };
          });
        },
        [] as Array<{
          shapeId: string;
          shapeParameters$: BehaviorSubject<ShapeType>;
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
      return { shapes: [] };
    }

    return JSON.parse(model);
  }
}
