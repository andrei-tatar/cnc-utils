import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { FieldType } from '@ngx-formly/bootstrap/form-field';

@Component({
  imports: [FormlyModule, CommonModule, NgbCollapseModule],
  standalone: true,
  styles: ``,
  template: ``,
})
export class HiddnTypeComponent extends FieldType {}
