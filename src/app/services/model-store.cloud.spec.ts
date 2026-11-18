import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { emptyModel, ModelType } from '../model-editor/model';
import { deleteProject, listProjects, Project } from '../projects';
import {
  CloudProjects,
  CloudUser,
  projectsIn,
} from '../projects/cloud-projects.service';
import { ModelStore } from './model-store.service';

/** Firebase's part, in memory: the list changes as soon as it's written. */
class FakeCloud {
  readonly user$ = new BehaviorSubject<CloudUser | null | undefined>({
    uid: 'u',
    name: '',
    email: '',
  });
  readonly projects$ = new BehaviorSubject<Project[] | null>([]);
  readonly models = new Map<string, ModelType>();

  start() {}

  async load(id: string) {
    const model = this.models.get(id);
    return model && structuredClone(model);
  }

  async put(project: Project, model: ModelType) {
    this.models.set(project.id, structuredClone(model));
    this.projects$.next([
      project,
      ...this.projects$.value!.filter((p) => p.id !== project.id),
    ]);
    await tick();
  }

  async delete(id: string) {
    this.models.delete(id);
    this.projects$.next(this.projects$.value!.filter((p) => p.id !== id));
    await tick();
  }

  /** Another browser saves a project. */
  saveElsewhere(id: string, model: ModelType) {
    const project = this.projects$.value!.find((p) => p.id === id)!;
    this.put({ ...project, savedAt: project.savedAt + 1000 }, model);
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

function modelWith(value: number): ModelType {
  return {
    ...emptyModel(),
    variables: [{ id: 'v', name: 'a', value }],
  } as ModelType;
}

describe('ModelStore with projects in Firebase', () => {
  let store: ModelStore;
  let cloud: FakeCloud;

  beforeEach(async () => {
    cloud = new FakeCloud();
    TestBed.configureTestingModule({
      providers: [{ provide: CloudProjects, useValue: cloud }],
    });
    store = TestBed.inject(ModelStore);
    await store.ready;
    store.clear();
  });

  afterEach(async () => {
    for (const project of await listProjects()) {
      if (project.name.startsWith('cloud spec')) {
        await deleteProject(project.id);
      }
    }
  });

  async function savedInCloud(): Promise<Project> {
    store.set(modelWith(1));
    await store.saveProject('cloud spec', true);
    return store.project!;
  }

  it('saves the work in Firebase and stays linked to it', async () => {
    const project = await savedInCloud();
    expect(project.cloud).toBeTrue();
    expect(cloud.projects$.value).toEqual([project]);
    expect(store.pending).toBeFalse();

    store.set(modelWith(2));
    expect(store.pending).toBeTrue();
    await store.saveProject();
    expect(store.project!.id).toBe(project.id);
    expect(cloud.models.get(project.id)!.variables[0].value).toBe(2);
    expect(store.pending).toBeFalse();
  });

  it('takes a newer copy saved from another browser', async () => {
    const project = await savedInCloud();
    cloud.saveElsewhere(project.id, modelWith(5));
    await tick();
    await tick();
    expect(store.value.variables[0].value).toBe(5);
    expect(store.project!.savedAt).toBe(project.savedAt + 1000);
    expect(store.pending).toBeFalse();
  });

  it('keeps unsaved changes when another browser saves', async () => {
    const project = await savedInCloud();
    store.set(modelWith(3));
    cloud.saveElsewhere(project.id, modelWith(5));
    await tick();
    await tick();
    expect(store.value.variables[0].value).toBe(3);
    expect(store.pending).toBeTrue();
  });

  it('leaves the work open, unsaved, when its project is gone', async () => {
    const project = await savedInCloud();
    cloud.delete(project.id);
    await tick();
    expect(store.project).toBeNull();
    expect(store.value.variables[0].value).toBe(1);

    await savedInCloud();
    cloud.projects$.next(null);
    cloud.user$.next(null);
    expect(store.project).toBeNull();
  });

  it('moves a project to this browser, the work with it', async () => {
    const project = await savedInCloud();
    store.set(modelWith(2));
    await store.transferProject(project, true);
    expect(cloud.projects$.value).toEqual([]);
    const moved = store.project!;
    expect(moved.cloud).toBeUndefined();
    expect(moved.name).toBe('cloud spec');
    expect(store.pending).toBeTrue();
    expect((await listProjects()).some((p) => p.id === moved.id)).toBeTrue();

    // And a copy back, the work staying with the one here.
    await store.transferProject(moved, false);
    expect(cloud.projects$.value!.map((p) => p.name)).toEqual(['cloud spec']);
    expect(store.project).toEqual(moved);
  });

  it('reads the stored list, newest first', () => {
    expect(
      projectsIn({
        a: { name: 'A', savedAt: 1 },
        b: { name: 'B', savedAt: 2 },
        c: { name: 'broken' },
      }),
    ).toEqual([
      { id: 'b', name: 'B', savedAt: 2, cloud: true },
      { id: 'a', name: 'A', savedAt: 1, cloud: true },
    ]);
    expect(projectsIn(null)).toEqual([]);
  });
});
