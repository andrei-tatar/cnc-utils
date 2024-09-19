import { Observable } from 'rxjs';

export type OmitUnion<T, K extends keyof T> = T extends any
  ? Omit<T, K>
  : never;

export function readFile() {
  return new Observable<File>((observer) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        observer.next(file);
        observer.complete();
      }
      observer.complete();
    });
    input.addEventListener('cancel', () => {
      observer.complete();
    });
    input.addEventListener('error', (err) => {
      observer.error(err);
    });
    input.click();
  });
}

export function watchElementResize(elem: HTMLElement) {
  return new Observable<DOMRectReadOnly>((observer) => {
    var resizeObserver = new ResizeObserver((entries) => {
      observer.next(entries[0].contentRect);
    });

    resizeObserver.observe(elem);

    return () => {
      resizeObserver.unobserve(elem);
    };
  });
}

export async function generateId() {
  const data = crypto.getRandomValues(new Uint8Array(16));

  const base64url = await new Promise<string>((r) => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result as string);
    reader.readAsDataURL(new Blob([data]));
  });

  return base64url
    .slice(base64url.indexOf(',') + 1)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function lazy<T>(factory: () => T) {
  let val: T;
  let isInitialized = false;
  return {
    get value() {
      if (!isInitialized) {
        val = factory();
        isInitialized = true;
      }
      return val;
    },
  };
}
