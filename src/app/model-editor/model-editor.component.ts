import {
  Component,
  EventEmitter,
  inject,
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
import {
  FormlyFieldConfig,
  FormlyFormOptions,
  FormlyModule,
} from '@ngx-formly/core';
import { debounceTime, filter, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { emptyModel, ModelType, ModelFieldConfig } from './model';
import { CamService } from '../services/cam.service';
import { ModelStore } from '../services/model-store.service';
import { EditorState } from './editor-state';

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
        [options]="options"
      ></formly-form>
    </form>
  `,
})
export class ModelEditorComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<any>();

  form = new FormGroup({});
  fields: FormlyFieldConfig[] = ModelFieldConfig;
  private readonly cam = inject(CamService);
  private readonly store = inject(ModelStore);
  readonly options: FormlyFormOptions = {
    formState: {
      fitStock: async () => {
        const fit = await this.cam.stockToFit();
        if (!fit) return;
        // Through the store: the form hands it the stock turned on a moment
        // later, and the form then follows the store. Wait for that (unless
        // it's turned off again first), or it'd put the old size back.
        await firstValueFrom(
          this.store.model$.pipe(
            filter(
              (m) =>
                !!m.stock?.enabled ||
                !(this.form.value as Partial<ModelType>).stock?.enabled,
            ),
          ),
        );
        // Not from inside the store's own emission.
        await new Promise((resolve) => setTimeout(resolve));
        const model = this.store.value;
        if (model.stock?.enabled) {
          this.store.set({ ...model, stock: { ...model.stock, ...fit } });
        }
      },
    } satisfies EditorState,
  };

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
