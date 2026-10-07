/** A line of the cut list: one part (or one copy of a nested part). */
export type CutListRow = {
  part: string;
  /** 1 for the first copy. */
  copy: number;
  length: number;
  width: number;
  thickness: number | null;
  /** Where it's nested (sheet from 1, its box's corner), when it is. */
  sheet: number | null;
  x: number | null;
  y: number | null;
  turned: boolean | null;
  note: string;
};

const HEADER = [
  'Part',
  'Copy',
  'Length (mm)',
  'Width (mm)',
  'Thickness (mm)',
  'Sheet',
  'X (mm)',
  'Y (mm)',
  'Turned 90°',
  'Note',
];

/** The cut list as CSV (comma-separated, quoted where needed). */
export function cutListCsv(rows: CutListRow[]): string {
  const cell = (value: string | number | boolean | null) => {
    if (value === null) return '';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    const text =
      typeof value === 'number' ? String(Math.round(value * 10) / 10) : value;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return (
    [
      HEADER,
      ...rows.map((r) => [
        r.part,
        r.copy,
        r.length,
        r.width,
        r.thickness,
        r.sheet,
        r.x,
        r.y,
        r.turned,
        r.note,
      ]),
    ]
      .map((line) => line.map(cell).join(','))
      .join('\n') + '\n'
  );
}
