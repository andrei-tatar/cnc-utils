import { inject, Injectable } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { ModelStore } from '../services/model-store.service';
import { ConfirmDialogComponent } from '../model-editor/components/confirm-dialog.component';
import { Template } from '../templates';
import { Project } from '.';
import { ProjectNameDialogComponent } from './project-name-dialog.component';

/**
 * What the toolbar does to the project, with the dialogs it takes: saving,
 * opening and deleting saved projects, and replacing the work with a new
 * or template one (asking first when something isn't saved).
 */
@Injectable({ providedIn: 'root' })
export class ProjectCommands {
  private readonly store = inject(ModelStore);
  private readonly modals = inject(NgbModal);

  /** Starts an empty project, asking first if there's unsaved work. */
  async newProject() {
    if (
      await this.confirmReplace(
        'Start a new project?',
        'The current project is closed (the tool library is kept).',
        'New project',
      )
    ) {
      this.store.clear();
    }
  }

  /** Opens a template, asking first if there's unsaved work. */
  async openTemplate(template: Template) {
    if (
      await this.confirmReplace(
        `Open “${template.name}”?`,
        'It replaces the current project.',
        'Replace project',
      )
    ) {
      await this.store.openTemplate(template);
    }
  }

  /** Opens a saved project, asking first if there's unsaved work. */
  async openProject(project: Project) {
    const reopening = project.id === this.store.project?.id;
    const confirmed = reopening
      ? await this.confirmReplace(
          `Revert to the saved “${project.name}”?`,
          'The project is opened again as it was last saved.',
          'Revert',
        )
      : await this.confirmReplace(
          `Open “${project.name}”?`,
          'It replaces the current project.',
          'Replace project',
        );
    if (confirmed) {
      await this.attempt('Couldn’t open the project', () =>
        this.store.openProject(project),
      );
    }
  }

  /**
   * Saves the work over the project it belongs to, or, when it isn't one
   * yet, as a new project (asking for a name).
   */
  async save() {
    if (!this.store.project) {
      return this.saveAs();
    }
    await this.attempt('Couldn’t save the project', () =>
      this.store.saveProject(),
    );
  }

  /** Saves the work as a new project, under a name the user gives. */
  async saveAs() {
    await this.store.refreshProjects();
    const current = this.store.project;
    const ref = this.modals.open(ProjectNameDialogComponent, {
      size: 'sm',
      centered: true,
      ariaLabelledBy: 'project-name-title',
    });
    Object.assign(ref.componentInstance, {
      title: current ? 'Save as new project' : 'Save project',
      initialName: current ? `${current.name} (copy)` : '',
      takenNames: this.store.projects$.value.map((project) => project.name),
    });
    const name: string | false = await ref.result.catch(() => false);
    if (name !== false) {
      await this.attempt('Couldn’t save the project', () =>
        this.store.saveProject(name),
      );
    }
  }

  /** Deletes a saved project, once the user confirms. */
  async delete(project: Project) {
    const confirmed = await this.confirm(
      `Delete “${project.name}”?`,
      project.id === this.store.project?.id
        ? 'The project is removed from this browser. It stays open, as unsaved work.'
        : 'The project is removed from this browser.',
      'Delete project',
    );
    if (confirmed) {
      await this.attempt('Couldn’t delete the project', () =>
        this.store.deleteProject(project),
      );
    }
  }

  /**
   * Whether the work may be replaced: yes when there's nothing unsaved in
   * it, otherwise when the user confirms.
   */
  private async confirmReplace(
    title: string,
    message: string,
    confirmLabel: string,
  ): Promise<boolean> {
    if (!this.store.pending) {
      return true;
    }
    const project = this.store.project;
    return this.confirm(
      title,
      project
        ? `${message} The unsaved changes to “${project.name}” are lost.`
        : `${message} To keep it, save it as a project or download its G-code first.`,
      confirmLabel,
    );
  }

  private confirm(
    title: string,
    message: string,
    confirmLabel: string,
  ): Promise<boolean> {
    const ref = this.modals.open(ConfirmDialogComponent, {
      size: 'sm',
      centered: true,
      ariaLabelledBy: 'confirm-title',
    });
    Object.assign(ref.componentInstance, { title, message, confirmLabel });
    return ref.result.catch(() => false);
  }

  /** Runs `work`, telling of a failure (rare: no database, say). */
  private async attempt(title: string, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      console.error(`[projects] ${title}`, error);
      alert(`${title}: ${(error as Error)?.message ?? error}`);
    }
  }
}
