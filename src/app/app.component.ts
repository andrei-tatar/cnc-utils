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
    if (
      !(await this.confirmReplace(
        `Open “${template.name}”?`,
        'It replaces the current project.',
        'Replace project',
      ))
    ) {
      return;
    }
    await this.store.openTemplate(template);
    this.viewer().refit();
  }

  /** Starts an empty project, asking first unless the current one is empty. */
  async clearProject() {
    if (
      !(await this.confirmReplace(
        'Clear the project?',
        'Everything in the current project is removed, G-code settings included (the tool library is kept).',
        'Clear project',
      ))
    ) {
      return;
    }
    this.store.clear();
    this.viewer().refit();
  }

  /**
   * Whether the current project may be replaced: yes when it's empty,
   * otherwise when the user confirms.
   */
  private async confirmReplace(
    title: string,
    message: string,
    confirmLabel: string,
  ): Promise<boolean> {
    const { variables, shapes, tools, operations } = this.store.value;
    if (![variables, shapes, tools, operations].some((list) => list?.length)) {
      return true;
    }
    const ref = this.modals.open(ConfirmDialogComponent, {
      size: 'sm',
      centered: true,
      ariaLabelledBy: 'confirm-title',
    });
    Object.assign(ref.componentInstance, {
      title,
      message: `${message} To keep it, download its G-code first: the project is embedded in it.`,
      confirmLabel,
    });
    return ref.result.catch(() => false);
  }
}
