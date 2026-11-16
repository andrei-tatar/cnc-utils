import { droppedFileKind, isSvg, modelFromNcText } from './project-file';
import { getModelMetadata } from './store';
import { emptyModel } from './model-editor/model';

describe('dropped files', () => {
  it('tells SVGs and G-code files apart by name', () => {
    expect(droppedFileKind({ name: 'Logo.SVG' })).toBe('svg');
    expect(droppedFileKind({ name: 'logo', type: 'image/svg+xml' })).toBe(
      'svg',
    );
    expect(droppedFileKind({ name: 'knight.STL' })).toBe('model');
    expect(droppedFileKind({ name: 'knight.3mf' })).toBe('model');
    expect(droppedFileKind({ name: 'job.nc' })).toBe('project');
    expect(droppedFileKind({ name: 'job.gcode' })).toBe('project');
    expect(droppedFileKind({ name: 'photo.png' })).toBeNull();
  });

  it('knows an SVG drawing from other text', () => {
    expect(
      isSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'),
    ).toBeTrue();
    expect(isSvg('G0 X0 Y0')).toBeFalse();
    expect(isSvg('<html><body/></html>')).toBeFalse();
  });

  it('reads the project embedded in G-code', async () => {
    const model = emptyModel();
    const gcode = `G21\n; model=${await getModelMetadata(model)}\nM2\n`;
    expect(await modelFromNcText(gcode)).toEqual(model);
  });

  it('says so when the G-code has no project', async () => {
    await expectAsync(modelFromNcText('G21\nG0 X0\n')).toBeRejectedWithError(
      /no project/,
    );
  });

  it('says so when the project is damaged', async () => {
    await expectAsync(
      modelFromNcText('; model=H4sIAAAAnotreallygzip\n'),
    ).toBeRejectedWithError(/damaged/);
    await expectAsync(modelFromNcText('; model=!!!\n')).toBeRejectedWithError(
      /damaged/,
    );
  });
});
