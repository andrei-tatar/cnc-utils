import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FieldWrapper, FormlyFieldConfig } from '@ngx-formly/core';

/**
 * A box around related settings: `props.label`, an optional
 * `props.description`, and with `props.collapsible` a header that opens and
 * closes it (open at first when `props.startOpen(model)` says so; flagged
 * when closed over a setting that needs fixing).
 */
@Component({
  styles: `
    :host {
      display: block;
    }

    .group {
      border: 1px solid var(--editor-border);
      border-radius: 8px;
      margin: 0 0 12px;
      padding: 0 10px;
    }

    .group_header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 6px 0;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--bs-secondary-color);

      &.toggle {
        cursor: pointer;
        user-select: none;
      }
    }

    .group_description {
      font-weight: 400;
      text-transform: none;
      letter-spacing: normal;
    }

    .issue {
      color: var(--bs-danger-text-emphasis);
      text-transform: none;
      letter-spacing: normal;
    }

    .chevron {
      display: inline-block;
      transition: transform 150ms ease;

      &.open {
        transform: rotate(90deg);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="group">
      <div
        class="group_header"
        [class.toggle]="props['collapsible']"
        [attr.role]="props['collapsible'] ? 'button' : null"
        [attr.aria-expanded]="props['collapsible'] ? open : null"
        (click)="toggle()"
      >
        @if (props['collapsible']) {
          <span class="chevron" [class.open]="open">›</span>
        }
        <span>{{ props.label }}</span>
        @if (props.description) {
          <span class="group_description">· {{ props.description }}</span>
        }
        @if (!open && invalid(field)) {
          <span class="issue" title="Some settings need attention">⚠</span>
        }
      </div>
      <div [hidden]="!open">
        <ng-container #fieldComponent></ng-container>
      </div>
    </div>
  `,
})
export class GroupWrapperComponent extends FieldWrapper implements OnInit {
  open = true;

  ngOnInit() {
    if (this.props['collapsible']) {
      this.open = !!this.props['startOpen']?.(this.field.model);
    }
  }

  /** Whether a shown field in `field` (keyed or not) needs fixing. */
  invalid(field: FormlyFieldConfig): boolean {
    return !!field.fieldGroup?.some(
      (child) =>
        !child.hide &&
        (child.key != null
          ? !!child.formControl?.invalid
          : this.invalid(child)),
    );
  }

  toggle() {
    if (this.props['collapsible']) {
      this.open = !this.open;
    }
  }
}
