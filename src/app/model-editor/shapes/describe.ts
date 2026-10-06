import type { FormlyFieldConfig } from '@ngx-formly/core';

type AnyShape = {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: any;
};

const BOOLEAN_SYMBOLS: Record<string, string> = {
  union: '∪',
  intersection: '∩',
  difference: '−',
  xor: '⊕',
};

/** The shape's own name, or one built from its settings. */
export function shapeLabel(
  shape: AnyShape | undefined,
  shapes: AnyShape[],
): string {
  return shape?.name || describeShape(shape, shapes) || 'unnamed';
}

/** A readable name built from the shape's settings, e.g. "rectangle 30×20". */
export function describeShape(
  shape: AnyShape | undefined,
  shapes: AnyShape[],
  depth = 0,
): string {
  switch (shape?.type) {
    case 'rectangle':
      return `rectangle ${shape['width']}×${shape['height']}${
        shape['radius'] ? ` r${shape['radius']}` : ''
      }`;
    case 'circle':
      return `circle Ø${shape['diameter']}`;
    case 'line':
      return `line ${shape['width']}`;
    case 'path-data':
      return 'path';
    case 'slot':
      return `slot ${shape['slotLength']}×${shape['slotWidth']}`;
    case 'points': {
      const hole =
        shape['holeDiameter'] > 0 ? ` Ø${shape['holeDiameter']}` : '';
      switch (shape['pointsMode']) {
        case 'grid':
          return `${shape['gridCountX']}×${shape['gridCountY']} grid${hole}`;
        case 'circle':
          return `${shape['circleCount']} on Ø${shape['circleDiameter']}${hole}`;
        default:
          return `points${hole}`;
      }
    }
    case 'polyline':
      return shape['polylineClosed'] ? 'polygon' : 'lines';
    case 'box-panel':
      return `box panel ${shape['boxWidth']}×${shape['boxHeight']}`;
    case 'trace':
      return shape['fileName'] ? `trace ${shape['fileName']}` : 'image trace';
    case 'svg':
      return shape['fileName'] ? `svg ${shape['fileName']}` : 'svg';
    case 'text': {
      const text = String(shape['text'] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const short = text.length > 24 ? `${text.slice(0, 23)}…` : text;
      return `“${short}” ${shape['font']?.family ?? ''}`.trim();
    }
    case 'copy': {
      const other = shapes.find((s) => s.id === shape['copyOfId']);
      if (!other) return 'copy';
      return `copy of ${
        other.name ||
        (depth < 2 ? describeShape(other, shapes, depth + 1) : '…')
      }`;
    }
    case 'boolean': {
      // Boolean shapes can reference each other; don't recurse forever.
      const operand = (id: string) => {
        const other = shapes.find((s) => s.id === id);
        if (!other) return '?';
        if (other.name) return other.name;
        return depth < 2 ? `(${describeShape(other, shapes, depth + 1)})` : '…';
      };
      const symbol = BOOLEAN_SYMBOLS[shape['operationType']] ?? '?';
      return `${operand(shape['shape1Id'])} ${symbol} ${operand(shape['shape2Id'])}`;
    }
    default:
      return shape?.type ?? '';
  }
}

/** The whole model, from any field in the form. */
export function rootModel(field: FormlyFieldConfig | undefined): any {
  while (field?.parent) {
    field = field.parent;
  }
  return field?.model;
}

/** All shapes in the model, from any field in the form. */
export function allShapes(field: FormlyFieldConfig | undefined): AnyShape[] {
  return rootModel(field)?.shapes ?? [];
}
