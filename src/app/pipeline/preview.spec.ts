import { BehaviorSubject } from 'rxjs';
import { ModelType } from '../model-editor/model';
import { emptyModel } from '../model-editor/model';
import { hiddenShapeIds, highlightFromModel } from './preview';

function model({
  hiddenExpanded = false,
  shownExpanded = false,
  operationExpanded = false,
} = {}): ModelType {
  return {
    ...emptyModel(),
    shapes: [
      {
        id: 'hidden',
        type: 'rectangle',
        hidden: true,
        expanded: hiddenExpanded,
        transforms: [],
      },
      {
        id: 'shown',
        type: 'rectangle',
        hidden: false,
        expanded: shownExpanded,
        transforms: [],
      },
    ] as any,
    operations: [
      {
        id: 'op',
        type: 'profile',
        shapeId: 'shown',
        toolId: 't',
        expanded: operationExpanded,
      },
    ] as any,
  };
}

describe('preview', () => {
  it('keeps hidden shapes hidden as operations and shapes open and close', () => {
    const model$ = new BehaviorSubject(model());
    const hidden: string[][] = [];
    const subscription = hiddenShapeIds(model$).subscribe((ids) =>
      hidden.push(ids),
    );

    model$.next(model({ operationExpanded: true }));
    model$.next(model());
    model$.next(model({ shownExpanded: true }));
    model$.next(model());

    expect(hidden.length).toBeGreaterThan(0);
    for (const ids of hidden) {
      expect(ids).toEqual(['hidden']);
    }
    subscription.unsubscribe();
  });

  it('shows a hidden shape while it’s open, and hides it again once closed', () => {
    const model$ = new BehaviorSubject(model({ hiddenExpanded: true }));
    const hidden: string[][] = [];
    const subscription = hiddenShapeIds(model$).subscribe((ids) =>
      hidden.push(ids),
    );
    model$.next(model());
    expect(hidden).toEqual([[], ['hidden']]);
    subscription.unsubscribe();
  });

  it('highlights everything once nothing is open', () => {
    const model$ = new BehaviorSubject(model({ operationExpanded: true }));
    const highlights: unknown[] = [];
    const subscription = highlightFromModel(model$).subscribe((h) =>
      highlights.push(h),
    );
    model$.next(model());
    expect(highlights).toEqual([
      { shapes: ['shown'], operations: ['op'] },
      { shapes: [], operations: [] },
    ]);
    subscription.unsubscribe();
  });

  it('highlights everything while the open item’s section is collapsed', () => {
    const model$ = new BehaviorSubject(
      model({ operationExpanded: true, shownExpanded: true }),
    );
    const collapsed$ = new BehaviorSubject<string[]>([]);
    const highlights: unknown[] = [];
    const subscription = highlightFromModel(model$, collapsed$).subscribe((h) =>
      highlights.push(h),
    );
    collapsed$.next(['operations']);
    collapsed$.next(['operations', 'shapes']);
    collapsed$.next([]);
    expect(highlights).toEqual([
      { shapes: ['shown'], operations: ['op'] },
      { shapes: ['shown'], operations: [] },
      { shapes: [], operations: [] },
      { shapes: ['shown'], operations: ['op'] },
    ]);
    subscription.unsubscribe();
  });

  it('hides an open hidden shape while the shapes section is collapsed', () => {
    const model$ = new BehaviorSubject(model({ hiddenExpanded: true }));
    const collapsed$ = new BehaviorSubject<string[]>([]);
    const hidden: string[][] = [];
    const subscription = hiddenShapeIds(model$, collapsed$).subscribe((ids) =>
      hidden.push(ids),
    );
    collapsed$.next(['shapes']);
    collapsed$.next([]);
    expect(hidden).toEqual([[], ['hidden'], []]);
    subscription.unsubscribe();
  });
});
