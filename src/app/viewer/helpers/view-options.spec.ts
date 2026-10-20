import { MATERIALS } from '../../../cam/feeds-speeds';
import { materialColors } from './view-options';

describe('materialColors', () => {
  it('has a colour for every material', () => {
    const fallback = materialColors('no such material').top;
    for (const material of MATERIALS) {
      if (material.id !== 'oak') {
        expect({ ...materialColors(material.id).top })
          .withContext(material.id)
          .not.toEqual({ ...fallback });
      }
    }
  });
});
