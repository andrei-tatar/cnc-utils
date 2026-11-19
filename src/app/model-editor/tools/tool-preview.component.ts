import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { taperedBallNose } from '../../../cam/simulate';
import {
  DrawnTool,
  halfWidthAt,
  OutlinePoint,
  tipHeight,
  toolOutline,
} from './tool-outline';

type Rect = { x: number; y: number; width: number; height: number };
type Line = { x1: number; y1: number; x2: number; y2: number; soft?: boolean };
type Label = {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  /** Reads upwards (along a vertical dimension). */
  upright?: boolean;
};

/** One picture of the bit: all of it, or its tip enlarged. */
type Drawing = {
  id: string;
  caption: string | null;
  height: number;
  /** What's shown of the bit. */
  clip: Rect;
  /** The bit's outline (open at the top). */
  body: string;
  /** The part of the bit that has flutes, when that's known. */
  flutes: Rect | null;
  /** The flutes' edges as they spiral round the bit, seen from the front. */
  spirals: string[];
  /** Serrated edges (a roughing bit's). */
  serrated: boolean;
  /** The collet nut, when the bit says how far it sticks out. */
  nut: Rect | null;
  lines: Line[];
  labels: Label[];
  dots: Array<{ x: number; y: number }>;
};

/** A note pointing at a place on the bit (mm, as in its outline). */
type Callout = { at: OutlinePoint; text: string };

