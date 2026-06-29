import { useState, type ComponentProps } from 'react';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ControlBar } from './control-bar';

describe('ControlBar', () => {
  it('switches Project through searchable switcher', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Alpha Website',
      }),
    );

    await user.type(screen.getByPlaceholderText('搜索项目...'), 'mobile');
    await user.click(screen.getByRole('option', { name: 'Mobile App Refresh' }));

    expect(
      screen.getByRole('button', {
        name: '项目切换器 Mobile App Refresh',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '会话切换器 Navigation audit',
      }),
    ).toBeInTheDocument();
  });

  it('shows optimistic project and hides stale conversations while switching', async () => {
    const user = userEvent.setup();
    const projects = [
      {
        id: 'project-alpha',
        name: 'Alpha Website',
        outputType: 'html' as const,
        createdAt: '2026-05-14T10:00:00.000Z',
        updatedAt: '2026-05-14T10:00:00.000Z',
      },
      {
        id: 'project-beta',
        name: 'Mobile App Refresh',
        outputType: 'html' as const,
        createdAt: '2026-05-14T11:00:00.000Z',
        updatedAt: '2026-05-14T11:00:00.000Z',
      },
    ];
    const alphaConversations = [
      {
        id: 'conversation-alpha-1',
        projectId: 'project-alpha',
        title: 'Landing page polish',
        createdAt: '2026-05-14T10:00:00.000Z',
        updatedAt: '2026-05-14T10:00:00.000Z',
        messages: [],
      },
    ];
    const betaConversations = [
      {
        id: 'conversation-beta-1',
        projectId: 'project-beta',
        title: 'Navigation audit',
        createdAt: '2026-05-14T11:00:00.000Z',
        updatedAt: '2026-05-14T11:00:00.000Z',
        messages: [],
      },
    ];
    const pendingProjectSelect = new Promise<void>(() => {});
    const { rerender } = render(
      <ControlBar
        activeConversationId="conversation-alpha-1"
        activeProjectId="project-alpha"
        conversations={alphaConversations}
        onCreateConversation={() => undefined}
        onCreateProject={() => undefined}
        onDeleteConversation={() => undefined}
        onDeleteProject={() => undefined}
        onRenameConversation={() => undefined}
        onRenameProject={() => undefined}
        onSelectConversation={() => undefined}
        onSelectProject={() => pendingProjectSelect}
        projects={projects}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Alpha Website',
      }),
    );
    await user.click(screen.getByRole('option', { name: 'Mobile App Refresh' }));

    expect(
      screen.getByRole('button', {
        name: '项目切换器 Mobile App Refresh',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '会话切换器 加载会话...' })).toBeDisabled();
    expect(
      screen.queryByRole('button', {
        name: '会话切换器 Landing page polish',
      }),
    ).not.toBeInTheDocument();

    rerender(
      <ControlBar
        activeConversationId="conversation-beta-1"
        activeProjectId="project-beta"
        conversations={betaConversations}
        onCreateConversation={() => undefined}
        onCreateProject={() => undefined}
        onDeleteConversation={() => undefined}
        onDeleteProject={() => undefined}
        onRenameConversation={() => undefined}
        onRenameProject={() => undefined}
        onSelectConversation={() => undefined}
        onSelectProject={() => pendingProjectSelect}
        projects={projects}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: '会话切换器 Navigation audit',
        }),
      ).toBeInTheDocument(),
    );
  });

  it('switches Conversation through searchable switcher', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '会话切换器 Landing page polish',
      }),
    );

    await user.click(screen.getByRole('option', { name: 'Hero messaging' }));

    expect(
      screen.getByRole('button', {
        name: '会话切换器 Hero messaging',
      }),
    ).toBeInTheDocument();
  });

  it('creates Project from Project switcher action', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Alpha Website',
      }),
    );
    await user.click(screen.getByRole('option', { name: '新建项目' }));
    await user.type(screen.getByLabelText('项目名称'), 'Control Bar Launch');
    await user.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: '项目切换器 Control Bar Launch',
        }),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: '会话切换器 新建会话',
        }),
      ).toBeInTheDocument(),
    );
  });

  it('uploads a design document when creating a project', async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn(async () => undefined);

    renderControlBar({
      onCreateProject,
      projects: [],
    });

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 暂无当前项目',
      }),
    );
    await user.click(screen.getByRole('option', { name: '新建项目' }));
    await user.type(screen.getByLabelText('项目名称'), 'Design Project');
    await user.upload(
      screen.getByLabelText('DESIGN.md'),
      new File(['# Brand\n\nUse focused layouts.'], 'DESIGN.md', {
        type: 'text/markdown',
      }),
    );
    await user.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() =>
      expect(onCreateProject).toHaveBeenCalledWith(
        'Design Project',
        undefined,
        '# Brand\n\nUse focused layouts.',
      ),
    );
  });

  it('waits for design document reading before creating a project', async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn(async () => undefined);
    const textDeferred = createDeferred<string>();
    const fileTextSpy = vi
      .spyOn(File.prototype, 'text')
      .mockImplementationOnce(() => textDeferred.promise);

    renderControlBar({
      onCreateProject,
      projects: [],
    });

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 暂无当前项目',
      }),
    );
    await user.click(screen.getByRole('option', { name: '新建项目' }));
    await user.type(screen.getByLabelText('项目名称'), 'Design Project');
    await user.upload(
      screen.getByLabelText('DESIGN.md'),
      new File(['ignored'], 'DESIGN.md', {
        type: 'text/markdown',
      }),
    );

    const createButton = screen.getByRole('button', { name: '创建项目' });

    expect(createButton).toBeDisabled();

    await user.click(createButton);
    expect(onCreateProject).not.toHaveBeenCalled();

    textDeferred.resolve('# Exact\n\nPreserve trailing spaces.  \n');

    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    await waitFor(() =>
      expect(onCreateProject).toHaveBeenCalledWith(
        'Design Project',
        undefined,
        '# Exact\n\nPreserve trailing spaces.  \n',
      ),
    );

    fileTextSpy.mockRestore();
  });

  it('creates Conversation from Conversation switcher action', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '会话切换器 Landing page polish',
      }),
    );
    await user.click(screen.getByRole('option', { name: '新建会话' }));

    expect(
      screen.getByRole('button', {
        name: '会话切换器 新建会话 3',
      }),
    ).toBeInTheDocument();
  });

  it('renames Project from Project switcher item menu', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Alpha Website',
      }),
    );
    const alphaOption = screen.getByRole('option', { name: /Alpha Website/ });
    await user.click(within(alphaOption).getByRole('button', { name: '重命名' }));
    await user.clear(screen.getByLabelText('新名称'));
    await user.type(screen.getByLabelText('新名称'), 'Alpha Redesign');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: '项目切换器 Alpha Redesign',
        }),
      ).toBeInTheDocument(),
    );
  });

  it('updates a project design document from project settings', async () => {
    const user = userEvent.setup();
    const onRenameProject = vi.fn(async () => undefined);

    renderControlBar({
      activeProjectId: 'project-1',
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

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Project One',
      }),
    );
    await user.click(screen.getByRole('button', { name: '重命名' }));
    await user.upload(
      screen.getByLabelText('DESIGN.md'),
      new File(['# New\n\nUse clear contrast.'], 'DESIGN.md', {
        type: 'text/markdown',
      }),
    );
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(onRenameProject).toHaveBeenCalledWith(
        'project-1',
        'Project One',
        undefined,
        '# New\n\nUse clear contrast.',
      ),
    );
  });

  it('omits an untouched existing project design document from project settings', async () => {
    const user = userEvent.setup();
    const onRenameProject = vi.fn(async () => undefined);

    renderControlBar({
      activeProjectId: 'project-1',
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

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Project One',
      }),
    );
    await user.click(screen.getByRole('button', { name: '重命名' }));
    await user.clear(screen.getByLabelText('新名称'));
    await user.type(screen.getByLabelText('新名称'), 'Project Prime');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(onRenameProject).toHaveBeenCalledWith(
        'project-1',
        'Project Prime',
        undefined,
        undefined,
      ),
    );
  });

  it('waits for design document reading before saving project settings', async () => {
    const user = userEvent.setup();
    const onRenameProject = vi.fn(async () => undefined);
    const textDeferred = createDeferred<string>();
    const fileTextSpy = vi
      .spyOn(File.prototype, 'text')
      .mockImplementationOnce(() => textDeferred.promise);

    renderControlBar({
      activeProjectId: 'project-1',
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

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Project One',
      }),
    );
    await user.click(screen.getByRole('button', { name: '重命名' }));
    await user.upload(
      screen.getByLabelText('DESIGN.md'),
      new File(['ignored'], 'DESIGN.md', {
        type: 'text/markdown',
      }),
    );

    const saveButton = screen.getByRole('button', { name: '保存' });

    expect(saveButton).toBeDisabled();

    await user.click(saveButton);
    expect(onRenameProject).not.toHaveBeenCalled();

    textDeferred.resolve('# Updated\n\nKeep final newline.\n');

    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() =>
      expect(onRenameProject).toHaveBeenCalledWith(
        'project-1',
        'Project One',
        undefined,
        '# Updated\n\nKeep final newline.\n',
      ),
    );

    fileTextSpy.mockRestore();
  });

  it('removes a project design document from project settings', async () => {
    const user = userEvent.setup();
    const onRenameProject = vi.fn(async () => undefined);

    renderControlBar({
      activeProjectId: 'project-1',
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

    await user.click(
      screen.getByRole('button', {
        name: '项目切换器 Project One',
      }),
    );
    await user.click(screen.getByRole('button', { name: '重命名' }));
    await user.click(screen.getByRole('button', { name: '移除 DESIGN.md' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(onRenameProject).toHaveBeenCalledWith('project-1', 'Project One', undefined, null),
    );
  });

  it('deletes Conversation through confirmation dialog', async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole('button', {
        name: '会话切换器 Landing page polish',
      }),
    );
    const heroOption = screen.getByRole('option', { name: /Hero messaging/ });
    await user.click(within(heroOption).getByRole('button', { name: '删除' }));
    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(
      screen.getByRole('button', {
        name: '会话切换器 Landing page polish',
      }),
    );

    expect(screen.queryByRole('option', { name: /Hero messaging/ })).not.toBeInTheDocument();
  });
});

