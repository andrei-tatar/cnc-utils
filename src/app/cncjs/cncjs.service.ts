import { inject, Injectable, signal } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CamService } from '../services/cam.service';
import { ModelStore } from '../services/model-store.service';
import { fileNameFrom } from '../project-file';
import { clearNotice, showNotice } from '../notices';
import {
  cncjsPorts,
  CncjsSettings,
  loadCncjsSettings,
  loadInCncjs,
  saveCncjsSettings,
} from './cncjs';

/** The notice shown while, and once, the G-code is sent without the dialog. */
const NOTICE = 'cncjs';

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
  /** Sending without the dialog is under way. */
  private busy = false;

  /** Sends the G-code (asking for the address first when there's none). */
  send() {
    const { address, quiet } = this.settings();
    if (quiet && address) {
      this.sendQuietly(address);
    } else {
      this.open(true);
    }
  }

  /** Shows the settings. */
  configure() {
    this.open(false);
  }

  /**
   * Sends with only a notice to show for it. The dialog still opens to say
   * what went wrong, or when it has something to ask or say (several
   * machines connected, or none).
   */
  private async sendQuietly(address: string) {
    if (this.busy) return;
    this.busy = true;
    showNotice(NOTICE, 'Sending the G-code to cncjs…', true);
    try {
      const { token, ports } = await cncjsPorts(address);
      if (ports.length !== 1) {
        clearNotice(NOTICE);
        this.open(true);
        return;
      }
      const { name, gcode } = await this.program();
      await loadInCncjs(address, token, ports[0].port, name, gcode);
      showNotice(NOTICE, 'G-code sent to cncjs');
    } catch (error) {
      console.error('[cncjs]', error);
      clearNotice(NOTICE);
      this.open(true, error);
    } finally {
      this.busy = false;
    }
  }

  private async open(sending: boolean, failed: unknown = null) {
    // Fetched when first used: most never send to cncjs.
    const { CncjsDialogComponent } = await import('./cncjs-dialog.component');
    const ref = this.modals.open(CncjsDialogComponent, {
      centered: true,
      ariaLabelledBy: 'cncjs-title',
    });
    Object.assign(ref.componentInstance, {
      sending,
      failed,
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
