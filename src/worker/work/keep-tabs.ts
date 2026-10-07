import { GCodeBuilder } from '../../cam/gcode-builder';
import { keepTabs as keepOutOfTabs } from '../../cam/tabs';
import { CamTab } from '../../cam/types';

/**
 * An operation's moves, going over the tabs a tool of `radius` would cut
 * into (see `keepTabs` in `src/cam/tabs.ts`).
 */
export async function keepTabs(
  builder: GCodeBuilder,
  tabs: CamTab[],
  radius: number,
): Promise<GCodeBuilder> {
  return keepOutOfTabs(builder, tabs, radius);
}
