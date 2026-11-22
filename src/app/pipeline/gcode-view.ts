import { GcodeListing, listingSections } from '../../cam/gcode-listing';
import { OperationDescriptions, Program, programListing } from './gcode';

/** The program as the G-code panel shows it (see `GcodeViewComponent`). */
export type GcodeView = {
  /** Its G-code line by line, each with the move it makes. */
  listing: GcodeListing;
  /** Its stretches by operation, in order, as the panel names them. */
  sections: GcodeSection[];
};

export type GcodeSection = {
  /** The operation's id ('' for what belongs to none: the start, the end). */
  operationId: string;
  /** "Operation 2: pocket 5 mm · …" ('' with no operation). */
  label: string;
  /** Its first and last line (from 0). */
  first: number;
  last: number;
};

/** `program` written out for the panel, its operations as `descriptions`. */
export function gcodeView(
  program: Program,
  descriptions: OperationDescriptions,
): GcodeView {
  const listing = programListing(program, descriptions);
  const sections = listingSections(listing).map((section) => ({
    ...section,
    label: descriptions[section.operationId] ?? '',
  }));
  // The comment saying what an operation is comes before it (and before
  // the tool change it starts with): from there on is the operation's.
  sections.forEach((section, i) => {
    const before = sections[i - 1];
    if (!section.label || !before) return;
    const from = Math.max(before.first, section.first - DESCRIBED_WITHIN);
    for (let line = section.first - 1; line >= from; line--) {
      if (listing.lines[line] === `; ${section.label}`) {
        section.first = line;
        before.last = line - 1;
        break;
      }
    }
  });
  // An operation cut again right after itself (a rotary repeat's, at the
  // next angle) is described again: a stretch of its own from there.
  const stretches = sections.flatMap((section) => {
    if (!section.label) return [section];
    const parts = [{ ...section }];
    const comment = `; ${section.label}`;
    for (let line = section.first + 1; line <= section.last; line++) {
      if (listing.lines[line] === comment) {
        parts[parts.length - 1].last = line - 1;
        parts.push({ ...section, first: line });
      }
    }
    return parts;
  });
  return { listing, sections: stretches.filter((s) => s.last >= s.first) };
}

/** How many lines before its moves an operation's comment is looked for. */
const DESCRIBED_WITHIN = 12;

const SHOWN_STORAGE_KEY = 'ui.gcodeShown';
const WIDTH_STORAGE_KEY = 'ui.gcodeWidth';
export const DEFAULT_GCODE_WIDTH = 340;
const MIN_GCODE_WIDTH = 220;

/** Whether the panel was open last time in this browser. */
export function loadGcodeShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveGcodeShown(shown: boolean) {
  try {
    localStorage.setItem(SHOWN_STORAGE_KEY, shown ? '1' : '0');
  } catch {}
}

/** The panel's width kept within what the window has room for. */
export function clampGcodeWidth(width: number): number {
  const max = Math.max(MIN_GCODE_WIDTH, Math.round(window.innerWidth * 0.5));
  return Math.round(Math.min(max, Math.max(MIN_GCODE_WIDTH, width)));
}

export function loadGcodeWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (stored >= MIN_GCODE_WIDTH) return clampGcodeWidth(stored);
  } catch {}
  return clampGcodeWidth(DEFAULT_GCODE_WIDTH);
}

export function saveGcodeWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {}
}
