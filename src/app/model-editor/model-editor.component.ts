import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { debounceTime, Subject, takeUntil } from 'rxjs';
import { emptyModel, ModelType, ModelFieldConfig } from './model';

@Component({
  selector: 'app-model-editor',
  imports: [FormlyModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
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
  model: ModelType = emptyModel();

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
 * Re-run every validator, bottom-up, without emitting value events.
 * Validators that look at other parts of the model (does this operation's
 * tool still exist? what is this variable now?) don't re-run on their own
 * when only that other part changes.
 */
function revalidate(control: AbstractControl) {
  if (control instanceof FormGroup || control instanceof FormArray) {
    Object.values(control.controls).forEach(revalidate);
  }
  const before = control.errors;
  control.updateValueAndValidity({ onlySelf: true, emitEvent: false });
  // Error messages only update on a status event: send one when the
  // problem changed (e.g. a variable it uses now has an error).
  if (
    (before || control.errors) &&
    JSON.stringify(before) !== JSON.stringify(control.errors)
  ) {
    (control.statusChanges as EventEmitter<unknown>).emit(control.status);
  }
}
