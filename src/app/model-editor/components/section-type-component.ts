import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FieldType, FormlyModule } from '@ngx-formly/core';
import {
  readCollapsedSections,
  writeCollapsedSections,
} from './collapsed-sections';

/**
 * A collapsible card for a group of settings (not a list), styled like the
 * root list sections: `props.label`, `props.accent`.
 */
@Component({
  standalone: true,
  imports: [CommonModule, FormlyModule],
  styles: `
    :host {
      display: block;
    }

    .section {
      --accent: var(--bs-secondary);
      border-radius: 10px;
      background: var(--editor-section-bg);
      border: 1px solid var(--editor-border);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      margin: 0 0 12px;
      overflow: hidden;
    }

    .section_header {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      padding: 8px 10px 8px 12px;
      border-top: 3px solid var(--accent);
      cursor: pointer;
      user-select: none;

      &:hover {
        background: var(--editor-hover-bg);
      }
    }

    .chevron {
      display: inline-flex;
      color: var(--bs-secondary-color);
      transition: transform 150ms ease;

      &.open {
        transform: rotate(90deg);
      }
    }

    .icon {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .section_title {
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
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

    .section_body {
      padding: 10px 12px 4px;
      border-top: 1px solid var(--editor-border);
      background: var(--editor-card-bg);

      &.collapsed {
        display: none;
      }
    }
  `,
  template: `
    <div class="section" [style.--accent]="props['accent']">
      <div
        class="section_header"
        role="button"
        [attr.aria-expanded]="!collapsed"
        (click)="toggle()"
      >
        <span class="chevron" [class.open]="!collapsed"
          ><svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" /></svg
        ></span>
        <span class="section_title">{{ props.label }}</span>
        @if (formControl.invalid) {
          <span class="issue-chip" title="Some settings need attention"
            >⚠ to fix</span
          >
        }
      </div>
      <div class="section_body" [class.collapsed]="collapsed">
        @for (child of field.fieldGroup; track $index) {
          <formly-field [field]="child"></formly-field>
        }
      </div>
    </div>
  `,
})
export class SectionTypeComponent extends FieldType implements OnInit {
  collapsed = false;

  ngOnInit() {
    this.collapsed = readCollapsedSections().includes(this.storageKey);
  }

  toggle() {
    this.collapsed = !this.collapsed;
    const others = readCollapsedSections().filter((k) => k !== this.storageKey);
    writeCollapsedSections(
      this.collapsed ? [...others, this.storageKey] : others,
    );
  }

  private get storageKey() {
    return String(this.field.key);
  }
}
