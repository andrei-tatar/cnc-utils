import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Group,
  Object3D,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  distanceToPolygons,
  polygonPoints,
  windingNumber,
} from '../../../cam/arcs';
import { CamPoint, CamShape } from '../../../cam/types';
import type {
  EditHandle,
  ShapeEditing,
} from '../../model-editor/shape-editing';

/** How near (px) the pointer must be to a point or an outline to take it. */
const REACH_PX = 8;
/** How far (px) the pointer must move for a press to be a drag. */
const DRAG_PX = 3;

const POINT_COLOR = new Color('#4fc3f7');
const CONTROL_COLOR = new Color('#ffb74d');
const LOCKED_COLOR = new Color('#8a8f98');
const HANDLE_MATERIAL = new PointsMaterial({
  size: 9,
  sizeAttenuation: false,
  vertexColors: true,
  depthTest: false,
  transparent: true,
});

export type ShapeEditorHost = {
  canvas: HTMLCanvasElement;
  camera: () => Camera;
  controls: OrbitControls;
  pixelsPerUnit: () => number;
  /** Whether clicks edit (not while measuring or simulating). */
  active: () => boolean;
  requestRender: () => void;
  /** What the pointer would do here, for the HUD ('' for nothing). */
  hint: (text: string) => void;
  /** A shape clicked (null: none, clicked off every shape). */
  select: (shapeId: string | null) => void;
  moveShape: (shapeId: string, dx: number, dy: number) => void;
  movePoint: (shapeId: string, handle: EditHandle, to: CamPoint) => void;
};

/**
 * Editing shapes in the preview: a click picks the shape under the pointer
 * (its outline, or the smallest one round the pointer), and the one being
 * edited (open in the editor) can be dragged to move it, its points (see
 * `shapeEditing`) to reshape it. Drags are on the XY plane; the drawing
 * follows until the shape is made again.
 */
export class ShapeEditor {
  /** The points to drag, drawn over everything. */
  readonly handles = new Group();
  private editing: ShapeEditing | null = null;
  private shapes: CamShape[] = [];
  /** Each shape's drawing, by shape id: what a drag moves. */
  private drawings = new Map<string, Set<Object3D>>();
  private points: Points | null = null;

  private raycaster = new Raycaster();
  private plane = new Plane(new Vector3(0, 0, 1), 0);
  private ndc = new Vector2();

  constructor(private host: ShapeEditorHost) {
    this.handles.renderOrder = 20;
    this.listen();
  }

  /** The shape being edited and its points (null: none). */
  setEditing(editing: ShapeEditing | null) {
    this.editing = editing;
    this.drawHandles();
  }

  /** The shapes drawn (and so pickable). */
  setShapes(shapes: CamShape[]) {
    this.shapes = shapes;
  }

  /** Shows or hides the handles (hidden while the material is shown). */
  setVisible(visible: boolean) {
    this.handles.visible = visible;
  }

  /** `object` draws shape `shapeId`; the returned function forgets it. */
  register(shapeId: string, object: Object3D): () => void {
    let set = this.drawings.get(shapeId);
    if (!set) this.drawings.set(shapeId, (set = new Set()));
    set.add(object);
    return () => {
      set!.delete(object);
      if (!set!.size) this.drawings.delete(shapeId);
    };
  }

