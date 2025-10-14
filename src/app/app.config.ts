import {
  ApplicationConfig,
  importProvidersFrom,
  provideExperimentalZonelessChangeDetection,
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
import { FormlyModule } from '@ngx-formly/core';
import { FormlyBootstrapModule } from '@ngx-formly/bootstrap';
import { ArrayTypeComponent } from './model-editor/components/array-type-component';
import { FileTypeComponent } from './model-editor/components/file-type-component';
import { HiddenTypeComponent } from './model-editor/components/hidden-type-component';

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
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes),
    provideAnimationsAsync(),
    importProvidersFrom(ReactiveFormsModule),
    importProvidersFrom(
      FormlyModule.forRoot({
        types: [
          { name: 'repeat', component: ArrayTypeComponent },
          { name: 'file', component: FileTypeComponent },
          { name: 'hidden', component: HiddenTypeComponent },
        ],
        validators: [
          { name: 'whole-number', validation: WholeNumberValidator },
        ],
        validationMessages: [
          { name: 'whole-number', message: 'Must be a whole number' },
        ],
      }),
    ),
    importProvidersFrom(FormlyBootstrapModule),
  ],
};
