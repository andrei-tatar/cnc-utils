import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import {
  cncjsAddress,
  CncjsError,
  CncjsPort,
  cncjsPorts,
  CncjsSettings,
  loadInCncjs,
} from './cncjs';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; text: string }
  | { kind: 'ports'; token: string; ports: CncjsPort[] }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string; hint: string };

/**
 * Sending the G-code to cncjs, and its settings (the address, whether the
 * G-code button sends there): the settings show first when there's no
 * address yet, or when asked for.
 */
@Component({
  selector: 'app-cncjs-dialog',
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

    .note {
      margin: 6px 0 12px;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
    }

    .status {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 0;
    }

    .status--done {
      color: var(--bs-success-text-emphasis);
    }

    .status--error {
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--bs-danger-bg-subtle);
      color: var(--bs-danger-text-emphasis);
    }

    .hint {
      margin: 8px 0 0;
      font-size: 0.8rem;
      color: var(--bs-secondary-color);
    }

    .ports {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 8px;
    }

    .test,
    .quiet {
      margin-top: 12px;
    }

    .modal-footer {
      border-top: none;
      padding-top: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <form (submit)="$event.preventDefault(); editing() && apply()">
      <div class="modal-header">
        <h2 class="modal-title" id="cncjs-title">
          {{ editing() ? 'cncjs settings' : 'Send to cncjs' }}
        </h2>
      </div>
      <div class="modal-body">
        @if (editing()) {
          <label class="form-label" for="cncjs-address">Address</label>
          <input
            id="cncjs-address"
            class="form-control form-control-sm"
            type="text"
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="cncjs.lan:8000"
            ngbAutofocus
            [value]="typed()"
            (input)="typed.set($any($event.target).value); status.set(idle)"
          />
          <p class="note">
            Where cncjs answers on your network. The browser has to be let
            through to it: cncjs must answer this site (a proxy in front of it
            adding CORS headers), and Chrome asks to allow the local network.
          </p>
          <div class="form-check">
            <input
              id="cncjs-default"
              class="form-check-input"
              type="checkbox"
              [checked]="byDefault()"
              (change)="byDefault.set($any($event.target).checked)"
            />
            <label class="form-check-label" for="cncjs-default">
              The G-code button sends to cncjs
              <span class="d-block note mt-0 mb-0"
                >Instead of downloading the file, which stays in its menu.</span
              >
            </label>
          </div>
          <div class="form-check mt-2">
            <input
              id="cncjs-quiet"
              class="form-check-input"
              type="checkbox"
              [checked]="quiet()"
              (change)="quiet.set($any($event.target).checked)"
            />
            <label class="form-check-label" for="cncjs-quiet">
              Only a short notice once it’s sent
              <span class="d-block note mt-0 mb-0"
                >No dialog, unless something goes wrong or there are several
                machines to pick from.</span
              >
            </label>
          </div>
        }
        @switch (status().kind) {
          @case ('working') {
            <p class="status" [class.test]="editing()" role="status">
              <span
                class="spinner-border spinner-border-sm"
                aria-hidden="true"
              ></span>
              {{ $any(status()).text }}
            </p>
          }
          @case ('done') {
            <p
              class="status status--done"
              [class.test]="editing()"
              role="status"
            >
              ✓ {{ $any(status()).text }}
            </p>
            @if (!editing()) {
              <div class="form-check quiet">
                <input
                  id="cncjs-quiet-next"
                  class="form-check-input"
                  type="checkbox"
                  [checked]="settings.quiet"
                  (change)="setQuiet($any($event.target).checked)"
                />
                <label class="form-check-label" for="cncjs-quiet-next">
                  Don’t show this again
                  <span class="d-block note mt-0 mb-0"
                    >Just a short notice once it’s sent. cncjs settings bring
                    this back.</span
                  >
                </label>
              </div>
            }
          }
          @case ('error') {
            <div [class.test]="editing()" role="alert">
              <p class="status status--error">{{ $any(status()).text }}</p>
              @if ($any(status()).hint) {
                <p class="hint">{{ $any(status()).hint }}</p>
              }
            </div>
          }
          @case ('ports') {
            <p class="mb-0">cncjs has several machines connected. Send to:</p>
            <div class="ports">
              @for (port of $any(status()).ports; track port.port) {
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary text-start"
                  (click)="load($any(status()).token, port)"
                >
                  {{ describe(port) }}
                </button>
              }
            </div>
          }
        }
      </div>
      <div class="modal-footer">
        @if (editing()) {
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary me-auto"
            [disabled]="!address() || busy()"
            (click)="test()"
          >
            Test
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            (click)="modal.dismiss()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-sm btn-primary"
            [disabled]="
              (!address() && (sending || typed().trim() !== '')) || busy()
            "
          >
            {{ sending ? 'Save and send' : 'Save' }}
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary me-auto"
            [disabled]="busy()"
            (click)="edit()"
          >
            Settings
          </button>
          @if (status().kind === 'error') {
            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              (click)="send()"
            >
              Try again
            </button>
          }
          @if (status().kind === 'done') {
            <a
              class="btn btn-sm btn-outline-primary"
              target="_blank"
              rel="noopener"
              [href]="settings.address"
            >
              Open cncjs
            </a>
          }
          <button
            type="button"
            class="btn btn-sm btn-primary"
            ngbAutofocus
            (click)="modal.close()"
          >
            Close
          </button>
        }
      </div>
    </form>
  `,
})
export class CncjsDialogComponent {
  readonly modal = inject(NgbActiveModal);

  /** Opened to send the G-code (not only for the settings). */
  sending = false;
  settings: CncjsSettings = { address: '', byDefault: false, quiet: false };
  /** What went wrong sending without the dialog, which it opens to say. */
  failed: unknown = null;
  save: (settings: CncjsSettings) => void = () => {};
  /** The G-code to send, once it's made. */
  program: () => Promise<{ name: string; gcode: string }> = async () => ({
    name: '',
    gcode: '',
  });

  readonly idle: Status = { kind: 'idle' };
  readonly editing = signal(false);
  readonly status = signal<Status>(this.idle);
  readonly typed = signal('');
  readonly byDefault = signal(false);
  readonly quiet = signal(false);
  readonly address = computed(() => cncjsAddress(this.typed()));
  readonly busy = computed(() => this.status().kind === 'working');

  /** Once its inputs are set: sends, or shows the settings. */
  start() {
    if (this.failed) {
      this.fail(this.failed);
    } else if (this.sending && this.settings.address) {
      this.send();
    } else {
      this.edit();
    }
  }

  edit() {
    this.typed.set(this.settings.address.replace(/^http:\/\//, ''));
    this.byDefault.set(this.settings.byDefault);
    this.quiet.set(this.settings.quiet);
    this.status.set(this.idle);
    this.editing.set(true);
  }

  /** Keeps the settings; then sends, when that's what it was opened for. */
  apply() {
    const address = this.address();
    this.settings = {
      address,
      byDefault: !!address && this.byDefault(),
      quiet: this.quiet(),
    };
    this.save(this.settings);
    if (this.sending && address) {
      this.editing.set(false);
      this.send();
    } else {
      this.modal.close();
    }
  }

  /** Says whether cncjs answers at the address typed, and what's connected. */
  async test() {
    await this.attempt(async () => {
      this.working('Reaching cncjs…');
      const { ports } = await cncjsPorts(this.address());
      this.status.set({
        kind: 'done',
        text: ports.length
          ? `cncjs answers, with ${ports.map((p) => this.describe(p)).join(', ')} connected.`
          : 'cncjs answers. No machine is connected in it yet.',
      });
    });
  }

  async send() {
    await this.attempt(async () => {
      this.working('Reaching cncjs…');
      const { token, ports } = await cncjsPorts(this.settings.address);
      if (!ports.length) {
        throw new CncjsError(
          'No machine is connected in cncjs.',
          'Open the machine’s port in cncjs first: a program is loaded for a connected machine.',
        );
      }
      if (ports.length > 1) {
        this.status.set({ kind: 'ports', token, ports });
        return;
      }
      await this.load(token, ports[0]);
    });
  }

  async load(token: string, port: CncjsPort) {
    await this.attempt(async () => {
      this.working('Making the G-code…');
      const { name, gcode } = await this.program();
      this.working('Sending it…');
      await loadInCncjs(this.settings.address, token, port.port, name, gcode);
      this.status.set({
        kind: 'done',
        text: `“${name}” is loaded in cncjs for ${this.describe(port)}. Run it from there.`,
      });
    });
  }

  /** Whether sending shows only a notice from now on. */
  setQuiet(quiet: boolean) {
    this.settings = { ...this.settings, quiet };
    this.save(this.settings);
  }

  describe(port: CncjsPort): string {
    return port.controller ? `${port.port} (${port.controller})` : port.port;
  }

  private working(text: string) {
    this.status.set({ kind: 'working', text });
  }

  private async attempt(work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      console.error('[cncjs]', error);
      this.fail(error);
    }
  }

  private fail(error: unknown) {
    this.status.set({
      kind: 'error',
      text: (error as Error)?.message ?? String(error),
      hint: error instanceof CncjsError ? error.hint : '',
    });
  }
}
