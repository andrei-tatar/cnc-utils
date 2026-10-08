import { of, throwError } from 'rxjs';
import { AppError, appErrors$, recover } from './errors';

describe('recover', () => {
  it('reports the error and carries on with the fallback', () => {
    spyOn(console, 'error');
    const reported: AppError[] = [];
    const subscription = appErrors$.subscribe((e) => reported.push(e));
    const values: number[] = [];
    throwError(() => new Error('boom'))
      .pipe(recover('doing a thing', () => 0))
      .subscribe((v) => values.push(v));
    subscription.unsubscribe();
    expect(values).toEqual([0]);
    expect(reported).toEqual([{ context: 'doing a thing', message: 'boom' }]);
    expect(console.error).toHaveBeenCalled();
  });

  it('passes values through untouched', () => {
    const values: number[] = [];
    of(1, 2)
      .pipe(recover('doing a thing', () => 0))
      .subscribe((v) => values.push(v));
    expect(values).toEqual([1, 2]);
  });
});
