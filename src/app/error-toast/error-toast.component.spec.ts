import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ErrorToastComponent } from './error-toast.component';
import { reportError } from '../pipeline/errors';

describe('ErrorToastComponent', () => {
  beforeEach(() => {
    spyOn(console, 'error');
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });
  afterEach(() => jasmine.clock().uninstall());

  it('shows an error, counts repeats, and goes after a while', async () => {
    const fixture = TestBed.createComponent(ErrorToastComponent);
    reportError('routing a pocket', new Error('unreachable'));
    reportError('routing a pocket', new Error('unreachable'));
    reportError('simulating the cuts', new Error('other'));
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Something went wrong');
    expect(text).toContain(
      'Error routing a pocket: the geometry kernel crashed (unreachable)',
    );
    expect(text).toContain('×2');
    expect(fixture.componentInstance.toasts().length).toBe(2);

    jasmine.clock().tick(10_001);
    expect(fixture.componentInstance.toasts().length).toBe(0);
  });

  it('closes on its button', async () => {
    const fixture = TestBed.createComponent(ErrorToastComponent);
    reportError('making a text shape', 'no font');
    await fixture.whenStable();
    fixture.nativeElement.querySelector('.btn-close').click();
    expect(fixture.componentInstance.toasts().length).toBe(0);
  });
});
