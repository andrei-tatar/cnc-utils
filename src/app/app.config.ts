import {
  ApplicationConfig,
  importProvidersFrom,
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

export function WholeNumberValidator(
  control: AbstractControl,
): ValidationErrors | null {
  if (!control.value || +control.value === Math.round(+control.value)) {
    return null;
  }

  return { 'whole-number': true };
}

export const appConfig: ApplicationConfig = {
  providers: [
    //provideZoneChangeDetection({ eventCoalescing: true }),
    provideZonelessChangeDetection(),
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
        validators: [
          { name: 'whole-number', validation: WholeNumberValidator },
        ],
        validationMessages: [
          { name: 'whole-number', message: 'Must be a whole number' },
          { name: 'required', message: 'Required' },
          {
            name: 'min',
            message: (_: unknown, field: FormlyFieldConfig) =>
              `Must be at least ${field.props?.min}`,
          },
          {
            name: 'max',
            message: (_: unknown, field: FormlyFieldConfig) =>
              `Must be at most ${field.props?.max}`,
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
  ],
};
