const STORAGE_KEY = 'ui.camera';

type Vec3 = [number, number, number];

/** The preview's camera, as stored between page loads. */
export type SavedView = {
  position: Vec3;
  /** The point the camera orbits around and looks at. */
  target: Vec3;
  zoom: number;
  /** Still framing the content automatically (the user hasn't moved it). */
  autoFit: boolean;
};

/** The stored view, or null when there's none (or it's unreadable). */
export function loadView(): SavedView | null {
  try {
    const view = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const isVec3 = (v: unknown): v is Vec3 =>
      Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    if (
      view &&
      isVec3(view.position) &&
      isVec3(view.target) &&
      Number.isFinite(view.zoom) &&
      view.zoom > 0
    ) {
      return {
        position: view.position,
        target: view.target,
        zoom: view.zoom,
        autoFit: view.autoFit === true,
      };
    }
  } catch {
    // Storage unavailable or not JSON: start with the default view.
  }
  return null;
}

export function saveView(view: SavedView) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Storage unavailable or full: the view just won't be remembered.
  }
}
