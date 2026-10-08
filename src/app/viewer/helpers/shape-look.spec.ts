import { BehaviorSubject } from 'rxjs';
import { ShapeLook, shapeLook, shapeLook$ } from './shape-look';

describe('shapeLook', () => {
  const states = [false, true].flatMap((highlight) =>
    [false, true].flatMap((clamp) =>
      [false, true].map((hidden) => ({ highlight, clamp, hidden })),
    ),
  );

  it('draws nothing of a hidden shape, whatever else is true of it', () => {
    for (const state of states.filter((s) => s.hidden)) {
      const look = shapeLook(state);
      expect(look.outline.visible)
        .withContext(JSON.stringify(state))
        .toBe(false);
      expect(look.fill.visible).withContext(JSON.stringify(state)).toBe(false);
      expect(look.tabs).withContext(JSON.stringify(state)).toBe(false);
    }
  });

  it('fills only highlighted shapes and clamps', () => {
    expect(
      shapeLook({ highlight: false, clamp: false, hidden: false }).fill.visible,
    ).toBe(false);
    expect(
      shapeLook({ highlight: true, clamp: false, hidden: false }).fill,
    ).toEqual({ visible: true, material: 'fill' });
    expect(
      shapeLook({ highlight: false, clamp: true, hidden: false }).fill,
    ).toEqual({ visible: true, material: 'clamp' });
  });

  it('draws a clamp red even when highlighted', () => {
    const look = shapeLook({ highlight: true, clamp: true, hidden: false });
    expect(look.outline.material).toBe('clamp');
  });
});

describe('shapeLook$', () => {
  // The bug: collapsing an operation (or a shape) highlights every shape
  // again, and that showed the fills of hidden ones.
  it('keeps a hidden shape hidden when the highlight changes', () => {
    const highlight$ = new BehaviorSubject(false);
    const clamp$ = new BehaviorSubject(false);
    const hidden$ = new BehaviorSubject(false);
    const looks: ShapeLook[] = [];
    const subscription = shapeLook$({ highlight$, clamp$, hidden$ }).subscribe(
      (look) => looks.push(look),
    );

    hidden$.next(true);
    // An operation expanded (another shape highlighted), then collapsed:
    // with nothing expanded every shape is highlighted.
    highlight$.next(false);
    highlight$.next(true);
    highlight$.next(false);
    highlight$.next(true);
    clamp$.next(true);

    const afterHiding = looks.slice(1);
    expect(afterHiding.length).toBeGreaterThan(0);
    for (const look of afterHiding) {
      expect(look.outline.visible).toBe(false);
      expect(look.fill.visible).toBe(false);
      expect(look.tabs).toBe(false);
    }

    hidden$.next(false);
    const shown = looks[looks.length - 1];
    expect(shown.outline.visible).toBe(true);
    expect(shown.fill.visible).toBe(true);
    subscription.unsubscribe();
  });
});
