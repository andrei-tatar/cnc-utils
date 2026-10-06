import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  FieldArrayType,
  FormlyFieldConfig,
  FormlyModule,
} from '@ngx-formly/core';
import { generateId } from '../../../util';
import { NgbCollapseModule, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { rootModel } from '../shapes/describe';
import { resolvedItem } from '../variables/field';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import {
  readCollapsedSections,
  writeCollapsedSections,
} from './collapsed-sections';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';

/**
 * A button in a list's header (`props.headerActions`), e.g. the tool
 * library. `run` gets the list's items and a way to add one.
 */
export type HeaderAction = {
  label: string;
  title: string;
  run(context: {
    injector: Injector;
    /** The list's field. */
    field: FormlyFieldConfig;
    items: any[];
    /** Add an item (a new id is given to it). */
    add(item: object): Promise<void>;
  }): void;
};

@Component({
  imports: [FormlyModule, NgbCollapseModule, DragDropModule],
  styles: `
    :host {
      display: block;
    }

    .icon {
      width: 14px;
      height: 14px;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;

      .dots {
        fill: currentColor;
        stroke: none;
      }
    }

    .list {
      --accent: var(--bs-secondary);
      border-left: 3px solid var(--accent);
      border-radius: 6px;
      background: var(--editor-nested-bg);
      padding: 6px 8px 8px;
      margin: 4px 0 8px;
    }

    .list--root {
      border-left: none;
      border-radius: 10px;
      background: var(--editor-section-bg);
      border: 1px solid var(--editor-border);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      padding: 0;
      margin: 0 0 12px;
      overflow: hidden;
    }

    .list_header {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
    }

    // Set by fitHeader() when the header is too narrow for everything:
    // drop Clear's label first, then Add's and the "to fix" wording.
    .list_header[data-compact='1'] .clear-button .button-label,
    .list_header[data-compact='2'] .button-label {
      display: none;
    }

    .list--root > .list_header {
      padding: 8px 10px 8px 12px;
      border-top: 3px solid var(--accent);
      cursor: pointer;
      user-select: none;

      &:hover {
        background: var(--editor-hover-bg);
      }
    }

    .list_title {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      // Last resort in very narrow headers: shorten the title, never push
      // the buttons out.
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .list_count,
    .issue-chip,
    .add-button,
    .clear-button,
    .chevron {
      flex: none;
    }

    .list--root > .list_header .list_title {
      font-size: 0.85rem;
    }

    .list_count {
      font-size: 0.7rem;
      font-weight: 600;
      line-height: 1;
      padding: 3px 7px;
      border-radius: 999px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .list_spacer {
      flex: 1;
    }

    .chevron {
      display: inline-flex;
      color: var(--bs-secondary-color);
      transition: transform 150ms ease;

      &.open {
        transform: rotate(90deg);
      }
    }

    .clear-button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      --bs-btn-padding-y: 0.15rem;
      --bs-btn-padding-x: 0.45rem;
      --bs-btn-font-size: 0.75rem;
      --bs-btn-color: var(--bs-secondary-color);
      --bs-btn-border-color: transparent;
      --bs-btn-hover-color: var(--bs-danger);
      --bs-btn-hover-bg: var(--bs-danger-bg-subtle);
      --bs-btn-hover-border-color: transparent;
      --bs-btn-disabled-border-color: transparent;
    }

    .add-button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      --bs-btn-padding-y: 0.15rem;
      --bs-btn-padding-x: 0.5rem;
      --bs-btn-font-size: 0.75rem;
      --bs-btn-font-weight: 500;
      --bs-btn-color: var(--accent);
      --bs-btn-border-color: color-mix(in srgb, var(--accent) 45%, transparent);
      --bs-btn-hover-color: #fff;
      --bs-btn-hover-bg: var(--accent);
      --bs-btn-hover-border-color: var(--accent);
      --bs-btn-disabled-color: var(--accent);
      --bs-btn-disabled-border-color: color-mix(
        in srgb,
        var(--accent) 30%,
        transparent
      );
    }

    .list_items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
    }

    .list--root > .list_items {
      margin: 0;
      padding: 10px;
      border-top: 1px solid var(--editor-border);
    }

    .list_items.collapsed {
      display: none;
    }

    .list_empty {
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
      font-style: italic;
      padding: 4px 2px;
    }

    .item {
      background: var(--editor-card-bg);
      border: 1px solid var(--editor-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .issue-chip {
      font-size: 0.7rem;
      font-weight: 600;
      line-height: 1;
      padding: 3px 7px;
      border-radius: 999px;
      white-space: nowrap;
      color: var(--bs-danger-text-emphasis);
      background: var(--bs-danger-bg-subtle);
      border: 1px solid var(--bs-danger-border-subtle);
    }

    // Doubled class: wins over .item--expanded so an open item stays red.
    .item.item--invalid {
      border-color: var(--bs-danger-border-subtle);
      box-shadow: inset 3px 0 0 var(--bs-danger);

      > .item_header {
        background: color-mix(in srgb, var(--bs-danger) 6%, transparent);
      }
    }

    .item--expanded {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--editor-border));
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    }

    .item.cdk-drag-preview {
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
    }

    .item.cdk-drag-placeholder {
      opacity: 0.35;
      border-style: dashed;
    }

    .item.cdk-drag-animating,
    .list_items.cdk-drop-list-dragging .item:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    .item_header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px 5px 4px;
      cursor: pointer;
      user-select: none;

      &:hover {
        background: var(--editor-hover-bg);
      }
    }

    .item--expanded > .item_header {
      background: color-mix(in srgb, var(--accent) 8%, transparent);
      border-bottom: 1px solid var(--editor-border);
    }

    .drag-handle {
      display: inline-flex;
      cursor: grab;
      padding: 2px 0;
      color: var(--bs-tertiary-color);
      touch-action: none;

      &:hover {
        color: var(--bs-body-color);
      }
    }

    .item_index {
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 5px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 600;
      color: #fff;
      background: var(--accent);
    }

    .item_name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .item_name--auto {
      font-style: italic;
      color: var(--bs-secondary-color);
    }

    .item_type {
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 999px;
      color: var(--bs-secondary-color);
      background: var(--editor-chip-bg);
      white-space: nowrap;
    }

    .toggle-button {
      display: inline-flex;
      align-items: center;
      --bs-btn-padding-y: 0.25rem;
      --bs-btn-padding-x: 0.35rem;
      --bs-btn-color: var(--accent);
      --bs-btn-border-color: transparent;
      --bs-btn-hover-color: var(--accent);
      --bs-btn-hover-bg: var(--editor-hover-bg);
      --bs-btn-hover-border-color: transparent;

      &.off {
        --bs-btn-color: var(--bs-tertiary-color);
      }

      .switch {
        width: 18px;
      }

      .knob {
        fill: currentColor;
        stroke: none;
      }
    }

    // Hidden shapes / disabled transforms and operations: dimmed so the
    // state shows at a glance.
    .item--off > .item_header {
      .item_index,
      .item_name,
      .item_type {
        opacity: 0.45;
      }

      .item_name {
        text-decoration: line-through;
      }
    }

    .remove-button {
      display: inline-flex;
      align-items: center;
      --bs-btn-padding-y: 0.25rem;
      --bs-btn-padding-x: 0.35rem;
      --bs-btn-color: var(--bs-tertiary-color);
      --bs-btn-border-color: transparent;
      --bs-btn-hover-color: var(--bs-danger);
      --bs-btn-hover-bg: var(--bs-danger-bg-subtle);
      --bs-btn-hover-border-color: transparent;
    }

    // props.inline: an item is one row of fields, always shown.
    .item--inline {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      padding: 3px 4px;
      overflow: visible;

      // As tall as the inputs, so they line up with the first line of
      // fields (an error message may show below).
      > .drag-handle,
      > .remove-button {
        height: 30px;
        padding-top: 0;
        padding-bottom: 0;
        align-items: center;
      }

      &.item--invalid {
        background: color-mix(
          in srgb,
          var(--bs-danger) 4%,
          var(--editor-card-bg)
        );
      }
    }

    .item_inline-fields {
      flex: 1;
      min-width: 0;
    }

    .list_description {
      font-size: 0.75rem;
      color: var(--bs-secondary-color);
      padding: 0 2px 6px;
    }

    .item_body {
      display: none;
      padding: 8px 10px 4px;

      &.visible {
        display: block;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div
      class="list"
      [class.list--root]="collapsible"
      [style.--accent]="props['accent']"
    >
      <div
        #header
        class="list_header"
        (click)="collapsible && toggleCollapsed()"
        [attr.role]="collapsible ? 'button' : null"
        [attr.aria-expanded]="collapsible ? !collapsed : null"
      >
        @if (collapsible) {
          <span class="chevron" [class.open]="!collapsed"
            ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5 10.5 8 6 12.5" /></svg
          ></span>
        }
        <span class="list_title">{{ props.label }}</span>
        <span class="list_count">{{ field.fieldGroup?.length ?? 0 }}</span>
        @if (invalidCount; as count) {
          <span
            class="issue-chip"
            [title]="
              count +
              ' ' +
              (count === 1 ? itemLabel : props.label) +
              ' need attention'
            "
            >⚠ {{ count }}<span class="button-label"> to fix</span></span
          >
        }
        <span class="list_spacer"></span>
        @for (action of headerActions; track action.label) {
          <button
            class="btn btn-sm add-button"
            type="button"
            (click)="$event.stopPropagation(); runAction(action)"
            [title]="action.title"
            [attr.aria-label]="action.title"
          >
            <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 2.5h3v11H3zM7 2.5h3v11H7zM11 3.2l2.6-.7 2.4 10.6-2.6.7z"
              />
            </svg>
            <span class="button-label">{{ action.label }}</span>
          </button>
        }
        <button
          class="btn btn-sm add-button"
          type="button"
          (click)="$event.stopPropagation(); addNewItem()"
          [disabled]="!isValid"
          [title]="
            isValid
              ? 'Add ' + itemLabel
              : 'Fix the invalid fields before adding'
          "
          [attr.aria-label]="'Add ' + itemLabel"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          <span class="button-label">Add {{ itemLabel }}</span>
        </button>
        <button
          class="btn btn-sm clear-button"
          type="button"
          (click)="$event.stopPropagation(); confirmClear()"
          [disabled]="!field.fieldGroup?.length"
          [title]="'Remove all ' + props.label"
          [attr.aria-label]="'Clear all ' + props.label"
        >
          <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
          <span class="button-label">Clear</span>
        </button>
      </div>

      <div
        class="list_items"
        [class.collapsed]="collapsible && collapsed"
        cdkDropList
        cdkDropListLockAxis="y"
        (cdkDropListDropped)="drop($event)"
      >
        @if (inline && props.description) {
          <div class="list_description">{{ props.description }}</div>
        }
        @for (field of field.fieldGroup; track $index) {
          @let problems = issues(field);
          @if (inline) {
            <div
              class="item item--inline"
              [class.item--invalid]="problems.length"
              cdkDrag
            >
              <span class="drag-handle" cdkDragHandle title="drag to reorder"
                ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  <g class="dots">
                    <circle cx="6" cy="4" r="1.2" />
                    <circle cx="10" cy="4" r="1.2" />
                    <circle cx="6" cy="8" r="1.2" />
                    <circle cx="10" cy="8" r="1.2" />
                    <circle cx="6" cy="12" r="1.2" />
                    <circle cx="10" cy="12" r="1.2" />
                  </g></svg
              ></span>
              <div class="item_inline-fields">
                <formly-field [field]="field"></formly-field>
              </div>
              <button
                class="btn btn-sm remove-button"
                type="button"
                [title]="'Remove ' + itemLabel"
                [attr.aria-label]="
                  'Remove ' + itemLabel + ' ' + itemName(field.model)
                "
                (click)="confirmRemove($index)"
              >
                <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4"
                  />
                </svg>
              </button>
            </div>
          } @else {
            <div
              class="item"
              [class.item--expanded]="field.model.expanded"
              [class.item--invalid]="problems.length"
              [class.item--off]="isOff(field.model)"
              cdkDrag
            >
              <div class="item_header" (click)="toggleExpanded($index)">
                <span
                  class="drag-handle"
                  cdkDragHandle
                  title="drag to reorder"
                  (click)="$event.stopPropagation()"
                  ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                    <g class="dots">
                      <circle cx="6" cy="4" r="1.2" />
                      <circle cx="10" cy="4" r="1.2" />
                      <circle cx="6" cy="8" r="1.2" />
                      <circle cx="10" cy="8" r="1.2" />
                      <circle cx="6" cy="12" r="1.2" />
                      <circle cx="10" cy="12" r="1.2" />
                    </g></svg
                ></span>
                <span class="chevron" [class.open]="field.model.expanded"
                  ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 3.5 10.5 8 6 12.5" /></svg
                ></span>
                <span class="item_index">{{ $index + 1 }}</span>
                <span
                  class="item_name"
                  [class.item_name--auto]="!field.model?.name && describeItem"
                  >{{ itemName(field.model) }}</span
                >
                @if (itemType(field.model); as type) {
                  <span class="item_type">{{ type }}</span>
                }
                @if (problems.length) {
                  <span
                    class="issue-chip"
                    role="img"
                    [attr.aria-label]="
                      'Needs attention: ' + problems.join(', ')
                    "
                    [title]="'Needs attention: ' + problems.join(', ')"
                    >⚠ {{ problems.length }}</span
                  >
                }
                @if (toggle; as t) {
                  <button
                    class="btn btn-sm toggle-button"
                    type="button"
                    [class.off]="isOff(field.model)"
                    [attr.aria-pressed]="!isOff(field.model)"
                    [title]="isOff(field.model) ? t.offTitle : t.onTitle"
                    [attr.aria-label]="
                      (isOff(field.model) ? t.offTitle : t.onTitle) +
                      ': ' +
                      itemName(field.model)
                    "
                    (click)="$event.stopPropagation(); toggleFlag($index)"
                  >
                    @if (t.icon === 'eye') {
                      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
                        />
                        <circle cx="8" cy="8" r="2" />
                        @if (isOff(field.model)) {
                          <path d="M2.5 13.5l11-11" />
                        }
                      </svg>
                    } @else {
                      <svg
                        class="icon switch"
                        viewBox="0 0 20 16"
                        aria-hidden="true"
                      >
                        <rect x="1.5" y="4" width="17" height="8" rx="4" />
                        <circle
                          class="knob"
                          [attr.cx]="isOff(field.model) ? 5.5 : 14.5"
                          cy="8"
                          r="2.6"
                        />
                      </svg>
                    }
                  </button>
                }
                @if (field.props?.['removable'] !== false) {
                  <button
                    class="btn btn-sm remove-button"
                    type="button"
                    [title]="'Remove ' + itemLabel"
                    [attr.aria-label]="
                      'Remove ' + itemLabel + ' ' + itemName(field.model)
                    "
                    (click)="$event.stopPropagation(); confirmRemove($index)"
                  >
                    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.7 7v4M9.3 7v4"
                      />
                    </svg>
                  </button>
                }
              </div>

              <div class="item_body" [class.visible]="field.model.expanded">
                <formly-field [field]="field"></formly-field>
              </div>
            </div>
          }
        } @empty {
          <div class="list_empty">
            No {{ props.label }} yet — use “Add {{ itemLabel }}” above.
          </div>
        }
      </div>
    </div>
  `,
})
export class ArrayTypeComponent
  extends FieldArrayType
  implements OnInit, AfterViewInit, OnDestroy
{
  private modals = inject(NgbModal);
  private injector = inject(Injector);
  collapsed = false;

  @ViewChild('header', { static: true })
  private header!: ElementRef<HTMLElement>;
  private headerObservers: Array<ResizeObserver | MutationObserver> = [];

  get itemLabel(): string {
    return this.props['itemLabel'] ?? 'item';
  }

  get headerActions(): HeaderAction[] {
    return this.props['headerActions'] ?? [];
  }

  runAction(action: HeaderAction) {
    action.run({
      injector: this.injector,
      field: this.field,
      items: this.model ?? [],
      add: async (item) => {
        this.collapsed = this.collapsible ? false : this.collapsed;
        const id = await generateId();
        this.add(undefined, { ...item, id, expanded: false });
      },
    });
  }

  get collapsible() {
    return this.props['collapsible'] === true;
  }

  /** `props.inline`: items are edited in place, one row each (variables). */
  get inline() {
    return this.props['inline'] === true;
  }

  get isValid() {
    return this.field.fieldGroup?.every((v) => v.formControl?.valid);
  }

  get invalidCount(): number {
    return (this.field.fieldGroup ?? []).filter((f) => f.formControl?.invalid)
      .length;
  }

  /**
   * Labels of the visible fields in an item that need fixing. A nested list
   * with problems is reported by its own label ("transforms").
   */
  issues(item: FormlyFieldConfig): string[] {
    const found: string[] = [];
    const walk = (field: FormlyFieldConfig) => {
      if (field.hide) {
        return;
      }
      if (field !== item && field.type === 'repeat') {
        if (field.formControl?.invalid) {
          found.push(String(field.props?.label ?? field.key));
        }
        return;
      }
      if (field.fieldGroup?.length) {
        field.fieldGroup.forEach(walk);
      } else if (field.formControl?.invalid && field.props?.label) {
        found.push(field.props.label);
      }
    };
    walk(item);
    return found;
  }

  ngAfterViewInit() {
    // Refit when the header is resized or its contents change (the item
    // count or the "to fix" chip).
    const header = this.header.nativeElement;
    const fit = () => this.fitHeader();
    const resize = new ResizeObserver(fit);
    resize.observe(header);
    const mutation = new MutationObserver(fit);
    mutation.observe(header, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.headerObservers = [resize, mutation];
    fit();
  }

  ngOnDestroy() {
    this.headerObservers.forEach((o) => o.disconnect());
  }

  /**
   * Use the least compact header layout in which the title still fits:
   * full labels, then no "Clear" label, then icon-only buttons.
   */
  private fitHeader() {
    const header = this.header.nativeElement;
    const title = header.querySelector<HTMLElement>('.list_title');
    for (const level of ['0', '1', '2']) {
      header.dataset['compact'] = level;
      if (!title || title.scrollWidth <= title.clientWidth) {
        break;
      }
    }
  }

  ngOnInit() {
    if (this.collapsible) {
      this.collapsed = readCollapsedSections().includes(this.storageKey);
    }
  }

  /**
   * Optional `props.describeItem(model, field)` names items that have no name;
   * `field` is this list's field, for looking up the rest of the model.
   */
  get describeItem():
    ((model: any, field: FormlyFieldConfig) => string) | undefined {
    return this.props['describeItem'];
  }

  itemName(model: any): string {
    return (
      model?.name ||
      this.describeItem?.(resolvedItem(this.field, model, true), this.field) ||
      model?.type ||
      'unnamed'
    );
  }

  itemType(model: any): string | null {
    const type = model?.type ?? model?.bitType;
    // Unnamed items already show their type (or a description) as the name.
    if (!model?.name && this.describeItem) {
      return null;
    }
    return type && type !== this.itemName(model) ? type : null;
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    const others = readCollapsedSections().filter((k) => k !== this.storageKey);
    writeCollapsedSections(
      this.collapsed ? [...others, this.storageKey] : others,
    );
  }

  async addNewItem() {
    this.collapseAllItems();
    this.collapsed = this.collapsible ? false : this.collapsed;
    const id = await generateId();
    this.add(undefined, this.inline ? { id } : { id, expanded: true });
  }

  /** Ask before removing, mentioning anything that refers to the item. */
  async confirmRemove(index: number) {
    const model = this.field.fieldGroup?.[index]?.model;
    const ref = this.modals.open(ConfirmDialogComponent, {
      size: 'sm',
      centered: true,
      ariaLabelledBy: 'confirm-title',
    });
    Object.assign(ref.componentInstance, {
      title: `Delete ${this.itemLabel}?`,
      message: `“${this.itemName(model)}” will be removed.`,
      details: this.usages([model?.id]),
      confirmLabel: `Delete ${this.itemLabel}`,
    });

    const confirmed = await ref.result.catch(() => false);
    if (!confirmed) {
      return;
    }
    // Find it again: the list may have changed while the dialog was open.
    const current = (this.model ?? []).findIndex(
      (item: any) => item === model || (model?.id && item?.id === model.id),
    );
    if (current !== -1) {
      this.remove(current);
    }
  }

  /**
   * What refers to any of `ids` elsewhere in the model, e.g. "2 operations
   * use it". References are fields named like `toolId`, `shapeId`, ….
   * Items being removed themselves don't count.
   */
  private usages(ids: string[], pronoun = 'it'): string[] {
    const removed = new Set(ids.filter(Boolean));
    if (!removed.size) {
      return [];
    }
    const root = rootModel(this.field) ?? {};
    const sections: Array<[string, string, string]> = [
      ['shapes', 'shape', 'shapes'],
      ['tools', 'tool', 'tools'],
      ['operations', 'operation', 'operations'],
    ];
    return sections.flatMap(([key, singular, plural]) => {
      const count = (root[key] ?? []).filter(
        (item: any) =>
          !removed.has(item?.id) &&
          Object.entries(item ?? {}).some(
            ([field, value]) =>
              field.endsWith('Id') && removed.has(value as string),
          ),
      ).length;
      return count
        ? [
            `${count} ${count === 1 ? singular : plural} ${
              count === 1 ? 'uses' : 'use'
            } ${pronoun} and will need updating`,
          ]
        : [];
    });
  }

  /** Ask, then remove every item in this list. */
  async confirmClear() {
    const items: any[] = this.model ?? [];
    if (!items.length) {
      return;
    }
    const noun = items.length === 1 ? this.itemLabel : this.props.label;
    const ref = this.modals.open(ConfirmDialogComponent, {
      size: 'sm',
      centered: true,
      ariaLabelledBy: 'confirm-title',
    });
    Object.assign(ref.componentInstance, {
      title: `Clear all ${this.props.label}?`,
      message:
        items.length === 1
          ? `“${this.itemName(items[0])}” will be removed.`
          : `All ${items.length} ${noun} will be removed.`,
      details: this.usages(
        items.map((item) => item?.id),
        items.length === 1 ? 'it' : 'them',
      ),
      confirmLabel: 'Clear all',
    });

    if (!(await ref.result.catch(() => false))) {
      return;
    }
    for (let i = (this.model?.length ?? 0) - 1; i >= 0; i--) {
      this.remove(i, { markAsDirty: false });
    }
    this.formControl.markAsDirty();
  }

  drop({ previousIndex, currentIndex }: CdkDragDrop<unknown>) {
    if (previousIndex === currentIndex) {
      return;
    }

    // Formly has no "move": rebuild the item at its new position from a copy
    // of its model. Ids are preserved, so downstream pipelines keyed by id
    // are reused rather than recomputed.
    const item = structuredClone(this.model[previousIndex]);
    this.remove(previousIndex, { markAsDirty: false });
    this.add(currentIndex, item);
  }

  /**
   * Optional `props.toggle`: a per-item on/off flag shown as a button in the
   * header (hide a shape in the preview, disable a transform or an
   * operation). The flag is true when the item is "off".
   */
  get toggle():
    | { key: string; icon: 'eye' | 'switch'; onTitle: string; offTitle: string }
    | undefined {
    return this.props['toggle'];
  }

  isOff(model: any): boolean {
    const key = this.toggle?.key;
    return !!key && !!model?.[key];
  }

  toggleFlag(index: number) {
    const key = this.toggle?.key;
    const control = key && this.formControl.controls[index]?.get(key);
    if (control) {
      control.setValue(!control.value);
    }
  }

  toggleExpanded(index: number) {
    this.collapseAllItems(index);
    const expandedControl = this.formControl.controls[index]?.get('expanded')!;
    expandedControl?.setValue(!expandedControl.value);
  }

  private get storageKey() {
    return String(this.field.key);
  }

  private collapseAllItems(except?: number) {
    for (let i = 0; i < this.formControl.controls.length; i++) {
      if (i === except) continue;
      this.formControl.controls[i].get('expanded')?.setValue(false);
    }
  }
}
