import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { Highlight } from '../cam/types';
import { ViewerComponent } from './viewer/viewer.component';
import { ModelEditorComponent } from './model-editor/model-editor.component';
import { JobAction, ToolbarComponent } from './toolbar/toolbar.component';
import { EditorDividerComponent } from './editor-divider/editor-divider.component';
import { ErrorToastComponent } from './error-toast/error-toast.component';
import { UpdateNoticeComponent } from './update-notice/update-notice.component';
import { loadEditorWidth } from './editor-divider/editor-width';
import { ModelStore } from './services/model-store.service';
import { CamService } from './services/cam.service';
import { WorkTracker } from './services/work-tracker.service';
import { ProjectCommands } from './projects/project-commands.service';
import { Cncjs } from './cncjs/cncjs.service';
import { ModelHistory } from './services/model-history.service';
import {
  EditHandle,
  movePoint,
  moveShape,
  selectShape,
} from './model-editor/shape-editing';
import {
  readCollapsedSections,
  writeCollapsedSections,
} from './model-editor/components/collapsed-sections';
import { CamPoint } from '../cam/types';
import { generateId } from '../util';
import { WebMcp } from './webmcp/webmcp.service';
import { droppedFileKind, isSvg, readAsDataUrl } from './project-file';
import { ModelType } from './model-editor/model';
import { reportError } from './pipeline/errors';
import { parseModelFile } from '../cam/threemf';

