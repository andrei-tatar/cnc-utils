import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FieldArrayType, FormlyModule } from '@ngx-formly/core';
import { generateId } from '../../../util';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';

@Component({
  imports: [FormlyModule, CommonModule, NgbCollapseModule],
  standalone: true,
  styles: `
    .header {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }

    .fields {
    }

    .field_item-expansion {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      cursor: pointer;
    }

    .fields_item {
      position: relative;
      display: none;
      &.visible {
        display: flex;
      }

      &:before {
        content: ' ';
        top: 5px;
        bottom: 5px;
        left: 0;
        width: 2px;
        position: absolute;
        background-color: green;
      }

      flex-direction: row;

      // align-items: center;

      formly-field {
        flex: 1;
      }

      button {
        align-self: start;
      }

      &:not(:last-child) {
        border-bottom: 1px solid lightgray;
        margin-bottom: 5px;
      }
    }
  `,
  template: `
    <div class="header">
      <div class="header_text">
        @if (props.label) {
          <label>{{ props.label }}</label>
        }
      </div>
      <button
        class="btn btn-sm btn-primary"
        type="button"
        (click)="addNewItem()"
        [disabled]="!isValid"
      >
        +
      </button>
    </div>

    <div class="fields">
      @for (field of field.fieldGroup; track $index) {
        <div class="field_item-expansion" (click)="toggleExpanded($index)">
          {{ (field.model.name ?? field.model.type) || 'unknown' }}

          @if (field.props?.['removable'] !== false) {
            <button
              class="btn btn-sm btn-outline-danger ms-1 mt-1"
              type="button"
              (click)="remove($index)"
            >
              -
            </button>
          }
        </div>

        <div class="fields_item ps-2" [class.visible]="field.model.expanded">
          <formly-field [field]="field"></formly-field>
        </div>
      }
    </div>
  `,
})
export class ArrayTypeComponent extends FieldArrayType {
  get isValid() {
    return this.field.fieldGroup?.every((v) => v.formControl?.valid);
  }

  async addNewItem() {
    this.collapseAllItems();
    const id = await generateId();
    this.add(undefined, { id, expanded: true });
  }

  toggleExpanded(index: number) {
    this.collapseAllItems(index);
    const expandedControl = this.formControl.controls[index]?.get('expanded')!;
    expandedControl?.setValue(!expandedControl.value);
  }

  private collapseAllItems(except?: number) {
    for (let i = 0; i < this.formControl.controls.length; i++) {
      if (i === except) continue;
      this.formControl.controls[i].get('expanded')?.setValue(false);
    }
  }
}
