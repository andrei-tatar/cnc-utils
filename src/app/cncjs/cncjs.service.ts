import { inject, Injectable, signal } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CamService } from '../services/cam.service';
import { ModelStore } from '../services/model-store.service';
import { fileNameFrom } from '../project-file';
import { CncjsSettings, loadCncjsSettings, saveCncjsSettings } from './cncjs';

/**
 * The G-code menu's "Send to cncjs": loads the job's G-code in the user's
 * cncjs (see `cncjs.ts`), whose address — and whether the G-code button
 * sends there instead of downloading — is kept in this browser.
 */
@Injectable({ providedIn: 'root' })
export class Cncjs {
  private readonly modals = inject(NgbModal);
  private readonly cam = inject(CamService);
  private readonly store = inject(ModelStore);

  readonly settings = signal<CncjsSettings>(loadCncjsSettings());

  /** Sends the G-code (asking for the address first when there's none). */
  send() {
    this.open(true);
  }

  /** Shows the settings. */
  configure() {
    this.open(false);
  }

  private async open(sending: boolean) {
    // Fetched when first used: most never send to cncjs.
    const { CncjsDialogComponent } = await import('./cncjs-dialog.component');
    const ref = this.modals.open(CncjsDialogComponent, {
      centered: true,
      ariaLabelledBy: 'cncjs-title',
    });
    Object.assign(ref.componentInstance, {
      sending,
      settings: this.settings(),
      save: (settings: CncjsSettings) => {
        saveCncjsSettings(settings);
        this.settings.set(settings);
      },
      program: () => this.program(),
    });
    ref.componentInstance.start();
    ref.result.catch(() => {});
  }

  /** The job's G-code (the project in it), named after the project. */
  private async program(): Promise<{ name: string; gcode: string }> {
    const [file] = await this.cam.gcode('one', true);
    const name = fileNameFrom(this.store.project?.name ?? '') || 'gcode';
    return { name: `${name}.nc`, gcode: file.gcode };
  }
}
