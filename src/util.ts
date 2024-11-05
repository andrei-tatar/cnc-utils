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

export function deepEqual(x: any, y: any) {
  if (x === y) {
    return true;
  }

  if (typeof x == 'object' && x != null && typeof y == 'object' && y != null) {
    if (Object.keys(x).length != Object.keys(y).length) return false;

    for (const prop in x) {
      if (y.hasOwnProperty(prop)) {
        if (!deepEqual(x[prop], y[prop])) return false;
      } else return false;
    }

    return true;
  }

  return false;
}

export function pointsEqual(
  a: { x: number; y: number },
  b: { x: number; y: number },
  precision = 0.001,
) {
  return Math.abs(a.x - b.x) <= precision && Math.abs(a.y - b.y) <= precision;
}

export function getDistance<TPoint extends { x: number; y: number }>(
  a: TPoint,
  b: TPoint,
) {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}
