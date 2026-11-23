import { defer, forkJoin, Observable, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { Rotary } from '../../cam/rotary';
import { Heightmap, SimulatedTool } from '../../cam/simulate';
import { rotaryCuts, SimulatedSolid } from '../../cam/simulate-rotary';
import { CamPath } from '../../cam/types';
import worker from '../../worker';
import { SimulationInput } from './simulation';

/** What an angle's cuts left, and what that was worked out from. */
type Kept = { paths: CamPath[]; inputs: string; map: Heightmap };

/**
 * Simulates a stock on a rotary axis (or a board turned over), in the
 * worker: a job per angle the stock is turned to (`simulateRotaryAngle`),
 * side by side, then the solid under all of them (`rotarySolidUnder`). It
 * keeps each angle's result, so a change to the cuts at one angle
 * simulates that angle again and no other.
 */
export function rotarySimulator() {
  const kept = new Map<string, Kept>();
  return (
    paths: CamPath[],
    input: SimulationInput & { rotary: Rotary },
    cells: number,
  ): Observable<SimulatedSolid> =>
    defer(() => {
      const groups = rotaryCuts(paths);
      for (const key of [...kept.keys()]) {
        if (!groups.some((g) => g.key === key)) kept.delete(key);
      }
      const maps$ = groups.map((group) => {
        // Only the bits that cut at this angle: another's changing leaves
        // it as it is.
        const tools: Record<string, SimulatedTool> = {};
        for (const { sourceOperationId: id } of group.paths) {
          if (id && input.tools[id]) tools[id] = input.tools[id];
        }
        const inputs = JSON.stringify([
          tools,
          input.rotary,
          input.stock,
          cells,
        ]);
        const had = kept.get(group.key);
        if (
          had &&
          had.inputs === inputs &&
          had.paths.length === group.paths.length &&
          had.paths.every((path, i) => path === group.paths[i])
        ) {
          return of(had.map);
        }
        return worker
          .simulateRotaryAngle(
            group.paths,
            tools,
            input.rotary,
            input.stock,
            cells,
            { angle: group.angle, wrapped: !!group.wrapped },
          )
          .pipe(
            tap((map) =>
              kept.set(group.key, { paths: group.paths, inputs, map }),
            ),
          );
      });
      return (maps$.length ? forkJoin(maps$) : of([])).pipe(
        switchMap((maps) =>
          worker.rotarySolidUnder(
            maps.map((map, i) => ({
              angle: groups[i].angle,
              ...(groups[i].wrapped ? { wrapped: true as const } : {}),
              map,
            })),
            input.rotary,
            input.stock,
            cells,
          ),
        ),
      );
    });
}
