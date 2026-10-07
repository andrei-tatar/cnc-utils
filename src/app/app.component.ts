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
  readonly projects = inject(ProjectCommands);
  readonly cam = inject(CamService);
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
}