function ControlBarHarness() {
  const [projects, setProjects] = useState([
    {
      id: 'project-alpha',
      name: 'Alpha Website',
      outputType: 'html' as const,
      createdAt: '2026-05-14T10:00:00.000Z',
      updatedAt: '2026-05-14T10:00:00.000Z',
    },
    {
      id: 'project-beta',
      name: 'Mobile App Refresh',
      outputType: 'html' as const,
      createdAt: '2026-05-14T11:00:00.000Z',
      updatedAt: '2026-05-14T11:00:00.000Z',
    },
  ]);
  const [activeProjectId, setActiveProjectId] = useState('project-alpha');
  const [conversationsByProject, setConversationsByProject] = useState<
    Record<
      string,
      Array<{
        id: string;
        projectId: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messages: never[];
      }>
    >
  >({
    'project-alpha': [
      {
        id: 'conversation-alpha-1',
        projectId: 'project-alpha',
        title: 'Landing page polish',
        createdAt: '2026-05-14T10:00:00.000Z',
        updatedAt: '2026-05-14T10:00:00.000Z',
        messages: [],
      },
      {
        id: 'conversation-alpha-2',
        projectId: 'project-alpha',
        title: 'Hero messaging',
        createdAt: '2026-05-14T10:30:00.000Z',
        updatedAt: '2026-05-14T10:30:00.000Z',
        messages: [],
      },
    ],
    'project-beta': [
      {
        id: 'conversation-beta-1',
        projectId: 'project-beta',
        title: 'Navigation audit',
        createdAt: '2026-05-14T11:00:00.000Z',
        updatedAt: '2026-05-14T11:00:00.000Z',
        messages: [],
      },
    ],
  });
  const [activeConversationIds, setActiveConversationIds] = useState<Record<string, string>>({
    'project-alpha': 'conversation-alpha-1',
    'project-beta': 'conversation-beta-1',
  });

  return (
    <ControlBar
      activeConversationId={activeConversationIds[activeProjectId]}
      activeProjectId={activeProjectId}
      conversations={conversationsByProject[activeProjectId]}
      onCreateConversation={async () => {
        const nextCount = conversationsByProject[activeProjectId].length + 1;
        const nextConversationId = `conversation-${activeProjectId}-${nextCount}`;
        const nextConversation = {
          id: nextConversationId,
          projectId: activeProjectId,
          title: `新建会话 ${nextCount}`,
          createdAt: '2026-05-14T12:30:00.000Z',
          updatedAt: '2026-05-14T12:30:00.000Z',
          messages: [],
        };

        setConversationsByProject((current) => ({
          ...current,
          [activeProjectId]: [nextConversation, ...current[activeProjectId]],
        }));
        setActiveConversationIds((current) => ({
          ...current,
          [activeProjectId]: nextConversationId,
        }));
      }}
      onCreateProject={async (name, description) => {
        const nextProjectNumber = projects.length + 1;
        const nextProjectId = `project-${nextProjectNumber}`;
        const nextConversationId = `conversation-${nextProjectNumber}-1`;

        setProjects((current) => [
          ...current,
          {
            id: nextProjectId,
            name,
            description,
            outputType: 'html',
            createdAt: '2026-05-14T12:00:00.000Z',
            updatedAt: '2026-05-14T12:00:00.000Z',
          },
        ]);
        setConversationsByProject((current) => ({
          ...current,
          [nextProjectId]: [
            {
              id: nextConversationId,
              projectId: nextProjectId,
              title: '新建会话',
              createdAt: '2026-05-14T12:00:00.000Z',
              updatedAt: '2026-05-14T12:00:00.000Z',
              messages: [],
            },
          ],
        }));
        setActiveConversationIds((current) => ({
          ...current,
          [nextProjectId]: nextConversationId,
        }));
        setActiveProjectId(nextProjectId);
      }}
      onDeleteConversation={async (conversationId) => {
        setConversationsByProject((current) => ({
          ...current,
          [activeProjectId]: current[activeProjectId].filter(
            (conversation) => conversation.id !== conversationId,
          ),
        }));
      }}
      onDeleteProject={async (projectId) => {
        setProjects((current) => current.filter((project) => project.id !== projectId));
        if (activeProjectId === projectId) {
          const fallbackProject = projects.find((project) => project.id !== projectId);
          setActiveProjectId(fallbackProject?.id ?? '');
        }
      }}
      onRenameConversation={async (conversationId, title) => {
        setConversationsByProject((current) => ({
          ...current,
          [activeProjectId]: current[activeProjectId].map((conversation) =>
            conversation.id === conversationId ? { ...conversation, title } : conversation,
          ),
        }));
      }}
      onRenameProject={async (projectId, name, description) => {
        setProjects((current) =>
          current.map((project) =>
            project.id === projectId ? { ...project, name, description } : project,
          ),
        );
      }}
      onSelectConversation={async (conversationId) => {
        setActiveConversationIds((current) => ({
          ...current,
          [activeProjectId]: conversationId,
        }));
      }}
      onSelectProject={async (projectId) => {
        setActiveProjectId(projectId);
      }}
      projects={projects}
    />
  );
}

function renderControlBar(overrides: Partial<ComponentProps<typeof ControlBar>> = {}) {
  return render(
    <ControlBar
      activeConversationId={overrides.activeConversationId}
      activeProjectId={overrides.activeProjectId}
      conversations={overrides.conversations ?? []}
      onCreateConversation={overrides.onCreateConversation ?? (() => undefined)}
      onCreateProject={overrides.onCreateProject ?? (() => undefined)}
      onDeleteConversation={overrides.onDeleteConversation ?? (() => undefined)}
      onDeleteProject={overrides.onDeleteProject ?? (() => undefined)}
      onRenameConversation={overrides.onRenameConversation ?? (() => undefined)}
      onRenameProject={overrides.onRenameProject ?? (() => undefined)}
      onSelectConversation={overrides.onSelectConversation ?? (() => undefined)}
      onSelectProject={overrides.onSelectProject ?? (() => undefined)}
      projects={overrides.projects ?? []}
    />,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}
