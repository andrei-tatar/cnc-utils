import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { FieldType } from '@ngx-formly/bootstrap/form-field';

@Component({
  imports: [FormlyModule, NgbCollapseModule],
  styles: ``,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: ``,
})
export class HiddenTypeComponent extends FieldType {}
