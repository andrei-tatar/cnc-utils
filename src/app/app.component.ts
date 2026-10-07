import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Highlight } from '../cam/types';
import { ViewerComponent } from './viewer/viewer.component';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import { ToolbarComponent } from './toolbar/toolbar.component';
import { EditorDividerComponent } from './editor-divider/editor-divider.component';
import { loadEditorWidth } from './editor-divider/editor-width';
import { ModelStore } from './services/model-store.service';
import { CamService } from './services/cam.service';
import { WorkTracker } from './services/work-tracker.service';
import { ProjectCommands } from './projects/project-commands.service';
import { ModelHistory } from './services/model-history.service';

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
  host: { '(document:keydown)': 'onKeydown($event)' },
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly NO_HIGHLIGHT: Highlight = { shapes: [], operations: [] };

  readonly store = inject(ModelStore);
  readonly projects = inject(ProjectCommands);
  readonly cam = inject(CamService);
  readonly history = inject(ModelHistory);
  readonly isWorking$ = inject(WorkTracker).isWorking$;

  readonly editorWidth = signal(loadEditorWidth());
  readonly resizing = signal(false);

  private readonly viewer = viewChild.required(ViewerComponent);

  constructor() {
    // Show a project that was just opened from the top, framed (its shapes
    // are still coming).
    this.store.replaced$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.viewer().refit());
  }

  /**
   * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo the project, except in a
   * text field, where they undo the typing as usual.
   */
  onKeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (isTextEntry(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      this.history.undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      this.history.redo();
    } else {
      return;
    }
    event.preventDefault();
  }
}

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    ![
      'checkbox',
      'radio',
      'button',
      'submit',
      'range',
      'color',
      'file',
    ].includes(target.type)
  );
}
