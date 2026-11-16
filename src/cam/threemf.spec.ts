import { createZip } from '../app/zip';
import { parse3mf, parseModelFile } from './threemf';

const RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

/** One triangle, in an object used by a build item and by a component. */
const model = (unit: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0" /><vertex x="0" y="2" z="3"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh></object>
  <object id="2" type="model"><components>
   <component objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>
  </components></object>
 </resources>
 <build>
  <item objectid="1"/>
  <item objectid="2" transform="0 1 0 -1 0 0 0 0 1 0 0 5"/>
 </build>
</model>`;

async function package3mf(unit = 'millimeter'): Promise<ArrayBuffer> {
  return createZip([
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: model(unit) },
  ]).arrayBuffer();
}

describe('3MF models', () => {
  it('reads what the package builds, placed by its transforms', async () => {
    const triangles = await parse3mf(await package3mf());
    const rounded = Array.from(triangles, (v) => Math.round(v * 1e6) / 1e6 + 0);
    expect(rounded).toEqual([
      // The object as it is.
      0, 0, 0, 1, 0, 0, 0, 2, 3,
      // Moved 10 along X as a component, then turned a quarter round Z and
      // lifted 5 by the build item.
      0, 10, 5, 0, 11, 5, -2, 10, 8,
    ]);
  });

  it('reads other units as mm', async () => {
    const triangles = await parse3mf(await package3mf('inch'));
    expect(triangles[3]).toBeCloseTo(25.4, 4);
    // The component's move is in inches too.
    expect(triangles[10]).toBeCloseTo(254, 3);
  });

  it('tells a 3MF package from an STL file', async () => {
    expect((await parseModelFile(await package3mf())).length).toBe(18);
    const stl = new TextEncoder().encode(
      'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n',
    );
    expect((await parseModelFile(stl.buffer as ArrayBuffer)).length).toBe(9);
  });

  it('says so when there’s no model', async () => {
    const blob = createZip([{ name: 'readme.txt', data: 'hello' }]);
    await expectAsync(parse3mf(await blob.arrayBuffer())).toBeRejectedWithError(
      /not a 3MF/,
    );
  });
});