const WIDTH = 320;
let drawings = 0;

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const mm = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * A drawing of a bit from its settings, with their values on it: all of it
 * to scale (diameter, flute length, how far it sticks out of the collet
 * nut), and for bits with a shaped tip the tip enlarged (a V's angle and
 * flat, a bull nose's corners, a tapered ball nose's ball and taper, a
 * drill's point). The outline is the one the simulation cuts with.
 */
@Component({
  selector: 'app-tool-preview',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    :host {
      display: block;
    }

    .drawing {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid var(--editor-border);
      border-radius: 8px;
      background: var(--editor-card-bg);

      & + .drawing {
        margin-top: 8px;
      }
    }

    .body {
      fill: var(--editor-chip-bg);
      stroke: none;
    }

    .cutting {
      fill: color-mix(in srgb, var(--bs-primary) 22%, var(--editor-card-bg));
    }

    .spiral {
      fill: none;
      stroke: color-mix(in srgb, var(--bs-primary) 60%, transparent);
      stroke-width: 1.5;
      stroke-linecap: round;

      &.serrated {
        stroke-width: 2.4;
        stroke-linecap: butt;
        stroke-dasharray: 3 2;
      }
    }

    .outline {
      fill: none;
      stroke: var(--bs-body-color);
      stroke-width: 1.4;
      stroke-linejoin: round;
      stroke-linecap: round;
    }

    .nut {
      fill: var(--bs-secondary-bg);
      stroke: var(--bs-body-color);
      stroke-width: 1.2;
    }

    .dimension {
      stroke: var(--bs-secondary-color);
      stroke-width: 1;

      &.soft {
        stroke-dasharray: 2 3;
        opacity: 0.7;
      }
    }

    .dot {
      fill: var(--bs-secondary-color);
    }

    text {
      font-size: 11px;
      fill: var(--bs-body-color);
      font-variant-numeric: tabular-nums;
    }

    .caption,
    .nut-label {
      font-size: 10px;
      fill: var(--bs-secondary-color);
    }

    .empty {
      padding: 24px 12px;
      border: 1px dashed var(--editor-border);
      border-radius: 8px;
      text-align: center;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
    }
  `,
  template: `
    @for (d of drawings; track d.id) {
      <svg
        class="drawing"
        [attr.viewBox]="'0 0 ' + width + ' ' + d.height"
        role="img"
        [attr.aria-label]="d.caption ?? summary"
      >
        <defs>
          <clipPath [attr.id]="d.id + '-clip'">
            <rect
              [attr.x]="d.clip.x"
              [attr.y]="d.clip.y"
              [attr.width]="d.clip.width"
              [attr.height]="d.clip.height"
            />
          </clipPath>
          <clipPath [attr.id]="d.id + '-body'">
            <path [attr.d]="d.body" />
          </clipPath>
          @if (d.flutes; as f) {
            <clipPath [attr.id]="d.id + '-flutes'">
              <rect
                [attr.x]="f.x"
                [attr.y]="f.y"
                [attr.width]="f.width"
                [attr.height]="f.height"
              />
            </clipPath>
          }
        </defs>
        <g [attr.clip-path]="'url(#' + d.id + '-clip)'">
          <path class="body" [class.cutting]="!d.flutes" [attr.d]="d.body" />
          @if (d.flutes) {
            <g [attr.clip-path]="'url(#' + d.id + '-flutes)'">
              <path class="body cutting" [attr.d]="d.body" />
            </g>
          }
          <g [attr.clip-path]="'url(#' + d.id + '-body)'">
            @for (spiral of d.spirals; track $index) {
              <path
                class="spiral"
                [class.serrated]="d.serrated"
                [attr.d]="spiral"
              />
            }
          </g>
          <path class="outline" [attr.d]="d.body" />
        </g>
        @if (d.nut; as n) {
          <rect
            class="nut"
            rx="3"
            [attr.x]="n.x"
            [attr.y]="n.y"
            [attr.width]="n.width"
            [attr.height]="n.height"
          />
          <text
            class="nut-label"
            text-anchor="middle"
            [attr.x]="n.x + n.width / 2"
            [attr.y]="n.y + n.height / 2 + 3.5"
          >
            collet nut
          </text>
        }
        @for (l of d.lines; track $index) {
          <line
            class="dimension"
            [class.soft]="l.soft"
            [attr.x1]="l.x1"
            [attr.y1]="l.y1"
            [attr.x2]="l.x2"
            [attr.y2]="l.y2"
          />
        }
        @for (dot of d.dots; track $index) {
          <circle class="dot" r="2.2" [attr.cx]="dot.x" [attr.cy]="dot.y" />
        }
        @for (t of d.labels; track $index) {
          <text
            [attr.x]="t.x"
            [attr.y]="t.y"
            [attr.text-anchor]="t.anchor"
            [attr.transform]="
              t.upright ? 'rotate(-90 ' + t.x + ' ' + t.y + ')' : null
            "
          >
            {{ t.text }}
          </text>
        }
        @if (d.caption) {
          <text class="caption" x="8" y="15">{{ d.caption }}</text>
        }
      </svg>
    } @empty {
      <div class="empty">Give the bit a diameter to see it drawn.</div>
    }
  `,
})
export class ToolPreviewComponent {
  readonly width = WIDTH;
  private readonly id = `tool-preview-${++drawings}`;
  private drawn = '';
  drawings: Drawing[] = [];
  summary = '';

  /** The tool, its expressions worked out. */
  @Input()
  set item(tool: DrawnTool | null | undefined) {
    // A new object every time it's looked at: only draw what changed.
    const key = JSON.stringify(tool ?? null);
    if (key === this.drawn) {
      return;
    }
    this.drawn = key;
    this.drawings = tool && positive(tool.diameter) ? this.draw(tool) : [];
    this.summary = 'The bit, drawn from its settings';
  }

  private draw(tool: DrawnTool): Drawing[] {
    const detail = tipDetail(tool, `${this.id}-tip`);
    return [overview(tool, `${this.id}-all`), ...(detail ? [detail] : [])];
  }
}

/** The outline as a path: down the left side, round the tip, up the right. */
function bodyPath(
  outline: OutlinePoint[],
  x: (mm: number) => number,
  y: (mm: number) => number,
): string {
  const right = outline.map(
    ([d, z]) => `${x(d).toFixed(2)} ${y(z).toFixed(2)}`,
  );
  const left = outline
    .slice(1)
    .reverse()
    .map(([d, z]) => `${x(-d).toFixed(2)} ${y(z).toFixed(2)}`);
  return `M${[...left, ...right].join('L')}`;
}

/** Dimension lines and their labels, as they're added. */
class Dimensions {
  lines: Line[] = [];
  labels: Label[] = [];
  dots: Array<{ x: number; y: number }> = [];

  /** Across, at `y`, between `x1` and `x2` (from the bit at `from`). */
  across(x1: number, x2: number, y: number, from: number, text: string) {
    for (const x of [x1, x2]) {
      this.lines.push({ x1: x, y1: from, x2: x, y2: y + 4, soft: true });
      this.tick(x, y);
    }
    this.lines.push({ x1, y1: y, x2, y2: y });
    this.labels.push({ x: (x1 + x2) / 2, y: y + 14, text, anchor: 'middle' });
  }

  /**
   * Up, at `x`, between `y1` and `y2` (from the bit at `from1` / `from2`);
   * the label on the side away from the bit.
   */
  up(
    y1: number,
    y2: number,
    x: number,
    from1: number,
    from2: number,
    text: string,
  ) {
    const out = x >= Math.max(from1, from2) ? 1 : -1;
    this.lines.push(
      { x1: from1, y1, x2: x + 4 * out, y2: y1, soft: true },
      { x1: from2, y1: y2, x2: x + 4 * out, y2, soft: true },
      { x1: x, y1, x2: x, y2 },
    );
    this.tick(x, y1);
    this.tick(x, y2);
    this.labels.push({
      x: out > 0 ? x + 12 : x - 5,
      y: (y1 + y2) / 2,
      text,
      anchor: 'middle',
      upright: true,
    });
  }

  private tick(x: number, y: number) {
    this.lines.push({ x1: x - 3, y1: y + 3, x2: x + 3, y2: y - 3 });
  }

  /**
   * Notes pointing at places on the bit, their text ending at `x`, kept
   * apart between `top` and `bottom`.
   */
  callouts(
    notes: Array<{ x: number; y: number; text: string }>,
    x: number,
    top: number,
    bottom: number,
  ) {
    const GAP = 15;
    const sorted = [...notes].sort((a, b) => a.y - b.y);
    let next = top;
    const rows = sorted.map((note) => {
      const y = Math.max(next, note.y);
      next = y + GAP;
      return y;
    });
    // Back up from the bottom where they ran past it.
    let limit = bottom;
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i] = Math.min(rows[i], limit);
      limit = rows[i] - GAP;
    }
    sorted.forEach((note, i) => {
      this.lines.push({ x1: x + 4, y1: rows[i], x2: note.x, y2: note.y });
      this.dots.push({ x: note.x, y: note.y });
      this.labels.push({ x, y: rows[i] + 4, text: note.text, anchor: 'end' });
    });
  }
}

/**
 * How far up a compression bit's flutes spiral upwards, as drawn on `top`
 * mm of flutes: what the bit says, or about its diameter.
 */
function upcutTip(tool: DrawnTool, top: number): number {
  const said = positive(tool.upcutLength);
  return said
    ? Math.min(said, top)
    : Math.min(positive(tool.diameter), top / 2);
}

const isEndMill = (tool: DrawnTool) =>
  (tool.bitType ?? 'end-mill') === 'end-mill';

/**
 * The flutes' edges on the front of the bit, up to `top` (mm above the
 * tip), as paths: each spirals from one side of the bit to the other,
 * rising to the right where it lifts the chips (an upcut bit, and the bits
 * that don't say), to the left where it presses them down (downcut); a
 * compression bit's go up at the tip (`upcutTip`), down above.
 * Straight flutes run straight up. None for a V-bit or a keyhole bit.
 */
function spirals(
  tool: DrawnTool,
  outline: OutlinePoint[],
  top: number,
  x: (mm: number) => number,
  y: (mm: number) => number,
): string[] {
  if (tool.bitType === 'v-bit' || tool.bitType === 'keyhole' || !(top > 0)) {
    return [];
  }
  const diameter = positive(tool.diameter);
  const type = isEndMill(tool) ? (tool.fluteType ?? 'upcut') : 'upcut';
  if (type === 'straight') {
    // Straight up the bit: the edge, and the back of the flute beside it.
    return [-0.45, 0.2].map((across) => {
      const points: string[] = [];
      for (let i = 0; i <= 40; i++) {
        const z = (top * i) / 40;
        const d = across * halfWidthAt(outline, z);
        points.push(`${x(d).toFixed(2)} ${y(z).toFixed(2)}`);
      }
      return `M${points.join('L')}`;
    });
  }
  // Where the edges turn from going up to going down.
  const turn =
    type === 'compression' ? upcutTip(tool, top) : type === 'downcut' ? 0 : top;
  // How far an edge rises crossing the front (half a turn): steeper than
  // most bits' 30° helix, so that a short bit shows a few of them.
  const rise = 1.1 * diameter;
  const flutes = Math.min(
    Math.max(Math.round(positive(tool.flutes) || 2), 1),
    6,
  );
  // Each flute shows as two lines: its edge and the back of its land.
  const apart = rise / flutes;
  const STEPS = 40;
  const paths: string[] = [];
  /**
   * The edges between `from` and `to` above the turn (below it: negative),
   * going up, or mirrored in the turn (`down`) so the two meet there.
   */
  const add = (from: number, to: number, down: boolean) => {
    if (!(to > from)) return;
    const first = Math.ceil((from - rise) / apart) * apart;
    for (let start = first; start < to; start += apart) {
      const points: string[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const u = start + (rise * i) / STEPS;
        if (u < from - 1e-9 || u > to + 1e-9) continue;
        const z = down ? turn - u : turn + u;
        const d = -halfWidthAt(outline, z) * Math.cos((Math.PI * i) / STEPS);
        points.push(`${x(d).toFixed(2)} ${y(z).toFixed(2)}`);
      }
      if (points.length > 1) {
        paths.push(`M${points.join('L')}`);
      }
    }
  };
  add(-turn, 0, false);
  add(turn - top, 0, true);
  return paths;
}

/** All of the bit, to scale. */
function overview(tool: DrawnTool, id: string): Drawing {
  const diameter = positive(tool.diameter);
  const r = diameter / 2;
  const keyhole = tool.bitType === 'keyhole';
  const head = keyhole ? positive(tool.headHeight) : 0;
  const tip = keyhole ? head : tipHeight(tool);
  const fluteLength = positive(tool.fluteLength);
  const stickout = positive(tool.stickout);
  // Without lengths: enough of it to see what it is.
  const cutting = fluteLength || Math.max(tip, 2.5 * diameter);
  const shown =
    stickout || Math.max(cutting, tip) * 1.25 + Math.max(diameter, head) * 0.5;

  const TOP = stickout ? 34 : 12;
  const BOTTOM = 40;
  const centre = 150;
  const scale = Math.min(150 / diameter, 250 / shown);
  const height = Math.max(150, Math.ceil(TOP + shown * scale + BOTTOM));
  const base = height - BOTTOM;
  const x = (d: number) => centre + d * scale;
  const y = (z: number) => base - z * scale;

  const dims = new Dimensions();
  dims.across(
    x(-r),
    x(r),
    base + 14,
    y(Math.min(tip, shown)),
    `Ø${mm(diameter)}`,
  );
  let right = x(r) + 18;
  if (fluteLength) {
    dims.up(
      y(0),
      y(Math.min(fluteLength, shown)),
      right,
      x(keyhole ? r : 0),
      x(r),
      `flutes ${mm(fluteLength)}`,
    );
    right += 22;
  }
  if (stickout) {
    dims.up(
      y(0),
      y(stickout),
      right,
      x(keyhole ? r : 0),
      x(r),
      `sticks out ${mm(stickout)}`,
    );
  }
  const upcut =
    isEndMill(tool) && tool.fluteType === 'compression'
      ? positive(tool.upcutLength)
      : 0;
  if (upcut) {
    dims.up(
      y(0),
      y(Math.min(upcut, shown)),
      x(-r) - 16,
      x(-r),
      x(-r),
      `upcut ${mm(upcut)}`,
    );
  }
  if (keyhole) {
    const neck = Math.min(positive(tool.neckDiameter) / 2, r);
    if (head) {
      dims.up(y(0), y(head), x(-r) - 16, x(-r), x(-r), `head ${mm(head)}`);
    }
    if (neck) {
      dims.callouts(
        [
          {
            x: x(-neck),
            y: y((head + shown) / 2),
            text: `neck Ø${mm(2 * neck)}`,
          },
        ],
        x(-r) - 34,
        14,
        base,
      );
    }
  }

  const fluted = fluteLength || (keyhole ? head : 0);
  const outline = toolOutline(tool, shown * 1.1);
  const nutWidth = Math.min(WIDTH - 40, Math.max(diameter * scale * 1.7, 84));
  return {
    id,
    caption: null,
    height,
    clip: { x: 0, y: y(shown), width: WIDTH, height: shown * scale + 4 },
    body: bodyPath(outline, x, y),
    flutes: fluted
      ? { x: 0, y: y(fluted), width: WIDTH, height: fluted * scale + 4 }
      : null,
    spirals: spirals(tool, outline, Math.min(cutting, shown), x, y),
    serrated: tool.fluteType === 'roughing' && isEndMill(tool),
    nut: stickout
      ? {
          x: centre - nutWidth / 2,
          y: y(shown) - 24,
          width: nutWidth,
          height: 24,
        }
      : null,
    lines: dims.lines,
    labels: dims.labels,
    dots: dims.dots,
  };
}

/**
 * The tip enlarged, with what shapes it: nothing for bits whose tip has no
 * settings of its own (end mill, ball nose, keyhole).
 */
function tipDetail(tool: DrawnTool, id: string): Drawing | null {
  const diameter = positive(tool.diameter);
  const r = diameter / 2;
  const half = (degrees: number) => (degrees * Math.PI) / 360;

  // How much of the bit's width is shown, and what's pointed out: places
  // on the bit, given how far up it the picture goes.
  let across = diameter;
  let flat = 0;
  let notes: (upTo: number) => Callout[];
  /**
   * A place on a straight side that starts at `from` and leans `lean` mm
   * outwards per mm up: half way out to `edge`, or lower when that's out
   * of the picture.
   */
  const onSide = (
    from: OutlinePoint,
    lean: number,
    edge: number,
    upTo: number,
  ): OutlinePoint => {
    const d = (from[0] + edge) / 2;
    const z = from[1] + (d - from[0]) / Math.max(lean, 1e-6);
    return z <= upTo ? [d, z] : [from[0] + (upTo - from[1]) * lean, upTo];
  };
  switch (tool.bitType) {
    case 'v-bit': {
      flat = Math.min(positive(tool.tipDiameter), diameter);
      if (flat) {
        across = Math.min(diameter, Math.max(5 * flat, diameter / 4));
      }
      const angle = positive(tool.vAngle);
      notes = (upTo) => [
        {
          at: onSide([flat / 2, 0], Math.tan(half(angle)), across / 2, upTo),
          text: `V ${mm(angle)}°`,
        },
      ];
      break;
    }
    case 'drill': {
      const angle = positive(tool.pointAngle) || 118;
      notes = (upTo) => [
        {
          at: onSide([0, 0], Math.tan(half(angle)), r, upTo),
          text: `point ${mm(angle)}°`,
        },
      ];
      break;
    }
    case 'bull-nose': {
      const corner = Math.min(positive(tool.cornerRadius), r);
      if (!corner) return null;
      across = Math.min(diameter, Math.max(6 * corner, diameter / 2));
      notes = () => [
        {
          at: [r - corner + corner * Math.SQRT1_2, corner * (1 - Math.SQRT1_2)],
          text: `corner r${mm(corner)}`,
        },
      ];
      break;
    }
    case 'tapered-ball-nose': {
      const { ball, reach, height, tan } = taperedBallNose({
        ...tool,
        diameter,
      });
      across = Math.min(diameter, Math.max(6 * ball, diameter / 4));
      notes = (upTo) => [
        ...(ball
          ? [
              {
                at: [
                  ball * Math.SQRT1_2,
                  ball * (1 - Math.SQRT1_2),
                ] as OutlinePoint,
                text: `tip R${mm(ball)}`,
              },
            ]
          : []),
        {
          at: onSide([reach, height], tan, across / 2, upTo),
          text: `taper ${mm(positive(tool.taperAngle))}° a side`,
        },
      ];
      break;
    }
    default:
      return null;
  }

  const HEIGHT = 220;
  const TOP = 24;
  const BOTTOM = flat ? 40 : 16;
  const centre = 205;
  const HALF = 100;
  const base = HEIGHT - BOTTOM;
  const window = base - TOP;
  const scale = (2 * HALF) / across;
  const x = (d: number) => centre + d * scale;
  const y = (z: number) => base - z * scale;
  const callouts = notes((0.6 * window) / scale);

  const dims = new Dimensions();
  if (flat) {
    dims.across(x(-flat / 2), x(flat / 2), base + 14, y(0), `tip Ø${mm(flat)}`);
  }
  dims.callouts(
    callouts
      // Only what's in the picture.
      .filter(({ at }) => at[0] * scale <= HALF && at[1] * scale <= window)
      .map(({ at, text }) => ({ x: x(-at[0]), y: y(at[1]), text })),
    centre - HALF - 6,
    TOP + 10,
    base,
  );

  return {
    id,
    caption: across < diameter ? 'the tip, enlarged' : 'the tip',
    height: HEIGHT,
    clip: { x: centre - HALF, y: TOP, width: 2 * HALF, height: window + 3 },
    body: bodyPath(toolOutline(tool, (window / scale) * 1.2), x, y),
    flutes: null,
    spirals: [],
    serrated: false,
    nut: null,
    lines: dims.lines,
    labels: dims.labels,
    dots: dims.dots,
  };
}
