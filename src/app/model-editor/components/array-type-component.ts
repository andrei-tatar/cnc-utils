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
      position: relative;

      &:before {
        content: ' ';
        top: 5px;
        bottom: 5px;
        left: 0;
        width: 2px;
        position: absolute;
        background-color: green;
      }
    }

    .fields_item {
      display: flex;
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

    <div class="fields ps-2">
      @for (field of field.fieldGroup; track $index) {
        <div class="fields_item">
          <formly-field [field]="field"></formly-field>
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
      }
    </div>
  `,
})
export class ArrayTypeComponent extends FieldArrayType {
  get isValid() {
    return this.field.fieldGroup?.every((v) => v.formControl?.valid);
  }

  async addNewItem() {
    const id = await generateId();
    this.add(undefined, { id });
  }
}