  private drawHandles() {
    if (this.points) {
      this.handles.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
    }
    const handles = this.editing?.handles ?? [];
    if (handles.length) {
      const positions = new Float32Array(handles.length * 3);
      const colors = new Float32Array(handles.length * 3);
      handles.forEach((h, i) => {
        positions.set([h.x, h.y, 0], i * 3);
        const color = h.locked
          ? LOCKED_COLOR
          : h.control
            ? CONTROL_COLOR
            : POINT_COLOR;
        color.toArray(colors, i * 3);
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
      this.points = new Points(geometry, HANDLE_MATERIAL);
      this.points.renderOrder = 20;
      this.handles.add(this.points);
    }
    this.host.requestRender();
  }

  /** The point on the XY plane under the pointer. */
  private pointAt(event: MouseEvent): Vector3 | null {
    const { canvas } = this.host;
    this.ndc.set(
      (event.offsetX / canvas.clientWidth) * 2 - 1,
      -(event.offsetY / canvas.clientHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.host.camera());
    return this.raycaster.ray.intersectPlane(this.plane, new Vector3());
  }

  private reach() {
    return REACH_PX / Math.max(this.host.pixelsPerUnit(), 1e-9);
  }

  /** The draggable point nearest `at`, within reach. */
  private handleAt(at: CamPoint): number {
    let best = -1;
    let distance = this.reach();
    (this.editing?.handles ?? []).forEach((h, i) => {
      const d = Math.hypot(h.x - at.x, h.y - at.y);
      if (d < distance) {
        best = i;
        distance = d;
      }
    });
    return best;
  }

  /** How far `at` is from shape `id`'s outlines (and single points). */
  private distanceTo(id: string, at: CamPoint): number {
    let distance = Infinity;
    for (const shape of this.shapes) {
      if (shape.sourceShapeId !== id) continue;
      for (const polygon of shape.polygons) {
        distance = Math.min(
          distance,
          polygon.vertices.length === 1
            ? Math.hypot(
                polygon.vertices[0].x - at.x,
                polygon.vertices[0].y - at.y,
              )
            : distanceToPolygons(at, [polygon]),
        );
      }
    }
    return distance;
  }

  /**
   * The shape under `at`: the one whose outline is nearest, within reach;
   * otherwise the smallest closed one round it.
   */
  private shapeAt(at: CamPoint): string | null {
    const ids = [...new Set(this.shapes.map((s) => s.sourceShapeId))];
    let best: string | null = null;
    let distance = this.reach();
    for (const id of ids) {
      const d = this.distanceTo(id, at);
      if (d < distance) {
        best = id;
        distance = d;
      }
    }
    if (best) return best;
    let smallest = Infinity;
    for (const shape of this.shapes) {
      for (const polygon of shape.polygons) {
        if (!polygon.close || polygon.vertices.length < 2) continue;
        if (!windingNumber(at, [polygon])) continue;
        const points = polygonPoints(polygon);
        let area = 0;
        for (let i = 0; i < points.length; i++) {
          const a = points[i];
          const b = points[(i + 1) % points.length];
          area += a.x * b.y - b.x * a.y;
        }
        if (Math.abs(area) < smallest) {
          smallest = Math.abs(area);
          best = shape.sourceShapeId;
        }
      }
    }
    return best;
  }

  /** Moves the drawing of what's dragged by (`dx`, `dy`). */
  private offset(drag: Drag, dx: number, dy: number) {
    if (drag.handle >= 0 && this.points) {
      const h = this.editing!.handles[drag.handle];
      const position = this.points.geometry.getAttribute(
        'position',
      ) as BufferAttribute;
      position.setXY(
        drag.handle,
        h.xKey ? h.x + dx : h.x,
        h.yKey ? h.y + dy : h.y,
      );
      position.needsUpdate = true;
    } else {
      for (const object of this.drawings.get(drag.shapeId) ?? []) {
        object.position.set(dx, dy, 0);
      }
      this.handles.position.set(dx, dy, 0);
    }
    this.host.requestRender();
  }

  private listen() {
    const { canvas } = this.host;
    let drag: Drag | null = null;
    // A drag just ended: the click that follows isn't a pick.
    let dragged = false;
    let down: { x: number; y: number } | null = null;

    // Before the orbit controls see it (capture, registered first on the
    // canvas): a press on what can be dragged is a drag, not an orbit.
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        down = { x: event.clientX, y: event.clientY };
        dragged = false;
        if (event.button !== 0 || !this.host.active() || !this.editing) return;
        const at = this.pointAt(event);
        if (!at) return;
        const handle = this.handleAt(at);
        const onShape =
          handle < 0 &&
          this.distanceTo(this.editing.shapeId, at) < this.reach();
        if (handle < 0 && !onShape) return;
        if (handle >= 0 && this.editing.handles[handle].locked) return;
        drag = {
          shapeId: this.editing.shapeId,
          handle,
          from: at,
          screen: { x: event.clientX, y: event.clientY },
          moved: false,
        };
        this.host.controls.enabled = false;
        canvas.setPointerCapture(event.pointerId);
        event.stopImmediatePropagation();
      },
      { capture: true },
    );

    canvas.addEventListener('pointermove', (event) => {
      if (!drag) {
        // Say what a press here would do.
        if (!this.host.active() || !this.editing) {
          this.host.hint('');
          return;
        }
        const at = this.pointAt(event);
        if (!at) return;
        const handle = this.handleAt(at);
        const h = handle >= 0 ? this.editing.handles[handle] : null;
        this.host.hint(
          h
            ? h.locked
              ? 'this point is an expression: change it in the editor'
              : 'drag the point'
            : this.distanceTo(this.editing.shapeId, at) < this.reach()
              ? 'drag to move the shape'
              : '',
        );
        canvas.style.cursor =
          (h && !h.locked) ||
          (!h && this.distanceTo(this.editing.shapeId, at) < this.reach())
            ? 'move'
            : '';
        return;
      }
      const at = this.pointAt(event);
      if (!at) return;
      if (
        !drag.moved &&
        Math.hypot(
          event.clientX - drag.screen.x,
          event.clientY - drag.screen.y,
        ) < DRAG_PX
      ) {
        return;
      }
      drag.moved = true;
      this.offset(drag, at.x - drag.from.x, at.y - drag.from.y);
    });

    const end = (event: PointerEvent, cancelled: boolean) => {
      if (!drag) return;
      const finished = drag;
      drag = null;
      this.host.controls.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      dragged = finished.moved;
      const at = this.pointAt(event);
      const dx = at && !cancelled ? at.x - finished.from.x : 0;
      const dy = at && !cancelled ? at.y - finished.from.y : 0;
      const moved = finished.moved && Math.hypot(dx, dy) >= 0.005;
      if (!moved) {
        this.offset(finished, 0, 0);
      }
      this.handles.position.set(0, 0, 0);
      if (!moved) return;
      if (finished.handle >= 0) {
        const h = this.editing!.handles[finished.handle];
        this.host.movePoint(finished.shapeId, h, {
          x: h.x + dx,
          y: h.y + dy,
        });
      } else {
        // The drawing stays moved until the shape is made again there.
        this.host.moveShape(finished.shapeId, dx, dy);
      }
    };
    canvas.addEventListener('pointerup', (event) => end(event, false));
    canvas.addEventListener('pointercancel', (event) => end(event, true));

    // A click (not the end of a drag, an orbit or a pan) picks a shape.
    canvas.addEventListener('click', (event) => {
      const moved =
        !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4;
      if (dragged || moved || !this.host.active()) return;
      const at = this.pointAt(event);
      if (!at) return;
      const id = this.shapeAt(at);
      if (id !== (this.editing?.shapeId ?? null)) {
        this.host.select(id);
      }
    });
  }
}

/** What's being dragged: a point (`handle`, its index) or the shape. */
type Drag = {
  shapeId: string;
  handle: number;
  from: Vector3;
  screen: { x: number; y: number };
  moved: boolean;
};
