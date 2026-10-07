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
    case 'nest': {
      const items: any[] = shape['nestItems'] ?? [];
      const count = items.reduce((n, i) => n + (+i?.count || 0), 0);
      return `nest of ${count} on ${shape['nestSheetWidth']}×${shape['nestSheetHeight']}`;
    }
    case 'nest-layer': {
      const nest = shapes.find((s) => s.id === shape['nestOfId']);
      return nest ? `with ${nest.name || 'nest'}` : 'with a nest';
    }
    case 'hinge-cup':
      return `hinge cup Ø${shape['hingeCupDiameter']}`;
    case 'bowtie':
      return `bowtie ${shape['bowtieLength']}×${shape['bowtieEndWidth']}`;
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
      const operands: any[] = shape['operands'] ?? [];
      if (!operands.length) return 'boolean';
      return operands
        .map((o, i) =>
          i === 0
            ? operand(o?.shapeId)
            : `${BOOLEAN_SYMBOLS[o?.operation] ?? '?'} ${operand(o?.shapeId)}`,
        )
        .join(' ');
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

/** The shapes `shape` takes its geometry from (copies and booleans). */
export function shapeSources(shape: any): string[] {
  switch (shape?.type) {
    case 'copy':
      return [shape.copyOfId];
    case 'boolean':
      return (shape.operands ?? []).map((o: any) => o?.shapeId);
    case 'nest':
      return (shape.nestItems ?? []).map((i: any) => i?.shapeId);
    case 'nest-layer':
      return [
        shape.nestOfId,
        ...(shape.nestLayers ?? []).map((l: any) => l?.shapeId),
      ];
    default:
      return [];
  }
}

/** Whether `fromId` takes its geometry from `id`, directly or not. */
export function dependsOn(fromId: string, id: string, shapes: any[]): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === id) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    stack.push(...shapeSources(shapes.find((s) => s.id === current)));
  }
  return false;
}
