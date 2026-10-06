import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Highlight } from '../cam/types';
import { ViewerComponent } from './viewer/viewer.component';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
import { EditorDividerComponent } from './editor-divider/editor-divider.component';
import { loadEditorWidth } from './editor-divider/editor-width';
import { ModelStore } from './services/model-store.service';
import { CamService } from './services/cam.service';
import { WorkTracker } from './services/work-tracker.service';
import { ConfirmDialogComponent } from './model-editor/components/confirm-dialog.component';
import { Template } from './templates';

@Component({
  selector: 'app-root',
  imports: [
    ViewerComponent,
    AsyncPipe,
    ModelEditorComponent,
    ToolbarComponent,
    EditorDividerComponent,
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly NO_HIGHLIGHT: Highlight = { shapes: [], operations: [] };

  readonly store = inject(ModelStore);
  readonly cam = inject(CamService);
  readonly isWorking$ = inject(WorkTracker).isWorking$;

  readonly editorWidth = signal(loadEditorWidth());
  readonly resizing = signal(false);

  private readonly modals = inject(NgbModal);
  private readonly viewer = viewChild.required(ViewerComponent);

  /** Opens a template, asking first unless the current project is empty. */
  async openTemplate(template: Template) {
    const { variables, shapes, tools, operations } = this.store.value;
    if ([variables, shapes, tools, operations].some((list) => list?.length)) {
      const ref = this.modals.open(ConfirmDialogComponent, {
        size: 'sm',
        centered: true,
        ariaLabelledBy: 'confirm-title',
      });
      Object.assign(ref.componentInstance, {
        title: `Open “${template.name}”?`,
        message:
          'It replaces the current project. To keep that, download its G-code first: the project is embedded in it.',
        confirmLabel: 'Replace project',
      });
      const confirmed = await ref.result.catch(() => false);
      if (!confirmed) return;
    }
    await this.store.openTemplate(template);
    this.viewer().refit();
  }
}
