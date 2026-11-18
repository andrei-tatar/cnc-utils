import { Observable, Subject } from 'rxjs';

/**
 * A short notice for the UI ("G-code sent"), shown as a toast for a few
 * seconds — or, while `working`, until the one that takes its place.
 */
export type AppNotice = {
  /** A later notice of the same key takes this one's place. */
  key: string;
  /** What to say; null takes the notice away. */
  text: string | null;
  /** Still under way: shown with a spinner, and stays. */
  working?: boolean;
};

const notices = new Subject<AppNotice>();

/** Every notice (see showNotice), as it's given. */
export const appNotices$: Observable<AppNotice> = notices.asObservable();

/** Shows a notice, in place of the one of the same key. */
export function showNotice(key: string, text: string, working = false): void {
  notices.next({ key, text, working });
}

/** Takes a notice away (one that was `working`, and came to nothing). */
export function clearNotice(key: string): void {
  notices.next({ key, text: null });
}
