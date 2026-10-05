import { Injectable, signal } from '@angular/core';

/**
 * Warnings found while generating the G-code (e.g. a ramp with no room), by
 * the id of the item they're about, for the editor to show on that item.
 */
@Injectable({ providedIn: 'root' })
export class ItemWarnings {
  readonly byId = signal<Record<string, string[]>>({});
}
