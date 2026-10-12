import { emptyModel, ModelType } from './model-editor/model';
import { shareLink, sharedProject, sharedProjectData } from './share-link';

describe('share links', () => {
  const model = {
    ...emptyModel(),
    shapes: [{ id: 's', type: 'circle', diameter: 20, transforms: [] }],
    // Enough to need every base64 character, padding included.
    variables: [{ id: 'v', name: 'note', value: 'ÿ?>~ ü' }],
  } as unknown as ModelType;

  it('carry the project in the fragment, and give it back', async () => {
    const link = await shareLink(model, 'https://cnc.example/app/');
    expect(link.startsWith('https://cnc.example/app/#project=')).toBe(true);
    // Safe in a URL as it is.
    expect(link).toMatch(/^[^#]*#project=[A-Za-z0-9_-]+$/);
    const data = sharedProjectData(new URL(link).hash)!;
    expect(await sharedProject(data)).toEqual(model);
  });

  it('find no project in other fragments', () => {
    expect(sharedProjectData('')).toBeNull();
    expect(sharedProjectData('#top')).toBeNull();
    expect(sharedProjectData('#project=')).toBeNull();
  });

  it('tell a link cut short from a project', async () => {
    const link = await shareLink(model, 'https://cnc.example/');
    const data = sharedProjectData(new URL(link).hash)!;
    await expectAsync(sharedProject(data.slice(0, 20))).toBeRejectedWithError(
      /cut short or damaged/,
    );
  });
});