@Component({
  selector: 'app-root',
  imports: [
    ViewerComponent,
    AsyncPipe,
    ModelEditorComponent,
    ToolbarComponent,
    EditorDividerComponent,
    ErrorToastComponent,
    UpdateNoticeComponent,
  ],
  templateUrl: './app.component.html',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '(document:dragover)': 'onDragOver($event)',
    '(document:dragleave)': 'onDragLeave($event)',
    '(document:drop)': 'onDrop($event)',
  },
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  readonly NO_HIGHLIGHT: Highlight = { shapes: [], operations: [] };

  readonly store = inject(ModelStore);
  readonly projects = inject(ProjectCommands);
  readonly cam = inject(CamService);
  readonly cncjs = inject(Cncjs);
  readonly history = inject(ModelHistory);
  readonly isWorking$ = inject(WorkTracker).isWorking$;

  /** More things to do with the job, in the G-code menu. */
  readonly jobActions: JobAction[] = [
    {
      id: 'send-cncjs',
      label: 'Send to cncjs',
      description:
        'Loads the G-code in cncjs running on your network, ready to run from there.',
    },
    {
      id: 'cncjs-settings',
      label: 'cncjs settings…',
      description:
        'Its address, and whether the G-code button sends to it instead of downloading.',
    },
    {
      id: 'setup-sheet',
      label: 'Setup sheet',
      description:
        'A page to print for the machine: stock, zero, tools in order, times and a drawing.',
    },
    {
      id: 'share-link',
      label: 'Share link',
      description:
        'A link that opens a copy of this project, to send or bookmark (nothing is uploaded).',
    },
    {
      id: 'cut-list',
      label: 'Cut list (.csv)',
      description:
        'The parts with their sizes: nested parts with their sheet and place, else what the outside profiles cut out.',
    },
  ];

  readonly editorWidth = signal(loadEditorWidth());
  readonly resizing = signal(false);
  /** Files are being dragged over the window. */
  readonly dropping = signal(false);

  private readonly viewer = viewChild.required(ViewerComponent);

  constructor() {
    // Show a project that was just opened from the top, framed (its shapes
    // are still coming).
    this.store.replaced$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.viewer().refit());
    // Opened from a share link, or one pasted into this tab's address.
    this.projects.openLinked();
    fromEvent(window, 'hashchange')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.projects.openLinked());
    // Agents in the browser can work with the project (WebMCP).
    inject(WebMcp).start({ selectShape: (id) => this.onShapeSelect(id) });
  }

  /**
   * A shape clicked in the preview: open it in the editor (its section too)
   * and bring it into view there; null closes the shapes.
   */
  onShapeSelect(shapeId: string | null) {
    this.store.set(selectShape(this.store.value, shapeId));
    if (!shapeId) return;
    const collapsed = readCollapsedSections();
    if (collapsed.includes('shapes')) {
      writeCollapsedSections(collapsed.filter((k) => k !== 'shapes'));
    }
    // Once the editor shows it open.
    setTimeout(() =>
      document
        .querySelector(`[data-item-id="${CSS.escape(shapeId)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  /** The shape being edited dragged in the preview. */
  async onShapeMove(move: { shapeId: string; dx: number; dy: number }) {
    const id = await generateId();
    this.store.set(
      moveShape(this.store.value, move.shapeId, move.dx, move.dy, id),
    );
  }

  /** One of its points dragged in the preview. */
  onPointMove(move: { shapeId: string; handle: EditHandle; to: CamPoint }) {
    this.store.set(
      movePoint(this.store.value, move.shapeId, move.handle, move.to),
    );
  }

  /**
   * Files dragged over the window can be dropped anywhere (the browser
   * would open them in place of the app otherwise).
   */
  onDragOver(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const taken = this.projects.busy;
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = taken ? 'none' : 'copy';
    }
    this.dropping.set(!taken);
  }

  onDragLeave(event: DragEvent) {
    // Out of the window, not from one element to the next.
    if (!event.relatedTarget) this.dropping.set(false);
  }

  /**
   * Files dropped on the app: a .nc file's project is opened, each SVG
   * becomes a new shape, each STL or 3MF file a new 3D model shape. A file field takes what's dropped on it itself.
   */
  async onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    this.dropping.set(false);
    const taken = event.defaultPrevented || this.projects.busy;
    event.preventDefault();
    if (taken) return;

    const files = Array.from(event.dataTransfer?.files ?? []);
    const project = files.find((f) => droppedFileKind(f) === 'project');
    if (project) {
      await this.projects.openNcFile(project);
      return;
    }
    let model = this.store.value;
    let added: string | null = null;
    for (const file of files) {
      const context = `opening “${file.name}”`;
      const unchanged = 'Nothing was changed.';
      const kind = droppedFileKind(file);
      try {
        if (kind === 'svg') {
          const svg = await file.text();
          if (!isSvg(svg)) {
            reportError(context, 'it isn’t an SVG drawing', unchanged);
            continue;
          }
          added = await generateId();
          model = withShape(model, {
            id: added,
            type: 'svg',
            svg,
            fileName: file.name,
            expanded: true,
            transforms: [],
          });
        } else if (kind === 'model') {
          // Read once here, so a file that isn't a model adds nothing.
          await parseModelFile(await file.arrayBuffer());
          added = await generateId();
          model = withShape(model, {
            id: added,
            type: 'model',
            modelFile: await readAsDataUrl(file),
            fileName: file.name,
            expanded: true,
            // Its top at the top of the stock, where a relief carves it.
            transforms: [
              {
                id: await generateId(),
                expanded: false,
                type: 'align',
                alignX: 'none',
                alignXTo: 0,
                alignY: 'none',
                alignYTo: 0,
                alignZ: 'top',
                alignZTo: 0,
              },
            ],
          });
        } else {
          reportError(
            context,
            'only .svg files (a new shape), .stl and .3mf files (a new 3D model) and .nc files (their project) can be dropped here',
            unchanged,
          );
        }
      } catch (error) {
        reportError(context, error, unchanged);
      }
    }
    if (added) {
      this.store.set(model);
      this.onShapeSelect(added);
    }
  }

  onJobAction(id: string) {
    switch (id) {
      case 'send-cncjs':
        this.cncjs.send();
        break;
      case 'cncjs-settings':
        this.cncjs.configure();
        break;
      case 'setup-sheet':
        this.cam.openSetupSheet();
        break;
      case 'share-link':
        this.projects.share();
        break;
      case 'cut-list':
        this.cam.downloadCutList();
        break;
    }
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

/** `model` with `shape` at the end of its shapes. */
function withShape(
  model: ModelType,
  shape: ModelType['shapes'][number],
): ModelType {
  return { ...model, shapes: [...(model.shapes ?? []), shape] };
}

function hasFiles(event: DragEvent) {
  return !!event.dataTransfer?.types.includes('Files');
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
