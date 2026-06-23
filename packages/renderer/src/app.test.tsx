import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OwnDesignApp } from './app';

vi.mock('@/features/workspace/components/workspace-shell', async () => {
  const { useNavigate } = await vi.importActual<typeof import('react-router')>('react-router');

  return {
    WorkspaceShell({
      activeConversationId,
      activeProject,
      onDeleteProject,
      onSelectProject,
    }: {
      activeConversationId?: string;
      activeProject?: { id: string };
      onDeleteProject: (projectId: string) => Promise<{ href?: string }> | { href?: string };
      onSelectProject: (projectId: string) => Promise<{ href?: string }> | { href?: string };
    }) {
      const navigate = useNavigate();

      return (
        <div>
          <div>
            {activeProject?.id}:{activeConversationId}
          </div>
          <button
            onClick={() => navigate(`${window.location.pathname}?panel=preview`, { replace: true })}
            type="button"
          >
            Switch query
          </button>
          <button
            onClick={() => navigate('/projects/project-1/conversations/conversation-2')}
            type="button"
          >
            Switch conversation
          </button>
          <button
            onClick={async () => {
              const result = await Promise.resolve(onSelectProject('project-2'));

              if (result.href) {
                navigate(result.href);
              }
            }}
            type="button"
          >
            Switch project
          </button>
          <button
            onClick={async () => {
              const result = await Promise.resolve(onDeleteProject('project-2'));

              if (result?.href) {
                navigate(result.href);
              }
            }}
            type="button"
          >
            Delete inactive project
          </button>
        </div>
      );
    },
  };
});

describe('OwnDesignApp routing', () => {
  const requests: string[] = [];
  const workspaceRequests: string[] = [];
  let isProject2Deleted = false;

  beforeEach(() => {
    requests.length = 0;
    workspaceRequests.length = 0;
    isProject2Deleted = false;
    window.history.replaceState(null, '', '/projects/project-1/conversations/conversation-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        const method = input instanceof Request ? input.method : init?.method;
        requests.push(`${url.pathname}${url.search}`);

        if (url.pathname === '/api/workspace') {
          workspaceRequests.push(`${url.pathname}${url.search}`);

          const projectId = url.searchParams.get('projectId') ?? 'project-1';
          const conversationId = url.searchParams.get('conversationId') ?? 'conversation-1';

          return Response.json({
            activeConversationId: conversationId,
            activeProject: {
              createdAt: '2026-05-24T00:00:00.000Z',
              id: projectId,
              name: 'Project',
              outputType: 'html',
              updatedAt: '2026-05-24T00:00:00.000Z',
            },
            conversations: [
              {
                createdAt: '2026-05-24T00:00:00.000Z',
                id: conversationId,
                messages: [],
                projectId,
                title: 'Conversation',
                updatedAt: '2026-05-24T00:00:00.000Z',
              },
            ],
            projects: [
              {
                createdAt: '2026-05-24T00:00:00.000Z',
                id: 'project-1',
                name: 'Project',
                outputType: 'html',
                updatedAt: '2026-05-24T00:00:00.000Z',
              },
              ...(isProject2Deleted
                ? []
                : [
                    {
                      createdAt: '2026-05-24T00:00:00.000Z',
                      id: 'project-2',
                      name: 'Project 2',
                      outputType: 'html' as const,
                      updatedAt: '2026-05-24T00:00:00.000Z',
                    },
                  ]),
            ],
            settings: {
              defaultModelId: null,
              interfaceLanguage: 'zh-CN',
              modelConfigurations: [{ id: 'model-1' }],
              resources: { fontLibraries: [], iconLibraries: [] },
            },
          });
        }

        if (url.pathname === '/api/projects/project-2' && method === 'DELETE') {
          isProject2Deleted = true;
          return Response.json({ href: '/projects/project-1' });
        }

        return Response.json({});
      }),
    );
  });

  it('does not reload workspace when only an unrelated query changes', async () => {
    const user = userEvent.setup();

    render(<OwnDesignApp />);

    expect(await screen.findByText('project-1:conversation-1')).toBeInTheDocument();
    expect(workspaceRequests).toEqual([
      '/api/workspace?projectId=project-1&conversationId=conversation-1',
    ]);

    await user.click(screen.getByRole('button', { name: 'Switch query' }));
    await waitFor(() => expect(window.location.search).toBe('?panel=preview'));

    expect(workspaceRequests).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Switch conversation' }));

    expect(await screen.findByText('project-1:conversation-2')).toBeInTheDocument();
    expect(workspaceRequests).toEqual([
      '/api/workspace?projectId=project-1&conversationId=conversation-1',
      '/api/workspace?projectId=project-1&conversationId=conversation-2',
    ]);
  });

  it('does not reload workspace twice when switching projects', async () => {
    const user = userEvent.setup();

    render(<OwnDesignApp />);

    expect(await screen.findByText('project-1:conversation-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch project' }));

    expect(await screen.findByText('project-2:conversation-1')).toBeInTheDocument();
    expect(workspaceRequests).toEqual([
      '/api/workspace?projectId=project-1&conversationId=conversation-1',
      '/api/workspace?projectId=project-2',
    ]);
    expect(requests).not.toContain('/api/projects/project-2/select');
  });

  it('reloads the current workspace when deleting an inactive project', async () => {
    const user = userEvent.setup();

    render(<OwnDesignApp />);

    expect(await screen.findByText('project-1:conversation-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete inactive project' }));

    await waitFor(() => expect(workspaceRequests).toHaveLength(2));

    expect(window.location.pathname).toBe('/projects/project-1/conversations/conversation-1');
    expect(workspaceRequests).toEqual([
      '/api/workspace?projectId=project-1&conversationId=conversation-1',
      '/api/workspace?projectId=project-1&conversationId=conversation-1',
    ]);
  });
});
