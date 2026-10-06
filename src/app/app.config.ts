import {
  ApplicationConfig,
  importProvidersFrom,
  provideAppInitializer,
  provideZonelessChangeDetection,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  AbstractControl,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { GroupWrapperComponent } from './model-editor/components/group-wrapper-component';
import { ArrayTypeComponent } from './model-editor/components/array-type-component';
import { FileTypeComponent } from './model-editor/components/file-type-component';
import { HiddenTypeComponent } from './model-editor/components/hidden-type-component';
import { FontTypeComponent } from './model-editor/components/font-type-component';
import { SectionTypeComponent } from './model-editor/components/section-type-component';
import {
  NumberTypeComponent,
  numberExpressionExtension,
} from './model-editor/components/number-type-component';
import { evaluateField } from './model-editor/variables/field';
import { preloadModel } from './services/model-persistence';

export function WholeNumberValidator(
  _: AbstractControl,
  field: FormlyFieldConfig,
): ValidationErrors | null {
  // The value an expression works out to (it reports its own errors).
  const result = evaluateField(field);
  if (!result || !('value' in result)) {
    return null;
  }
  if (!result.value || result.value === Math.round(result.value)) {
    return null;
  }

  return { 'whole-number': true };
}

export const appConfig: ApplicationConfig = {
  providers: [
    //provideZoneChangeDetection({ eventCoalescing: true }),
    provideZonelessChangeDetection(),
    // The saved project is read (asynchronously) before anything uses it.
    provideAppInitializer(preloadModel),
    provideRouter(routes),
    provideAnimationsAsync(),
    importProvidersFrom(ReactiveFormsModule),
    importProvidersFrom(
      FormlyModule.forRoot({
        types: [
          { name: 'repeat', component: ArrayTypeComponent },
          {
            name: 'file',
            component: FileTypeComponent,
            wrappers: ['form-field'],
          },
          { name: 'hidden', component: HiddenTypeComponent },
          { name: 'section', component: SectionTypeComponent },
          {
            name: 'font',
            component: FontTypeComponent,
            wrappers: ['form-field'],
          },
        ],
        wrappers: [{ name: 'group', component: GroupWrapperComponent }],
        extensions: [
          { name: 'number-expression', extension: numberExpressionExtension },
        ],
        validators: [
          { name: 'whole-number', validation: WholeNumberValidator },
        ],
        validationMessages: [
          { name: 'whole-number', message: 'Must be a whole number' },
          { name: 'required', message: 'Required' },
          {
            name: 'expression',
            message: (error: { message: string }) => error.message,
          },
          {
            name: 'min',
            message: (error: { min: number; actual: number }) =>
              `Must be at least ${error.min}${
                error.actual !== undefined
                  ? ` (it is ${round(error.actual)})`
                  : ''
              }`,
          },
          {
            name: 'max',
            message: (error: { max: number; actual: number }) =>
              `Must be at most ${error.max}${
                error.actual !== undefined
                  ? ` (it is ${round(error.actual)})`
                  : ''
              }`,
          },
        ],
        extras: {
          // Show problems right away (not only after a field is touched), so
          // e.g. an operation whose tool was deleted is flagged on load.
          showError: (field) => !!field.formControl?.invalid,
        },
      }),
    ),
    importProvidersFrom(FormlyBootstrapModule),
    // After the Bootstrap types: replaces their `number` input with one
    // that also takes expressions.
    importProvidersFrom(
      FormlyModule.forChild({
        types: [
          {
            name: 'number',
            component: NumberTypeComponent,
            wrappers: ['form-field'],
            extends: undefined,
            defaultOptions: {},
          },
        ],
      }),
    ),
  ],
};

function round(value: number) {
  return Math.round(value * 1e4) / 1e4;
}
