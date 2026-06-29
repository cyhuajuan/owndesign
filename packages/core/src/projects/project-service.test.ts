import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectService } from './project-service';
import { assertOwnDesignRuntimeScript } from '@owndesign/core/templates/owndesign-runtime';
import { WorkspaceStore } from '@owndesign/core/workspace-store';

const tempRoots: string[] = [];
let sequentialId = 0;

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'owndesign-project-service-'));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, '.owndesign'),
  });
}

function createSequentialId() {
  return () => `id-${++sequentialId}`;
}

describe('ProjectService', () => {
  it('creates a Project and auto-creates its first Conversation without global state', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });

    const { conversation, project: createdProject } = await projectService.createProject({
      name: 'Landing Redesign',
      description: 'Marketing refresh',
    });
    const state = await projectService.getProjectState();

    expect(createdProject.name).toBe('Landing Redesign');
    expect(createdProject.projectType).toBe('single_html');
    expect(createdProject.outputType).toBe('html');
    expect(state.projects).toHaveLength(1);
    await expect(
      stat(path.join(workspaceStore.getWorkspaceRoot(), 'state.json')),
    ).rejects.toThrow();

    const conversationJson = JSON.parse(
      await readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          'projects',
          createdProject.id,
          'conversations',
          `${conversation.id}.json`,
        ),
        'utf8',
      ),
    );

    expect(conversationJson.projectId).toBe(createdProject.id);
    expect(conversationJson.title).toBe('新建会话');
    expect(conversationJson.messages).toEqual([]);
    const indexHtml = await readFile(
      path.join(
        workspaceStore.getWorkspaceRoot(),
        'projects',
        createdProject.id,
        'workspace',
        'index.html',
      ),
      'utf8',
    );

    expect(indexHtml).toContain('<main id="app"></main>');
    expect(() => assertOwnDesignRuntimeScript(indexHtml)).not.toThrow();
  });

  it('stores a user-managed design document when creating a project', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      createId: createSequentialId(),
      now: () => '2026-06-29T00:00:00.000Z',
      workspaceStore,
    });

    const { project } = await projectService.createProject({
      designDocument: '# Brand\n\nUse quiet enterprise surfaces.',
      name: 'Design System Project',
    });

    await expect(workspaceStore.getProject(project.id)).resolves.toMatchObject({
      designDocument: '# Brand\n\nUse quiet enterprise surfaces.',
      name: 'Design System Project',
    });
  });

  it('rejects reserved React projects', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });

    await expect(
      projectService.createProject({
        name: 'React App',
        projectType: 'react',
      }),
    ).rejects.toThrow('React project type is reserved but not supported yet.');
  });

  it('renames a Project and updates Project Updated Time', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      now: () => '2026-05-14T10:00:00.000Z',
    });

    const { project: createdProject } = await projectService.createProject({
      name: 'Old Name',
    });

    const renamedService = new ProjectService({
      workspaceStore,
      now: () => '2026-05-14T11:00:00.000Z',
    });
    const renamedProject = await renamedService.renameProject(createdProject.id, {
      name: 'New Name',
      description: 'Sharper summary',
    });

    expect(renamedProject.name).toBe('New Name');
    expect(renamedProject.description).toBe('Sharper summary');
    expect(renamedProject.updatedAt).toBe('2026-05-14T11:00:00.000Z');

    await expect(workspaceStore.listProjects()).resolves.toEqual([renamedProject]);
  });

  it('updates the user-managed design document when renaming project settings', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      createId: createSequentialId(),
      now: () => '2026-06-29T00:00:00.000Z',
      workspaceStore,
    });
    const { project } = await projectService.createProject({
      designDocument: '# Old',
      name: 'Original',
    });

    const updated = await projectService.renameProject(project.id, {
      designDocument: '# New\n\nUse compact controls.',
      name: 'Renamed',
    });

    expect(updated.designDocument).toBe('# New\n\nUse compact controls.');
    await expect(workspaceStore.getProject(project.id)).resolves.toMatchObject({
      designDocument: '# New\n\nUse compact controls.',
      name: 'Renamed',
    });
  });

  it('removes the design document when project settings pass undefined', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      createId: createSequentialId(),
      now: () => '2026-06-29T00:00:00.000Z',
      workspaceStore,
    });
    const { project } = await projectService.createProject({
      designDocument: '# Remove me',
      name: 'Original',
    });

    const updated = await projectService.renameProject(project.id, {
      name: 'Renamed',
    });

    expect(updated.designDocument).toBeUndefined();
    await expect(workspaceStore.getProject(project.id)).resolves.toMatchObject({
      name: 'Renamed',
    });
    expect((await workspaceStore.getProject(project.id)).designDocument).toBeUndefined();
  });

  it('lists Projects without restoring global active state after reload', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const { project: firstProject } = await projectService.createProject({
      name: 'First Project',
    });
    const { project: secondProject } = await projectService.createProject({
      name: 'Second Project',
    });

    const reloadedService = new ProjectService({ workspaceStore });
    const state = await reloadedService.getProjectState();

    expect(state.projects.map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
    ]);
  });

  it('deletes a Project without writing fallback state', async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const { project: firstProject } = await projectService.createProject({
      name: 'First Project',
    });
    const { project: secondProject } = await projectService.createProject({
      name: 'Second Project',
    });

    await projectService.deleteProject(firstProject.id);

    const state = await projectService.getProjectState();

    expect(state.projects.map((project) => project.id)).toEqual([secondProject.id]);
    await expect(
      stat(path.join(workspaceStore.getWorkspaceRoot(), 'state.json')),
    ).rejects.toThrow();
  });
});
