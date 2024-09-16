import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ModelType, field as shapesField } from './shapes';
import { debounceTime, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-model-editor',
  standalone: true,
  imports: [FormlyModule, CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" class="p-2">
      <formly-form
        [form]="form"
        [fields]="fields"
        [model]="model"
      ></formly-form>
    </form>
  `,
})
export class ModelEditorComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<any>();

  form = new FormGroup({});
  fields: FormlyFieldConfig[] = [shapesField];

  @Input()
  model: ModelType = {
    shapes: [],
  };

  @Output()
  modelChange = new EventEmitter<ModelType>(true);

  ngOnInit() {
    this.form.valueChanges
      .pipe(debounceTime(100), takeUntil(this.destroy$))
      .subscribe((v) => {
        this.modelChange.next(v as ModelType);
      });
  }

  ngOnDestroy() {
    this.destroy$.next(1);
  }
}
