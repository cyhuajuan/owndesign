# Project DESIGN.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-managed project `DESIGN.md` support and freeze it into a conversation's agent instructions on first chat.

**Architecture:** Store the uploaded document as project metadata, not as a Project Workspace file. Project create/edit APIs carry optional raw Markdown, the renderer exposes upload/replace/remove controls in project dialogs, and `/api/chat` appends the document to `conversation.agentInstructions` only when that conversation first receives frozen instructions. Workspace tools remain unchanged, so the agent cannot create, edit, read, or delete `DESIGN.md` as a normal workspace file.

**Tech Stack:** TypeScript, Hono, React 19, Vite, Vitest, oxlint/oxfmt, existing shadcn-style UI primitives.

## Global Constraints

- `DESIGN.md` is user-maintained only. OwnDesign must not generate, rewrite, normalize, migrate, lint, summarize, or auto-create it.
- `DESIGN.md` is project setting data, not an agent workspace file.
- The agent must not have any tool path that can mutate `DESIGN.md`.
- Scheme A is required: `DESIGN.md` is frozen into `conversation.agentInstructions` on first chat only.
- Changes to project `DESIGN.md` affect only conversations whose `agentInstructions` have not yet been created.
- Existing conversations with stored `agentInstructions` keep their old frozen prompt.
- Checkpoint restore must not restore or modify project `DESIGN.md`.
- Workspace zip download should remain a workspace export and should not include project setting data in this first implementation.
- Keep the single previewable file invariant: only `index.html` is previewable.

---

## File Structure

- Modify `packages/core/src/workspace-store/store.ts`: extend `ProjectRecord` with optional `designDocument`, normalize old project records, and keep project JSON as the source of truth.
- Modify `packages/core/src/projects/project-service.ts`: accept optional design document content on create and rename/update.
- Modify `packages/core/src/projects/project-service.test.ts`: verify create/update behavior and existing project compatibility.
- Modify `packages/core/src/agent/design-page-agent.ts`: add a prompt section builder for frozen project `DESIGN.md`, append it to conversation instructions, and bump the prompt version.
- Modify `packages/core/src/agent/design-page-agent.test.ts`: verify prompt section rendering and no-section behavior.
- Modify `packages/server/src/app.ts`: parse `designDocument` on create/patch and freeze project design content into first-time conversation instructions.
- Modify `packages/server/src/app.test.ts`: verify API persistence, instruction freezing, and non-retroactive updates.
- Modify `packages/renderer/src/api/client.ts`: pass optional design document content through project create/rename calls.
- Modify `packages/renderer/src/features/projects/components/control-bar.tsx`: add upload/remove UI to create and edit project dialogs.
- Modify `packages/renderer/src/features/projects/components/control-bar.test.tsx`: verify upload, replace, remove, and payloads.
- Modify `packages/renderer/src/app.tsx`: adapt project action signatures.
- Modify `packages/renderer/src/features/i18n/translations.ts`: add zh-CN and en-US strings.

---

### Task 1: Persist Project Design Document

**Files:**
- Modify: `packages/core/src/workspace-store/store.ts`
- Modify: `packages/core/src/projects/project-service.ts`
- Test: `packages/core/src/projects/project-service.test.ts`
- Test: `packages/core/src/workspace-store/store.test.ts`

**Interfaces:**
- Consumes: existing `ProjectRecord`, `ProjectService.createProject`, `ProjectService.renameProject`.
- Produces:
  - `ProjectRecord.designDocument?: string`
  - `CreateProjectInput.designDocument?: string | null`
  - `RenameProjectInput.designDocument?: string | null`
  - Existing project JSON files without `designDocument` still load successfully.

- [ ] **Step 1: Write failing project service tests**

