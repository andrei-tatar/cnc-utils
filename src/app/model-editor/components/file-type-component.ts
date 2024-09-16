import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormlyModule } from '@ngx-formly/core';
import { NgbCollapseModule } from '@ng-bootstrap/ng-bootstrap';
import { FieldType } from '@ngx-formly/bootstrap/form-field';
import { readFile } from '../../../util';
import { switchMap } from 'rxjs';

@Component({
  imports: [FormlyModule, CommonModule, NgbCollapseModule],
  standalone: true,
  styles: ``,
  template: `
    <button class="btn btn-primary" (click)="select($event)">Open</button>
  `,
})
export class FileTypeComponent extends FieldType {
  select(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    readFile()
      .pipe(
        switchMap(async (file) => {
          const content = await file.text();
          return { name: file.name, content };
        }),
      )
      .subscribe({
        next: ({ name, content }) => {
          this.form.get('svg')?.setValue(content);
          this.form.get('name')?.setValue(name);
        },
      });
  }
}
