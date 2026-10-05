import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { debounceTime, Subject, takeUntil } from 'rxjs';
import { ModelType, ModelFieldConfig } from './model';
import { resolveGcodeOptions } from '../../cam/gcode-options';

@Component({
  selector: 'app-model-editor',
  standalone: true,
  imports: [FormlyModule, CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
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
  fields: FormlyFieldConfig[] = ModelFieldConfig;

  @Input()
  model: ModelType = {
    shapes: [],
    tools: [],
    operations: [],
    gcode: resolveGcodeOptions(undefined),
  };

  @Output()
  modelChange = new EventEmitter<ModelType>(true);

  ngOnInit() {
    this.form.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => revalidate(this.form));

    this.form.valueChanges
      .pipe(debounceTime(100), takeUntil(this.destroy$))
      .subscribe((v) => this.modelChange.next(v as ModelType));
  }

  ngOnDestroy() {
    this.destroy$.next(1);
  }
}

/**
 * Re-run every validator, bottom-up, without emitting events. Validators that
 * look at other parts of the model (does this operation's tool still exist?)
 * don't re-run on their own when only that other part changes.
 */
function revalidate(control: AbstractControl) {
  if (control instanceof FormGroup || control instanceof FormArray) {
    Object.values(control.controls).forEach(revalidate);
  }
  control.updateValueAndValidity({ onlySelf: true, emitEvent: false });
}