Add these imports only if the file does not already have them:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
```

Add tests to `packages/core/src/projects/project-service.test.ts`:

```ts
it('stores a user-managed design document when creating a project', async () => {
  const workspaceStore = await createWorkspaceStore();
  const projectService = new ProjectService({
    createId: createSequentialId(),
    now: () => '2026-06-29T00:00:00.000Z',
    workspaceStore,
  });

  const { project } = await projectService.createProject({
    designDocument: '   ',
    name: 'Design System Project',
  });

  await expect(workspaceStore.getProject(project.id)).resolves.toMatchObject({
    designDocument: '   ',
    name: 'Design System Project',
  });
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

it('removes the design document when project settings pass null', async () => {
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
    designDocument: null,
  });

  expect(updated.designDocument).toBeUndefined();
  await expect(workspaceStore.getProject(project.id)).resolves.toMatchObject({
    name: 'Renamed',
  });
  expect((await workspaceStore.getProject(project.id)).designDocument).toBeUndefined();
});
```

Add this store compatibility test to `packages/core/src/workspace-store/store.test.ts`:

```ts
it('loads older project records without a design document', async () => {
  const store = await createWorkspaceStore();
  const project = buildProject({ id: 'legacy-project', name: 'Legacy Project' });

  await store.createProject(project);

  const projectJsonPath = path.join(
    store.getWorkspaceRoot(),
    'projects',
    project.id,
    'project.json',
  );
  const rawProject = JSON.parse(await readFile(projectJsonPath, 'utf8')) as Record<string, unknown>;

  delete rawProject.designDocument;
  await writeFile(projectJsonPath, JSON.stringify(rawProject, null, 2), 'utf8');

  await expect(store.getProject(project.id)).resolves.toMatchObject({
    id: 'legacy-project',
    name: 'Legacy Project',
    projectType: 'single_html',
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @owndesign/core test -- src/projects/project-service.test.ts src/workspace-store/store.test.ts
```

Expected: FAIL with TypeScript or assertion failures because `designDocument` is not part of the project types/service inputs yet.

- [ ] **Step 3: Implement metadata persistence**

In `packages/core/src/workspace-store/store.ts`, extend `ProjectRecord`:

```ts
export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  designDocument?: string | null;
  projectType?: ProjectType;
  outputType?: ProjectOutputType;
  createdAt: string;
  updatedAt: string;
};
```

Keep `normalizeProjectRecord` simple and non-mutating:

```ts
function normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    designDocument: typeof project.designDocument === 'string' ? project.designDocument : undefined,
    projectType: project.projectType ?? 'single_html',
  };
}
```

In `packages/core/src/projects/project-service.ts`, extend input types:

```ts
type CreateProjectInput = {
  defaultConversationTitle?: string;
  name: string;
  description?: string;
  designDocument?: string | null;
  projectType?: ProjectType;
};

type RenameProjectInput = {
  name: string;
  description?: string;
  designDocument?: string | null;
};
```

Set the field in `createProject`:

```ts
const project: ProjectRecord = {
  id: this.createId(),
  name: input.name,
  description: input.description,
  projectType,
  outputType: 'html',
  createdAt: timestamp,
  updatedAt: timestamp,
  ...(typeof input.designDocument === 'string' ? { designDocument: input.designDocument } : {}),
};
```

Update `renameProject`:

```ts
const renamedProject: ProjectRecord = {
  ...existingProject,
  name: input.name,
  description: input.description,
  updatedAt: this.now(),
};

if (Object.prototype.hasOwnProperty.call(input, 'designDocument')) {
  if (input.designDocument === null) {
    delete renamedProject.designDocument;
  } else if (typeof input.designDocument === 'string') {
    renamedProject.designDocument = input.designDocument;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --filter @owndesign/core test -- src/projects/project-service.test.ts src/workspace-store/store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workspace-store/store.ts packages/core/src/projects/project-service.ts packages/core/src/projects/project-service.test.ts packages/core/src/workspace-store/store.test.ts
git commit -m "feat: store project design document"
```

---

### Task 2: Freeze DESIGN.md Into Agent Instructions

**Files:**
- Modify: `packages/core/src/agent/design-page-agent.ts`
- Test: `packages/core/src/agent/design-page-agent.test.ts`

**Interfaces:**
- Consumes: `ProjectRecord.designDocument?: string` from server code.
- Produces:
  - `DESIGN_PAGE_AGENT_PROMPT_VERSION = 7`
  - `buildDesignPageConversationInstructions(resources?: ResourceSettings, designDocument?: string | null): string`
  - `buildProjectDesignDocumentPrompt(designDocument: string | null | undefined): string`

- [ ] **Step 1: Write failing prompt tests**

Add tests to `packages/core/src/agent/design-page-agent.test.ts`:

```ts
it('freezes project DESIGN.md into conversation instructions when provided', () => {
  const instructions = buildDesignPageConversationInstructions(undefined, [
    '# Brand System',
    '',
    'Use dense dashboard layouts and avoid playful illustration.',
  ].join('\n'));

  expect(instructions).toContain('<project_design_document>');
  expect(instructions).toContain('## Project DESIGN.md');
  expect(instructions).toContain('user-maintained project design document');
  expect(instructions).toContain('read-only design guidance');
  expect(instructions).toContain('# Brand System');
  expect(instructions).toContain('Use dense dashboard layouts');
  expect(instructions).toContain('</project_design_document>');
});

it('omits project DESIGN.md section when document is undefined', () => {
  const instructions = buildDesignPageConversationInstructions(undefined, undefined);

  expect(instructions).not.toContain('<project_design_document>');
  expect(instructions).not.toContain('## Project DESIGN.md');
});

it('increments the prompt version for project DESIGN.md behavior', () => {
  expect(DESIGN_PAGE_AGENT_PROMPT_VERSION).toBe(7);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
```

Expected: FAIL because the function signature and version are not updated.

- [ ] **Step 3: Implement prompt section**

In `packages/core/src/agent/design-page-agent.ts`, bump the version:

```ts
export const DESIGN_PAGE_AGENT_PROMPT_VERSION = 7;
```

Change instruction builders:

```ts
export function buildDesignPageAgentInstructions(
  resources?: ResourceSettings,
  designDocument?: string | null,
) {
  return buildDesignPageConversationInstructions(resources, designDocument);
}

export function buildDesignPageConversationInstructions(
  resources?: ResourceSettings,
  designDocument?: string | null,
) {
  const sections: DesignPromptSection[] = [
    {
      tag: 'design_agent_core',
      content: loadDesignPageAgentCorePrompt(),
    },
    {
      tag: 'page_target_protocol',
      content: buildPageTargetProtocolPrompt(),
    },
    {
      tag: 'tool_workflow',
      content: buildToolWorkflowPrompt(),
    },
    {
      tag: 'frontend_capabilities',
      content: buildFrontendCapabilityPrompt(),
    },
    {
      tag: 'resource_policy',
      content: resources ? buildResourcePolicyPrompt(resources) : buildResourcePolicyFallbackPrompt(),
    },
  ];

  const projectDesignPrompt = buildProjectDesignDocumentPrompt(designDocument);

  if (projectDesignPrompt) {
    sections.push({
      tag: 'project_design_document',
      content: projectDesignPrompt,
    });
  }

  return renderDesignPromptSections(sections);
}
```

Add helper:

```ts
export function buildProjectDesignDocumentPrompt(designDocument: string | null | undefined) {
  if (designDocument == null) {
    return undefined;
  }

  return [
    '## Project DESIGN.md',
    '',
    'The following content is the user-maintained project design document frozen for this conversation.',
    'Treat it as read-only design guidance when creating or editing `index.html`.',
    'OwnDesign must not create, edit, overwrite, normalize, migrate, or summarize this document.',
    'Do not claim that you changed `DESIGN.md`; only the user can update it in project settings.',
    'If the user asks for a change that conflicts with this document, explain the conflict briefly and follow the user request only as a one-off change unless they update project settings.',
    '',
    '```md',
    designDocument,
    '```',
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --filter @owndesign/core test -- src/agent/design-page-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/design-page-agent.ts packages/core/src/agent/design-page-agent.test.ts
git commit -m "feat: freeze project design doc in prompt"
```

---

### Task 3: Wire Server API and First-Chat Freezing

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes:
  - `body.designDocument?: unknown` in `POST /api/projects`
  - `body.designDocument?: unknown` in `PATCH /api/projects/:projectId`
  - `project.designDocument?: string` in `/api/chat`
- Produces:
  - Project create/update persists uploaded Markdown.
  - First chat stores `conversation.agentInstructions` with that project's current design document.
  - Existing frozen conversations are not rebuilt after project setting edits.

- [ ] **Step 1: Write failing server tests**

Add tests to `packages/server/src/app.test.ts` near the existing project creation and agent instruction tests:

```ts
it('creates projects with user-managed design documents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'owndesign-server-'));
  const app = createOwnDesignApp({ workspaceRoot: root });

  const response = await app.request(
    new Request('http://localhost/api/projects', {
      body: JSON.stringify({
        designDocument: '# Brand\n\nUse restrained SaaS styling.',
        name: 'With Design',
        projectType: 'single_html',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { href: string };
  const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(body.href);
  const workspaceStore = createWorkspaceStore({ workspaceRoot: root });

  await expect(workspaceStore.getProject(match?.[1] ?? '')).resolves.toMatchObject({
    designDocument: '# Brand\n\nUse restrained SaaS styling.',
    name: 'With Design',
  });
});

it('updates project design documents through project settings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'owndesign-server-'));
  const app = createOwnDesignApp({ workspaceRoot: root });
  const { projectId } = await setupProject(app);
  const workspaceStore = createWorkspaceStore({ workspaceRoot: root });

  const response = await app.request(
    new Request(`http://localhost/api/projects/${projectId}`, {
      body: JSON.stringify({
        designDocument: '# Updated\n\nUse compact admin surfaces.',
        name: 'Updated Project',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }),
  );

  expect(response.status).toBe(200);
  await expect(workspaceStore.getProject(projectId)).resolves.toMatchObject({
    designDocument: '# Updated\n\nUse compact admin surfaces.',
    name: 'Updated Project',
  });
});

it('freezes project DESIGN.md into agent instructions on first chat', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'owndesign-server-'));
  const app = createOwnDesignApp({ workspaceRoot: root });
  const { conversationId, projectId } = await setupProject(app);
  const workspaceStore = createWorkspaceStore({ workspaceRoot: root });
  const project = await workspaceStore.getProject(projectId);

  await workspaceStore.updateProject(projectId, {
    ...project,
    designDocument: '# Design Rules\n\nUse warm neutrals and dense forms.',
  });

  const response = await app.request(
    new Request('http://localhost/api/chat', {
      body: JSON.stringify({
        conversationId,
        message: { id: 'msg-1', text: 'Design a dashboard' },
        projectId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );

  expect(response.status).toBe(200);
  const conversation = await workspaceStore.getConversation(projectId, conversationId);

  expect(conversation.agentPromptVersion).toBe(DESIGN_PAGE_AGENT_PROMPT_VERSION);
  expect(conversation.agentInstructions).toContain('<project_design_document>');
  expect(conversation.agentInstructions).toContain('# Design Rules');
  expect(conversation.agentInstructions).toContain('Use warm neutrals and dense forms.');
});

it('does not rebuild frozen agent instructions after project DESIGN.md changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'owndesign-server-'));
  const app = createOwnDesignApp({ workspaceRoot: root });
  const { conversationId, projectId } = await setupProject(app);
  const workspaceStore = createWorkspaceStore({ workspaceRoot: root });
  const project = await workspaceStore.getProject(projectId);

  await workspaceStore.updateProject(projectId, {
    ...project,
    designDocument: '# First Rules',
  });

  await app.request(
    new Request('http://localhost/api/chat', {
      body: JSON.stringify({
        conversationId,
        message: { id: 'msg-1', text: 'Design a landing page' },
        projectId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );

  await workspaceStore.updateProject(projectId, {
    ...(await workspaceStore.getProject(projectId)),
    designDocument: '# Second Rules',
  });

  await app.request(
    new Request('http://localhost/api/chat', {
      body: JSON.stringify({
        conversationId,
        message: { id: 'msg-2', text: 'Adjust spacing' },
        projectId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );

  const conversation = await workspaceStore.getConversation(projectId, conversationId);

  expect(conversation.agentInstructions).toContain('# First Rules');
  expect(conversation.agentInstructions).not.toContain('# Second Rules');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @owndesign/server test -- src/app.test.ts
```

Expected: FAIL because API parsing and prompt freezing are not wired.

- [ ] **Step 3: Implement server parsing and freezing**

In `packages/server/src/app.ts`, add helper:

```ts
function asDesignDocument(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  return value === null ? null : undefined;
}
```

In `POST /api/projects`, pass the body field:

```ts
const result = await services.projectService.createProject({
  defaultConversationTitle: getDefaultConversationTitle(settings.interfaceLanguage),
  name: trimmedName,
  description: asNonEmptyString(body.description),
  designDocument: asDesignDocument(body.designDocument),
  projectType,
});
```

In `PATCH /api/projects/:projectId`, pass the body field:

```ts
await createProjectService(options).renameProject(projectId, {
  name: trimmedName,
  description: asNonEmptyString(body.description),
  designDocument: asDesignDocument(body.designDocument),
});
```

In `/api/chat`, freeze current project setting only inside the existing first-instructions block:

```ts
if (!conversation.agentInstructions) {
  conversation = await workspaceStore.updateConversation(projectId, conversationId, {
    ...conversation,
    agentInstructions: buildDesignPageConversationInstructions(
      agentContext.resources,
      project.designDocument,
    ),
    agentPromptVersion: DESIGN_PAGE_AGENT_PROMPT_VERSION,
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --filter @owndesign/server test -- src/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts
git commit -m "feat: freeze project design doc on chat"
```

---

### Task 4: Add Project UI Upload and Settings Editing

**Files:**
- Modify: `packages/renderer/src/api/client.ts`
- Modify: `packages/renderer/src/app.tsx`
- Modify: `packages/renderer/src/features/projects/components/control-bar.tsx`
- Modify: `packages/renderer/src/features/i18n/translations.ts`
- Test: `packages/renderer/src/features/projects/components/control-bar.test.tsx`

**Interfaces:**
- Consumes: `ProjectRecord.designDocument?: string`
- Produces:
  - `api.createProject(name, description?, projectType?, designDocument?)`
  - `api.renameProject(projectId, name, description?, designDocument?)`
  - `ControlBar` project create and edit dialogs can upload/replace/remove `DESIGN.md`.

- [ ] **Step 1: Write failing renderer tests**

Add tests to `packages/renderer/src/features/projects/components/control-bar.test.tsx`:

```tsx
it('uploads a design document when creating a project', async () => {
  const user = userEvent.setup();
  const onCreateProject = vi.fn(async () => undefined);

  renderControlBar({
    onCreateProject,
    projects: [],
  });

  await user.click(screen.getByText('New Project'));
  await user.type(screen.getByLabelText('Project name'), 'Design Project');
  await user.upload(
    screen.getByLabelText('DESIGN.md'),
    new File(['# Brand\n\nUse focused layouts.'], 'DESIGN.md', {
      type: 'text/markdown',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Create' }));

  expect(onCreateProject).toHaveBeenCalledWith(
    'Design Project',
    undefined,
    '# Brand\n\nUse focused layouts.',
  );
});

it('updates a project design document from project settings', async () => {
  const user = userEvent.setup();
  const onRenameProject = vi.fn(async () => undefined);

  renderControlBar({
    onRenameProject,
    projects: [
      {
        createdAt: '2026-06-29T00:00:00.000Z',
        designDocument: '# Old',
        id: 'project-1',
        name: 'Project One',
        projectType: 'single_html',
        updatedAt: '2026-06-29T00:00:00.000Z',
      },
    ],
  });

  await user.click(screen.getByLabelText('Project Switcher Project One'));
  await user.click(screen.getByLabelText('Rename'));
  await user.upload(
    screen.getByLabelText('DESIGN.md'),
    new File(['# New\n\nUse clear contrast.'], 'DESIGN.md', {
      type: 'text/markdown',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(onRenameProject).toHaveBeenCalledWith(
    'project-1',
    'Project One',
    undefined,
    '# New\n\nUse clear contrast.',
  );
});

it('removes a project design document from project settings', async () => {
  const user = userEvent.setup();
  const onRenameProject = vi.fn(async () => undefined);

  renderControlBar({
    onRenameProject,
    projects: [
      {
        createdAt: '2026-06-29T00:00:00.000Z',
        designDocument: '# Existing',
        id: 'project-1',
        name: 'Project One',
        projectType: 'single_html',
        updatedAt: '2026-06-29T00:00:00.000Z',
      },
    ],
  });

  await user.click(screen.getByLabelText('Project Switcher Project One'));
  await user.click(screen.getByLabelText('Rename'));
  await user.click(screen.getByRole('button', { name: 'Remove DESIGN.md' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(onRenameProject).toHaveBeenCalledWith('project-1', 'Project One', undefined, null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @owndesign/renderer test -- src/features/projects/components/control-bar.test.tsx
```

Expected: FAIL because the UI and callback signatures do not support design documents.

- [ ] **Step 3: Update API client and app action signatures**

In `packages/renderer/src/api/client.ts`:

```ts
createProject(
  name: string,
  description?: string,
  projectType = 'single_html',
  designDocument?: string | null,
) {
  return requestJson<ActionResult>('/api/projects', {
    body: JSON.stringify({ description, designDocument, name, projectType }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
},
```

```ts
renameProject(projectId: string, name: string, description?: string, designDocument?: string | null) {
  return requestJson<ActionResult>(`/api/projects/${encodeURIComponent(projectId)}`, {
    body: JSON.stringify({ description, designDocument, name }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
  });
},
```

In `packages/renderer/src/app.tsx`, keep `onCreateProject: api.createProject` and `onRenameProject: api.renameProject` if TypeScript accepts the widened signatures. If it does not, add wrappers that preserve the argument order used by `ControlBar`.

- [ ] **Step 4: Add project dialog state and file reader**

In `packages/renderer/src/features/projects/components/control-bar.tsx`, update prop types:

```ts
onCreateProject: (
  name: string,
  description?: string,
  designDocument?: string | null,
) => Promise<ControlBarActionResult> | ControlBarActionResult;
```

```ts
onRenameProject: (
  projectId: string,
  name: string,
  description?: string,
  designDocument?: string | null,
) => Promise<ControlBarActionResult> | ControlBarActionResult;
```

Add state:

```ts
const [projectDesignDocument, setProjectDesignDocument] = useState<string | null>();
const [renameDesignDocument, setRenameDesignDocument] = useState<string | null>();
const projectDesignDocumentId = useId();
const renameDesignDocumentId = useId();
```

Add helper inside the component file:

```ts
async function readDesignDocumentFile(file: File | undefined) {
  if (!file) {
    return undefined;
  }

  return file.text();
}
```

In the project create dialog, add a field:

```tsx
<Field>
  <FieldLabel htmlFor={projectDesignDocumentId}>{t('projects.designDocument')}</FieldLabel>
  <Input
    accept=".md,text/markdown,text/plain"
    id={projectDesignDocumentId}
    onChange={(event) => {
      void readDesignDocumentFile(event.currentTarget.files?.[0]).then(setProjectDesignDocument);
    }}
    type="file"
  />
  {projectDesignDocument ? (
    <div className="text-xs text-muted-foreground">
      {t('projects.designDocumentAttached')}
    </div>
  ) : null}
</Field>
```

In the project rename branch, add a matching field and remove button:

```tsx
{renameTarget?.type === 'project' ? (
  <Field>
    <FieldLabel htmlFor={renameDesignDocumentId}>{t('projects.designDocument')}</FieldLabel>
    <Input
      accept=".md,text/markdown,text/plain"
      id={renameDesignDocumentId}
      onChange={(event) => {
        void readDesignDocumentFile(event.currentTarget.files?.[0]).then(setRenameDesignDocument);
      }}
      type="file"
    />
    {renameDesignDocument ? (
      <div className="text-xs text-muted-foreground">
        {t('projects.designDocumentAttached')}
      </div>
    ) : null}
    {renameDesignDocument ? (
      <Button
        onClick={() => setRenameDesignDocument(undefined)}
        type="button"
        variant="outline"
      >
        {t('projects.removeDesignDocument')}
      </Button>
    ) : null}
  </Field>
) : null}
```

When opening project rename, initialize:

```ts
setRenameDesignDocument(project.designDocument);
```

When closing rename dialog, clear:

```ts
setRenameDesignDocument(undefined);
```

Update create submit:

```ts
void runAction(onCreateProject(trimmedName, undefined, projectDesignDocument));
```

Update rename submit:

```ts
void runAction(
  onRenameProject(
    target.project.id,
    trimmedName,
    trimmedDescription || undefined,
    renameDesignDocument,
  ),
);
```

- [ ] **Step 5: Add translations**

In `packages/renderer/src/features/i18n/translations.ts`, add zh-CN:

```ts
'projects.designDocument': 'DESIGN.md',
'projects.designDocumentAttached': '已选择 DESIGN.md',
'projects.removeDesignDocument': '移除 DESIGN.md',
```

Add en-US:

```ts
'projects.designDocument': 'DESIGN.md',
'projects.designDocumentAttached': 'DESIGN.md selected',
'projects.removeDesignDocument': 'Remove DESIGN.md',
```

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @owndesign/renderer test -- src/features/projects/components/control-bar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src/api/client.ts packages/renderer/src/app.tsx packages/renderer/src/features/projects/components/control-bar.tsx packages/renderer/src/features/projects/components/control-bar.test.tsx packages/renderer/src/features/i18n/translations.ts
git commit -m "feat: upload project design document"
```

---

### Task 5: End-to-End Verification and Guardrails

**Files:**
- Modify tests only if earlier implementation reveals type fallout.

**Interfaces:**
- Consumes: all task outputs.
- Produces: verified project behavior across core, server, and renderer.

- [ ] **Step 1: Run focused package checks**

Run:

```bash
pnpm --filter @owndesign/core typecheck
pnpm --filter @owndesign/server typecheck
pnpm --filter @owndesign/renderer typecheck
```

Expected: all commands exit 0.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @owndesign/core test -- src/projects/project-service.test.ts src/workspace-store/store.test.ts src/agent/design-page-agent.test.ts
pnpm --filter @owndesign/server test -- src/app.test.ts
pnpm --filter @owndesign/renderer test -- src/features/projects/components/control-bar.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 3: Run repo lint and full typecheck**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Manually verify through the local app**

Run:

```bash
pnpm dev
```

Expected: server on `127.0.0.1:3711` and web on `127.0.0.1:3710`.

Manual checks:

- Create a new project and upload a local Markdown file named `DESIGN.md`.
- Send the first chat message in that project's initial conversation.
- Inspect `~/.owndesign/projects/<project-id>/conversations/<conversation-id>.json` or the test workspace equivalent and verify `agentInstructions` contains `<project_design_document>` and the uploaded Markdown.
- Replace the project `DESIGN.md` in project settings.
- Send another message in the same conversation and verify `agentInstructions` still contains the old document.
- Create a new conversation in the same project, send its first message, and verify that new conversation freezes the updated document.
- Use agent workspace tools indirectly through a chat request and verify no `DESIGN.md` appears in workspace listing because it is not inside `workspace/`.

- [ ] **Step 5: Commit verification fixes if needed**

If typecheck, lint, or tests require small compatibility changes:

```bash
git add <changed-files>
git commit -m "fix: align design document integration"
```

Expected: only compatibility or test fixes are committed here.

---

## Self-Review

- Spec coverage: The plan covers user upload/maintenance, project setting persistence, create/edit flows, first-chat freezing, non-retroactive updates, prompt rules, and tool non-mutability by keeping the document outside Project Workspace.
- Placeholder scan: No task uses TBD/TODO/fill-later language. Each implementation step includes concrete file paths, signatures, code, commands, and expected outcomes.
- Type consistency: The plan consistently uses `designDocument?: string | null` on Task 1 service inputs, with `null` meaning removal and exact string content preserved without trimming or normalization.
