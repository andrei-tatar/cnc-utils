import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { listProjects, loadProject, Project } from '../../projects';
import { ModelStore } from '../../services/model-store.service';
import { generateIdSync } from '../../../util';
import { importParts, ImportSummary } from '../import-parts';
import { ModelType } from '../model';
import { borrowedShapeId } from '../operations/describe';
import { flatOperations } from '../operations/flatten';
import { shapeLabel } from '../shapes/describe';

/**
 * Copies shapes — with the operations that cut them, their tools and the
 * variables they use — from a project saved in this browser into the work
 * (see `importParts`).
 */
@Component({
  selector: 'app-import-parts-dialog',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: `
    .modal-header {
      border-bottom: none;
      padding-bottom: 0;
    }

    .modal-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .modal-body {
      font-size: 0.875rem;
    }

    .shapes {
      max-height: 40vh;
      overflow: auto;
      margin: 10px 0;
      padding: 6px 8px;
      border: 1px solid var(--bs-border-color);
      border-radius: 6px;
    }

    .shape {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 3px 0;
    }

    .cuts {
      color: var(--bs-secondary-color);
      font-size: 0.75rem;
    }

    .summary,
    .empty {
      margin: 8px 0 0;
      color: var(--bs-secondary-color);
    }

    .modal-footer {
      border-top: none;
      padding-top: 0;
    }
  `,
  template: `
    <div class="modal-header">
      <h2 class="modal-title" id="import-parts-title">
        Import shapes from a project
      </h2>
    </div>
    <div class="modal-body">
      @if (projects() === null) {
        <p class="empty">Reading the saved projects…</p>
      } @else if (!projects()!.length) {
        <p class="empty">
          No saved projects yet. Save a project (the Save button) to take its
          shapes into others.
        </p>
      } @else {
        <label class="form-label" for="import-project">From</label>
        <select
          id="import-project"
          class="form-select form-select-sm"
          ngbAutofocus
          (change)="choose($any($event.target).value)"
        >
          <option value="" [selected]="!projectId()">Pick a project…</option>
          @for (project of projects(); track project.id) {
            <option
              [value]="project.id"
              [selected]="project.id === projectId()"
            >
              {{ project.name }}
            </option>
          }
        </select>

        @if (source(); as model) {
          @if (!model.shapes.length) {
            <p class="empty">It has no shapes.</p>
          } @else {
            <div class="shapes" role="group" aria-label="Shapes">
              @for (shape of model.shapes; track shape.id) {
                <label class="shape">
                  <input
                    type="checkbox"
                    class="form-check-input"
                    [checked]="picked().has(shape.id)"
                    (change)="toggle(shape.id)"
                  />
                  <span>{{ label(shape) }}</span>
                  @if (cutsOf(shape.id); as cuts) {
                    <span class="cuts"
                      >{{ cuts }} operation{{ cuts === 1 ? '' : 's' }}</span
                    >
                  }
                </label>
              }
            </div>
            <label class="shape">
              <input
                type="checkbox"
                class="form-check-input"
                [checked]="withOperations()"
                (change)="withOperations.set(!withOperations())"
              />
              <span>with the operations that cut them, and their tools</span>
            </label>
            @if (summary(); as s) {
              <p class="summary" role="status">{{ describe(s) }}</p>
            }
          }
        }
        @if (error()) {
          <p class="empty text-danger">{{ error() }}</p>
        }
      }
    </div>
    <div class="modal-footer">
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        (click)="modal.dismiss()"
      >
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        [disabled]="!picked().size"
        (click)="import()"
      >
        Import
      </button>
    </div>
  `,
})
export class ImportPartsDialogComponent implements OnInit {
  readonly modal = inject(NgbActiveModal);
  private readonly store = inject(ModelStore);

  readonly projects = signal<Project[] | null>(null);
  readonly projectId = signal('');
  readonly source = signal<ModelType | null>(null);
  readonly picked = signal(new Set<string>());
  readonly withOperations = signal(true);
  readonly error = signal('');

  /** What importing the picked shapes would bring (worked out, not done). */
  readonly summary = computed(() => {
    const source = this.source();
    if (!source || !this.picked().size) return null;
    return importParts(
      this.store.value,
      source,
      [...this.picked()],
      this.withOperations(),
      () => '',
    ).summary;
  });

  async ngOnInit() {
    this.projects.set(await listProjects());
  }

  async choose(id: string) {
    this.projectId.set(id);
    this.picked.set(new Set());
    this.source.set(null);
    this.error.set('');
    if (!id) return;
    let model: ModelType | undefined;
    let problem = '';
    try {
      model = await loadProject(id);
    } catch (error) {
      problem = (error as Error)?.message ?? '';
    }
    if (this.projectId() !== id) return;
    if (!model || !Array.isArray(model.shapes)) {
      this.error.set(
        problem
          ? `That project couldn’t be read: ${problem}.`
          : 'That project couldn’t be read.',
      );
      return;
    }
    this.source.set(model);
  }

  toggle(id: string) {
    const next = new Set(this.picked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.picked.set(next);
  }

  label(shape: any): string {
    return shapeLabel(shape, this.source()?.shapes ?? []);
  }

  /** How many operations cut shape `id` in the project chosen. */
  cutsOf(id: string): number {
    const all = flatOperations(this.source()?.operations ?? []);
    return all.filter((op: any) => borrowedShapeId(op, all) === id).length;
  }

  describe(s: ImportSummary): string {
    const count = (n: number, one: string, many = `${one}s`) =>
      `${n} ${n === 1 ? one : many}`;
    const parts = [count(s.shapes, 'shape')];
    if (s.operations) parts.push(count(s.operations, 'operation'));
    if (s.addedTools) parts.push(count(s.addedTools, 'tool'));
    if (s.variables) parts.push(count(s.variables, 'variable'));
    const reused = s.reusedTools
      ? ` Uses ${count(s.reusedTools, 'tool')} of this project’s for the same bits.`
      : '';
    const shared = s.sharedVariables.length
      ? ` Takes this project’s ${s.sharedVariables.join(', ')}.`
      : '';
    return `Adds ${parts.join(', ')}.${reused}${shared}`;
  }

  import() {
    const source = this.source();
    if (!source || !this.picked().size) return;
    const { model } = importParts(
      this.store.value,
      source,
      [...this.picked()],
      this.withOperations(),
      generateIdSync,
    );
    this.store.set(model);
    this.modal.close(true);
  }
}
