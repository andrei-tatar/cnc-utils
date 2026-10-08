import { combineLatest, distinctUntilChanged, map, Observable } from 'rxjs';

/** What decides how a shape is drawn. */
export type ShapeState = {
  /** Highlighted: expanded, or what an expanded operation cuts. */
  highlight: boolean;
  /** A clamp (keep-out zone): drawn red. */
  clamp: boolean;
  /** Toggled off, or the simulated material is shown. */
  hidden: boolean;
};

/** How a shape is drawn: its outline, its fill and its tabs. */
export type ShapeLook = {
  outline: { visible: boolean; material: 'clamp' | 'highlight' | 'plain' };
  fill: { visible: boolean; material: 'clamp' | 'fill' };
  tabs: boolean;
};

/**
 * A shape's look from all of its state at once, so no part of it (a
 * highlight changing, say) can show what hiding it hid.
 */
export function shapeLook({ highlight, clamp, hidden }: ShapeState): ShapeLook {
  return {
    outline: {
      visible: !hidden,
      material: clamp ? 'clamp' : highlight ? 'highlight' : 'plain',
    },
    // Unfilled, not drawn at all.
    fill: {
      visible: !hidden && (clamp || highlight),
      material: clamp ? 'clamp' : 'fill',
    },
    tabs: !hidden,
  };
}

/** `shapeLook` as its state changes. */
export function shapeLook$(state: {
  highlight$: Observable<boolean>;
  clamp$: Observable<boolean>;
  hidden$: Observable<boolean>;
}): Observable<ShapeLook> {
  return combineLatest([state.highlight$, state.clamp$, state.hidden$]).pipe(
    map(([highlight, clamp, hidden]) =>
      shapeLook({ highlight, clamp, hidden }),
    ),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  );
}
